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
      const callerId = ext.callerId || `"Ext ${num}" <${num}>`;
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

        // If registration is required with carrier
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

        // Endpoint for the Carrier
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
        if (carrier.fromuser) {
          pjsipContent += `from_user = ${carrier.fromuser}\n`;
        }
        pjsipContent += `from_domain = ${cHost}\n`;
        pjsipContent += `direct_media = no\n`;
        pjsipContent += `rtp_symmetric = yes\n`;
        pjsipContent += `force_rport = yes\n`;
        pjsipContent += `rewrite_contact = yes\n`;
        pjsipContent += `transport = transport-udp\n\n`;

        // Auth section for Carrier
        if (cSecret) {
          pjsipContent += `[auth_${cName}]\n`;
          pjsipContent += `type = auth\n`;
          pjsipContent += `auth_type = userpass\n`;
          pjsipContent += `username = ${cUser}\n`;
          pjsipContent += `password = ${cSecret}\n\n`;
        }

        // AOR for Carrier
        pjsipContent += `[${cName}]\n`;
        pjsipContent += `type = aor\n`;
        pjsipContent += `contact = sip:${cHost}:${cPort}\n`;
        pjsipContent += `qualify_frequency = ${carrier.qualifyFreq || 60}\n\n`;

        // Identify for incoming IP/host traffic
        pjsipContent += `[${cName}-identify]\n`;
        pjsipContent += `type = identify\n`;
        pjsipContent += `endpoint = ${cName}\n`;
        pjsipContent += `match = ${cHost}\n\n`;
      }
    }

    const asteriskPjsipPath = '/etc/asterisk/pjsip.conf';
    let fileWritten = false;
    let writeError = null;

    // Direct fs write
    try {
      fs.writeFileSync(asteriskPjsipPath, pjsipContent, 'utf8');
      fileWritten = true;
    } catch (err: any) {
      writeError = err.message;
      // Fallback using tee via shell
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

    // Also write to local app dir for safety
    try {
      fs.writeFileSync(path.join(process.cwd(), 'pjsip.conf'), pjsipContent, 'utf8');
    } catch (e) {}

    // Send Hot Reload to Asterisk AMI immediately
    const amiOutput = await sendAmiAction('127.0.0.1', 5038, 'sammy', 'Robert2026RDTGcvgbsg', [
      'pjsip reload',
      'pjsip show endpoints',
    ]);

    // Also call asterisk -rx directly via child_process as guarantee
    exec('asterisk -rx "pjsip reload"', () => {});

    res.json({
      success: true,
      message: `Configuración sincronizada con Asterisk: ${extensions.length} extensiones activas`,
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
