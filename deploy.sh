#!/usr/bin/env bash
# ==============================================================================
# Script de Actualización Automática para VPS vía GitHub (Black Hat Dialer)
# ==============================================================================
set -e

# Cambiar al directorio donde se encuentra este script
cd "$(dirname "$0")"

echo ""
echo "=========================================================="
echo "    ACTUALIZANDO SISTEMA DESDE GITHUB (BLACK HAT DIALER)   "
echo "=========================================================="
echo ""

echo "=== [1/4] Descargando cambios más recientes de GitHub ==="
git pull origin main || git pull

echo ""
echo "=== [2/4] Verificando dependencias npm ==="
npm install

echo ""
echo "=== [3/4] Recompilando Frontend (Vite) y Servidor Node (esbuild) ==="
npm run build

echo ""
echo "=== [4/4] Reiniciando servicios y recargando Asterisk ==="
if command -v pm2 >/dev/null 2>&1 && pm2 list 2>/dev/null | grep -qE "online|stopped|errored"; then
  pm2 restart all
  pm2 save 2>/dev/null || true
  echo "✓ Proceso PM2 reiniciado."
elif systemctl is-active --quiet asterisk-web 2>/dev/null; then
  systemctl restart asterisk-web
  echo "✓ Servicio systemd asterisk-web reiniciado."
elif systemctl is-active --quiet dialer 2>/dev/null; then
  systemctl restart dialer
  echo "✓ Servicio systemd dialer reiniciado."
else
  echo "✓ Si no usas PM2 ni systemd, reinicia tu proceso actual con 'npm start'."
fi

# Recargar Asterisk por si hubo cambios en dialplan o extensiones
asterisk -rx "dialplan reload" 2>/dev/null || true
asterisk -rx "pjsip reload" 2>/dev/null || true

echo ""
echo "=========================================================="
echo "    ¡SISTEMA ACTUALIZADO Y RECOMPILADO CON ÉXITO!"
echo "=========================================================="
echo " >>> RECORDATORIO IMPORTANTE <<<"
echo " En tu navegador, presiona CTRL + F5 (o abre ventana de incógnito)"
echo " para limpiar la memoria caché y ver los nuevos cambios reflejados."
echo "=========================================================="
echo ""
