import express from 'express';
import path from 'path';
import fs from 'fs';
import net from 'net';
import { createServer as createViteServer } from 'vite';

const app = express();
const PORT = 3000;

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
      pjsipContent += `context = from-internal\n`;
      pjsipContent += `disallow = all\n`;
      pjsipContent += `allow = ${codecs}\n`;
      pjsipContent += `auth = ${num}-auth\n`;
      pjsipContent += `aors = ${num}-aor\n`;
      pjsipContent += `callerid = ${callerId}\n`;
      pjsipContent += `direct_media = no\n\n`;

      pjsipContent += `[${num}-auth]\n`;
      pjsipContent += `type = auth\n`;
      pjsipContent += `auth_type = userpass\n`;
      pjsipContent += `username = ${num}\n`;
      pjsipContent += `password = ${pass}\n\n`;

      pjsipContent += `[${num}-aor]\n`;
      pjsipContent += `type = aor\n`;
      pjsipContent += `max_contacts = ${ext.maxContacts || 2}\n`;
      pjsipContent += `remove_existing = yes\n\n`;
    }

    // Write directly to Asterisk configuration if directory exists
    const asteriskDir = '/etc/asterisk';
    let fileWritten = false;
    let writePath = '/tmp/pjsip.conf';

    if (fs.existsSync(asteriskDir)) {
      try {
        fs.writeFileSync(path.join(asteriskDir, 'pjsip.conf'), pjsipContent, 'utf8');
        fileWritten = true;
        writePath = path.join(asteriskDir, 'pjsip.conf');
      } catch (err: any) {
        console.warn('Could not write to /etc/asterisk/pjsip.conf directly (permission issue?):', err.message);
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

    res.json({
      success: true,
      message: `Configuración de ${extensions.length} extensiones aplicada con éxito en Asterisk`,
      fileWritten,
      writePath,
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
      } catch (e) {}
    }

    const amiOutput = await sendAmiAction('127.0.0.1', 5038, 'sammy', 'Robert2026RDTGcvgbsg', [
      'dialplan reload',
      'dialplan show from-internal',
    ]);

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
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Asterisk 20 Governor Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
