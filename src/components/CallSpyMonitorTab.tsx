import React, { useState, useEffect, useRef } from 'react';
import { PjsipExtension, CarrierTrunk, SystemUser, CallCenterTenant } from '../types';
import {
  Headphones,
  Mic,
  Volume2,
  VolumeX,
  PhoneCall,
  PhoneOff,
  Radio,
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
  Search,
  Info,
  Disc,
  Download,
  Trash2,
  BookOpen,
  ChevronDown,
  ChevronUp,
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

interface RecordingItem {
  filename: string;
  direction: 'IN' | 'OUT' | 'INT';
  extension: string;
  remoteParty: string;
  date: string;
  sizeBytes: number;
  durationSec: number;
  mtimeMs: number;
  playUrl: string;
}

interface CallSpyMonitorTabProps {
  extensions: PjsipExtension[];
  carriers: CarrierTrunk[];
  users: SystemUser[];
  tenants?: CallCenterTenant[];
  currentUser?: SystemUser;
  onUpdateExtension?: (ext: PjsipExtension) => void;
  onTriggerSync?: () => void;
  onNavigateToLiveCalls?: () => void;
  onNavigateToProduction?: () => void;
}

export const CallSpyMonitorTab: React.FC<CallSpyMonitorTabProps> = ({
  extensions,
  carriers,
  users,
  tenants = [],
  currentUser,
  onUpdateExtension,
  onTriggerSync,
  onNavigateToLiveCalls,
  onNavigateToProduction,
}) => {
  const isSuperAdmin = !currentUser || (currentUser.role === 'admin' && !currentUser.tenantId);
  const myTenant = !isSuperAdmin && currentUser?.tenantId
    ? tenants.find((t) => t.id === currentUser.tenantId)
    : undefined;

  const defaultSupExten = isSuperAdmin
    ? '1000'
    : (currentUser?.assignedExtensions?.[0] || '1001');

  // Supervisor extension configuration (Super Admin defaults to 1000)
  const [supervisorExten, setSupervisorExten] = useState<string>(() => {
    const saved = localStorage.getItem('ast20_supervisor_exten');
    if (saved) return saved;
    return defaultSupExten;
  });

  const [subTab, setSubTab] = useState<'spy' | 'recordings'>('spy');
  const [showSpyGuide, setShowSpyGuide] = useState<boolean>(true);

  const [activeSpySession, setActiveSpySession] = useState<SpySession | null>(null);
  const [liveCalls, setLiveCalls] = useState<LiveCallItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [feedbackMsg, setFeedbackMsg] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // In-browser Web Audio listening state
  const [webAudioListeningCallId, setWebAudioListeningCallId] = useState<string | null>(null);
  const [webAudioVolume, setWebAudioVolume] = useState<number>(85);
  const [isWebAudioMuted, setIsWebAudioMuted] = useState(false);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  // Recordings (MixMonitor) state
  const [recordings, setRecordings] = useState<RecordingItem[]>([]);
  const [recordingsLoading, setRecordingsLoading] = useState(false);
  const [recordingFilterExt, setRecordingFilterExt] = useState<string>('all');
  const [recordingSearch, setRecordingSearch] = useState<string>('');
  const [togglingExtRecord, setTogglingExtRecord] = useState<string | null>(null);

  // Scope extensions when user belongs to a specific Call Center tenant
  const scopedExtensions = extensions.filter((ext) => {
    if (isSuperAdmin) return true;
    const num = parseInt(ext.extension, 10);
    if (myTenant && !isNaN(num)) {
      if (num >= myTenant.extensionStart && num <= myTenant.extensionEnd) return true;
    }
    const tenantUserExts = users
      .filter((u) => u.tenantId === currentUser?.tenantId)
      .flatMap((u) => u.assignedExtensions || []);
    return ext.tenantId === currentUser?.tenantId || tenantUserExts.includes(ext.extension);
  });

  // Recordable extensions (exclude 1000 / isSpyOnly monitor extensions)
  const recordableExtensions = scopedExtensions.filter(
    (ext) => ext.extension !== '1000' && !ext.isSpyOnly
  );

  // Helper: check if a call/extension belongs to this tenant
  const isExtenInScope = (extNum?: string) => {
    if (isSuperAdmin) return true;
    if (!extNum) return false;
    return scopedExtensions.some((e) => e.extension === extNum);
  };

  // Save supervisor extension in localStorage
  const handleSupervisorExtenChange = (val: string) => {
    const clean = val.replace(/[^0-9a-zA-Z_\-]/g, '');
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
        if (data.success && Array.isArray(data.sessions)) {
          const mySession = data.sessions.find((s: SpySession) => s.supervisorExten === supervisorExten);
          setActiveSpySession(mySession || null);
        }
      }
    } catch (_) {}
  };

  // Fetch MixMonitor recordings list
  const fetchRecordings = async () => {
    setRecordingsLoading(true);
    try {
      const params = new URLSearchParams();
      if (recordingFilterExt && recordingFilterExt !== 'all') {
        params.set('extension', recordingFilterExt);
      }
      if (recordingSearch.trim()) {
        params.set('search', recordingSearch.trim());
      }
      const res = await fetch(`/api/asterisk/recordings?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.recordings)) {
          const filteredByTenant = isSuperAdmin
            ? data.recordings
            : data.recordings.filter((r: RecordingItem) => isExtenInScope(r.extension));
          setRecordings(filteredByTenant);
        }
      }
    } catch (_) {}
    setRecordingsLoading(false);
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

  useEffect(() => {
    if (subTab === 'recordings') {
      fetchRecordings();
    }
  }, [subTab, recordingFilterExt]);

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

  const formatFileSize = (bytes: number) => {
    if (!bytes) return '0 KB';
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  // Toggle per-extension call recording (MixMonitor via AstDB)
  const handleToggleExtensionRecording = async (ext: PjsipExtension) => {
    const nextEnabled = !ext.recordCalls;
    setTogglingExtRecord(ext.extension);
    try {
      const res = await fetch('/api/asterisk/extensions/recording', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          extension: ext.extension,
          enabled: nextEnabled,
        }),
      });
      const data = await res.json();
      if (data.success) {
        if (onUpdateExtension) {
          onUpdateExtension({ ...ext, recordCalls: nextEnabled });
        }
        setFeedbackMsg({
          text: nextEnabled
            ? `⏺️ Grabación automática ACTIVADA para Ext ${ext.extension} (${ext.name}). Todas sus llamadas se guardarán en WAV.`
            : `⏹️ Grabación desactivada para Ext ${ext.extension}.`,
          type: nextEnabled ? 'success' : 'info',
        });
      } else {
        setFeedbackMsg({ text: data.error || 'Error al actualizar grabación.', type: 'error' });
      }
    } catch (err: any) {
      setFeedbackMsg({ text: `Error de red: ${err.message}`, type: 'error' });
    } finally {
      setTogglingExtRecord(null);
      setTimeout(() => setFeedbackMsg(null), 5000);
    }
  };

  // Delete a recording file
  const handleDeleteRecording = async (filename: string) => {
    try {
      const res = await fetch(`/api/asterisk/recordings/${encodeURIComponent(filename)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        setRecordings((prev) => prev.filter((r) => r.filename !== filename));
        setFeedbackMsg({ text: `Grabación "${filename}" eliminada.`, type: 'info' });
        setTimeout(() => setFeedbackMsg(null), 3000);
      }
    } catch (_) {}
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
          text: `✓ Timbrando tu MicroSIP Ext ${supervisorExten} para conectar: ${modeNames[mode]}. ¡Contesta tu softphone!`,
          type: 'success',
        });
      } else {
        setFeedbackMsg({
          text: `No se pudo iniciar supervisión: ${data.error || 'Asterisk no respondió'}`,
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
      setTimeout(() => setFeedbackMsg(null), 6500);
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
        text: `Supervisión detenida (canal de Ext ${supervisorExten} colgado). La llamada del agente continúa normal.`,
        type: 'info',
      });
    } catch (_) {
      setActiveSpySession(null);
    } finally {
      setIsLoading(false);
      setTimeout(() => setFeedbackMsg(null), 3500);
    }
  };

  // Toggle In-Browser Web Audio listening
  const handleToggleWebAudio = (callId: string, channelName?: string) => {
    if (webAudioListeningCallId === callId) {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
        audioPlayerRef.current.src = '';
      }
      setWebAudioListeningCallId(null);
      setFeedbackMsg({ text: 'Escucha de audio web detenida.', type: 'info' });
      setTimeout(() => setFeedbackMsg(null), 2500);
      return;
    }

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
      text: `🔊 Reproduciendo audio web disponible. Para escucha bidireccional y Susurro en tiempo real usa MicroSIP en Ext ${supervisorExten}.`,
      type: 'success',
    });
    setTimeout(() => setFeedbackMsg(null), 4500);
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

  // Copy helper
  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(id);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  // Filtered active calls (scoped by tenant if not Super Admin)
  const filteredCalls = liveCalls.filter((c) => {
    if (c.status === 'ended') return false;
    if (!isSuperAdmin && !isExtenInScope(c.agent)) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchNum = c.number.toLowerCase().includes(q);
      const matchAgent = (c.agent || '').toLowerCase().includes(q) || (c.agentName || '').toLowerCase().includes(q);
      const matchEntity = (c.entityName || '').toLowerCase().includes(q);
      return matchNum || matchAgent || matchEntity;
    }
    return true;
  });

  const recordedExtensionsCount = recordableExtensions.filter((e) => e.recordCalls).length;

  if (currentUser && (currentUser.role === 'agent' || (!currentUser.permissions?.canSpy && currentUser.role !== 'admin' && currentUser.role !== 'supervisor'))) {
    return (
      <div className="p-8 max-w-2xl mx-auto my-12 bg-slate-900 border-2 border-rose-500/40 rounded-2xl text-center space-y-4 shadow-2xl">
        <div className="w-16 h-16 rounded-2xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center mx-auto text-rose-400">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-white">Acceso Restringido: Módulo de Supervisión</h2>
        <p className="text-xs text-slate-300 leading-relaxed">
          Tu usuario tiene asignado el rol de <strong className="text-emerald-400">Agente (Solo Llamadas)</strong>. Las funciones de espionaje telefónico silencioso (ChanSpy), susurro (*56), intervención (*57) y grabaciones están reservadas exclusivamente a Supervisores y Administradores.
        </p>
        <div className="pt-2">
          {onNavigateToProduction && (
            <button
              type="button"
              onClick={onNavigateToProduction}
              className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-lg transition-all cursor-pointer"
            >
              Ir a Centro de Operaciones (Llamadas)
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1. Header con Resumen de Supervisión en Vivo + Grabaciones */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center space-x-2.5">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shadow-md">
                <Headphones className="w-5 h-5 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-xl font-bold text-white tracking-tight">
                    Modo Espía en Vivo & Grabaciones por Extensión
                  </h2>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-mono font-bold tracking-wider uppercase">
                    Ext 1000 Super Admin • ChanSpy + MixMonitor
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Supervisa en vivo desde tu softphone <strong className="text-cyan-300 font-mono">Ext {supervisorExten}</strong> (Silencio, Susurro o Barge) y activa grabación WAV por extensión.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center flex-wrap gap-2">
            {/* Sub-tab Switcher */}
            <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
              <button
                type="button"
                onClick={() => setSubTab('spy')}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                  subTab === 'spy'
                    ? 'bg-cyan-500 text-slate-950 shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Headphones className="w-3.5 h-3.5" />
                <span>Escucha en Vivo ({filteredCalls.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setSubTab('recordings')}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                  subTab === 'recordings'
                    ? 'bg-rose-500 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Disc className="w-3.5 h-3.5" />
                <span>Grabaciones ({recordedExtensionsCount} ext. activas)</span>
              </button>
            </div>

            <button
              type="button"
              onClick={subTab === 'spy' ? fetchActiveCalls : fetchRecordings}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-mono flex items-center space-x-1.5 transition-all cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-slate-300 ${recordingsLoading ? 'animate-spin' : ''}`} />
              <span>Refrescar</span>
            </button>
          </div>
        </div>

        {/* Barra de Ajuste de Extensión del Supervisor */}
        <div className="mt-5 pt-4 border-t border-slate-800/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 relative z-10">
          <div className="flex items-center flex-wrap gap-3">
            <div className="flex items-center space-x-2">
              <span className="text-xs text-slate-300 font-semibold flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-cyan-400" />
                <span>Tu Extensión de Escucha (Softphone):</span>
              </span>
              <select
                value={supervisorExten}
                onChange={(e) => handleSupervisorExtenChange(e.target.value)}
                className="bg-slate-950 border border-cyan-500/40 text-cyan-300 text-xs font-mono font-bold rounded-lg px-3 py-1.5 focus:outline-none focus:border-cyan-400 cursor-pointer shadow-sm"
              >
                {extensions.some((e) => e.extension === '1000') ? null : (
                  <option value="1000">Ext 1000 (Super Admin Espía)</option>
                )}
                {extensions.map((ext) => (
                  <option key={ext.extension} value={ext.extension}>
                    Ext {ext.extension} ({ext.name || 'Operador'})
                  </option>
                ))}
                {supervisorExten !== '1000' && !extensions.some((e) => e.extension === supervisorExten) && (
                  <option value={supervisorExten}>Ext {supervisorExten} (Personalizada)</option>
                )}
              </select>

              {isSuperAdmin && supervisorExten !== '1000' && (
                <button
                  type="button"
                  onClick={() => handleSupervisorExtenChange('1000')}
                  className="px-2.5 py-1 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-[11px] font-mono font-bold cursor-pointer"
                >
                  Usar Ext 1000 (Recomendada)
                </button>
              )}
            </div>

            <div className="text-[11px] text-slate-400 hidden xl:inline-block">
              Al pulsar <strong className="text-cyan-300">"Espiar"</strong>, Asterisk llama a tu{' '}
              <span className="font-mono text-cyan-400">Ext {supervisorExten}</span> en MicroSIP para conectarte al instante.
            </div>
          </div>

          <div className="flex items-center space-x-3 text-xs font-mono">
            <button
              type="button"
              onClick={() => setShowSpyGuide((v) => !v)}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 text-[11px] flex items-center gap-1.5 cursor-pointer"
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>¿Cómo usar Modo Espía?</span>
              {showSpyGuide ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            <div className="flex items-center space-x-2">
              <span className="flex h-2.5 w-2.5 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
              <span className="text-slate-300">
                En Vivo: <strong className="text-emerald-400">{filteredCalls.length}</strong>
              </span>
            </div>
          </div>
        </div>
      </div>

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

      {/* 2. Guía paso a paso del Modo Espía con Extensión 1000 */}
      {showSpyGuide && subTab === 'spy' && (
        <div className="bg-slate-900/90 border border-cyan-500/30 rounded-2xl p-4 sm:p-5 space-y-3 shadow-lg">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-cyan-300 uppercase tracking-wider font-mono flex items-center gap-2">
              <Shield className="w-4 h-4" />
              <span>Guía Rápida: Cómo usar el Modo Espía desde Extensión 1000</span>
            </h3>
            <span className="text-[10px] font-mono text-slate-400">
              1000 = Excluida de Ring-All • 1001–1999 = Call Centers • 2001+ = Clientes
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
              <div className="font-bold text-white font-mono">1. Conecta MicroSIP como Ext 1000</div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Registra tu MicroSIP con usuario <strong className="text-cyan-300 font-mono">1000</strong> en el puerto <strong className="text-white font-mono">47923</strong> (la clave está en la pestaña <em>Extensiones PJSIP</em>). Esta extensión nunca recibe llamadas entrantes de clientes.
              </p>
            </div>
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
              <div className="font-bold text-white font-mono">2. Escucha con 1 Clic desde la Web</div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                En cualquier llamada activa abajo, pulsa <strong className="text-cyan-300">Espiar (Silencio)</strong>, <strong className="text-amber-300">Susurrar</strong> o <strong className="text-purple-300">Intervenir</strong>. Tu MicroSIP 1000 timbrará: contesta y entrarás de inmediato.
              </p>
            </div>
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
              <div className="font-bold text-white font-mono">3. O Marca Códigos Directos en MicroSIP</div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Marca <strong className="text-emerald-300 font-mono">*55</strong> (y pulsa <strong className="text-white font-mono">#</strong> para saltar entre llamadas), <strong className="text-cyan-300 font-mono">*551001</strong> (silencio), <strong className="text-amber-300 font-mono">*561001</strong> (susurro al agente) o <strong className="text-purple-300 font-mono">*571001</strong> (hablar ambos).
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ==================== SUBTAB 1: ESCUCHA EN VIVO ==================== */}
      {subTab === 'spy' && (
        <>
          {/* Banner de Sesión de Escucha Activa */}
          {activeSpySession && (
            <div className="bg-gradient-to-r from-cyan-950 via-slate-900 to-slate-950 border-2 border-cyan-500/60 rounded-2xl p-4 sm:p-5 shadow-xl relative overflow-hidden">
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
                      {activeSpySession.mode === 'spy' && '🔇 Silencio absoluto: ni el cliente ni el agente te escuchan.'}
                      {activeSpySession.mode === 'whisper' && '🗣️ Coaching privado: solo el agente te escucha, el cliente NO.'}
                      {activeSpySession.mode === 'barge' && '📢 Conferencia 3 vías: tanto el cliente como el agente te escuchan.'}
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-4 w-full md:w-auto justify-between md:justify-end border-t md:border-t-0 pt-3 md:pt-0 border-slate-800">
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

          {/* Panel de Llamadas Activas */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Columna Izquierda (2 cols): Lista de Llamadas */}
            <div className="lg:col-span-2 space-y-4">
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

              {filteredCalls.length === 0 ? (
                <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-10 text-center space-y-3">
                  <div className="w-14 h-14 rounded-2xl bg-slate-800/80 border border-slate-700 flex items-center justify-center mx-auto text-slate-400">
                    <Headphones className="w-7 h-7 text-slate-500" />
                  </div>
                  <h3 className="text-base font-bold text-white">No hay llamadas activas en este momento</h3>
                  <p className="text-xs text-slate-400 max-w-md mx-auto">
                    Cuando un agente (1001–1999) o cliente (2001+) esté en llamada, aparecerá aquí con los botones <strong>Espiar</strong>, <strong>Susurrar</strong> e <strong>Intervenir</strong> para tu extensión <strong>{supervisorExten}</strong>.
                  </p>
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
                    const extConfig = extensions.find((e) => e.extension === call.agent);

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
                              <div className="flex items-center space-x-2 flex-wrap">
                                <span className="text-base sm:text-lg font-black text-white font-mono tracking-tight">
                                  {call.number}
                                </span>
                                {call.clientName && (
                                  <span className="text-xs text-slate-300 font-medium">({call.clientName})</span>
                                )}
                                {extConfig?.recordCalls && (
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 flex items-center gap-1">
                                    <Disc className="w-2.5 h-2.5 animate-pulse" />
                                    <span>REC</span>
                                  </span>
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

                        <div className="mt-4 pt-3 border-t border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
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

                          <div className="flex items-center flex-wrap gap-2 w-full md:w-auto justify-end">
                            <button
                              type="button"
                              onClick={() => handleStartSpy(call.agent || '1001', call.channel, call.number, 'spy')}
                              className="px-3 py-1.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-xs font-mono font-bold flex items-center space-x-1.5 transition-all cursor-pointer shadow-sm"
                              title="Llama a tu Ext para escuchar en silencio absoluto (ni cliente ni agente te oyen)"
                            >
                              <Headphones className="w-3.5 h-3.5 text-cyan-400" />
                              <span>Espiar (Silencio)</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleStartSpy(call.agent || '1001', call.channel, call.number, 'whisper')}
                              className="px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-mono font-bold flex items-center space-x-1.5 transition-all cursor-pointer shadow-sm"
                              title="Habla al oído del agente para guiarlo (el cliente NO te escucha)"
                            >
                              <Mic className="w-3.5 h-3.5 text-amber-400" />
                              <span>Susurrar</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleStartSpy(call.agent || '1001', call.channel, call.number, 'barge')}
                              className="px-3 py-1.5 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 text-xs font-mono font-bold flex items-center space-x-1.5 transition-all cursor-pointer shadow-sm"
                              title="Entrar a la llamada hablando con ambos (conferencia tripartita)"
                            >
                              <Radio className="w-3.5 h-3.5 text-purple-400" />
                              <span>Intervenir</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleToggleWebAudio(call.id || call.number, call.channel)}
                              className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold flex items-center space-x-1.5 transition-all cursor-pointer shadow-sm ${
                                isWebAudioActive
                                  ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black animate-pulse'
                                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
                              }`}
                              title="Reproducir grabación/stream disponible en navegador"
                            >
                              {isWebAudioActive ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                              <span>{isWebAudioActive ? 'Pausar Web' : 'Audio Web'}</span>
                            </button>

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

            {/* Columna Derecha (1 col): Audio Web & Códigos Softphone */}
            <div className="space-y-4">
              {/* Tarjeta de Reproductor Web */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-lg space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Volume2 className="w-4 h-4 text-cyan-400" />
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                      Audio en Navegador
                    </h3>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-mono">
                    HTML5 Audio
                  </span>
                </div>

                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Para escucha en tiempo real con <strong className="text-amber-300">Susurro / Barge</strong> usa tu MicroSIP conectado a <strong className="text-cyan-300 font-mono">Ext {supervisorExten}</strong>. También puedes revisar las grabaciones WAV en la pestaña <strong className="text-rose-300">Grabaciones</strong>.
                </p>

                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 space-y-2.5">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-slate-400 flex items-center gap-1.5">
                      <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Volumen:</span>
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
                        <span>Reproduciendo...</span>
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

              {/* Códigos de Marcación en Softphone */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-lg space-y-4">
                <div className="flex items-center space-x-2">
                  <Shield className="w-4 h-4 text-amber-400" />
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                    Códigos desde MicroSIP ({supervisorExten})
                  </h3>
                </div>

                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Marca estos códigos directamente desde tu extensión autorizada <strong className="text-cyan-300 font-mono">{supervisorExten}</strong> (activos en el Dialplan de Asterisk):
                </p>

                <div className="space-y-2">
                  <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-mono font-bold text-cyan-400">
                        <code>*55 + Extensión</code>
                      </div>
                      <div className="text-[10px] text-slate-400">
                        Espía Silencioso (Ej: <span className="text-slate-300 font-mono">*551001</span> o <span className="text-slate-300 font-mono">*552001</span>)
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

                  <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-mono font-bold text-amber-400">
                        <code>*56 + Extensión</code>
                      </div>
                      <div className="text-[10px] text-slate-400">
                        Susurro / Coach (Ej: <span className="text-slate-300 font-mono">*561001</span>)
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

                  <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-mono font-bold text-purple-400">
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

                  <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-mono font-bold text-emerald-400">
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
        </>
      )}

      {/* ==================== SUBTAB 2: GRABACIONES POR EXTENSIÓN (MixMonitor) ==================== */}
      {subTab === 'recordings' && (
        <div className="space-y-6">
          {/* Control Rápido de Grabación por Extensión */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Disc className="w-4 h-4 text-rose-400" />
                  <span>Activar / Desactivar Grabación Automática por Extensión (MixMonitor)</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Haz clic en cualquier extensión específica para grabar todas sus llamadas entrantes (IVR), salientes e internas en formato WAV de alta claridad. Se aplica al instante sin cortar llamadas.
                </p>
              </div>
              <span className="text-[11px] font-mono px-2.5 py-1 rounded-lg bg-rose-500/15 text-rose-300 border border-rose-500/30 shrink-0">
                {recordedExtensionsCount} de {recordableExtensions.length} grabando
              </span>
            </div>

            {recordableExtensions.length === 0 ? (
              <div className="text-xs text-slate-400 p-4 rounded-xl bg-slate-950 border border-slate-800">
                No hay extensiones configuradas para mostrar en este rango.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5">
                {recordableExtensions.map((ext) => {
                  const isRec = Boolean(ext.recordCalls);
                  const isBusy = togglingExtRecord === ext.extension;
                  const num = parseInt(ext.extension, 10);
                  const roleTag = !isNaN(num) && num >= 2001 ? 'Cliente 2001+' : 'Call Center';

                  return (
                    <button
                      key={ext.id}
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleToggleExtensionRecording(ext)}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-2 ${
                        isRec
                          ? 'bg-rose-950/40 border-rose-500/60 text-white shadow-md shadow-rose-500/10'
                          : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className="font-mono font-black text-sm">{ext.extension}</span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold flex items-center gap-1 ${
                            isRec
                              ? 'bg-rose-500 text-white'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          <Disc className={`w-2.5 h-2.5 ${isRec ? 'animate-pulse' : ''}`} />
                          <span>{isBusy ? '...' : isRec ? 'REC ON' : 'OFF'}</span>
                        </span>
                      </div>
                      <div className="min-w-0">
                        <div className="text-[11px] font-medium truncate text-slate-200">{ext.name}</div>
                        <div className="text-[9px] font-mono text-slate-400">{roleTag}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Listado y Reproductor de Grabaciones WAV */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Volume2 className="w-4 h-4 text-cyan-400" />
                  <span>Historial de Grabaciones ({recordings.length})</span>
                </h3>
                <p className="text-[11px] text-slate-400">
                  Escucha o descarga los archivos WAV capturados por Asterisk en <code className="text-cyan-300">/var/spool/asterisk/monitor</code>.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={recordingFilterExt}
                  onChange={(e) => setRecordingFilterExt(e.target.value)}
                  className="bg-slate-950 border border-slate-800 text-xs text-white font-mono rounded-lg px-3 py-1.5 focus:outline-none focus:border-cyan-500"
                >
                  <option value="all">Todas las Extensiones</option>
                  {recordableExtensions.map((ext) => (
                    <option key={ext.extension} value={ext.extension}>
                      Ext {ext.extension} ({ext.name})
                    </option>
                  ))}
                </select>

                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={recordingSearch}
                    onChange={(e) => setRecordingSearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && fetchRecordings()}
                    placeholder="Buscar número o archivo..."
                    className="pl-8 pr-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white font-mono focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <button
                  type="button"
                  onClick={fetchRecordings}
                  className="px-3 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-xs font-mono font-bold cursor-pointer"
                >
                  Buscar
                </button>
              </div>
            </div>

            {recordings.length === 0 ? (
              <div className="p-8 text-center bg-slate-950/60 border border-slate-800 rounded-xl space-y-2">
                <Disc className="w-8 h-8 text-slate-600 mx-auto" />
                <div className="text-sm font-bold text-slate-300">No hay grabaciones todavía</div>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Activa el botón <strong className="text-rose-400">REC</strong> en cualquier extensión arriba. La próxima llamada de esa extensión aparecerá aquí para reproducir o descargar.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {recordings.map((rec) => (
                  <div
                    key={rec.filename}
                    className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold shrink-0 mt-0.5 ${
                          rec.direction === 'IN'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : rec.direction === 'INT'
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                        }`}
                      >
                        {rec.direction}
                      </span>
                      <div className="min-w-0">
                        <div className="text-xs font-mono font-bold text-white flex items-center gap-2 flex-wrap">
                          <span>Ext {rec.extension}</span>
                          <span className="text-slate-500">↔</span>
                          <span className="text-emerald-300">{rec.remoteParty}</span>
                          <span className="text-[10px] text-slate-400 font-normal">
                            ({formatSeconds(rec.durationSec)} • {formatFileSize(rec.sizeBytes)})
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono truncate mt-0.5">
                          {rec.date} • {rec.filename}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center flex-wrap gap-2 shrink-0">
                      <audio
                        controls
                        preload="none"
                        src={rec.playUrl}
                        className="h-8 w-56 sm:w-64"
                      />
                      <a
                        href={`${rec.playUrl}?download=1`}
                        download={rec.filename}
                        className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 transition-colors"
                        title="Descargar WAV"
                      >
                        <Download className="w-4 h-4" />
                      </a>
                      <button
                        type="button"
                        onClick={() => handleDeleteRecording(rec.filename)}
                        className="p-2 rounded-lg bg-rose-500/15 hover:bg-rose-500/30 text-rose-400 border border-rose-500/30 transition-colors cursor-pointer"
                        title="Eliminar grabación"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
