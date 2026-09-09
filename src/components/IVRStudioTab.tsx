import React, { useState, useRef } from 'react';
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

  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

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
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-amber-400" />
            <span>Estudio de IVR: Press-1 y Captura de OTP con Audios Profesionales</span>
          </h2>
          <p className="text-sm text-slate-400">
            Asocia <strong>locuciones pregrabadas de la Audioteca</strong> o texto sintetizado. Destinos de transferencia restringidos a extensiones <strong>1001 en adelante</strong>.
          </p>
        </div>

        <button
          id="btn-save-ivr-sync"
          onClick={handleSaveAll}
          disabled={isSyncing}
          className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-lg text-sm font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-lg shadow-amber-500/20 transition-all"
        >
          <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
          <span>{isSyncing ? 'Aplicando en Asterisk...' : 'Guardar y Recargar Dialplan'}</span>
        </button>
      </div>

      {savedFeedback && (
        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs flex items-center gap-2 animate-fadeIn">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{savedFeedback}</span>
        </div>
      )}

      {/* Visual Flow Representation */}
      <div className="p-4 rounded-xl bg-slate-950 border border-slate-800">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5 text-amber-400" />
          <span>Diagrama de Flujo en Asterisk 20 (Audios + Dialplan)</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-center text-xs">
          <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-center">
            <div className="text-[10px] text-slate-500 font-mono">1. ENTRADA</div>
            <div className="font-bold text-white mt-0.5">Carrier / Troncal SIP</div>
            <div className="text-[11px] text-slate-400">from-trunk</div>
          </div>

          <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-500/30 text-center">
            <div className="text-[10px] text-amber-400 font-mono">2. IVR PRESS 1 (Ext {press1.extension})</div>
            <div className="font-bold text-amber-200 mt-0.5">
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
              <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
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
              <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
            </label>
          </div>

          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Extensión Interna IVR</label>
                <input
                  type="text"
                  value={press1.extension}
                  onChange={(e) => setPress1({ ...press1, extension: e.target.value })}
                  className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-white font-mono focus:border-amber-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-medium mb-1">Tiempo de Espera (seg)</label>
                <input
                  type="number"
                  value={press1.timeoutSeconds}
                  onChange={(e) => setPress1({ ...press1, timeoutSeconds: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-white font-mono focus:border-amber-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Audio Selection for Press 1 */}
            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-slate-300 font-semibold flex items-center gap-1.5">
                  <FileAudio className="w-4 h-4 text-amber-400" />
                  <span>Audio Pregrabado de Bienvenida (Recomendado)</span>
                </label>
                {press1.welcomeAudioId && (
                  <button
                    type="button"
                    onClick={() => playRecordedAudio(press1.welcomeAudioId)}
                    className="text-amber-400 hover:text-amber-300 inline-flex items-center gap-1 text-[11px]"
                  >
                    {playingAudioId === press1.welcomeAudioId ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                    <span>{playingAudioId === press1.welcomeAudioId ? 'Pausar' : 'Escuchar Audio'}</span>
                  </button>
                )}
              </div>

              <select
                value={press1.welcomeAudioId || ''}
                onChange={(e) => setPress1({ ...press1, welcomeAudioId: e.target.value || undefined })}
                className="w-full px-3 py-2 rounded-md bg-slate-900 border border-slate-800 text-white focus:border-amber-500 focus:outline-none"
              >
                <option value="">-- Sin audio pregrabado (Usar texto TTS abajo) --</option>
                {audios.map((a) => (
                  <option key={a.id} value={a.id}>
                    🎵 {a.name} ({a.fileName} - {a.durationSec}s)
                  </option>
                ))}
              </select>

              {press1.welcomeAudioId ? (
                <div className="text-[11px] text-amber-300/80 font-mono">
                  Sintaxis Asterisk: Playback(custom/{audios.find((a) => a.id === press1.welcomeAudioId)?.fileName.replace(/\.[^/.]+$/, '')})
                </div>
              ) : (
                <div className="space-y-1 pt-1">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">O texto para voz sintética (TTS):</span>
                    <button
                      type="button"
                      onClick={() => speakText(press1.welcomeAudioText, 'press1')}
                      className="text-amber-400 hover:text-amber-300 inline-flex items-center gap-1 text-[11px]"
                    >
                      <Volume2 className="w-3 h-3" />
                      <span>{isPlayingTTS === 'press1' ? 'Detener' : 'Probar TTS'}</span>
                    </button>
                  </div>
                  <textarea
                    rows={2}
                    value={press1.welcomeAudioText}
                    onChange={(e) => setPress1({ ...press1, welcomeAudioText: e.target.value })}
                    className="w-full px-3 py-2 rounded-md bg-slate-900 border border-slate-800 text-white leading-relaxed focus:border-amber-500 focus:outline-none"
                  />
                </div>
              )}
            </div>

            {/* Originating Agent Return Option */}
            <div className="p-3 rounded-lg bg-slate-950 border border-amber-500/30 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <UserCheck className="w-4 h-4 text-amber-400" />
                  <span className="font-semibold text-white">Retornar al Agente que Originó el Contacto</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={press1.returnToOriginatingAgent ?? true}
                    onChange={(e) => setPress1({ ...press1, returnToOriginatingAgent: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500"></div>
                </label>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Cuando el cliente presione 1, Asterisk evaluará la variable de canal heredada <code className="text-amber-300 font-mono font-bold">__ORIGINATING_EXTEN</code>. Si la llamada fue iniciada por un agente (marcador saliente / click-to-call), regresará directamente a su extensión. De lo contrario, se usará el destino de respaldo configurado abajo.
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
                  className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-white focus:border-amber-500 focus:outline-none"
                >
                  <option value="transfer_extension">Transferir a Extensión</option>
                  <option value="queue">Enviar a Cola de Asesores</option>
                  <option value="webhook">Disparar Webhook HTTP</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Destino de Respaldo <span className="text-amber-400">(≥ 1001)</span>
                </label>
                <select
                  value={press1.digit1Target}
                  onChange={(e) => setPress1({ ...press1, digit1Target: e.target.value })}
                  className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-white font-mono focus:border-amber-500 focus:outline-none"
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
              <label className="block text-slate-300 font-medium mb-1">
                Audio ante Opción Inválida (Reintento)
              </label>
              <select
                value={press1.invalidAudioId || ''}
                onChange={(e) => setPress1({ ...press1, invalidAudioId: e.target.value || undefined })}
                className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-white focus:border-amber-500 focus:outline-none"
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
            <div className="grid grid-cols-2 gap-3">
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

              <select
                value={otp.welcomeAudioId || ''}
                onChange={(e) => setOtp({ ...otp, welcomeAudioId: e.target.value || undefined })}
                className="w-full px-3 py-2 rounded-md bg-slate-900 border border-slate-800 text-white focus:border-blue-500 focus:outline-none"
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
                  Si es Válido, Transferir a: <span className="text-amber-400">(≥ 1001)</span>
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
                <label className="block text-slate-300 font-medium mb-1">
                  Audio de Éxito OTP
                </label>
                <select
                  value={otp.successAudioId || ''}
                  onChange={(e) => setOtp({ ...otp, successAudioId: e.target.value || undefined })}
                  className="w-full px-2.5 py-1.5 rounded-md bg-slate-950 border border-slate-800 text-white focus:border-blue-500 focus:outline-none text-[11px]"
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
                <label className="block text-slate-300 font-medium mb-1">
                  Audio de Código Inválido / Reintento
                </label>
                <select
                  value={otp.failureAudioId || ''}
                  onChange={(e) => setOtp({ ...otp, failureAudioId: e.target.value || undefined })}
                  className="w-full px-2.5 py-1.5 rounded-md bg-slate-950 border border-slate-800 text-white focus:border-blue-500 focus:outline-none text-[11px]"
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
                    className="text-amber-400 hover:text-amber-300 inline-flex items-center gap-1"
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
                    <Volume2 className="w-3.5 h-3.5 text-amber-400" />
                    <span>Locución de Espera que escucha el Cliente mientras el Asesor valida:</span>
                  </label>
                  {otp.validatingWaitAudioId && (
                    <button
                      type="button"
                      onClick={() => playRecordedAudio(otp.validatingWaitAudioId)}
                      className="text-amber-400 hover:text-amber-300 inline-flex items-center gap-1 text-[11px]"
                    >
                      {playingAudioId === otp.validatingWaitAudioId ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                      <span>{playingAudioId === otp.validatingWaitAudioId ? 'Pausar' : 'Escuchar Audio'}</span>
                    </button>
                  )}
                </div>

                <select
                  value={otp.validatingWaitAudioId || ''}
                  onChange={(e) => setOtp({ ...otp, validatingWaitAudioId: e.target.value || undefined })}
                  className="w-full px-2.5 py-1.5 rounded-md bg-slate-950 border border-slate-800 text-white focus:border-indigo-500 focus:outline-none text-[11px]"
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
                      className="text-amber-400 hover:text-amber-300 inline-flex items-center gap-1 text-[11px]"
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
                        ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
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
