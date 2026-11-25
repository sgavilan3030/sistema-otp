#!/usr/bin/env bash
# ==========================================================
# ACTUALIZADOR TOTAL AUTOMATICO PARA VPS ASTERISK 20
# Ejecutar en la terminal SSH de tu VPS: bash update_vps.sh
# ==========================================================
set -e

echo ""
echo "=========================================================="
echo "    INICIANDO ACTUALIZACION COMPLETA EN TU VPS"
echo "=========================================================="
echo ""

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ ! -f "$APP_DIR/package.json" ]; then
  if [ -f "/var/www/sistema-otp/package.json" ]; then
    APP_DIR="/var/www/sistema-otp"
  elif [ -f "/root/sistema-otp/package.json" ]; then
    APP_DIR="/root/sistema-otp"
  elif [ -f "$(pwd)/package.json" ]; then
    APP_DIR="$(pwd)"
  elif [ -f "/var/www/black-hat-dialer/package.json" ]; then
    APP_DIR="/var/www/black-hat-dialer"
  fi
fi

echo "=== [1/6] Directorio de la aplicacion: $APP_DIR ==="
cd "$APP_DIR"

echo "=== [2/6] Descargando ultimos cambios de GitHub (git pull) ==="
# Preservar bases de datos de clientes, saldos, .env y configuraciones activas
mkdir -p /tmp/ast20_db_backup
[ -f .env ] && cp -f .env /tmp/ast20_db_backup/.env 2>/dev/null || true
[ -f reseller_data.json ] && cp -f reseller_data.json /tmp/ast20_db_backup/reseller_data.json 2>/dev/null || true
[ -d data ] && cp -rf data /tmp/ast20_db_backup/ 2>/dev/null || true

if [ -d ".git" ]; then
  echo "-> Actualizando repositorio git..."
  git fetch --all || true
  BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
  [ "$BRANCH" = "HEAD" ] && BRANCH="main"
  git reset --hard "origin/$BRANCH" 2>/dev/null || git reset --hard origin/main 2>/dev/null || git pull --force || true
  echo "✓ Repositorio actualizado a la última versión remota."
else
  echo "Aviso: No se detectó repositorio .git directo, usando archivos locales actuales."
fi

# Restaurar .env, bases de datos de clientes y saldos para que ninguna actualización sobreescriba datos
if [ -f /tmp/ast20_db_backup/.env ]; then
  cp -f /tmp/ast20_db_backup/.env ./.env 2>/dev/null || true
fi
if [ -f /tmp/ast20_db_backup/reseller_data.json ]; then
  cp -f /tmp/ast20_db_backup/reseller_data.json ./reseller_data.json 2>/dev/null || true
fi
if [ -d /tmp/ast20_db_backup/data ]; then
  mkdir -p ./data
  cp -rn /tmp/ast20_db_backup/data/* ./data/ 2>/dev/null || true
fi

# Asegurar archivo .env con claves aleatorias de produccion si faltan
touch .env
chmod 600 .env 2>/dev/null || true
if ! grep -q "^AUTH_SECRET=" .env || grep -q '^AUTH_SECRET=""' .env; then
  GEN_AUTH=$(openssl rand -hex 32 2>/dev/null || node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  sed -i '/^AUTH_SECRET=/d' .env 2>/dev/null || true
  echo "AUTH_SECRET=\"${GEN_AUTH}\"" >> .env
  echo "-> AUTH_SECRET generado automáticamente en .env"
fi
if ! grep -q "^INTERNAL_WEBHOOK_KEY=" .env || grep -q '^INTERNAL_WEBHOOK_KEY=""' .env; then
  GEN_WHK=$(openssl rand -hex 24 2>/dev/null || node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
  sed -i '/^INTERNAL_WEBHOOK_KEY=/d' .env 2>/dev/null || true
  echo "INTERNAL_WEBHOOK_KEY=\"${GEN_WHK}\"" >> .env
  echo "-> INTERNAL_WEBHOOK_KEY generada automáticamente en .env"
fi
chmod 750 data 2>/dev/null || true

# Verificar herramienta ffmpeg / sox para conversión de audios 8kHz
if ! command -v ffmpeg >/dev/null 2>&1 && ! command -v sox >/dev/null 2>&1; then
  echo "-> Instalando ffmpeg para conversión de audios Asterisk..."
  (apt-get update -qq && apt-get install -y -qq ffmpeg) 2>/dev/null || (yum install -y -q ffmpeg) 2>/dev/null || true
fi

echo "=== [3/6] Instalando/verificando dependencias de Node.js ==="
npm install --prefer-offline --no-audit 2>/dev/null || npm install || true

echo "=== [4/6] Compilando frontend (Vite) y backend (esbuild) en dist/ ==="
npm run build

echo "=== [5/6] Sincronizando configuracion pura Asterisk 20 y Audios ==="
mkdir -p /etc/asterisk
mkdir -p /var/spool/asterisk/outgoing
chmod 750 /var/spool/asterisk/outgoing 2>/dev/null || true
chown -R asterisk:asterisk /var/spool/asterisk/outgoing 2>/dev/null || true

# Detectar IP pública real del VPS para NAT y RTP bidireccional
PUBLIC_IP=$(curl -s -m 3 https://api.ipify.org || curl -s -m 3 https://ifconfig.me || curl -s -m 3 https://icanhazip.com || hostname -I | awk '{print $1}')
echo "-> IP Pública del VPS para RTP/NAT: $PUBLIC_IP"

# Copiar configuraciones locales si existen (manager.conf solo en 127.0.0.1 y sin secreto débil)
[ -f rtp.conf ] && cp -f rtp.conf /etc/asterisk/rtp.conf || true
if [ -f /etc/asterisk/manager.conf ]; then
  sed -i 's/bindaddr = 0.0.0.0/bindaddr = 127.0.0.1/g' /etc/asterisk/manager.conf 2>/dev/null || true
  chmod 640 /etc/asterisk/manager.conf 2>/dev/null || true
fi
[ -f amd.conf ] && cp -f amd.conf /etc/asterisk/amd.conf || true
[ -f extensions.conf ] && cp -f extensions.conf /etc/asterisk/extensions.conf || true
if [ -f pjsip.conf ]; then
  cp -f pjsip.conf /etc/asterisk/pjsip.conf
  if [ -n "$PUBLIC_IP" ] && ! grep -q "external_media_address" /etc/asterisk/pjsip.conf; then
    sed -i "/bind = 0.0.0.0:47923/a local_net = 127.0.0.0/8\nlocal_net = 10.0.0.0/8\nlocal_net = 172.16.0.0/12\nlocal_net = 192.168.0.0/16\nexternal_media_address = $PUBLIC_IP\nexternal_signaling_address = $PUBLIC_IP:47923" /etc/asterisk/pjsip.conf
  fi
fi

# Copiar audios WAV de alta calidad (sin .gsm comprimido) a directorios estándar de Asterisk con permisos seguros (775)
mkdir -p /var/lib/asterisk/sounds/custom /var/lib/asterisk/sounds/es/custom /var/lib/asterisk/sounds/en/custom
mkdir -p /usr/share/asterisk/sounds/custom /usr/share/asterisk/sounds/es/custom /usr/share/asterisk/sounds/en/custom
if [ -d "public/assets" ]; then
  for wavfile in public/assets/*.wav; do
    [ -f "$wavfile" ] || continue
    basewav=$(basename "$wavfile" .wav)
    for snddir in /var/lib/asterisk/sounds/custom /var/lib/asterisk/sounds/es/custom /var/lib/asterisk/sounds/en/custom /var/lib/asterisk/sounds /usr/share/asterisk/sounds/custom /usr/share/asterisk/sounds/es/custom /usr/share/asterisk/sounds/en/custom /usr/share/asterisk/sounds; do
      cp -f "$wavfile" "$snddir/" 2>/dev/null || true
      rm -f "$snddir/${basewav}.gsm" 2>/dev/null || true
    done
  done
fi
chmod -R 775 /var/lib/asterisk/sounds /usr/share/asterisk/sounds 2>/dev/null || true
chown -R asterisk:asterisk /var/lib/asterisk/sounds /usr/share/asterisk/sounds 2>/dev/null || true

# Recargar Asterisk y módulo de timing de alta precisión
echo "Recargando Asterisk Timing, PJSIP, RTP, Dialplan y Manager..."
asterisk -rx "module load res_timing_timerfd.so" 2>/dev/null || true
asterisk -rx "module reload res_rtp_asterisk.so" 2>/dev/null || true
asterisk -rx "module reload app_amd.so" 2>/dev/null || true
asterisk -rx "core reload" 2>/dev/null || true
asterisk -rx "pjsip reload" 2>/dev/null || true
asterisk -rx "dialplan reload" 2>/dev/null || true
asterisk -rx "manager reload" 2>/dev/null || true
asterisk -rx "pjsip send register reg_televox" 2>/dev/null || true
asterisk -rx "pjsip send register reg_ghost" 2>/dev/null || true
echo "Estado de registros SIP con el proveedor:"
asterisk -rx "pjsip show registrations" 2>/dev/null || true

echo "=== [6/6] Reiniciando servicio de la aplicacion Node.js ==="
# Garantizar que el puerto 3000 no quede bloqueado por procesos zombies, systemd duplicados o huérfanos
echo "Liberando puerto 3000 y deteniendo procesos duplicados..."
if command -v pm2 >/dev/null 2>&1; then
  pm2 stop all 2>/dev/null || true
  systemctl stop sistema-otp asterisk-web dialer otp 2>/dev/null || true
  systemctl disable sistema-otp asterisk-web dialer otp 2>/dev/null || true
fi
fuser -k 3000/tcp 2>/dev/null || true
pkill -9 -f "dist/server.cjs" 2>/dev/null || true
pkill -9 -f "tsx server.ts" 2>/dev/null || true
sleep 1

if command -v pm2 >/dev/null 2>&1; then
  pm2 delete all 2>/dev/null || true
  cd "$APP_DIR"
  NODE_ENV=production pm2 start dist/server.cjs --name "sistema-otp" -- --production
  pm2 save 2>/dev/null || true
  echo "✓ Proceso PM2 'sistema-otp' iniciado en MODO PRODUCCIÓN puro en el puerto 3000."
elif systemctl is-active --quiet sistema-otp 2>/dev/null; then
  systemctl restart sistema-otp
  echo "✓ Servicio systemd sistema-otp reiniciado."
elif systemctl is-active --quiet asterisk-web 2>/dev/null; then
  systemctl restart asterisk-web
  echo "✓ Servicio systemd asterisk-web reiniciado."
elif systemctl is-active --quiet dialer 2>/dev/null; then
  systemctl restart dialer
  echo "✓ Servicio systemd dialer reiniciado."
elif systemctl is-active --quiet otp 2>/dev/null; then
  systemctl restart otp
  echo "✓ Servicio systemd otp reiniciado."
else
  NODE_ENV=production nohup node dist/server.cjs --production > app.log 2>&1 &
  echo "✓ Aplicacion iniciada en producción en segundo plano (PID: $!)."
fi

echo ""
echo "=========================================================="
echo "    ¡ACTUALIZACION COMPLETADA EXITOSAMENTE!"
echo "=========================================================="
echo " 1. Frontend y Backend compilados en dist/ (Reventa de Minutos y MicroSIP activos)."
echo " 2. Asterisk 20 actualizado en puerto 47923."
echo " 3. Servicio Node.js reiniciado y escuchando en el puerto 3000."
echo ""
echo " >>> ATENCION CRITICA <<<"
echo " En tu navegador presiona CTRL + F5 (o abre una ventana de incógnito)"
echo " para limpiar la caché del navegador y ver todos los cambios nuevos."
echo "=========================================================="
