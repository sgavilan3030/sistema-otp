import React, { useState, useRef, useEffect } from 'react';
import { Press1Config, OtpCaptureConfig, PjsipExtension, AudioPrompt } from '../types';
import {
  Volume2,
  ShieldCheck,
  PhoneForwarded,
  KeyRound,
  Play,
  Pause,
  RefreshCw,
  Zap,
  CheckCircle2,
  FileAudio,
  Music,
  UserCheck,
  Monitor,
  Eye,
  EyeOff,
  PhoneCall,
  Send,
  Radio,
  Sparkles,
  AlertTriangle,
  Loader2,
  Lock,
  Unlock,
  Save,
} from 'lucide-react';

interface IVRStudioTabProps {
  press1Config: Press1Config;
  otpConfig: OtpCaptureConfig;
  extensions: PjsipExtension[];
  audios: AudioPrompt[];
  onSavePress1: (config: Press1Config) => void;
  onSaveOtp: (config: OtpCaptureConfig) => void;
  onTriggerSync: () => void;
  isSyncing: boolean;
}

interface AudioVerificationItem {
  status: 'idle' | 'checking' | 'found' | 'missing';
  path?: string;
}

export const IVRStudioTab: React.FC<IVRStudioTabProps> = ({
  press1Config: initialPress1,
  otpConfig: initialOtp,
  extensions,
  audios,
  onSavePress1,
  onSaveOtp,
  onTriggerSync,
  isSyncing,
}) => {
  const [press1, setPress1] = useState<Press1Config>(initialPress1);
  const [otp, setOtp] = useState<OtpCaptureConfig>(initialOtp);
  const [isPlayingTTS, setIsPlayingTTS] = useState<string | null>(null);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [savedFeedback, setSavedFeedback] = useState<string | null>(null);

  // Audio verification states: slot name -> { status: 'idle' | 'checking' | 'found' | 'missing', path?: string }
  const [audioVerification, setAudioVerification] = useState<Record<string, AudioVerificationItem>>({});

  const checkAudioExists = async (slotKey: string, audioPath?: string) => {
    if (!audioPath) {
      setAudioVerification((prev) => ({ ...prev, [slotKey]: { status: 'idle' } }));
      return;
    }
    setAudioVerification((prev) => ({
      ...prev,
      [slotKey]: { status: 'checking', path: audioPath },
    }));

    try {
      const res = await fetch(`/api/asterisk/audio/verify?path=${encodeURIComponent(audioPath)}`, {
        method: 'HEAD',
      });
      if (res.status === 200) {
        setAudioVerification((prev) => ({
          ...prev,
          [slotKey]: { status: 'found', path: audioPath },
        }));
      } else {
        setAudioVerification((prev) => ({
          ...prev,
          [slotKey]: { status: 'missing', path: audioPath },
        }));
      }
    } catch {
      setAudioVerification((prev) => ({
        ...prev,
        [slotKey]: { status: 'missing', path: audioPath },
      }));
    }
  };

  // Determine if any selected audio file is missing on the Asterisk server
  const verificationList = Object.values(audioVerification) as AudioVerificationItem[];
  const hasMissingAudio = verificationList.some((v) => v.status === 'missing');
  const isCheckingAudio = verificationList.some((v) => v.status === 'checking');

  // Helper to render the verification status tag next to an audio selector
  const renderAudioStatusTag = (slotKey: string) => {
    const item = audioVerification[slotKey];
    if (!item || item.status === 'idle') return null;

    if (item.status === 'checking') {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] text-sky-400">
          <Loader2 className="w-3 h-3 animate-spin shrink-0" />
          <span>Comprobando en Asterisk...</span>
        </span>
      );
    }

    if (item.status === 'found') {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
          <CheckCircle2 className="w-3 h-3 shrink-0" />
          <span>Archivo verificado en servidor</span>
        </span>
      );
    }

    if (item.status === 'missing') {
      return (
        <span
          id={`missing-audio-alert-${slotKey}`}
          className="inline-flex items-center gap-1 text-[11px] text-rose-400 font-semibold bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/30 animate-pulse"
        >
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-rose-400" />
          <span>Archivo no encontrado en Asterisk</span>
        </span>
      );
    }

    return null;
  };

  // Run verification on initial mount for any configured audios
  useEffect(() => {
    if (press1.welcomeAudioId) {
      const a = audios.find((x) => x.id === press1.welcomeAudioId);
      if (a?.asteriskPath) checkAudioExists('press1_welcome', a.asteriskPath);
    }
    if (press1.invalidAudioId) {
      const a = audios.find((x) => x.id === press1.invalidAudioId);
      if (a?.asteriskPath) checkAudioExists('press1_invalid', a.asteriskPath);
    }
    if (otp.welcomeAudioId) {
      const a = audios.find((x) => x.id === otp.welcomeAudioId);
      if (a?.asteriskPath) checkAudioExists('otp_welcome', a.asteriskPath);
    }
    if (otp.successAudioId) {
      const a = audios.find((x) => x.id === otp.successAudioId);
      if (a?.asteriskPath) checkAudioExists('otp_success', a.asteriskPath);
    }
    if (otp.failureAudioId) {
      const a = audios.find((x) => x.id === otp.failureAudioId);
      if (a?.asteriskPath) checkAudioExists('otp_failure', a.asteriskPath);
    }
    if (otp.validatingWaitAudioId) {
      const a = audios.find((x) => x.id === otp.validatingWaitAudioId);
      if (a?.asteriskPath) checkAudioExists('otp_validating_wait', a.asteriskPath);
    }
  }, []);

  const [testPhone, setTestPhone] = useState('16104803845');
  const [isTriggeringCall, setIsTriggeringCall] = useState(false);
  const [callFeedback, setCallFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  const handleOriginateTestCall = async () => {
    if (!testPhone.trim()) return;
    setIsTriggeringCall(true);
    setCallFeedback(null);
    try {
      const res = await fetch('/api/asterisk/call/originate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination: testPhone.trim(),
          carrier: 'televox',
          callerId: '+18005550199',
          agentExten: '1001',
        }),
      });
      const data = await res.json();
      if (data.success) {
        setCallFeedback({
          text: `¡Llamada disparada exitosamente a ${testPhone}! Tu teléfono sonará en segundos. Contesta para probar el IVR.`,
          type: 'success',
        });
      } else {
        setCallFeedback({
          text: `Error al originar llamada: ${data.error || 'Fallo desconocido'}`,
          type: 'error',
        });
      }
    } catch (err: any) {
      setCallFeedback({
        text: `Error de conexión: ${err.message}`,
        type: 'error',
      });
    } finally {
      setIsTriggeringCall(false);
    }
  };

  // Filter only extensions >= 1001
  const validExtensions = extensions.filter((e) => {
    const num = parseInt(e.extension, 10);
    return !isNaN(num) && num >= 1001;
  });

  const speakText = (text: string, id: string) => {
    if (!('speechSynthesis' in window)) {
      alert('Tu navegador no soporta síntesis de voz en tiempo real.');
      return;
    }
    window.speechSynthesis.cancel();
    if (isPlayingTTS === id) {
      setIsPlayingTTS(null);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'es-ES';
    utterance.rate = 0.95;
    utterance.onend = () => setIsPlayingTTS(null);
    utterance.onerror = () => setIsPlayingTTS(null);
    setIsPlayingTTS(id);
    window.speechSynthesis.speak(utterance);
  };

  const playRecordedAudio = (audioId?: string) => {
    if (!audioId) return;
    const found = audios.find((a) => a.id === audioId);
    if (!found) return;

    if (playingAudioId === audioId) {
      audioPlayerRef.current?.pause();
      setPlayingAudioId(null);
    } else {
      audioPlayerRef.current?.pause();
      const player = new Audio(found.dataUrl);
      audioPlayerRef.current = player;
      setPlayingAudioId(audioId);
      player.play().catch((err) => console.error(err));
      player.onended = () => setPlayingAudioId(null);
    }
  };

  const isIvrLocked = !!(press1.isLocked || otp.isLocked);
  const [isSavingLock, setIsSavingLock] = useState(false);

  const handleSaveAndLockIVR = async () => {
    setIsSavingLock(true);
    try {
      const nextPress1: Press1Config = { ...press1, isLocked: true };
      const nextOtp: OtpCaptureConfig = { ...otp, isLocked: true };
      setPress1(nextPress1);
      setOtp(nextOtp);
      onSavePress1(nextPress1);
      onSaveOtp(nextOtp);

      try {
        localStorage.setItem('ast20_press1', JSON.stringify(nextPress1));
        localStorage.setItem('ast20_otp', JSON.stringify(nextOtp));
      } catch (_) {}

      fetch('/api/asterisk/audio/toggle-lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'ivr_entity', isLocked: true }),
      }).catch(() => {});

      onTriggerSync();
      setSavedFeedback('✓ Configuración del Guión de IVR guardada y bloqueada manualmente (isLocked: true). Protegida contra sobreescritura.');
      setTimeout(() => setSavedFeedback(null), 5000);
    } finally {
      setIsSavingLock(false);
    }
  };

  const handleUnlockIVR = () => {
    const nextPress1: Press1Config = { ...press1, isLocked: false };
    const nextOtp: OtpCaptureConfig = { ...otp, isLocked: false };
    setPress1(nextPress1);
    setOtp(nextOtp);
    onSavePress1(nextPress1);
    onSaveOtp(nextOtp);

    try {
      localStorage.setItem('ast20_press1', JSON.stringify(nextPress1));
      localStorage.setItem('ast20_otp', JSON.stringify(nextOtp));
    } catch (_) {}

    fetch('/api/asterisk/audio/toggle-lock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'ivr_entity', isLocked: false }),
    }).catch(() => {});

    setSavedFeedback('🔓 Configuración del Guión de IVR desbloqueada. Ahora permite sincronización automática.');
    setTimeout(() => setSavedFeedback(null), 4000);
  };

  const handleSaveAll = () => {
    onSavePress1(press1);
    onSaveOtp(otp);
    onTriggerSync();
    setSavedFeedback('Configuración de IVR & OTP guardada y recargada en Asterisk 20 con soporte para audios pregrabados.');
    setTimeout(() => setSavedFeedback(null), 4000);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              <span>Estudio de IVR: Press-1 y Captura de OTP con Audios Profesionales</span>
            </h2>
            {isIvrLocked ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                <Lock className="w-3 h-3 text-amber-400" />
                <span>Bloqueo manual (isLocked: true)</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-slate-800 text-slate-400 border border-slate-700">
                <Unlock className="w-3 h-3" />
                <span>Desbloqueado</span>
              </span>
            )}
          </div>
          <p className="text-sm text-slate-400">
            Asocia <strong>locuciones pregrabadas de la Audioteca</strong> o texto sintetizado. Destinos de transferencia restringidos a extensiones <strong>1001 en adelante</strong>.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 flex-wrap">
          {hasMissingAudio && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs animate-pulse">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Audios no encontrados en el servidor. Corrige la selección para guardar.</span>
            </div>
          )}

          <button
            type="button"
            onClick={handleSaveAndLockIVR}
            disabled={isSavingLock || isSyncing || hasMissingAudio || isCheckingAudio}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-md bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white shadow-emerald-600/20 cursor-pointer disabled:opacity-50"
            title="Guardar y bloquear la configuración del guión contra sobreescritura automática"
          >
            {isSavingLock ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            <span>{isSavingLock ? 'Guardando...' : 'Guardar Configuración'}</span>
          </button>

          {isIvrLocked && (
            <button
              type="button"
              onClick={handleUnlockIVR}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-amber-300 hover:text-white border border-amber-500/30 transition-all cursor-pointer"
              title="Desbloquear guión de IVR para permitir sincronización automática"
            >
              <Unlock className="w-3.5 h-3.5" />
              <span>Desbloquear</span>
            </button>
          )}

          <button
            id="btn-save-ivr-sync"
            onClick={handleSaveAll}
            disabled={isSyncing || hasMissingAudio || isCheckingAudio}
            className={`inline-flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-bold shadow-lg transition-all ${
              hasMissingAudio || isCheckingAudio
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
            }`}
            title={
              hasMissingAudio
                ? 'No se puede guardar: Uno o más audios seleccionados no existen en el servidor de Asterisk'
                : undefined
            }
          >
            {isCheckingAudio ? (
              <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
            ) : (
              <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
            )}
            <span>
              {isSyncing
                ? 'Aplicando...'
                : isCheckingAudio
                ? 'Verificando...'
                : hasMissingAudio
                ? 'Bloqueado'
                : 'Recargar Asterisk'}
            </span>
          </button>
        </div>
      </div>

      {savedFeedback && (
        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs flex items-center gap-2 animate-fadeIn">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{savedFeedback}</span>
        </div>
      )}

      {/* Real-time IVR Testing Banner */}
      <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-950 to-slate-900 border border-emerald-500/30 shadow-xl space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400">
              <PhoneCall className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>Prueba en Vivo del IVR con Asterisk 20</span>
                <span className="px-2 py-0.5 text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 rounded-full border border-emerald-500/30">
                  Listo para Probar
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Verifica la interacción por voz y captura DTMF directamente desde tu softphone o hacia tu teléfono móvil.
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Option A: Direct Test via X-Lite */}
          <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col justify-between space-y-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold text-sky-400 mb-1">
                <Radio className="w-3.5 h-3.5 text-sky-400 animate-pulse" />
                <span>OPCIÓN 1: Probar desde Softphone X-Lite</span>
              </div>
              <p className="text-xs text-slate-300">
                Desde tu extensión <strong>1001</strong> en X-Lite tienes dos opciones de prueba:
              </p>
              <div className="mt-2 flex items-center gap-3">
                <div className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 font-mono text-sm font-bold text-emerald-400">
                  <span>8888</span>
                </div>
                <span className="text-[11px] text-slate-300">
                  Llama directamente al cliente de prueba <strong>16104803845</strong> sin errores.
                </span>
              </div>
              <div className="mt-2 flex items-center gap-3">
                <div className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 font-mono text-sm font-bold text-sky-400">
                  <span>8880</span> o <span>*8888</span>
                </div>
                <span className="text-[11px] text-slate-400">
                  Simulador de IVR en tu auricular (sin llamada externa ni consumo de saldo).
                </span>
              </div>
            </div>
          </div>

          {/* Option B: Originate Outbound Call to Cellphone */}
          <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              <span>OPCIÓN 2: Disparar Llamada Real Saliente a tu Celular</span>
            </div>
            <p className="text-xs text-slate-300">
              Asterisk llamará a tu número a través de la troncal <strong>televox</strong> y al contestar entrarás al IVR:
            </p>
            <div className="flex items-center gap-2">
              <input
                id="input-originate-phone"
                type="text"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder="ej. 16104803845"
                className="flex-1 px-3 py-2 text-xs bg-slate-950 border border-slate-700 rounded-lg text-white font-mono focus:border-emerald-500 focus:outline-none"
              />
              <button
                id="btn-trigger-ivr-call"
                onClick={handleOriginateTestCall}
                disabled={isTriggeringCall || !testPhone.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 disabled:opacity-50 transition-all shrink-0"
              >
                {isTriggeringCall ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                <span>{isTriggeringCall ? 'Llamando...' : 'Llamar a mi Celular'}</span>
              </button>
            </div>

            {callFeedback && (
              <div
                className={`p-2.5 rounded-lg text-xs flex items-center gap-2 ${
                  callFeedback.type === 'success'
                    ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                    : 'bg-rose-500/10 border border-rose-500/30 text-rose-400'
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>{callFeedback.text}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Visual Flow Representation */}
      <div className="p-4 rounded-xl bg-slate-950 border border-slate-800">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5 text-emerald-400" />
          <span>Diagrama de Flujo en Asterisk 20 (Audios + Dialplan)</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-center text-xs">
          <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-center">
            <div className="text-[10px] text-slate-500 font-mono">1. ENTRADA</div>
            <div className="font-bold text-white mt-0.5">Carrier / Troncal SIP</div>
            <div className="text-[11px] text-slate-400">from-trunk</div>
          </div>

          <div className="p-3 rounded-lg bg-emerald-950/30 border border-emerald-500/30 text-center">
            <div className="text-[10px] text-emerald-400 font-mono">2. IVR PRESS 1 (Ext {press1.extension})</div>
            <div className="font-bold text-emerald-200 mt-0.5">
              {press1.welcomeAudioId ? 'Audio Pregrabado WAV' : 'Mensaje de Bienvenida'}
            </div>
            <div className="text-[11px] text-slate-300">Espera DTMF tecla "1"</div>
          </div>

          <div className="p-3 rounded-lg bg-blue-950/30 border border-blue-500/30 text-center">
            <div className="text-[10px] text-blue-400 font-mono">3. CAPTURA OTP (Ext {otp.extension})</div>
            <div className="font-bold text-blue-200 mt-0.5">{otp.digitLength} Dígitos DTMF</div>
            <div className="text-[11px] text-slate-300">ARI Stasis + Webhook</div>
          </div>

          <div className="p-3 rounded-lg bg-emerald-950/30 border border-emerald-500/30 text-center">
            <div className="text-[10px] text-emerald-400 font-mono">4. DESTINO FINAL</div>
            <div className="font-bold text-emerald-200 mt-0.5">
              Ext {otp.successTarget || press1.digit1Target} (≥ 1001)
            </div>
            <div className="text-[11px] text-slate-300">Llamada segura verificada</div>
          </div>
        </div>
      </div>

      {/* Two Columns: Press 1 & OTP */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Panel 1: IVR Press-1 */}
        <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center space-x-2.5">
              <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <PhoneForwarded className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">IVR Campaña Press 1</h3>
                <span className="text-xs text-slate-400">Extensión Dialplan: {press1.extension}</span>
              </div>
            </div>

            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={press1.enabled}
                onChange={(e) => setPress1({ ...press1, enabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
            </label>
          </div>

          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Extensión IVR</label>
                <input
                  type="text"
                  value={press1.extension}
                  onChange={(e) => setPress1({ ...press1, extension: e.target.value })}
                  className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-white font-mono focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-medium mb-1" title="Tiempo de cortesía tras descolgar para que el cliente se lleve el teléfono al oído y el canal de audio se abra">
                  Pausa al Contestar <span className="text-emerald-400 font-mono font-bold">(seg)</span>
                </label>
                <input
                  type="number"
                  min="0"
                  max="10"
                  value={press1.answerDelaySeconds ?? 1}
                  onChange={(e) => setPress1({ ...press1, answerDelaySeconds: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-md bg-slate-950 border border-emerald-500/40 text-emerald-300 font-mono font-bold focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-medium mb-1">Espera DTMF (seg)</label>
                <input
                  type="number"
                  value={press1.timeoutSeconds}
                  onChange={(e) => setPress1({ ...press1, timeoutSeconds: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-white font-mono focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-medium mb-1" title="Tiempo de pausa natural tras pulsar 1 antes de reproducir el mensaje de transferencia">
                  Pausa tras "1" <span className="text-emerald-400 font-mono font-bold">(seg)</span>
                </label>
                <input
                  type="number"
                  min="0"
                  max="10"
                  value={press1.transferDelaySeconds ?? 2}
                  onChange={(e) => setPress1({ ...press1, transferDelaySeconds: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-md bg-slate-950 border border-emerald-500/40 text-emerald-300 font-mono font-bold focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Audio Selection for Press 1 */}
            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-slate-300 font-semibold flex items-center gap-1.5">
                  <FileAudio className="w-4 h-4 text-emerald-400" />
                  <span>Audio Pregrabado de Bienvenida (Recomendado)</span>
                </label>
                <div className="flex items-center gap-2">
                  {renderAudioStatusTag('press1_welcome')}
                  {press1.welcomeAudioId && (
                    <button
                      type="button"
                      onClick={() => playRecordedAudio(press1.welcomeAudioId)}
                      className="text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1 text-[11px]"
                    >
                      {playingAudioId === press1.welcomeAudioId ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                      <span>{playingAudioId === press1.welcomeAudioId ? 'Pausar' : 'Escuchar Audio'}</span>
                    </button>
                  )}
                </div>
              </div>

              <select
                value={press1.welcomeAudioId || ''}
                onChange={(e) => {
                  const val = e.target.value || undefined;
                  setPress1({ ...press1, welcomeAudioId: val });
                  const selectedAudio = audios.find((a) => a.id === val);
                  if (selectedAudio?.asteriskPath) {
                    checkAudioExists('press1_welcome', selectedAudio.asteriskPath);
                    fetch('/api/asterisk/audio/assign', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ role: 'press1_welcome', asteriskPath: selectedAudio.asteriskPath }),
                    }).catch(() => {});
                  } else {
                    checkAudioExists('press1_welcome', undefined);
                  }
                }}
                className={`w-full px-3 py-2 rounded-md bg-slate-900 border text-white focus:outline-none ${
                  audioVerification['press1_welcome']?.status === 'missing'
                    ? 'border-rose-500/80 bg-rose-950/20'
                    : 'border-slate-800 focus:border-emerald-500'
                }`}
              >
                <option value="">-- Sin audio pregrabado (Usar texto TTS abajo) --</option>
                {audios.map((a) => (
                  <option key={a.id} value={a.id}>
                    🎵 {a.name} ({a.fileName} - {a.durationSec}s)
                  </option>
                ))}
              </select>

              {press1.welcomeAudioId ? (
                <div className="text-[11px] text-emerald-300/80 font-mono">
                  Sintaxis Asterisk: Playback(custom/{audios.find((a) => a.id === press1.welcomeAudioId)?.fileName.replace(/\.[^/.]+$/, '')})
                </div>
              ) : (
                <div className="space-y-1 pt-1">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">O texto para voz sintética (TTS):</span>
                    <button
                      type="button"
                      onClick={() => speakText(press1.welcomeAudioText, 'press1')}
                      className="text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1 text-[11px]"
                    >
                      <Volume2 className="w-3 h-3" />
                      <span>{isPlayingTTS === 'press1' ? 'Detener' : 'Probar TTS'}</span>
                    </button>
                  </div>
                  <textarea
                    rows={2}
                    value={press1.welcomeAudioText}
                    onChange={(e) => setPress1({ ...press1, welcomeAudioText: e.target.value })}
                    className="w-full px-3 py-2 rounded-md bg-slate-900 border border-slate-800 text-white leading-relaxed focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              )}
            </div>

            {/* Originating Agent Return Option */}
            <div className="p-3 rounded-lg bg-slate-950 border border-emerald-500/30 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <UserCheck className="w-4 h-4 text-emerald-400" />
                  <span className="font-semibold text-white">Retornar al Agente que Originó el Contacto</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={press1.returnToOriginatingAgent ?? true}
                    onChange={(e) => setPress1({ ...press1, returnToOriginatingAgent: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
                </label>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Cuando el cliente presione 1, Asterisk evaluará la variable de canal heredada <code className="text-emerald-300 font-mono font-bold">__ORIGINATING_EXTEN</code>. Si la llamada fue iniciada por un agente (marcador saliente / click-to-call), regresará directamente a su extensión. De lo contrario, se usará el destino de respaldo configurado abajo.
              </p>
              {(press1.returnToOriginatingAgent ?? true) && (
                <div className="flex items-center gap-1.5 text-[11px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>Dialplan activo: <code>{'GotoIf($["${ORIGINATING_EXTEN}" != ""]?agent_return)'}</code></span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Acción al Presionar 1</label>
                <select
                  value={press1.digit1Action}
                  onChange={(e) => setPress1({ ...press1, digit1Action: e.target.value as any })}
                  className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-white focus:border-emerald-500 focus:outline-none"
                >
                  <option value="transfer_extension">Transferir a Extensión</option>
                  <option value="queue">Enviar a Cola de Asesores</option>
                  <option value="webhook">Disparar Webhook HTTP</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Destino de Respaldo <span className="text-emerald-400">(≥ 1001)</span>
                </label>
                <select
                  value={press1.digit1Target}
                  onChange={(e) => setPress1({ ...press1, digit1Target: e.target.value })}
                  className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-white font-mono focus:border-emerald-500 focus:outline-none"
                >
                  {validExtensions.map((ext) => (
                    <option key={ext.id} value={ext.extension}>
                      Ext {ext.extension} - {ext.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Invalid audio selection */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-slate-300 font-medium">
                  Audio ante Opción Inválida (Reintento)
                </label>
                {renderAudioStatusTag('press1_invalid')}
              </div>
              <select
                value={press1.invalidAudioId || ''}
                onChange={(e) => {
                  const val = e.target.value || undefined;
                  setPress1({ ...press1, invalidAudioId: val });
                  const selectedAudio = audios.find((a) => a.id === val);
                  if (selectedAudio?.asteriskPath) {
                    checkAudioExists('press1_invalid', selectedAudio.asteriskPath);
                  } else {
                    checkAudioExists('press1_invalid', undefined);
                  }
                }}
                className={`w-full px-3 py-2 rounded-md bg-slate-950 border text-white focus:outline-none ${
                  audioVerification['press1_invalid']?.status === 'missing'
                    ? 'border-rose-500/80 bg-rose-950/20'
                    : 'border-slate-800 focus:border-emerald-500'
                }`}
              >
                <option value="">-- Usar texto: "{press1.invalidPromptText}" --</option>
                {audios.map((a) => (
                  <option key={a.id} value={a.id}>
                    🎵 {a.name} ({a.fileName})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Panel 2: Captura de OTP */}
        <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center space-x-2.5">
              <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
                <KeyRound className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">Motor de Captura de OTP</h3>
                <span className="text-xs text-slate-400">
                  Extensión: {otp.extension} &bull; ARI Stasis App: {otp.stasisAppName}
                </span>
              </div>
            </div>

            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={otp.enabled}
                onChange={(e) => setOtp({ ...otp, enabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Extensión OTP</label>
                <input
                  type="text"
                  value={otp.extension}
                  onChange={(e) => setOtp({ ...otp, extension: e.target.value })}
                  className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-white font-mono focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1" title="Pausa de cortesía tras descolgar antes de solicitar el código">
                  Pausa al Contestar <span className="text-blue-400 font-mono font-bold">(seg)</span>
                </label>
                <input
                  type="number"
                  min="0"
                  max="10"
                  value={otp.answerDelaySeconds ?? 1}
                  onChange={(e) => setOtp({ ...otp, answerDelaySeconds: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-md bg-slate-950 border border-blue-500/40 text-blue-300 font-mono font-bold focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Longitud de Dígitos OTP</label>
                <select
                  value={otp.digitLength}
                  onChange={(e) => setOtp({ ...otp, digitLength: Number(e.target.value) as any })}
                  className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-white font-bold focus:border-blue-500 focus:outline-none"
                >
                  <option value={4}>4 Dígitos</option>
                  <option value={6}>6 Dígitos (Estándar)</option>
                  <option value={8}>8 Dígitos</option>
                </select>
              </div>
            </div>

            {/* Audio Selection for OTP Prompt */}
            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-slate-300 font-semibold flex items-center gap-1.5">
                  <FileAudio className="w-4 h-4 text-blue-400" />
                  <span>Audio Instrucción de OTP (Recomendado)</span>
                </label>
                <div className="flex items-center gap-2">
                  {renderAudioStatusTag('otp_welcome')}
                  {otp.welcomeAudioId && (
                    <button
                      type="button"
                      onClick={() => playRecordedAudio(otp.welcomeAudioId)}
                      className="text-blue-400 hover:text-blue-300 inline-flex items-center gap-1 text-[11px]"
                    >
                      {playingAudioId === otp.welcomeAudioId ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                      <span>{playingAudioId === otp.welcomeAudioId ? 'Pausar' : 'Escuchar Audio'}</span>
                    </button>
                  )}
                </div>
              </div>

              <select
                value={otp.welcomeAudioId || ''}
                onChange={(e) => {
                  const val = e.target.value || undefined;
                  setOtp({ ...otp, welcomeAudioId: val });
                  const selectedAudio = audios.find((a) => a.id === val);
                  if (selectedAudio?.asteriskPath) {
                    checkAudioExists('otp_welcome', selectedAudio.asteriskPath);
                    fetch('/api/asterisk/audio/assign', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ role: 'otp_welcome', asteriskPath: selectedAudio.asteriskPath }),
                    }).catch(() => {});
                  } else {
                    checkAudioExists('otp_welcome', undefined);
                  }
                }}
                className={`w-full px-3 py-2 rounded-md bg-slate-900 border text-white focus:outline-none ${
                  audioVerification['otp_welcome']?.status === 'missing'
                    ? 'border-rose-500/80 bg-rose-950/20'
                    : 'border-slate-800 focus:border-blue-500'
                }`}
              >
                <option value="">-- Sin audio pregrabado (Usar texto TTS abajo) --</option>
                {audios.map((a) => (
                  <option key={a.id} value={a.id}>
                    🎵 {a.name} ({a.fileName} - {a.durationSec}s)
                  </option>
                ))}
              </select>

              {!otp.welcomeAudioId && (
                <div className="space-y-1 pt-1">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Texto para voz sintética (TTS):</span>
                    <button
                      type="button"
                      onClick={() => speakText(otp.welcomePromptText, 'otp')}
                      className="text-blue-400 hover:text-blue-300 inline-flex items-center gap-1 text-[11px]"
                    >
                      <Volume2 className="w-3 h-3" />
                      <span>{isPlayingTTS === 'otp' ? 'Detener' : 'Probar TTS'}</span>
                    </button>
                  </div>
                  <textarea
                    rows={2}
                    value={otp.welcomePromptText}
                    onChange={(e) => setOtp({ ...otp, welcomePromptText: e.target.value })}
                    className="w-full px-3 py-2 rounded-md bg-slate-900 border border-slate-800 text-white leading-relaxed focus:border-blue-500 focus:outline-none"
                  />
                </div>
              )}
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">
                Webhook URL de Validación (Recibe DTMF y decide validez)
              </label>
              <input
                type="url"
                value={otp.webhookUrl}
                onChange={(e) => setOtp({ ...otp, webhookUrl: e.target.value })}
                className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-white font-mono text-[11px] focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Máximo de Intentos</label>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={otp.maxAttempts}
                  onChange={(e) => setOtp({ ...otp, maxAttempts: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-white font-mono focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Si es Válido, Transferir a: <span className="text-emerald-400">(≥ 1001)</span>
                </label>
                <select
                  value={otp.successTarget}
                  onChange={(e) => setOtp({ ...otp, successTarget: e.target.value })}
                  className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-white font-mono focus:border-blue-500 focus:outline-none"
                >
                  {validExtensions.map((ext) => (
                    <option key={ext.id} value={ext.extension}>
                      Ext {ext.extension} - {ext.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Success and failure audio dropdowns */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-slate-300 font-medium">
                    Audio de Éxito OTP
                  </label>
                  {renderAudioStatusTag('otp_success')}
                </div>
                <select
                  value={otp.successAudioId || ''}
                  onChange={(e) => {
                    const val = e.target.value || undefined;
                    setOtp({ ...otp, successAudioId: val });
                    const selectedAudio = audios.find((a) => a.id === val);
                    if (selectedAudio?.asteriskPath) {
                      checkAudioExists('otp_success', selectedAudio.asteriskPath);
                    } else {
                      checkAudioExists('otp_success', undefined);
                    }
                  }}
                  className={`w-full px-2.5 py-1.5 rounded-md bg-slate-950 border text-white focus:outline-none text-[11px] ${
                    audioVerification['otp_success']?.status === 'missing'
                      ? 'border-rose-500/80 bg-rose-950/20'
                      : 'border-slate-800 focus:border-blue-500'
                  }`}
                >
                  <option value="">-- Usar texto: "{otp.successPromptText}" --</option>
                  {audios.map((a) => (
                    <option key={a.id} value={a.id}>
                      🎵 {a.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-slate-300 font-medium">
                    Audio de Código Inválido / Reintento
                  </label>
                  {renderAudioStatusTag('otp_failure')}
                </div>
                <select
                  value={otp.failureAudioId || ''}
                  onChange={(e) => {
                    const val = e.target.value || undefined;
                    setOtp({ ...otp, failureAudioId: val });
                    const selectedAudio = audios.find((a) => a.id === val);
                    if (selectedAudio?.asteriskPath) {
                      checkAudioExists('otp_failure', selectedAudio.asteriskPath);
                    } else {
                      checkAudioExists('otp_failure', undefined);
                    }
                  }}
                  className={`w-full px-2.5 py-1.5 rounded-md bg-slate-950 border text-white focus:outline-none text-[11px] ${
                    audioVerification['otp_failure']?.status === 'missing'
                      ? 'border-rose-500/80 bg-rose-950/20'
                      : 'border-slate-800 focus:border-blue-500'
                  }`}
                >
                  <option value="">-- Usar texto: "{otp.failurePromptText}" --</option>
                  {audios.map((a) => (
                    <option key={a.id} value={a.id}>
                      🎵 {a.name}
                    </option>
                  ))}
                </select>
                <div className="mt-1 flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">Texto si no hay audio:</span>
                  <button
                    type="button"
                    onClick={() => speakText(otp.failurePromptText, 'otp-fail')}
                    className="text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1"
                  >
                    <Volume2 className="w-3 h-3" />
                    <span>{isPlayingTTS === 'otp-fail' ? 'Detener' : 'Probar'}</span>
                  </button>
                </div>
                <input
                  type="text"
                  value={otp.failurePromptText}
                  onChange={(e) => setOtp({ ...otp, failurePromptText: e.target.value })}
                  placeholder="El código ingresado es inválido. Por favor vuelva a ingresarlo."
                  className="mt-0.5 w-full px-2.5 py-1 rounded bg-slate-950 border border-slate-800 text-white text-[11px] focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Modo de Validación y Mensaje de Espera al Cliente */}
            <div className="p-3.5 rounded-lg bg-indigo-950/30 border border-indigo-500/40 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <ShieldCheck className="w-4 h-4 text-indigo-400" />
                  <span className="font-semibold text-white text-xs uppercase tracking-wider">
                    Modo de Decisión & Locución de Espera al Cliente
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  Control Asesor Activo
                </span>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1 text-xs">
                  ¿Quién decide si el código es Válido o Inválido?
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setOtp({ ...otp, validationMode: 'agent_manual' })}
                    className={`p-2 rounded-lg border text-left text-xs transition-all ${
                      (otp.validationMode ?? 'agent_manual') === 'agent_manual'
                        ? 'bg-indigo-600/30 border-indigo-400 text-white shadow-sm'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div className="font-bold text-indigo-300 flex items-center gap-1">
                      <span>✓ El Asesor en su Pantalla</span>
                    </div>
                    <div className="text-[11px] text-slate-300 mt-0.5 leading-tight">
                      El asesor ve los dígitos y selecciona si es Válido o Inválido.
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setOtp({ ...otp, validationMode: 'automatic_webhook' })}
                    className={`p-2 rounded-lg border text-left text-xs transition-all ${
                      otp.validationMode === 'automatic_webhook'
                        ? 'bg-indigo-600/30 border-indigo-400 text-white shadow-sm'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div className="font-bold text-slate-200 flex items-center gap-1">
                      <span>⚡ Automático por Webhook</span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5 leading-tight">
                      Asterisk consulta la API y aprueba o rechaza automáticamente.
                    </div>
                  </button>
                </div>
              </div>

              {/* Audio de Espera para el Cliente */}
              <div className="space-y-1.5 pt-1 border-t border-indigo-500/20">
                <div className="flex justify-between items-center">
                  <label className="text-slate-200 font-medium text-xs flex items-center gap-1.5">
                    <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Locución de Espera que escucha el Cliente mientras el Asesor valida:</span>
                  </label>
                  <div className="flex items-center gap-2">
                    {renderAudioStatusTag('otp_validating_wait')}
                    {otp.validatingWaitAudioId && (
                      <button
                        type="button"
                        onClick={() => playRecordedAudio(otp.validatingWaitAudioId)}
                        className="text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1 text-[11px]"
                      >
                        {playingAudioId === otp.validatingWaitAudioId ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                        <span>{playingAudioId === otp.validatingWaitAudioId ? 'Pausar' : 'Escuchar Audio'}</span>
                      </button>
                    )}
                  </div>
                </div>

                <select
                  value={otp.validatingWaitAudioId || ''}
                  onChange={(e) => {
                    const val = e.target.value || undefined;
                    setOtp({ ...otp, validatingWaitAudioId: val });
                    const selectedAudio = audios.find((a) => a.id === val);
                    if (selectedAudio?.asteriskPath) {
                      checkAudioExists('otp_validating_wait', selectedAudio.asteriskPath);
                    } else {
                      checkAudioExists('otp_validating_wait', undefined);
                    }
                  }}
                  className={`w-full px-2.5 py-1.5 rounded-md bg-slate-950 border text-white focus:outline-none text-[11px] ${
                    audioVerification['otp_validating_wait']?.status === 'missing'
                      ? 'border-rose-500/80 bg-rose-950/20'
                      : 'border-slate-800 focus:border-indigo-500'
                  }`}
                >
                  <option value="">-- Sin audio pregrabado (usar texto TTS) --</option>
                  {audios.map((a) => (
                    <option key={a.id} value={a.id}>
                      🎵 {a.name} ({a.fileName})
                    </option>
                  ))}
                </select>

                <div className="pt-1">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-slate-400 text-[11px]">Texto de la locución en espera:</span>
                    <button
                      type="button"
                      onClick={() =>
                        speakText(
                          otp.validatingWaitPromptText ||
                            'Un momento por favor, estamos validando su información...',
                          'otp-wait'
                        )
                      }
                      className="text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1 text-[11px]"
                    >
                      <Volume2 className="w-3 h-3" />
                      <span>{isPlayingTTS === 'otp-wait' ? 'Detener' : 'Probar Locución'}</span>
                    </button>
                  </div>
                  <input
                    type="text"
                    value={
                      otp.validatingWaitPromptText ||
                      'Un momento por favor, estamos validando su información...'
                    }
                    onChange={(e) => setOtp({ ...otp, validatingWaitPromptText: e.target.value })}
                    className="w-full px-3 py-1.5 rounded-md bg-slate-950 border border-slate-800 text-white text-xs focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Pantalla en Tiempo Real para el Agente (Live DTMF Stream) */}
            <div className="p-3.5 rounded-lg bg-slate-950 border border-blue-500/30 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Monitor className="w-4 h-4 text-blue-400" />
                  <span className="font-semibold text-white">Streaming en Vivo a Pantalla del Agente</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={otp.enableAgentRealtimeScreen ?? true}
                    onChange={(e) =>
                      setOtp({ ...otp, enableAgentRealtimeScreen: e.target.checked })
                    }
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed">
                Cuando el agente le pida al cliente que digite su código de {otp.digitLength} dígitos durante la llamada, los eventos DTMF capturados por Asterisk se enviarán por WebSocket (ARI) a la pantalla del operador en tiempo real dígito por dígito.
              </p>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800/80">
                <div className="flex items-center space-x-2">
                  <span className="text-slate-400 text-[11px]">Visibilidad en pantalla del agente:</span>
                  <button
                    type="button"
                    onClick={() =>
                      setOtp({ ...otp, maskDigitsOnAgentScreen: !otp.maskDigitsOnAgentScreen })
                    }
                    className={`inline-flex items-center space-x-1.5 px-2 py-0.5 rounded text-[10px] font-semibold border ${
                      otp.maskDigitsOnAgentScreen
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                        : 'bg-blue-500/10 border-blue-500/30 text-blue-300'
                    }`}
                  >
                    {otp.maskDigitsOnAgentScreen ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    <span>{otp.maskDigitsOnAgentScreen ? 'Dígitos Ocultos (••••••)' : 'Dígitos Visibles en Claro'}</span>
                  </button>
                </div>

                <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  ARI WebSocket: /events?app={otp.stasisAppName}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
