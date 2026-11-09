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
git checkout -- . 2>/dev/null || true
git stash 2>/dev/null || true
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

# Copiar configuraciones de Asterisk (pjsip.conf y extensions.conf)
if [ -f pjsip.conf ]; then
  cp -f pjsip.conf /etc/asterisk/pjsip.conf 2>/dev/null || true
  echo "✓ /etc/asterisk/pjsip.conf actualizado."
fi
if [ -f extensions.conf ]; then
  cp -f extensions.conf /etc/asterisk/extensions.conf 2>/dev/null || true
  echo "✓ /etc/asterisk/extensions.conf actualizado."
fi

if [ -f amd.conf ]; then
  cp -f amd.conf /etc/asterisk/amd.conf 2>/dev/null || true
  echo "✓ /etc/asterisk/amd.conf actualizado."
fi
asterisk -rx "module load app_amd.so" 2>/dev/null || true

# Limpiar modulador de voz de AstDB para garantizar voz 100% natural del asesor
echo "=== Configurando voz natural del asesor (sin modulador) ==="
asterisk -rx "database deltree voice_changer" 2>/dev/null || true

# Recargar Asterisk
asterisk -rx "dialplan reload" 2>/dev/null || true
asterisk -rx "pjsip reload" 2>/dev/null || true

echo ""
echo "=== Estado de Troncales SIP (PJSIP) ==="
asterisk -rx "pjsip show endpoints" 2>/dev/null | grep -E "televox|ghost|trunk_69_197_187_87|Endpoint:" || true

echo ""
echo "=========================================================="
echo "    ¡SISTEMA ACTUALIZADO Y RECOMPILADO CON ÉXITO!"
echo "=========================================================="
echo " >>> RECORDATORIO IMPORTANTE <<<"
echo " 1. En tu navegador presiona CTRL + F5."
echo " 2. Las llamadas salientes saldrán por Televox con CID asignado por el carrier."
echo " 3. Marca 8888 desde MicroSIP para probar tu voz natural con eco en vivo."
echo "=========================================================="
echo ""
