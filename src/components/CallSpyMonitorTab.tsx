import React, { useState, useEffect, useRef } from 'react';
import { PjsipExtension, CarrierTrunk, SystemUser } from '../types';
import {
  Headphones,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  PhoneCall,
  PhoneOff,
  Radio,
  Zap,
  RefreshCw,
  Clock,
  User,
  Shield,
  ShieldAlert,
  Building2,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Play,
  Pause,
  Sliders,
  Sparkles,
  Search,
  ExternalLink,
  Info,
} from 'lucide-react';

export interface LiveCallItem {
  id: string;
  number: string;
  clientName?: string;
  agent: string;
  agentName?: string;
  status: 'dialing' | 'ringing' | 'in_ivr' | 'talking' | 'on_hold' | 'pressed_1' | 'transferred' | 'machine' | 'ended';
  statusText?: string;
  startTime: number;
  answeredAt?: number;
  duration: number;
  entityId?: string;
  entityName?: string;
  holdMusic?: string;
  holdMusicName?: string;
  channel?: string;
  bridgedChannel?: string;
  trunk?: string;
  digit?: string;
  isOnHold?: boolean;
}

interface SpySession {
  id: string;
  supervisorExten: string;
  targetExten?: string;
  targetChannel?: string;
  targetNumber?: string;
  mode: 'spy' | 'whisper' | 'barge';
  status: 'connecting' | 'connected' | 'ended';
  startedAt: number;
}

interface CallSpyMonitorTabProps {
  extensions: PjsipExtension[];
  carriers: CarrierTrunk[];
  users: SystemUser[];
  onTriggerSync?: () => void;
  onNavigateToLiveCalls?: () => void;
}

export const CallSpyMonitorTab: React.FC<CallSpyMonitorTabProps> = ({
  extensions,
  carriers,
  users,
  onTriggerSync,
  onNavigateToLiveCalls,
}) => {
  // Supervisor extension configuration
  const [supervisorExten, setSupervisorExten] = useState<string>(() => {
    return localStorage.getItem('ast20_supervisor_exten') || '1001';
  });

  const [activeSpySession, setActiveSpySession] = useState<SpySession | null>(null);
  const [liveCalls, setLiveCalls] = useState<LiveCallItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [searchQuery, setSearchQuery] = useState('');
  const [feedbackMsg, setFeedbackMsg] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // In-browser Web Audio listening simulation state
  const [webAudioListeningCallId, setWebAudioListeningCallId] = useState<string | null>(null);
  const [webAudioVolume, setWebAudioVolume] = useState<number>(85);
  const [isWebAudioMuted, setIsWebAudioMuted] = useState(false);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  // Save supervisor extension in localStorage
  const handleSupervisorExtenChange = (val: string) => {
    const clean = val.replace(/[^0-9]/g, '');
    setSupervisorExten(clean);
    localStorage.setItem('ast20_supervisor_exten', clean);
  };

  // Poll active calls
  const fetchActiveCalls = async () => {
    if (typeof document !== 'undefined' && document.hidden) return;
    try {
      const res = await fetch('/api/asterisk/live/calls');
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.calls)) {
          setLiveCalls(data.calls);
          setLastRefreshed(new Date());
        }
      }
    } catch (_) {}
  };

  // Poll active spy sessions
  const fetchSpySessions = async () => {
    try {
      const res = await fetch('/api/asterisk/spy/active');
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.sessions) && data.sessions.length > 0) {
          const mySession = data.sessions.find((s: SpySession) => s.supervisorExten === supervisorExten);
          if (mySession) {
            setActiveSpySession(mySession);
          }
        }
      }
    } catch (_) {}
  };

  useEffect(() => {
    fetchActiveCalls();
    fetchSpySessions();
    const callInterval = setInterval(fetchActiveCalls, 2500);
    const spyInterval = setInterval(fetchSpySessions, 4000);
    return () => {
      clearInterval(callInterval);
      clearInterval(spyInterval);
    };
  }, [supervisorExten]);

  // Real-time second counter ticker
  useEffect(() => {
    const timer = setInterval(() => {
      setLiveCalls((prev) =>
        prev.map((c) => {
          if (c.status === 'ended') return c;
          const start = c.answeredAt || c.startTime;
          const liveDuration = start ? Math.max(0, Math.floor((Date.now() - start) / 1000)) : c.duration + 1;
          return { ...c, duration: liveDuration };
        })
      );
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Format seconds to MM:SS or HH:MM:SS
  const formatSeconds = (sec: number) => {
    const s = Math.max(0, Math.floor(sec));
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    if (hrs > 0) {
      return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  // Trigger ChanSpy Originate call to supervisor's extension
  const handleStartSpy = async (
    targetExten: string,
    targetChannel: string | undefined,
    targetNumber: string,
    mode: 'spy' | 'whisper' | 'barge'
  ) => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/asterisk/spy/originate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supervisorExten,
          targetExten,
          targetChannel,
          targetNumber,
          mode,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setActiveSpySession({
          id: data.session?.id || `spy-${Date.now()}`,
          supervisorExten,
          targetExten,
          targetChannel,
          targetNumber,
          mode,
          status: 'connected',
          startedAt: Date.now(),
        });

        const modeNames = {
          spy: 'Modo Espía Silencioso (Solo Escuchar)',
          whisper: 'Modo Susurro (Coach al Agente)',
          barge: 'Modo Intervención (Conferencia 3 vías)',
        };

        setFeedbackMsg({
          text: `✓ Llamando a tu extensión ${supervisorExten} para conectar audio en vivo: ${modeNames[mode]}. ¡Descuelga tu softphone!`,
          type: 'success',
        });
      } else {
        setFeedbackMsg({
          text: `Error al iniciar supervisión: ${data.error || 'Asterisk no respondió'}`,
          type: 'error',
        });
      }
    } catch (err: any) {
      setFeedbackMsg({
        text: `Error de conexión con Asterisk: ${err.message}`,
        type: 'error',
      });
    } finally {
      setIsLoading(false);
      setTimeout(() => setFeedbackMsg(null), 6000);
    }
  };

  // Stop active ChanSpy session
  const handleStopSpy = async () => {
    setIsLoading(true);
    try {
      await fetch('/api/asterisk/spy/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supervisorExten }),
      });
      setActiveSpySession(null);
      setFeedbackMsg({
        text: `Supervisión de llamada detenida. La llamada del agente sigue en curso.`,
        type: 'info',
      });
    } catch (_) {
      setActiveSpySession(null);
    } finally {
      setIsLoading(false);
      setTimeout(() => setFeedbackMsg(null), 3000);
    }
  };

  // Toggle In-Browser Web Audio listening
  const handleToggleWebAudio = (callId: string, channelName?: string) => {
    if (webAudioListeningCallId === callId) {
      // Stop listening
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
        audioPlayerRef.current.src = '';
      }
      setWebAudioListeningCallId(null);
      setFeedbackMsg({ text: 'Escucha de audio web detenida.', type: 'info' });
      setTimeout(() => setFeedbackMsg(null), 2500);
      return;
    }

    // Start listening in browser
    setWebAudioListeningCallId(callId);
    const audioUrl = `/api/asterisk/spy/stream?channel=${encodeURIComponent(channelName || '')}&t=${Date.now()}`;
    if (!audioPlayerRef.current) {
      audioPlayerRef.current = new Audio();
    }
    const audio = audioPlayerRef.current;
    audio.src = audioUrl;
    audio.volume = isWebAudioMuted ? 0 : webAudioVolume / 100;
    audio.loop = true;
    audio.play().catch(() => {});

    setFeedbackMsg({
      text: `🔊 Escuchando llamada en vivo directamente en tus altavoces/auriculares del navegador.`,
      type: 'success',
    });
    setTimeout(() => setFeedbackMsg(null), 4000);
  };

  // Volume change
  const handleVolumeChange = (vol: number) => {
    setWebAudioVolume(vol);
    if (audioPlayerRef.current) {
      audioPlayerRef.current.volume = isWebAudioMuted ? 0 : vol / 100;
    }
  };

  const handleToggleMuteWebAudio = () => {
    const next = !isWebAudioMuted;
    setIsWebAudioMuted(next);
    if (audioPlayerRef.current) {
      audioPlayerRef.current.volume = next ? 0 : webAudioVolume / 100;
    }
  };

  // Hangup call
  const handleHangupCall = async (channel?: string, number?: string) => {
    try {
      await fetch('/api/asterisk/call/hangup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, number }),
      });
      setLiveCalls((prev) => prev.filter((c) => c.number !== number && c.channel !== channel));
      if (webAudioListeningCallId === number) {
        if (audioPlayerRef.current) audioPlayerRef.current.pause();
        setWebAudioListeningCallId(null);
      }
      if (activeSpySession?.targetNumber === number) {
        setActiveSpySession(null);
      }
      setFeedbackMsg({ text: `Canal de llamada finalizado.`, type: 'info' });
    } catch (_) {}
    setTimeout(() => setFeedbackMsg(null), 3000);
  };

  // Simulate test active call
  const handleSimulateCall = async () => {
    setIsLoading(true);
    try {
      const testPhones = ['18494386040', '18095550199', '18293334455', '16104803845'];
      const randomPhone = testPhones[Math.floor(Math.random() * testPhones.length)];
      const randomExten = extensions.length > 0 ? extensions[Math.floor(Math.random() * extensions.length)].extension : '1001';
      const extenObj = extensions.find((e) => e.extension === randomExten);

      await fetch('/api/asterisk/call/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          number: randomPhone,
          clientName: 'Cliente Activo en Línea',
          agent: randomExten,
          agentName: extenObj?.name || 'Operador Asignado',
          entityId: 'bank',
          entityName: 'Banreservas / Antifraude',
          trunk: carriers[0]?.name || 'televox',
        }),
      });

      await fetchActiveCalls();
      setFeedbackMsg({
        text: `✓ Llamada de prueba creada para extensión ${randomExten} con cliente ${randomPhone}. ¡Ya puedes escucharla!`,
        type: 'success',
      });
    } catch (_) {}
    setIsLoading(false);
    setTimeout(() => setFeedbackMsg(null), 4000);
  };

  // Copy helper
  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(id);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  // Filtered active calls
  const filteredCalls = liveCalls.filter((c) => {
    if (c.status === 'ended') return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchNum = c.number.toLowerCase().includes(q);
      const matchAgent = (c.agent || '').toLowerCase().includes(q) || (c.agentName || '').toLowerCase().includes(q);
      const matchEntity = (c.entityName || '').toLowerCase().includes(q);
      return matchNum || matchAgent || matchEntity;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* 1. Header con Resumen de Supervisión en Vivo */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center space-x-2.5">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shadow-md">
                <Headphones className="w-5 h-5 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold text-white tracking-tight">
                    Módulo de Escucha en Vivo de Agentes
                  </h2>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-mono font-bold tracking-wider uppercase">
                    ChanSpy Asterisk 20
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Escucha en tiempo real conversaciones entre operadores y clientes con soporte para{' '}
                  <strong className="text-cyan-400">Modo Silencioso</strong>,{' '}
                  <strong className="text-amber-400">Susurro (Coaching)</strong> e{' '}
                  <strong className="text-emerald-400">Intervención (Barge-in)</strong>.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center flex-wrap gap-2.5">
            <button
              type="button"
              onClick={handleSimulateCall}
              disabled={isLoading}
              className="px-3.5 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-xs font-mono font-bold flex items-center space-x-1.5 shadow-sm transition-all cursor-pointer"
              title="Generar llamada simulada para probar la escucha de inmediato"
            >
              <Zap className="w-3.5 h-3.5 text-cyan-400" />
              <span>Simular Llamada para Probar</span>
            </button>

            <button
              type="button"
              onClick={fetchActiveCalls}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-mono flex items-center space-x-1.5 transition-all cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5 text-slate-300" />
              <span>Refrescar</span>
            </button>
          </div>
        </div>

        {/* Barra de Ajuste de Extensión del Supervisor */}
        <div className="mt-5 pt-4 border-t border-slate-800/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center flex-wrap gap-3">
            <div className="flex items-center space-x-2">
              <span className="text-xs text-slate-300 font-semibold flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-cyan-400" />
                <span>Tu Extensión de Supervisor:</span>
              </span>
              <div className="relative">
                <select
                  value={supervisorExten}
                  onChange={(e) => handleSupervisorExtenChange(e.target.value)}
                  className="bg-slate-950 border border-cyan-500/40 text-cyan-300 text-xs font-mono font-bold rounded-lg px-3 py-1.5 focus:outline-none focus:border-cyan-400 cursor-pointer shadow-sm"
                >
                  {extensions.map((ext) => (
                    <option key={ext.extension} value={ext.extension}>
                      Ext {ext.extension} ({ext.name || 'Operador'})
                    </option>
                  ))}
                  {!extensions.some((e) => e.extension === supervisorExten) && (
                    <option value={supervisorExten}>Ext {supervisorExten} (Personalizada)</option>
                  )}
                </select>
              </div>
            </div>

            <div className="text-[11px] text-slate-400 hidden sm:inline-block">
              Al hacer clic en <strong className="text-cyan-300">"Espiar"</strong>, Asterisk llamará a tu teléfono o softphone{' '}
              <span className="font-mono text-cyan-400">({supervisorExten})</span> y te conectará al instante.
            </div>
          </div>

          <div className="flex items-center space-x-2 text-xs font-mono">
            <span className="flex h-2.5 w-2.5 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </span>
            <span className="text-slate-300">
              Llamadas en Vivo:{' '}
              <strong className="text-emerald-400">{filteredCalls.length} activas</strong>
            </span>
          </div>
        </div>
      </div>

      {/* 2. Banner de Sesión de Escucha Activa (Si hay una escucha en curso) */}
      {activeSpySession && (
        <div className="bg-gradient-to-r from-cyan-950 via-slate-900 to-slate-950 border-2 border-cyan-500/60 rounded-2xl p-4 sm:p-5 shadow-xl relative overflow-hidden animate-fadeIn">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-center space-x-3.5">
              <div className="w-12 h-12 rounded-xl bg-cyan-500/20 border border-cyan-400/50 flex items-center justify-center text-cyan-300 shrink-0 shadow-lg">
                <Radio className="w-6 h-6 animate-pulse text-cyan-400" />
              </div>

              <div>
                <div className="flex items-center space-x-2">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-black uppercase tracking-wider bg-cyan-500 text-slate-950">
                    {activeSpySession.mode === 'spy'
                      ? '🎧 MODO ESPÍA (SILENCIOSO)'
                      : activeSpySession.mode === 'whisper'
                      ? '🗣️ MODO SUSURRO (WHISPER)'
                      : '📢 MODO INTERVENCIÓN (BARGE-IN)'}
                  </span>
                  <span className="text-xs text-slate-400 font-mono">
                    Supervisor Ext: <strong className="text-white">{activeSpySession.supervisorExten}</strong>
                  </span>
                </div>

                <div className="text-sm sm:text-base font-bold text-white mt-1">
                  Escuchando al Agente{' '}
                  <span className="text-cyan-400 font-mono font-black">
                    Ext {activeSpySession.targetExten || '1001'}
                  </span>{' '}
                  con el Cliente{' '}
                  <span className="text-emerald-400 font-mono font-black">
                    {activeSpySession.targetNumber || 'Línea Externa'}
                  </span>
                </div>

                <div className="text-xs text-slate-400 mt-0.5">
                  {activeSpySession.mode === 'spy' && '🔇 Estás en silencio absoluto. Ni el cliente ni el agente te escuchan.'}
                  {activeSpySession.mode === 'whisper' && '🗣️ Solo el agente te escucha. El cliente no escucha nada de lo que digas.'}
                  {activeSpySession.mode === 'barge' && '📢 Conferencia tripartita: Tanto el cliente como el agente te escuchan.'}
                </div>
              </div>
            </div>

            {/* Visualizador de Ondas de Audio & Botón Detener */}
            <div className="flex items-center space-x-4 w-full md:w-auto justify-between md:justify-end border-t md:border-t-0 pt-3 md:pt-0 border-slate-800">
              {/* Animación de VU meter */}
              <div className="flex items-center space-x-1 h-8 px-3 py-1 bg-slate-950/80 rounded-xl border border-cyan-500/30">
                <span className="text-[10px] text-cyan-400 font-mono mr-1.5 uppercase font-bold">Audio:</span>
                {[40, 75, 55, 90, 60, 80, 45, 95, 70, 50].map((h, i) => (
                  <div
                    key={i}
                    className="w-1 bg-cyan-400 rounded-full animate-pulse"
                    style={{
                      height: `${h}%`,
                      animationDelay: `${i * 120}ms`,
                      animationDuration: '600ms',
                    }}
                  />
                ))}
              </div>

              <button
                type="button"
                onClick={handleStopSpy}
                className="px-4 py-2 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-xs font-mono font-bold flex items-center space-x-1.5 shadow-lg shadow-rose-500/20 transition-all cursor-pointer"
              >
                <PhoneOff className="w-4 h-4" />
                <span>Detener Escucha</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Alertas y Feedback */}
      {feedbackMsg && (
        <div
          className={`p-4 rounded-xl text-xs flex items-center space-x-2.5 border transition-all ${
            feedbackMsg.type === 'success'
              ? 'bg-emerald-950/70 border-emerald-500/50 text-emerald-200'
              : feedbackMsg.type === 'info'
              ? 'bg-cyan-950/70 border-cyan-500/50 text-cyan-200'
              : 'bg-rose-950/70 border-rose-500/50 text-rose-200'
          }`}
        >
          {feedbackMsg.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : feedbackMsg.type === 'info' ? (
            <Info className="w-4 h-4 text-cyan-400 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          )}
          <span className="font-mono">{feedbackMsg.text}</span>
        </div>
      )}

      {/* 3. Panel de Llamadas Activas en Vivo para Escuchar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Columna Izquierda (2 cols): Lista de Llamadas en Tiempo Real */}
        <div className="lg:col-span-2 space-y-4">
          {/* Barra de Búsqueda y Estado */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900 border border-slate-800 p-3 rounded-xl">
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                Llamadas en Curso
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                {filteredCalls.length} en línea
              </span>
            </div>

            <div className="relative w-full sm:w-60">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Buscar cliente o agente..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 font-mono focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          {/* Tarjetas de Llamadas en Vivo */}
          {filteredCalls.length === 0 ? (
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-10 text-center space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-slate-800/80 border border-slate-700 flex items-center justify-center mx-auto text-slate-400">
                <Headphones className="w-7 h-7 text-slate-500" />
              </div>
              <h3 className="text-base font-bold text-white">No hay agentes en llamada activa en este momento</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Cuando un agente saque una llamada por la troncal o conteste una transferencia, aparecerá aquí
                inmediatamente con sus botones de <strong>Espiar</strong> y <strong>Susurrar</strong>.
              </p>
              <div className="pt-2 flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={handleSimulateCall}
                  className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-mono font-bold flex items-center space-x-1.5 shadow-md transition-all cursor-pointer"
                >
                  <Zap className="w-4 h-4" />
                  <span>Crear Llamada Simulada para Probar</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredCalls.map((call) => {
                const isHold = !!call.isOnHold || call.status === 'on_hold';
                const isTalking = (call.status === 'talking' || call.status === 'transferred') && !isHold;
                const isListeningThisCall =
                  activeSpySession?.targetNumber === call.number ||
                  activeSpySession?.targetExten === call.agent;
                const isWebAudioActive = webAudioListeningCallId === call.id || webAudioListeningCallId === call.number;

                return (
                  <div
                    key={call.id || call.number}
                    className={`bg-slate-900 border rounded-2xl p-4 sm:p-5 transition-all shadow-md ${
                      isListeningThisCall
                        ? 'border-cyan-500 shadow-cyan-500/10 bg-slate-900/90'
                        : isHold
                        ? 'border-amber-500/50'
                        : isTalking
                        ? 'border-emerald-500/40'
                        : 'border-slate-800'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      {/* Información de Cliente y Guión */}
                      <div className="flex items-start space-x-3.5">
                        <div
                          className={`w-12 h-12 rounded-xl flex items-center justify-center text-lg shrink-0 shadow-md ${
                            isListeningThisCall
                              ? 'bg-cyan-500 text-slate-950 animate-pulse'
                              : isHold
                              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                              : isTalking
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                              : 'bg-slate-800 text-slate-300 border border-slate-700'
                          }`}
                        >
                          {isListeningThisCall ? (
                            <Headphones className="w-6 h-6" />
                          ) : (
                            <PhoneCall className="w-6 h-6" />
                          )}
                        </div>

                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="text-base sm:text-lg font-black text-white font-mono tracking-tight">
                              {call.number}
                            </span>
                            {call.clientName && (
                              <span className="text-xs text-slate-300 font-medium">({call.clientName})</span>
                            )}
                            {isListeningThisCall && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 animate-pulse">
                                ESCUCHANDO AHORA
                              </span>
                            )}
                          </div>

                          <div className="flex items-center flex-wrap gap-2 mt-1">
                            <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700 text-[10px] font-mono text-slate-300">
                              <Building2 className="w-3 h-3 text-cyan-400" />
                              <span>{call.entityName || 'Guión General'}</span>
                            </span>

                            {call.trunk && (
                              <span className="text-[10px] text-slate-400 font-mono">
                                Troncal: <strong className="text-slate-300">{call.trunk}</strong>
                              </span>
                            )}

                            {/* Indicador de Actividad de Audio */}
                            <div className="flex items-center space-x-1 px-2 py-0.5 bg-slate-950 rounded-md border border-slate-800">
                              <span className="text-[9px] text-slate-400 font-mono">Voz:</span>
                              <span className="flex space-x-0.5 items-end h-3">
                                <span className="w-0.5 h-1.5 bg-emerald-400 rounded-full animate-bounce"></span>
                                <span className="w-0.5 h-3 bg-emerald-400 rounded-full animate-bounce delay-75"></span>
                                <span className="w-0.5 h-2 bg-emerald-400 rounded-full animate-bounce delay-150"></span>
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Cronómetro de Duración y Estado */}
                      <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-center border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-800">
                        <div className="flex items-center space-x-1.5 font-mono">
                          <Clock className={`w-4 h-4 ${isHold ? 'text-amber-400' : 'text-emerald-400'}`} />
                          <span
                            className={`text-xl font-black tracking-wider ${
                              isHold ? 'text-amber-400' : 'text-white'
                            }`}
                          >
                            {formatSeconds(call.duration)}
                          </span>
                        </div>

                        <div className="mt-1">
                          {isHold ? (
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/50">
                              EN HOLD (MOH)
                            </span>
                          ) : isTalking ? (
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 flex items-center space-x-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                              <span>HABLANDO EN VIVO</span>
                            </span>
                          ) : (
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/50">
                              EN MENÚ IVR
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Fila Inferior: Agente Asignado & Botones de Escucha */}
                    <div className="mt-4 pt-3 border-t border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
                      {/* Agente */}
                      <div className="flex items-center space-x-2.5">
                        <div className="w-8 h-8 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-300 font-mono text-xs font-bold">
                          {call.agent || '1001'}
                        </div>
                        <div>
                          <div className="text-xs font-bold text-white flex items-center gap-1.5">
                            <User className="w-3 h-3 text-cyan-400" />
                            <span>Agente: {call.agentName || `Extensión ${call.agent || '1001'}`}</span>
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono">
                            Canal: {call.channel || `PJSIP/${call.agent || '1001'}`}
                          </div>
                        </div>
                      </div>

                      {/* Botones de Control de Escucha ChanSpy */}
                      <div className="flex items-center flex-wrap gap-2 w-full md:w-auto justify-end">
                        {/* 1. Botón Espiar (Silencioso) */}
                        <button
                          type="button"
                          onClick={() => handleStartSpy(call.agent || '1001', call.channel, call.number, 'spy')}
                          className="px-3 py-1.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-xs font-mono font-bold flex items-center space-x-1.5 transition-all cursor-pointer shadow-sm hover:scale-[1.02]"
                          title="Llama a tu teléfono para escuchar en silencio absoluto (ni cliente ni agente te oyen)"
                        >
                          <Headphones className="w-3.5 h-3.5 text-cyan-400" />
                          <span>Espiar (Silencio)</span>
                        </button>

                        {/* 2. Botón Susurrar (Whisper) */}
                        <button
                          type="button"
                          onClick={() => handleStartSpy(call.agent || '1001', call.channel, call.number, 'whisper')}
                          className="px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-mono font-bold flex items-center space-x-1.5 transition-all cursor-pointer shadow-sm hover:scale-[1.02]"
                          title="Habla al oído del agente para guiarlo (el cliente NO te escucha)"
                        >
                          <Mic className="w-3.5 h-3.5 text-amber-400" />
                          <span>Susurrar</span>
                        </button>

                        {/* 3. Botón Intervenir (Barge-in) */}
                        <button
                          type="button"
                          onClick={() => handleStartSpy(call.agent || '1001', call.channel, call.number, 'barge')}
                          className="px-3 py-1.5 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 text-xs font-mono font-bold flex items-center space-x-1.5 transition-all cursor-pointer shadow-sm hover:scale-[1.02]"
                          title="Entrar a la llamada hablando con ambos (conferencia tripartita)"
                        >
                          <Radio className="w-3.5 h-3.5 text-purple-400" />
                          <span>Intervenir</span>
                        </button>

                        {/* 4. Botón Escuchar en el Navegador Web (Audio directo) */}
                        <button
                          type="button"
                          onClick={() => handleToggleWebAudio(call.id || call.number, call.channel)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold flex items-center space-x-1.5 transition-all cursor-pointer shadow-sm ${
                            isWebAudioActive
                              ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black animate-pulse'
                              : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
                          }`}
                          title="Escuchar audio directo en los altavoces de tu navegador"
                        >
                          {isWebAudioActive ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                          <span>{isWebAudioActive ? 'Pausar Web' : 'Audio Web'}</span>
                        </button>

                        {/* 5. Botón Colgar Canal */}
                        <button
                          type="button"
                          onClick={() => handleHangupCall(call.channel, call.number)}
                          className="p-1.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 transition-all cursor-pointer"
                          title="Colgar llamada"
                        >
                          <PhoneOff className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Columna Derecha (1 col): Controles de Audio Web & Guía de Códigos Softphone */}
        <div className="space-y-4">
          {/* Tarjeta de Reproductor Web en Vivo */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-lg space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Volume2 className="w-4 h-4 text-cyan-400" />
                <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                  Audio en Vivo en Navegador
                </h3>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-mono">
                HTML5 Audio
              </span>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              Si no tienes tu softphone o teléfono SIP a mano, puedes escuchar las llamadas directamente en los
              altavoces de esta computadora haciendo clic en <strong>"Audio Web"</strong> en cualquier llamada.
            </p>

            {/* Controles de Volumen */}
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 space-y-2.5">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Volumen de Escucha:</span>
                </span>
                <span className="text-cyan-300 font-bold">{isWebAudioMuted ? 'MUTE' : `${webAudioVolume}%`}</span>
              </div>

              <div className="flex items-center space-x-3">
                <button
                  type="button"
                  onClick={handleToggleMuteWebAudio}
                  className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white transition-all cursor-pointer"
                  title={isWebAudioMuted ? 'Desactivar silencio' : 'Silenciar'}
                >
                  {isWebAudioMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}
                </button>

                <input
                  type="range"
                  min="0"
                  max="100"
                  value={isWebAudioMuted ? 0 : webAudioVolume}
                  onChange={(e) => handleVolumeChange(Number(e.target.value))}
                  className="w-full accent-cyan-400 cursor-pointer"
                />
              </div>

              {webAudioListeningCallId && (
                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-emerald-300 font-mono">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
                    <span>Reproduciendo en vivo...</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => handleToggleWebAudio(webAudioListeningCallId)}
                    className="text-rose-400 hover:text-rose-300 underline font-semibold cursor-pointer"
                  >
                    Detener
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Tarjeta de Marcación Rápida desde Softphone (Zoiper / X-Lite / MicroSIP) */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-lg space-y-4">
            <div className="flex items-center space-x-2">
              <Shield className="w-4 h-4 text-amber-400" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                Códigos de Marcación en Softphone
              </h3>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              Marca estos códigos directamente desde tu teléfono o softphone (Zoiper, MicroSIP, X-Lite) para entrar
              a supervisar cualquier llamada al instante:
            </p>

            <div className="space-y-2">
              {/* Código 1: *55<ext> */}
              <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-between">
                <div>
                  <div className="text-xs font-mono font-bold text-cyan-400 flex items-center gap-1.5">
                    <code>*55 + Extensión</code>
                  </div>
                  <div className="text-[10px] text-slate-400">
                    Modo Espía Silencioso (Ej: <span className="text-slate-300 font-mono">*551001</span>)
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => copyToClipboard('*551001', '55')}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all cursor-pointer"
                  title="Copiar ejemplo"
                >
                  {copiedCode === '55' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>

              {/* Código 2: *56<ext> */}
              <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-between">
                <div>
                  <div className="text-xs font-mono font-bold text-amber-400 flex items-center gap-1.5">
                    <code>*56 + Extensión</code>
                  </div>
                  <div className="text-[10px] text-slate-400">
                    Modo Susurro / Whisper (Ej: <span className="text-slate-300 font-mono">*561001</span>)
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => copyToClipboard('*561001', '56')}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all cursor-pointer"
                  title="Copiar ejemplo"
                >
                  {copiedCode === '56' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>

              {/* Código 3: *57<ext> */}
              <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-between">
                <div>
                  <div className="text-xs font-mono font-bold text-purple-400 flex items-center gap-1.5">
                    <code>*57 + Extensión</code>
                  </div>
                  <div className="text-[10px] text-slate-400">
                    Intervención / Barge (Ej: <span className="text-slate-300 font-mono">*571001</span>)
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => copyToClipboard('*571001', '57')}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all cursor-pointer"
                  title="Copiar ejemplo"
                >
                  {copiedCode === '57' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>

              {/* Código 4: *55 */}
              <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-between">
                <div>
                  <div className="text-xs font-mono font-bold text-emerald-400 flex items-center gap-1.5">
                    <code>*55</code>
                  </div>
                  <div className="text-[10px] text-slate-400">
                    Escaneo general (Presiona <span className="text-slate-300 font-mono">#</span> para saltar de llamada)
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => copyToClipboard('*55', '55all')}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all cursor-pointer"
                  title="Copiar código"
                >
                  {copiedCode === '55all' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
