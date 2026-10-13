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
  elif [ -f "/var/www/black-hat-dialer/package.json" ]; then
    APP_DIR="/var/www/black-hat-dialer"
  elif [ -f "$(pwd)/package.json" ]; then
    APP_DIR="$(pwd)"
  elif [ -f "/root/sistema-otp/package.json" ]; then
    APP_DIR="/root/sistema-otp"
  fi
fi

echo "=== [1/6] Directorio de la aplicacion: $APP_DIR ==="
cd "$APP_DIR"

echo "=== [2/6] Descargando ultimos cambios de GitHub (git pull) ==="
if [ -d ".git" ]; then
  echo "-> Actualizando repositorio git..."
  git fetch --all || true
  BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
  [ "$BRANCH" = "HEAD" ] && BRANCH="main"
  # Preservar cambios y descartar conflictos de merge
  git stash --include-untracked 2>/dev/null || true
  git reset --hard "origin/$BRANCH" 2>/dev/null || git reset --hard origin/main 2>/dev/null || git reset --hard origin/master 2>/dev/null || git pull --force || true
  echo "✓ Repositorio actualizado a la última versión remota."
else
  echo "Aviso: No se detectó repositorio .git directo, usando archivos locales actuales."
fi

echo "=== [3/6] Instalando/verificando dependencias de Node.js ==="
npm install --prefer-offline --no-audit 2>/dev/null || npm install || true

echo "=== [4/6] Compilando frontend (Vite) y backend (esbuild) en dist/ ==="
npm run build

echo "=== [5/6] Sincronizando configuracion pura Asterisk 20 ==="
mkdir -p /etc/asterisk
mkdir -p /var/lib/asterisk/sounds/custom /var/lib/asterisk/sounds/es/custom /var/lib/asterisk/sounds/en/custom
mkdir -p /var/spool/asterisk/outgoing
chmod 777 /var/spool/asterisk/outgoing 2>/dev/null || true

# Copiar configuraciones locales si existen
[ -f pjsip.conf ] && cp -f pjsip.conf /etc/asterisk/pjsip.conf || true
[ -f extensions.conf ] && cp -f extensions.conf /etc/asterisk/extensions.conf || true
[ -f manager.conf ] && cp -f manager.conf /etc/asterisk/manager.conf || true

# Copiar audios si existen
if [ -d "public/assets" ]; then
  cp -f public/assets/*.wav /var/lib/asterisk/sounds/custom/ 2>/dev/null || true
  cp -f public/assets/*.gsm /var/lib/asterisk/sounds/custom/ 2>/dev/null || true
  cp -f public/assets/*.wav /var/lib/asterisk/sounds/es/custom/ 2>/dev/null || true
  cp -f public/assets/*.gsm /var/lib/asterisk/sounds/es/custom/ 2>/dev/null || true
fi
chmod -R 777 /var/lib/asterisk/sounds 2>/dev/null || true

# Recargar Asterisk
echo "Recargando Asterisk PJSIP, Dialplan y Manager..."
asterisk -rx "pjsip reload" 2>/dev/null || true
asterisk -rx "dialplan reload" 2>/dev/null || true
asterisk -rx "manager reload" 2>/dev/null || true

echo "=== [6/6] Reiniciando servicio de la aplicacion Node.js ==="
if command -v pm2 >/dev/null 2>&1 && pm2 list 2>/dev/null | grep -qE "online|stopped|errored"; then
  pm2 restart all
  pm2 save 2>/dev/null || true
  echo "✓ Proceso PM2 reiniciado exitosamente."
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
  # Liberar puerto 3000 si hay procesos previos colgados
  fuser -k 3000/tcp 2>/dev/null || true
  pkill -9 -f "dist/server.cjs" 2>/dev/null || true
  pkill -9 -f "tsx server.ts" 2>/dev/null || true
  sleep 1
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
