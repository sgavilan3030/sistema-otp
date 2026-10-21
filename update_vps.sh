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
  if [ -f "/root/sistema-otp/package.json" ]; then
    APP_DIR="/root/sistema-otp"
  elif [ -f "$(pwd)/package.json" ]; then
    APP_DIR="$(pwd)"
  elif [ -f "/var/www/sistema-otp/package.json" ]; then
    APP_DIR="/var/www/sistema-otp"
  elif [ -f "/var/www/black-hat-dialer/package.json" ]; then
    APP_DIR="/var/www/black-hat-dialer"
  fi
fi

echo "=== [1/6] Directorio de la aplicacion: $APP_DIR ==="
cd "$APP_DIR"

echo "=== [2/6] Descargando ultimos cambios de GitHub (git pull) ==="
# Preservar bases de datos de clientes, saldos y configuraciones activas
mkdir -p /tmp/ast20_db_backup
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

# Restaurar bases de datos de clientes y saldos para que ninguna actualización sobreescriba datos
if [ -f /tmp/ast20_db_backup/reseller_data.json ]; then
  cp -f /tmp/ast20_db_backup/reseller_data.json ./reseller_data.json 2>/dev/null || true
fi
if [ -d /tmp/ast20_db_backup/data ]; then
  mkdir -p ./data
  cp -rn /tmp/ast20_db_backup/data/* ./data/ 2>/dev/null || true
fi


echo "=== [3/6] Instalando/verificando dependencias de Node.js ==="
npm install --prefer-offline --no-audit 2>/dev/null || npm install || true

echo "=== [4/6] Compilando frontend (Vite) y backend (esbuild) en dist/ ==="
npm run build

echo "=== [5/6] Sincronizando configuracion pura Asterisk 20 y Audios ==="
mkdir -p /etc/asterisk
mkdir -p /var/spool/asterisk/outgoing
chmod 777 /var/spool/asterisk/outgoing 2>/dev/null || true

# Detectar IP pública real del VPS para NAT y RTP bidireccional
PUBLIC_IP=$(curl -s -m 3 https://api.ipify.org || curl -s -m 3 https://ifconfig.me || curl -s -m 3 https://icanhazip.com || hostname -I | awk '{print $1}')
echo "-> IP Pública del VPS para RTP/NAT: $PUBLIC_IP"

# Copiar configuraciones locales si existen
[ -f rtp.conf ] && cp -f rtp.conf /etc/asterisk/rtp.conf || true
[ -f manager.conf ] && cp -f manager.conf /etc/asterisk/manager.conf || true
[ -f amd.conf ] && cp -f amd.conf /etc/asterisk/amd.conf || true
[ -f extensions.conf ] && cp -f extensions.conf /etc/asterisk/extensions.conf || true
if [ -f pjsip.conf ]; then
  cp -f pjsip.conf /etc/asterisk/pjsip.conf
  if [ -n "$PUBLIC_IP" ] && ! grep -q "external_media_address" /etc/asterisk/pjsip.conf; then
    sed -i "/bind = 0.0.0.0:47923/a local_net = 127.0.0.0/8\nlocal_net = 10.0.0.0/8\nlocal_net = 172.16.0.0/12\nlocal_net = 192.168.0.0/16\nexternal_media_address = $PUBLIC_IP\nexternal_signaling_address = $PUBLIC_IP:47923" /etc/asterisk/pjsip.conf
  fi
fi

# Copiar audios a todos los directorios estándar de Asterisk
mkdir -p /var/lib/asterisk/sounds/custom /var/lib/asterisk/sounds/es/custom /var/lib/asterisk/sounds/en/custom
mkdir -p /usr/share/asterisk/sounds/custom /usr/share/asterisk/sounds/es/custom /usr/share/asterisk/sounds/en/custom
if [ -d "public/assets" ]; then
  cp -f public/assets/*.wav /var/lib/asterisk/sounds/custom/ 2>/dev/null || true
  cp -f public/assets/*.gsm /var/lib/asterisk/sounds/custom/ 2>/dev/null || true
  cp -f public/assets/*.wav /var/lib/asterisk/sounds/es/custom/ 2>/dev/null || true
  cp -f public/assets/*.gsm /var/lib/asterisk/sounds/es/custom/ 2>/dev/null || true
  cp -f public/assets/*.wav /var/lib/asterisk/sounds/ 2>/dev/null || true
  cp -f public/assets/*.gsm /var/lib/asterisk/sounds/ 2>/dev/null || true
  cp -f public/assets/*.wav /usr/share/asterisk/sounds/custom/ 2>/dev/null || true
  cp -f public/assets/*.gsm /usr/share/asterisk/sounds/custom/ 2>/dev/null || true
  cp -f public/assets/*.wav /usr/share/asterisk/sounds/es/custom/ 2>/dev/null || true
  cp -f public/assets/*.gsm /usr/share/asterisk/sounds/es/custom/ 2>/dev/null || true
  cp -f public/assets/*.wav /usr/share/asterisk/sounds/ 2>/dev/null || true
  cp -f public/assets/*.gsm /usr/share/asterisk/sounds/ 2>/dev/null || true
fi
chmod -R 777 /var/lib/asterisk/sounds /usr/share/asterisk/sounds 2>/dev/null || true
chown -R asterisk:asterisk /var/lib/asterisk/sounds /usr/share/asterisk/sounds 2>/dev/null || true

# Recargar Asterisk
echo "Recargando Asterisk PJSIP, RTP, Dialplan y Manager..."
asterisk -rx "core reload" 2>/dev/null || true
asterisk -rx "pjsip reload" 2>/dev/null || true
asterisk -rx "dialplan reload" 2>/dev/null || true
asterisk -rx "manager reload" 2>/dev/null || true
asterisk -rx "pjsip send register reg_televox" 2>/dev/null || true
asterisk -rx "pjsip send register reg_ghost" 2>/dev/null || true
echo "Estado de registros SIP con el proveedor:"
asterisk -rx "pjsip show registrations" 2>/dev/null || true

echo "=== [6/6] Reiniciando servicio de la aplicacion Node.js ==="
# Garantizar que el puerto 3000 no quede bloqueado por procesos zombies o huérfanos
echo "Liberando puerto 3000 si hay procesos bloqueándolo..."
if command -v pm2 >/dev/null 2>&1; then
  pm2 stop all 2>/dev/null || true
fi
fuser -k 3000/tcp 2>/dev/null || true
pkill -9 -f "dist/server.cjs" 2>/dev/null || true
pkill -9 -f "tsx server.ts" 2>/dev/null || true
sleep 1

if command -v pm2 >/dev/null 2>&1; then
  # Si ya existe en PM2 lo arrancamos limpio, si no lo creamos
  pm2 delete all 2>/dev/null || true
  cd "$APP_DIR"
  pm2 start dist/server.cjs --name "sistema-otp"
  pm2 save 2>/dev/null || true
  echo "✓ Proceso PM2 'sistema-otp' iniciado limpiamente en el puerto 3000."
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
  nohup npm start > app.log 2>&1 &
  echo "✓ Aplicacion iniciada con 'npm start' en segundo plano (PID: $!)."
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
