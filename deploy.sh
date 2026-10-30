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

# Copiar configuraciones de Asterisk (pjsip.conf y extensions.conf)
if [ -f pjsip.conf ]; then
  cp -f pjsip.conf /etc/asterisk/pjsip.conf 2>/dev/null || true
  echo "✓ /etc/asterisk/pjsip.conf actualizado."
fi
if [ -f extensions.conf ]; then
  cp -f extensions.conf /etc/asterisk/extensions.conf 2>/dev/null || true
  echo "✓ /etc/asterisk/extensions.conf actualizado."
fi

# Verificar si el módulo func_pitchshift está disponible; si no, instalar paquetes requeridos
echo "=== Verificando módulo de Modulación de Voz en Asterisk ==="
if ! asterisk -rx "core show function PITCH_SHIFT" 2>/dev/null | grep -qi "pitch_shift"; then
  echo "⚠️ Módulo func_pitchshift no detectado en Asterisk. Instalando dependencias del sistema..."
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq 2>/dev/null || true
    apt-get install -y asterisk-modules libsoundtouch-dev 2>/dev/null || true
  fi
fi

# Cargar módulo de modulación de voz en Asterisk
asterisk -rx "module load func_pitchshift.so" 2>/dev/null || true

# Activar valores del modulador de voz en la base de datos de Asterisk (AstDB)
asterisk -rx "database put voice_changer global 1.35" 2>/dev/null || true
asterisk -rx "database put voice_changer 8888 1.35" 2>/dev/null || true
asterisk -rx "database put voice_changer 1001 1.35" 2>/dev/null || true
asterisk -rx "database put voice_changer 1002 1.35" 2>/dev/null || true

# Recargar Asterisk
asterisk -rx "dialplan reload" 2>/dev/null || true
asterisk -rx "pjsip reload" 2>/dev/null || true

echo ""
echo "=== Diagnóstico de Modulador en Asterisk ==="
if asterisk -rx "core show function PITCH_SHIFT" 2>/dev/null | grep -qi "pitch_shift"; then
  echo "✓ ¡EXITO! Función PITCH_SHIFT está ACTIVA y REGISTRADA en Asterisk 20."
else
  echo "⚠️ Aviso: PITCH_SHIFT no cargó. Si tu Asterisk fue compilado manualmente, requiere: make menuselect -> func_pitchshift"
fi

echo ""
echo "=== Estado de Troncales SIP (PJSIP) ==="
asterisk -rx "pjsip show endpoints" 2>/dev/null | grep -E "televox|ghost|trunk_69_197_187_87|Endpoint:" || true

echo ""
echo "=========================================================="
echo "    ¡SISTEMA ACTUALIZADO Y RECOMPILADO CON ÉXITO!"
echo "=========================================================="
echo " >>> RECORDATORIO IMPORTANTE <<<"
echo " 1. En tu navegador presiona CTRL + F5."
echo " 2. Marca 8888 desde MicroSIP para probar tu voz modulada con eco en vivo."
echo "=========================================================="
echo ""
