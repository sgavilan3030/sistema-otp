import React, { useState, useEffect, useRef } from 'react';
import {
  Phone,
  PhoneCall,
  PhoneForwarded,
  PhoneOff,
  User,
  Users,
  Search,
  Filter,
  Upload,
  Download,
  Plus,
  Trash2,
  CheckCircle2,
  Clock,
  Calendar,
  AlertCircle,
  FileText,
  Building,
  Check,
  X,
  Play,
  RotateCcw,
  Sparkles,
  BarChart2,
  TrendingUp,
  Shield,
  ShieldCheck,
  Eye,
  Edit3,
  Volume2,
  VolumeX,
  Radio,
  Headphones,
  Music
} from 'lucide-react';
import {
  CarrierTrunk,
  PjsipExtension,
  SystemUser,
  ManualDialerLead,
  ManualDialerAuditLog,
  ManualDialerDisposition,
  AudioPrompt
} from '../types';

export type ManualDialerCallMode = 'playback' | 'audio_then_agent' | 'direct';

interface ManualDialerTabProps {
  extensions: PjsipExtension[];
  carriers: CarrierTrunk[];
  currentUser: SystemUser;
  audios?: AudioPrompt[];
  onNavigateToLiveCalls?: () => void;
  onNavigateToVoiceChanger?: () => void;
}

const DEFAULT_1CLICK_AUDIOS: { path: string; name: string; label: string; duration: string; category: string }[] = [
  { path: 'custom/banrearreglado', name: 'banrearreglado.wav', label: 'Alerta Banreservas Antifraude', duration: '12s', category: 'Bancos' },
  { path: 'custom/alerta_banco_antifraude', name: 'alerta_banco_antifraude.wav', label: 'Alerta General Cuenta Bancaria', duration: '10s', category: 'Bancos' },
  { path: 'custom/alerta_cargo_tarjeta', name: 'alerta_cargo_tarjeta.wav', label: 'Alerta Cargo no Reconocido', duration: '11s', category: 'Tarjetas' },
  { path: 'custom/solicitar_codigo_otp', name: 'solicitar_codigo_otp.wav', label: 'Solicitud Código OTP / Token', duration: '8s', category: 'Seguridad' },
  { path: 'custom/solicitar_otp_tarjeta', name: 'solicitar_otp_tarjeta.wav', label: 'Solicitud Código Tarjeta de Crédito', duration: '9s', category: 'Tarjetas' },
  { path: 'custom/alerta_migracion_whatsapp', name: 'alerta_migracion_whatsapp.wav', label: 'Alerta Verificación WhatsApp', duration: '10s', category: 'Mensajería' },
  { path: 'custom/alerta_seguridad_google', name: 'alerta_seguridad_google.wav', label: 'Alerta Seguridad Cuenta Google', duration: '10s', category: 'Cuentas' },
  { path: 'custom/alerta_compra_amazon', name: 'alerta_compra_amazon.wav', label: 'Alerta Orden no Reconocida Amazon', duration: '11s', category: 'E-commerce' },
  { path: 'custom/bienvenida_corporativa', name: 'bienvenida_corporativa.wav', label: 'Bienvenida Corporativa General', duration: '14s', category: 'Corporativo' },
  { path: 'custom/conectar_asesor_banco', name: 'conectar_asesor_banco.wav', label: 'Transfiriendo con Asesor Bancario', duration: '7s', category: 'Transferencia' },
  { path: 'custom/un_momento_validando_informacion', name: 'un_momento_validando_informacion.wav', label: 'Validando Información en Sistema', duration: '8s', category: 'Espera' },
  { path: 'custom/operacion_bloqueada_exito', name: 'operacion_bloqueada_exito.wav', label: 'Operación Bloqueada con Éxito', duration: '8s', category: 'Éxito' },
];

const INITIAL_LEADS: ManualDialerLead[] = [
  {
    id: 'lead-1',
    number: '+18494386040',
    name: 'Ing. Carlos Mendoza',
    company: 'Distribuidora del Caribe',
    notes: 'Interesado en renovación de troncal SIP 30 canales',
    status: 'pending',
    attemptsCount: 0,
  },
  {
    id: 'lead-2',
    number: '+18095550199',
    name: 'Lic. Mariana Fernández',
    company: 'Financiera Capital Plus',
    notes: 'Revisión de tarifa de terminación internacional',
    status: 'answered',
    lastCalledAt: new Date(Date.now() - 3600000 * 2).toISOString(),
    lastCalledBy: 'user-admin',
    lastOperatorName: 'Administrador Maestro',
    lastDurationSec: 142,
    attemptsCount: 1,
    lastActionNotes: 'Cliente confirmó reunión para el jueves a las 10:00 AM.',
  },
  {
    id: 'lead-3',
    number: '+18295550211',
    name: 'Dr. Roberto Gavilán',
    company: 'Servicios Médicos Ozama',
    notes: 'Cliente corporativo nuevo',
    status: 'pending',
    attemptsCount: 0,
  },
  {
    id: 'lead-4',
    number: '+18097770144',
    name: 'Andrea Morales',
    company: 'Inversiones Cibao',
    notes: 'Contacto referido por gerencia',
    status: 'no_answer',
    lastCalledAt: new Date(Date.now() - 3600000 * 5).toISOString(),
    lastCalledBy: 'user-televox',
    lastOperatorName: 'Sammy Gavilán',
    lastDurationSec: 28,
    attemptsCount: 2,
    lastActionNotes: 'Timbró 6 veces sin contestar. Se reintentará en la tarde.',
  },
  {
    id: 'lead-5',
    number: '+18098889922',
    name: 'Lic. David Batista',
    company: 'Soluciones Logísticas RD',
    notes: 'Solicitud de demo de telefonía PJSIP',
    status: 'pending',
    attemptsCount: 0,
  },
];

const INITIAL_AUDIT_LOGS: ManualDialerAuditLog[] = [
  {
    id: 'audit-1',
    timestamp: new Date(Date.now() - 3600000 * 2).toISOString(),
    operatorId: 'user-admin',
    operatorName: 'Administrador Maestro',
    operatorRole: 'admin',
    leadId: 'lead-2',
    clientName: 'Lic. Mariana Fernández',
    clientNumber: '+18095550199',
    extensionUsed: '1001',
    durationSeconds: 142,
    disposition: 'answered',
    dispositionLabel: 'Contestada / Interesado',
    actionNotes: 'Cliente confirmó reunión para el jueves a las 10:00 AM.',
    carrierUsed: 'televox',
    uniqueid: 'ast-1708819201.21',
  },
  {
    id: 'audit-2',
    timestamp: new Date(Date.now() - 3600000 * 5).toISOString(),
    operatorId: 'user-televox',
    operatorName: 'Sammy Gavilán',
    operatorRole: 'agent',
    leadId: 'lead-4',
    clientName: 'Andrea Morales',
    clientNumber: '+18097770144',
    extensionUsed: '1002',
    durationSeconds: 28,
    disposition: 'no_answer',
    dispositionLabel: 'No Contesta',
    actionNotes: 'Timbró 6 veces sin contestar. Se reintentará en la tarde.',
    carrierUsed: 'televox',
    uniqueid: 'ast-1708808400.15',
  },
];

const DISPOSITIONS: { value: ManualDialerDisposition; label: string; badgeColor: string; icon: string }[] = [
  { value: 'answered', label: 'Contestada / Interesado', badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', icon: '✅' },
  { value: 'sale', label: 'Venta / Gestión Exitosa', badgeColor: 'bg-purple-500/20 text-purple-300 border-purple-500/40', icon: '🤝' },
  { value: 'no_answer', label: 'No Contesta', badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/40', icon: '❌' },
  { value: 'busy', label: 'Ocupado / Rechazó', badgeColor: 'bg-rose-500/20 text-rose-300 border-rose-500/40', icon: '⏳' },
  { value: 'voicemail', label: 'Buzón de Voz', badgeColor: 'bg-blue-500/20 text-blue-300 border-blue-500/40', icon: '📵' },
  { value: 'callback', label: 'Volver a Llamar', badgeColor: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40', icon: '🔄' },
  { value: 'invalid_number', label: 'Número Inválido', badgeColor: 'bg-slate-700 text-slate-300 border-slate-600', icon: '⚠️' },
];

export const ManualDialerTab: React.FC<ManualDialerTabProps> = ({
  extensions,
  carriers,
  currentUser,
  audios = [],
  onNavigateToLiveCalls,
  onNavigateToVoiceChanger,
}) => {
  const isAdminOrSupervisor = currentUser.role === 'admin' || currentUser.role === 'supervisor';

  // Active view tab: 'dialer' (Operador 1-Clic) vs 'audit' (Auditoría Administrador)
  const [activeSubTab, setActiveSubTab] = useState<'dialer' | 'audit'>('dialer');

  // Leads State with localStorage
  const [leads, setLeads] = useState<ManualDialerLead[]>(() => {
    try {
      const saved = localStorage.getItem('ast20_manual_dialer_leads');
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return INITIAL_LEADS;
  });

  // Audit Logs State with localStorage
  const [auditLogs, setAuditLogs] = useState<ManualDialerAuditLog[]>(() => {
    try {
      const saved = localStorage.getItem('ast20_manual_dialer_audit_logs');
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return INITIAL_AUDIT_LOGS;
  });

  // Save to localStorage on change
  useEffect(() => {
    try {
      localStorage.setItem('ast20_manual_dialer_leads', JSON.stringify(leads));
    } catch (_) {}
  }, [leads]);

  useEffect(() => {
    try {
      localStorage.setItem('ast20_manual_dialer_audit_logs', JSON.stringify(auditLogs));
    } catch (_) {}
  }, [auditLogs]);

  // Selected Operator Extension
  const [selectedExtension, setSelectedExtension] = useState<string>(() => {
    if (currentUser.assignedExtension) {
      return currentUser.assignedExtension;
    }
    if (currentUser.assignedExtensions && currentUser.assignedExtensions.length > 0) {
      return currentUser.assignedExtensions[0];
    }
    return extensions[0]?.extension || '1001';
  });

  // Selected Carrier for dialing
  const [selectedCarrier, setSelectedCarrier] = useState<string>(() => {
    const active = carriers.find((c) => c.enabled !== false && c.status !== 'disabled');
    return active?.name || carriers[0]?.name || 'televox';
  });

  // Call Mode & Audio Prompt State for 1-Click Dialing
  const [callMode, setCallMode] = useState<ManualDialerCallMode>('playback');
  const [selectedAudioPath, setSelectedAudioPath] = useState<string>('custom/banrearreglado');
  const [selectedAudioName, setSelectedAudioName] = useState<string>('banrearreglado.wav');

  // Audio Preview Player
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const previewAudioObj = useRef<HTMLAudioElement | null>(null);

  // Stop audio preview on unmount
  useEffect(() => {
    return () => {
      if (previewAudioObj.current) {
        previewAudioObj.current.pause();
        previewAudioObj.current = null;
      }
    };
  }, []);

  // Combined Audio Prompts List (Preset system audios + uploaded custom audios)
  const combinedAudioOptions = React.useMemo(() => {
    const list = [...DEFAULT_1CLICK_AUDIOS];
    if (audios && audios.length > 0) {
      audios.forEach((a) => {
        const cleanPath = a.asteriskPath || `custom/${a.fileName.replace(/\.wav$/i, '')}`;
        if (!list.some((item) => item.path === cleanPath || item.name === a.fileName)) {
          list.push({
            path: cleanPath,
            name: a.fileName,
            label: a.name || a.fileName,
            duration: `${a.durationSec || 10}s`,
            category: a.category || 'Audioteca',
          });
        }
      });
    }
    return list;
  }, [audios]);

  // Audio preview toggle
  const handleTogglePreview = () => {
    if (isPlayingPreview) {
      if (previewAudioObj.current) {
        previewAudioObj.current.pause();
        previewAudioObj.current = null;
      }
      setIsPlayingPreview(false);
      return;
    }

    const foundAudio = audios?.find(
      (a) => a.asteriskPath === selectedAudioPath || a.fileName === selectedAudioName || a.id === selectedAudioPath
    );

    const audioSrc = foundAudio?.dataUrl;
    if (audioSrc) {
      try {
        const audio = new Audio(audioSrc);
        previewAudioObj.current = audio;
        setIsPlayingPreview(true);
        audio.onended = () => {
          setIsPlayingPreview(false);
          previewAudioObj.current = null;
        };
        audio.onerror = () => {
          setIsPlayingPreview(false);
          previewAudioObj.current = null;
        };
        audio.play().catch(() => setIsPlayingPreview(false));
        return;
      } catch (_) {
        setIsPlayingPreview(false);
      }
    }

    // Synthesized tone preview if audio is on server Asterisk without local dataUrl
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.setValueAtTime(520, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      setIsPlayingPreview(true);
      setTimeout(() => {
        try {
          osc.stop();
          audioCtx.close();
        } catch (_) {}
        setIsPlayingPreview(false);
      }, 2500);
    } catch (_) {
      setIsPlayingPreview(false);
    }
  };

  // Active Call State
  const [activeCall, setActiveCall] = useState<{
    lead: ManualDialerLead;
    startTime: number;
    channel?: string;
    status: 'dialing' | 'ringing' | 'connected' | 'ended';
    callMode?: ManualDialerCallMode;
    audioName?: string;
  } | null>(null);

  const [callDuration, setCallDuration] = useState<number>(0);
  const timerRef = useRef<any>(null);

  // Chronometer for active call
  useEffect(() => {
    if (activeCall && activeCall.status !== 'ended') {
      timerRef.current = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [activeCall]);

  // Post-Call Disposition Modal / Drawer State
  const [dispositionLead, setDispositionLead] = useState<ManualDialerLead | null>(null);
  const [selectedDisposition, setSelectedDisposition] = useState<ManualDialerDisposition>('answered');
  const [actionNotes, setActionNotes] = useState<string>('');
  const [lastCallSeconds, setLastCallSeconds] = useState<number>(0);

  // File Upload & Manual Add Modals
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [newNumber, setNewNumber] = useState('');
  const [newName, setNewName] = useState('');
  const [newCompany, setNewCompany] = useState('');
  const [newNotes, setNewNotes] = useState('');

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [auditFilterOperator, setAuditFilterOperator] = useState<string>('all');
  const [auditFilterDisposition, setAuditFilterDisposition] = useState<string>('all');

  // Format seconds to mm:ss
  const formatTime = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const s = sec % 60;
    return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // 1-Click Dial Handler
  const handleOneClickDial = async (lead: ManualDialerLead) => {
    if (activeCall) {
      alert('Ya tienes una llamada en curso. Finaliza la llamada actual antes de marcar a otro cliente.');
      return;
    }

    setCallDuration(0);
    setActiveCall({
      lead,
      startTime: Date.now(),
      status: 'dialing',
      callMode,
      audioName: selectedAudioName,
    });

    // Update lead state to show dialing
    setLeads((prev) =>
      prev.map((item) =>
        item.id === lead.id
          ? {
              ...item,
              status: 'pending',
              attemptsCount: item.attemptsCount + 1,
              lastCalledAt: new Date().toISOString(),
              lastCalledBy: currentUser.id,
              lastOperatorName: currentUser.name,
            }
          : item
      )
    );

    // Call Asterisk Originate API
    try {
      const carrierTrunk = carriers.find((c) => c.name === selectedCarrier);
      const res = await fetch('/api/asterisk/call/originate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination: lead.number,
          exten: lead.number,
          channel: `PJSIP/${selectedExtension}`,
          carrier: selectedCarrier,
          agentExten: selectedExtension,
          callMode,
          mode: callMode,
          audioPrompt: selectedAudioPath,
          audioIntro: selectedAudioPath,
          selectedAudioName,
          callerId: carrierTrunk?.outboundCallerId || '+18494386040',
          callerIdNum: carrierTrunk?.outboundCallerId || '+18494386040',
          callerIdName: carrierTrunk?.outboundCallerName || 'Atención al Cliente',
          timeout: 45000,
          async: true,
          leadName: lead.name,
          clientName: lead.name,
          agent: selectedExtension,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setActiveCall((prev) => (prev ? { ...prev, status: 'connected', channel: data.channelId } : null));
      } else {
        // Fallback simulation in dev
        setTimeout(() => {
          setActiveCall((prev) => (prev ? { ...prev, status: 'connected' } : null));
        }, 1500);
      }
    } catch (_) {
      setTimeout(() => {
        setActiveCall((prev) => (prev ? { ...prev, status: 'connected' } : null));
      }, 1500);
    }
  };

  // Hangup Handler
  const handleHangup = async () => {
    if (!activeCall) return;

    const seconds = callDuration;
    const finishedLead = activeCall.lead;

    // Send hangup to Asterisk if channel exists
    if (activeCall.channel) {
      fetch('/api/asterisk/call/hangup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: activeCall.channel }),
      }).catch(() => {});
    }

    setActiveCall(null);
    setLastCallSeconds(seconds);
    setDispositionLead(finishedLead);
    setSelectedDisposition('answered');
    setActionNotes('');
  };

  // Save Disposition and Action
  const handleSaveDisposition = () => {
    if (!dispositionLead) return;

    const dispositionObj = DISPOSITIONS.find((d) => d.value === selectedDisposition);
    const dispositionLabel = dispositionObj ? dispositionObj.label : selectedDisposition;

    // 1. Update Lead
    setLeads((prev) =>
      prev.map((item) =>
        item.id === dispositionLead.id
          ? {
              ...item,
              status: selectedDisposition,
              lastCalledAt: new Date().toISOString(),
              lastCalledBy: currentUser.id,
              lastOperatorName: currentUser.name,
              lastDurationSec: lastCallSeconds,
              lastActionNotes: actionNotes.trim() || undefined,
            }
          : item
      )
    );

    // 2. Add to Global Audit Log for Admins & Supervisors
    const newLog: ManualDialerAuditLog = {
      id: `audit-${Date.now()}`,
      timestamp: new Date().toISOString(),
      operatorId: currentUser.id,
      operatorName: currentUser.name,
      operatorRole: currentUser.role,
      leadId: dispositionLead.id,
      clientName: dispositionLead.name,
      clientNumber: dispositionLead.number,
      extensionUsed: selectedExtension,
      durationSeconds: lastCallSeconds,
      disposition: selectedDisposition,
      dispositionLabel,
      actionNotes: actionNotes.trim() || undefined,
      carrierUsed: selectedCarrier,
      uniqueid: `ast-${Date.now()}`,
      audioUsed: callMode === 'direct' ? 'Voz Directa' : selectedAudioName,
      callMode: callMode,
    };

    setAuditLogs((prev) => [newLog, ...prev]);

    // Close modal
    setDispositionLead(null);
    setActionNotes('');
  };

  // Handle File Upload Parsing (.csv or .txt)
  const handleProcessImport = (text: string) => {
    if (!text.trim()) return;

    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    const newItems: ManualDialerLead[] = [];

    lines.forEach((line, idx) => {
      // Ignore CSV header if present
      if (idx === 0 && (line.toLowerCase().includes('telefono') || line.toLowerCase().includes('phone') || line.toLowerCase().includes('numero'))) {
        return;
      }

      // Detect separator: comma, semicolon, tab, pipe
      const parts = line.split(/[,;\t|]/).map((p) => p.trim().replace(/^["']|["']$/g, ''));
      if (parts.length >= 1) {
        const rawPhone = parts[0];
        const cleanPhone = rawPhone.startsWith('+') ? rawPhone : rawPhone.replace(/\D/g, '');
        if (cleanPhone.length >= 7) {
          const name = parts[1] || `Cliente ${cleanPhone.slice(-4)}`;
          const company = parts[2] || '';
          const notes = parts[3] || '';

          newItems.push({
            id: `lead-import-${Date.now()}-${idx}`,
            number: cleanPhone.startsWith('+') ? cleanPhone : `+${cleanPhone}`,
            name,
            company,
            notes,
            status: 'pending',
            attemptsCount: 0,
          });
        }
      }
    });

    if (newItems.length > 0) {
      setLeads((prev) => [...prev, ...newItems]);
      setIsImportModalOpen(false);
      setImportText('');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        handleProcessImport(content);
      }
    };
    reader.readAsText(file);
  };

  // Add individual lead
  const handleAddManualLead = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNumber.trim() || !newName.trim()) return;

    const cleanNum = newNumber.trim().startsWith('+') ? newNumber.trim() : `+${newNumber.trim().replace(/\D/g, '')}`;

    const newLead: ManualDialerLead = {
      id: `lead-manual-${Date.now()}`,
      number: cleanNum,
      name: newName.trim(),
      company: newCompany.trim() || undefined,
      notes: newNotes.trim() || undefined,
      status: 'pending',
      attemptsCount: 0,
    };

    setLeads((prev) => [newLead, ...prev]);
    setNewNumber('');
    setNewName('');
    setNewCompany('');
    setNewNotes('');
    setIsAddModalOpen(false);
  };

  // Delete lead
  const handleDeleteLead = (id: string) => {
    if (confirm('¿Eliminar este contacto del listado de marcación?')) {
      setLeads((prev) => prev.filter((l) => l.id !== id));
    }
  };

  // Clear all leads
  const handleClearAllLeads = () => {
    if (confirm('¿Estás seguro de que deseas vaciar toda la lista de contactos?')) {
      setLeads([]);
    }
  };

  // Export Audit to CSV
  const handleExportAuditCsv = () => {
    const headers = ['ID', 'Fecha y Hora', 'Operador', 'Rol', 'Extensión', 'Audio / Modo', 'Cliente', 'Teléfono', 'Duración (seg)', 'Disposición', 'Acción y Notas', 'Carrier'];
    const rows = auditLogs.map((log) => [
      log.id,
      new Date(log.timestamp).toLocaleString(),
      `"${log.operatorName.replace(/"/g, '""')}"`,
      log.operatorRole,
      log.extensionUsed,
      `"${(log.audioUsed || 'Voz Directa').replace(/"/g, '""')}"`,
      `"${log.clientName.replace(/"/g, '""')}"`,
      `"${log.clientNumber}"`,
      log.durationSeconds,
      `"${log.dispositionLabel}"`,
      `"${(log.actionNotes || '').replace(/"/g, '""')}"`,
      log.carrierUsed || 'televox',
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `auditoria_llamadas_operadores_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Filtered Leads
  const filteredLeads = leads.filter((lead) => {
    const matchesSearch =
      lead.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      lead.number.includes(searchQuery) ||
      (lead.company && lead.company.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (lead.notes && lead.notes.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'pending' && lead.status === 'pending') ||
      (statusFilter === 'contacted' && lead.status !== 'pending') ||
      lead.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  // Filtered Audit Logs
  const filteredAuditLogs = auditLogs.filter((log) => {
    const matchesOperator = auditFilterOperator === 'all' || log.operatorId === auditFilterOperator;
    const matchesDisposition = auditFilterDisposition === 'all' || log.disposition === auditFilterDisposition;
    const matchesSearch =
      log.clientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.clientNumber.includes(searchQuery) ||
      log.operatorName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (log.actionNotes && log.actionNotes.toLowerCase().includes(searchQuery.toLowerCase()));

    return matchesOperator && matchesDisposition && matchesSearch;
  });

  // KPI Calculations
  const totalLeads = leads.length;
  const pendingLeads = leads.filter((l) => l.status === 'pending').length;
  const contactedLeads = leads.filter((l) => l.status !== 'pending').length;
  const totalCallsLogged = auditLogs.length;
  const effectiveCalls = auditLogs.filter((l) => l.disposition === 'answered' || l.disposition === 'sale').length;
  const effectivenessRate = totalCallsLogged > 0 ? Math.round((effectiveCalls / totalCallsLogged) * 100) : 0;

  // Unique operators in audit
  const uniqueOperators: { id: string; name: string }[] = Array.from(
    new Set(auditLogs.map((l) => JSON.stringify({ id: l.operatorId, name: l.operatorName })))
  ).map((item: string) => JSON.parse(item));

  return (
    <div className="space-y-6">
      {/* Top Banner & Module Selector */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-indigo-500/30 shadow-xl">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 shrink-0 shadow-lg shadow-indigo-500/20">
            <PhoneForwarded className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black text-white tracking-wide">
                Marcador por Listado (1-Clic)
              </h2>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-bold border border-indigo-500/30">
                1-CLICK DIALER
              </span>
              {isAdminOrSupervisor && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30 flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" />
                  <span>AUDITORÍA ADMIN</span>
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Marcación 1 a 1 para operadores con registro de acciones y panel de auditoría en tiempo real para administradores.
            </p>
          </div>
        </div>

        {/* View Switcher: Dialer vs Auditoría */}
        <div className="flex items-center gap-2 bg-slate-950 p-1.5 rounded-xl border border-slate-800">
          <button
            type="button"
            onClick={() => setActiveSubTab('dialer')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
              activeSubTab === 'dialer'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
          >
            <PhoneCall className="w-3.5 h-3.5" />
            <span>Marcador de Operadores</span>
          </button>

          {isAdminOrSupervisor && (
            <button
              type="button"
              onClick={() => setActiveSubTab('audit')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
                activeSubTab === 'audit'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <BarChart2 className="w-3.5 h-3.5" />
              <span>Auditoría de Administrador ({auditLogs.length})</span>
            </button>
          )}

          {onNavigateToVoiceChanger && (
            <button
              type="button"
              onClick={onNavigateToVoiceChanger}
              className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 shadow-sm"
              title="Abrir Cambiador de Voz Femenina (ES/EN)"
            >
              <Sparkles className="w-3.5 h-3.5 text-purple-400 animate-pulse" />
              <span>Cambiador de Voz</span>
            </button>
          )}
        </div>
      </div>

      {/* FLOATING / TOP ACTIVE CALL NOTIFICATION BAR */}
      {activeCall && (
        <div className="p-4 rounded-xl bg-gradient-to-r from-emerald-950 via-slate-900 to-indigo-950 border-2 border-emerald-500 animate-pulse shadow-2xl flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center text-emerald-400 animate-bounce">
              <PhoneCall className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping"></span>
                <span className="text-xs font-black tracking-wider uppercase text-emerald-300">
                  Llamada en Curso ({activeCall.status === 'dialing' ? 'Marcando...' : 'Conectada'})
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300 font-mono">
                  Extensión: {selectedExtension}
                </span>
                <span className="text-xs px-2.5 py-0.5 rounded bg-indigo-900/70 border border-indigo-700/70 text-indigo-200 font-medium flex items-center gap-1.5 shadow-sm">
                  {callMode === 'direct' ? (
                    <>
                      <Headphones className="w-3 h-3 text-emerald-400" />
                      <span>Voz Directa con Operador</span>
                    </>
                  ) : callMode === 'playback' ? (
                    <>
                      <Volume2 className="w-3 h-3 text-indigo-400" />
                      <span>Audio al descolgar: <strong>{selectedAudioName}</strong></span>
                    </>
                  ) : (
                    <>
                      <PhoneForwarded className="w-3 h-3 text-purple-400" />
                      <span>Audio Intro: <strong>{selectedAudioName}</strong> &rarr; Ext {selectedExtension}</span>
                    </>
                  )}
                </span>
              </div>
              <h3 className="text-lg font-black text-white mt-0.5">
                {activeCall.lead.name} &bull; <span className="font-mono text-emerald-400">{activeCall.lead.number}</span>
              </h3>
              {activeCall.lead.company && (
                <p className="text-xs text-slate-300">{activeCall.lead.company}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-center px-4 py-2 rounded-xl bg-slate-950/80 border border-slate-800">
              <div className="text-[10px] uppercase font-bold text-slate-400">Duración</div>
              <div className="text-2xl font-black font-mono text-emerald-400">
                {formatTime(callDuration)}
              </div>
            </div>

            <button
              type="button"
              onClick={handleHangup}
              className="px-5 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-2 shadow-lg shadow-rose-600/30 transition-all cursor-pointer"
            >
              <PhoneOff className="w-4 h-4" />
              <span>Colgar Llamada</span>
            </button>
          </div>
        </div>
      )}

      {/* KPI CARDS (Admin & Operators) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-md">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-xs font-medium uppercase tracking-wider">Total en Listado</span>
            <Users className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-2xl font-black text-white font-mono">{totalLeads}</div>
          <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
            <span>Pendientes: <strong className="text-amber-400">{pendingLeads}</strong></span>
            <span>Gestionados: <strong className="text-emerald-400">{contactedLeads}</strong></span>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-md">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-xs font-medium uppercase tracking-wider">Llamadas Realizadas</span>
            <PhoneCall className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-black text-emerald-400 font-mono">{totalCallsLogged}</div>
          <div className="text-[11px] text-slate-400 mt-1">
            Registros guardados en auditoría
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-md">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-xs font-medium uppercase tracking-wider">Efectividad (%)</span>
            <TrendingUp className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-2xl font-black text-cyan-400 font-mono">{effectivenessRate}%</div>
          <div className="text-[11px] text-slate-400 mt-1">
            Contestadas / Ventas cerradas ({effectiveCalls})
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-md">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-xs font-medium uppercase tracking-wider">Operadores Activos</span>
            <Shield className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-2xl font-black text-purple-400 font-mono">
            {Math.max(1, uniqueOperators.length)}
          </div>
          <div className="text-[11px] text-slate-400 mt-1 truncate">
            Tu extensión: <strong className="text-white font-mono">{selectedExtension}</strong>
          </div>
        </div>
      </div>

      {/* VIEW 1: OPERATOR 1-CLICK DIALER */}
      {activeSubTab === 'dialer' && (
        <div className="space-y-4">
          {/* PANEL PRINCIPAL: SELECCIÓN DE AUDIO AL DESCOLGAR Y MODO DE LLAMADA */}
          <div className="p-4 rounded-xl bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-indigo-500/30 shadow-xl space-y-3.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-indigo-500/20 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
                  <Volume2 className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-black text-white tracking-wide">
                    Audio al Descolgar el Cliente & Modo de Marcación
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    Define qué escuchará el cliente cuando descuelgue la llamada de 1 clic.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Modo Activo:</span>
                <span className="text-xs px-2.5 py-1 rounded-lg bg-indigo-500/20 text-indigo-300 font-bold border border-indigo-500/30">
                  {callMode === 'playback' && '📢 Locución al Descolgar'}
                  {callMode === 'audio_then_agent' && '🔄 Audio Intro + Transferir'}
                  {callMode === 'direct' && '🎧 Voz Directa (Operador)'}
                </span>
              </div>
            </div>

            {/* 3 Botones de Selección de Modo */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={() => setCallMode('playback')}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex items-start gap-3 ${
                  callMode === 'playback'
                    ? 'bg-indigo-600/20 border-indigo-500 text-white shadow-lg shadow-indigo-600/20 ring-1 ring-indigo-500'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                }`}
              >
                <div className={`p-2 rounded-lg shrink-0 ${callMode === 'playback' ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-400'}`}>
                  <Radio className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-white flex items-center gap-1.5">
                    <span>Reproducir Audio al Descolgar</span>
                    {callMode === 'playback' && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                    Al contestar, Asterisk reproduce la locución seleccionada (Notificación, Banco, Promo, Cobro).
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setCallMode('audio_then_agent')}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex items-start gap-3 ${
                  callMode === 'audio_then_agent'
                    ? 'bg-purple-600/20 border-purple-500 text-white shadow-lg shadow-purple-600/20 ring-1 ring-purple-500'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                }`}
              >
                <div className={`p-2 rounded-lg shrink-0 ${callMode === 'audio_then_agent' ? 'bg-purple-500 text-white' : 'bg-slate-800 text-slate-400'}`}>
                  <PhoneForwarded className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-white flex items-center gap-1.5">
                    <span>Audio Intro + Conectar Asesor</span>
                    {callMode === 'audio_then_agent' && <Check className="w-3.5 h-3.5 text-purple-400" />}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                    Reproduce el mensaje de bienvenida y transfiere inmediatamente a tu extensión PJSIP ({selectedExtension}).
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setCallMode('direct')}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex items-start gap-3 ${
                  callMode === 'direct'
                    ? 'bg-emerald-600/20 border-emerald-500 text-white shadow-lg shadow-emerald-600/20 ring-1 ring-emerald-500'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                }`}
              >
                <div className={`p-2 rounded-lg shrink-0 ${callMode === 'direct' ? 'bg-emerald-500 text-white' : 'bg-slate-800 text-slate-400'}`}>
                  <Headphones className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-white flex items-center gap-1.5">
                    <span>Llamada Directa (Voz a Voz)</span>
                    {callMode === 'direct' && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                    El operador habla en vivo desde su teléfono tan pronto como el cliente descuelga.
                  </p>
                </div>
              </button>
            </div>

            {/* Selector de Audio Dropdown + Preview Player (Visible en modos playback y audio_then_agent) */}
            {callMode !== 'direct' && (
              <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-2.5">
                <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
                  <div className="flex flex-1 items-center gap-2.5">
                    <Music className="w-4 h-4 text-indigo-400 shrink-0" />
                    <div className="flex-1">
                      <label className="text-[10px] font-bold text-slate-300 uppercase tracking-wider block mb-1">
                        Locución Pregrabada que escuchará el cliente:
                      </label>
                      <select
                        value={selectedAudioPath}
                        onChange={(e) => {
                          const path = e.target.value;
                          setSelectedAudioPath(path);
                          const matchOpt = combinedAudioOptions.find((o) => o.path === path);
                          if (matchOpt) setSelectedAudioName(matchOpt.name);
                        }}
                        className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs font-medium focus:border-indigo-500 focus:outline-none"
                      >
                        {combinedAudioOptions.map((opt) => (
                          <option key={opt.path} value={opt.path}>
                            [{opt.category}] {opt.label} ({opt.name} - {opt.duration})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={handleTogglePreview}
                      className={`px-3.5 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-md ${
                        isPlayingPreview
                          ? 'bg-amber-600 hover:bg-amber-500 text-white animate-pulse'
                          : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/30'
                      }`}
                    >
                      {isPlayingPreview ? (
                        <>
                          <VolumeX className="w-3.5 h-3.5" />
                          <span>Detener Demo</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5 fill-current" />
                          <span>Escuchar Locución</span>
                        </>
                      )}
                    </button>

                    <div className="hidden sm:block text-[11px] px-2.5 py-2 rounded-lg bg-slate-900 border border-slate-800 font-mono text-indigo-300">
                      Asterisk: Playback({selectedAudioPath})
                    </div>
                  </div>
                </div>

                {/* Accesos rápidos de audios frecuentes */}
                <div className="flex items-center gap-1.5 flex-wrap pt-1 text-[11px] border-t border-slate-800/60">
                  <span className="text-slate-400 font-medium text-[10px] uppercase tracking-wider">Presets Frecuentes:</span>
                  {[
                    { path: 'custom/banrearreglado', label: '🏦 Banreservas Antifraude' },
                    { path: 'custom/alerta_cargo_tarjeta', label: '💳 Cargo Tarjeta' },
                    { path: 'custom/solicitar_codigo_otp', label: '🔐 Solicitar Token OTP' },
                    { path: 'custom/bienvenida_corporativa', label: '🏢 Bienvenida Corporativa' },
                    { path: 'custom/alerta_banco_antifraude', label: '⚠️ Alerta Bancaria' },
                  ].map((chip) => (
                    <button
                      key={chip.path}
                      type="button"
                      onClick={() => {
                        setSelectedAudioPath(chip.path);
                        const matchOpt = combinedAudioOptions.find((o) => o.path === chip.path);
                        if (matchOpt) setSelectedAudioName(matchOpt.name);
                      }}
                      className={`px-2 py-0.5 rounded-md border text-[11px] font-medium transition-all cursor-pointer ${
                        selectedAudioPath === chip.path
                          ? 'bg-indigo-500/30 border-indigo-400 text-indigo-200'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                      }`}
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Controls Bar */}
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
            {/* Operator Ext and Carrier Selectors */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <label className="text-xs font-bold text-slate-300">Extensión Operador:</label>
                <select
                  value={selectedExtension}
                  onChange={(e) => setSelectedExtension(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono text-xs font-bold focus:border-indigo-500 focus:outline-none"
                >
                  {extensions.map((ext) => (
                    <option key={ext.id} value={ext.extension}>
                      Ext {ext.extension} - {ext.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <label className="text-xs font-bold text-slate-300">Troncal Saliente:</label>
                <select
                  value={selectedCarrier}
                  onChange={(e) => setSelectedCarrier(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono text-xs focus:border-indigo-500 focus:outline-none"
                >
                  {carriers.map((c) => (
                    <option key={c.id} value={c.name}>
                      [{c.name}] ({c.authType === 'ip_auth' ? 'IP a IP' : 'SIP Reg'})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* List Actions: Import & Add */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setIsImportModalOpen(true)}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-indigo-600/20 transition-all cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Cargar Lista (.txt / .csv)</span>
              </button>

              <button
                type="button"
                onClick={() => setIsAddModalOpen(true)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Nuevo Contacto</span>
              </button>

              {leads.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearAllLeads}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-950 text-slate-400 hover:text-rose-300 border border-slate-700 transition-all cursor-pointer"
                  title="Vaciar lista de contactos"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Search & Status Filters */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar por cliente, teléfono o nota..."
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer transition-all ${
                  statusFilter === 'all'
                    ? 'bg-indigo-600 text-white font-bold'
                    : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                }`}
              >
                Todos ({leads.length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('pending')}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer transition-all ${
                  statusFilter === 'pending'
                    ? 'bg-amber-600 text-white font-bold'
                    : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                }`}
              >
                Pendientes ({pendingLeads})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('contacted')}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer transition-all ${
                  statusFilter === 'contacted'
                    ? 'bg-emerald-600 text-white font-bold'
                    : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                }`}
              >
                Gestionados ({contactedLeads})
              </button>
            </div>
          </div>

          {/* Leads Table */}
          <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/80 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="p-3.5">Cliente / Teléfono</th>
                    <th className="p-3.5">Empresa / Referencia</th>
                    <th className="p-3.5">Estado Gestión</th>
                    <th className="p-3.5">Última Llamada / Operador</th>
                    <th className="p-3.5">Observaciones</th>
                    <th className="p-3.5 text-right">Acción 1-Clic</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-sans">
                  {filteredLeads.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-400">
                        <Users className="w-8 h-8 mx-auto mb-2 text-slate-600" />
                        <p className="font-semibold text-white">No hay contactos en la lista</p>
                        <p className="text-xs text-slate-400 mt-1">
                          Haz clic en "Cargar Lista (.txt / .csv)" o "Nuevo Contacto" para comenzar.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    filteredLeads.map((lead) => {
                      const isCallingThis = activeCall?.lead.id === lead.id;
                      const dispObj = DISPOSITIONS.find((d) => d.value === lead.status);

                      return (
                        <tr
                          key={lead.id}
                          className={`hover:bg-slate-800/40 transition-colors ${
                            isCallingThis ? 'bg-indigo-950/30 ring-1 ring-indigo-500' : ''
                          }`}
                        >
                          <td className="p-3.5">
                            <div className="font-bold text-white text-sm">{lead.name}</div>
                            <div className="font-mono text-emerald-400 text-xs font-semibold flex items-center gap-1.5 mt-0.5">
                              <Phone className="w-3 h-3 text-slate-500" />
                              <span>{lead.number}</span>
                            </div>
                          </td>

                          <td className="p-3.5">
                            {lead.company ? (
                              <div className="flex items-center gap-1.5 text-slate-300">
                                <Building className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                                <span className="font-medium">{lead.company}</span>
                              </div>
                            ) : (
                              <span className="text-slate-600 italic">Sin empresa</span>
                            )}
                          </td>

                          <td className="p-3.5">
                            {lead.status === 'pending' ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                <Clock className="w-3 h-3" />
                                <span>Pendiente</span>
                              </span>
                            ) : (
                              <span
                                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold border ${
                                  dispObj?.badgeColor || 'bg-slate-800 text-slate-300'
                                }`}
                              >
                                <span>{dispObj?.icon || '•'}</span>
                                <span>{dispObj?.label || lead.status}</span>
                              </span>
                            )}
                            {lead.attemptsCount > 0 && (
                              <span className="text-[10px] text-slate-400 block mt-0.5">
                                Intentos: {lead.attemptsCount}
                              </span>
                            )}
                          </td>

                          <td className="p-3.5">
                            {lead.lastCalledAt ? (
                              <div className="space-y-0.5">
                                <div className="text-slate-300 font-medium">
                                  {new Date(lead.lastCalledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  {' - '}
                                  {new Date(lead.lastCalledAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                                </div>
                                <div className="text-[11px] text-slate-400 flex items-center gap-1">
                                  <User className="w-3 h-3 text-slate-500" />
                                  <span>{lead.lastOperatorName || 'Operador'}</span>
                                  {lead.lastDurationSec !== undefined && (
                                    <span className="text-emerald-400 font-mono">
                                      ({formatTime(lead.lastDurationSec)})
                                    </span>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <span className="text-slate-600 italic">No llamado aún</span>
                            )}
                          </td>

                          <td className="p-3.5 max-w-xs">
                            <p className="text-slate-300 text-xs truncate" title={lead.lastActionNotes || lead.notes || ''}>
                              {lead.lastActionNotes || lead.notes || <span className="text-slate-600 italic">Sin observaciones</span>}
                            </p>
                          </td>

                          <td className="p-3.5 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {isCallingThis ? (
                                <button
                                  type="button"
                                  onClick={handleHangup}
                                  className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-rose-600/30 cursor-pointer animate-pulse"
                                >
                                  <PhoneOff className="w-3.5 h-3.5" />
                                  <span>Colgar ({formatTime(callDuration)})</span>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleOneClickDial(lead)}
                                  disabled={Boolean(activeCall)}
                                  className={`px-3 py-1.5 rounded-lg text-white font-bold text-xs flex items-center gap-1.5 shadow-md transition-all cursor-pointer disabled:opacity-40 ${
                                    callMode === 'direct'
                                      ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/20'
                                      : callMode === 'playback'
                                      ? 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-600/20'
                                      : 'bg-purple-600 hover:bg-purple-500 shadow-purple-600/20'
                                  }`}
                                  title={
                                    callMode === 'direct'
                                      ? `Marcar 1-Clic directo desde Ext ${selectedExtension}`
                                      : callMode === 'playback'
                                      ? `Marcar 1-Clic: al contestar reproducirá audio "${selectedAudioName}"`
                                      : `Marcar 1-Clic: intro "${selectedAudioName}" y transfiere a Ext ${selectedExtension}`
                                  }
                                >
                                  {callMode === 'direct' ? (
                                    <PhoneCall className="w-3.5 h-3.5" />
                                  ) : callMode === 'playback' ? (
                                    <Volume2 className="w-3.5 h-3.5" />
                                  ) : (
                                    <PhoneForwarded className="w-3.5 h-3.5" />
                                  )}
                                  <span>
                                    {callMode === 'direct' && '1-Clic Voz'}
                                    {callMode === 'playback' && `1-Clic (${selectedAudioName.replace(/\.wav$/i, '')})`}
                                    {callMode === 'audio_then_agent' && `1-Clic (Audio + Ext ${selectedExtension})`}
                                  </span>
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => handleDeleteLead(lead.id)}
                                className="p-1.5 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition-colors cursor-pointer"
                                title="Eliminar de lista"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: ADMINISTRATOR AUDIT TRAIL */}
      {activeSubTab === 'audit' && (
        <div className="space-y-4">
          {/* Header Controls for Admin */}
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <BarChart2 className="w-5 h-5 text-emerald-400" />
              <div>
                <h3 className="text-sm font-bold text-white">Registro Global de Auditoría de Llamadas</h3>
                <p className="text-[11px] text-slate-400">
                  Todas las llamadas y acciones registradas por operadores en tiempo real.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleExportAuditCsv}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-emerald-600/20 transition-all cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Exportar a Excel / CSV</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (confirm('¿Vaciar el historial de auditoría?')) {
                    setAuditLogs([]);
                  }
                }}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-950 text-slate-400 hover:text-rose-300 border border-slate-700 text-xs font-bold transition-all cursor-pointer"
              >
                Limpiar Auditoría
              </button>
            </div>
          </div>

          {/* Filters Bar for Admin */}
          <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5 text-slate-400" />
                <span className="font-bold text-slate-300">Operador:</span>
                <select
                  value={auditFilterOperator}
                  onChange={(e) => setAuditFilterOperator(e.target.value)}
                  className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono focus:border-indigo-500 focus:outline-none"
                >
                  <option value="all">Todos los Operadores</option>
                  {uniqueOperators.map((op) => (
                    <option key={op.id} value={op.id}>
                      {op.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="font-bold text-slate-300">Tipificación / Disposición:</span>
                <select
                  value={auditFilterDisposition}
                  onChange={(e) => setAuditFilterDisposition(e.target.value)}
                  className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono focus:border-indigo-500 focus:outline-none"
                >
                  <option value="all">Todas las Disposiciones</option>
                  {DISPOSITIONS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.icon} {d.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar en auditoría..."
                className="w-full pl-8 pr-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Audit Logs Table */}
          <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/80 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="p-3.5">Fecha & Hora</th>
                    <th className="p-3.5">Operador / Asesor</th>
                    <th className="p-3.5">Cliente & Número</th>
                    <th className="p-3.5">Extensión</th>
                    <th className="p-3.5">Audio / Modo</th>
                    <th className="p-3.5">Duración</th>
                    <th className="p-3.5">Disposición</th>
                    <th className="p-3.5">Acción y Observaciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-sans">
                  {filteredAuditLogs.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-slate-400">
                        <BarChart2 className="w-8 h-8 mx-auto mb-2 text-slate-600" />
                        <p className="font-semibold text-white">No hay registros de auditoría aún</p>
                        <p className="text-xs text-slate-400 mt-1">
                          Conforme los operadores vayan marcando a los contactos, cada llamada y acción aparecerá aquí.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    filteredAuditLogs.map((log) => {
                      const dispObj = DISPOSITIONS.find((d) => d.value === log.disposition);

                      return (
                        <tr key={log.id} className="hover:bg-slate-800/40 transition-colors">
                          <td className="p-3.5 whitespace-nowrap">
                            <div className="font-medium text-white">
                              {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {new Date(log.timestamp).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })}
                            </div>
                          </td>

                          <td className="p-3.5">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-full bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center font-bold text-indigo-300 text-xs">
                                {log.operatorName.charAt(0)}
                              </div>
                              <div>
                                <div className="font-bold text-white">{log.operatorName}</div>
                                <div className="text-[10px] text-slate-400 uppercase font-mono">{log.operatorRole}</div>
                              </div>
                            </div>
                          </td>

                          <td className="p-3.5">
                            <div className="font-bold text-white">{log.clientName}</div>
                            <div className="font-mono text-emerald-400 text-xs font-semibold">{log.clientNumber}</div>
                          </td>

                          <td className="p-3.5 font-mono text-slate-300">
                            Ext {log.extensionUsed}
                          </td>

                          <td className="p-3.5">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono bg-slate-950 border border-slate-800 text-indigo-300">
                              <Volume2 className="w-3 h-3 text-indigo-400 shrink-0" />
                              <span className="truncate max-w-[140px]">{log.audioUsed || 'Voz Directa'}</span>
                            </span>
                          </td>

                          <td className="p-3.5 font-mono text-slate-300 font-bold">
                            {formatTime(log.durationSeconds)}
                          </td>

                          <td className="p-3.5">
                            <span
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold border ${
                                dispObj?.badgeColor || 'bg-slate-800 text-slate-300'
                              }`}
                            >
                              <span>{dispObj?.icon || '•'}</span>
                              <span>{log.dispositionLabel}</span>
                            </span>
                          </td>

                          <td className="p-3.5 max-w-sm">
                            {log.actionNotes ? (
                              <p className="text-slate-200 text-xs leading-relaxed bg-slate-950/60 p-2 rounded border border-slate-800">
                                {log.actionNotes}
                              </p>
                            ) : (
                              <span className="text-slate-500 italic">Sin observaciones adicionales</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: POST-CALL DISPOSITION & ACTION LOGGER */}
      {dispositionLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-indigo-500/40 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Tipificar Llamada & Registrar Acción</h3>
                  <p className="text-xs text-slate-400">
                    Cliente: <strong className="text-white">{dispositionLead.name}</strong> ({dispositionLead.number})
                  </p>
                </div>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-slate-400 uppercase">Duración</span>
                <div className="font-mono text-emerald-400 font-bold text-sm">
                  {formatTime(lastCallSeconds)}
                </div>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-bold mb-2">
                  Selecciona la Disposición / Resultado de la Llamada:
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {DISPOSITIONS.map((d) => (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => setSelectedDisposition(d.value)}
                      className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer flex items-center gap-2 ${
                        selectedDisposition === d.value
                          ? `${d.badgeColor} ring-1 ring-white/20 shadow-md`
                          : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:bg-slate-900'
                      }`}
                    >
                      <span className="text-base">{d.icon}</span>
                      <span className="font-bold text-xs">{d.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1.5">
                  Acciones Tomadas / Notas del Operador:
                </label>
                <textarea
                  rows={3}
                  value={actionNotes}
                  onChange={(e) => setActionNotes(e.target.value)}
                  placeholder="Ej: Cliente solicitó cotización por correo, volver a llamar el lunes a las 2:00 PM..."
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setDispositionLead(null)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition-colors cursor-pointer"
              >
                Omitir
              </button>
              <button
                type="button"
                onClick={handleSaveDisposition}
                className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md shadow-emerald-600/30 flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>Guardar y Pasar al Siguiente</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: IMPORT LIST (.TXT / .CSV) */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Upload className="w-5 h-5 text-indigo-400" />
                <h3 className="text-base font-bold text-white">Cargar Listado de Clientes (.txt / .csv)</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                className="p-1 rounded text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-lg bg-indigo-950/30 border border-indigo-500/30 text-indigo-200">
                <p className="font-bold">Formato Soportado:</p>
                <p className="text-[11px] text-slate-300 mt-0.5">
                  Una línea por cliente. Columnas separadas por coma, tab o punto y coma:
                  <br />
                  <code className="text-emerald-300 font-mono">
                    8095551234, Juan Pérez, Empresa SA, Notas
                  </code>
                </p>
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1.5">
                  Subir Archivo (.txt, .csv)
                </label>
                <input
                  type="file"
                  accept=".txt,.csv"
                  onChange={handleFileUpload}
                  className="w-full text-xs text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-indigo-600 file:text-white hover:file:bg-indigo-500 cursor-pointer"
                />
              </div>

              <div className="relative flex py-1 items-center">
                <div className="flex-grow border-t border-slate-800"></div>
                <span className="flex-shrink mx-3 text-slate-500 text-[10px] uppercase font-bold">O pegar texto</span>
                <div className="flex-grow border-t border-slate-800"></div>
              </div>

              <div>
                <textarea
                  rows={6}
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder="8494386040, Carlos Gomez, Distribuidora&#10;8095550199, Mariana Fernandez, Banco"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white font-mono placeholder-slate-600 focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => handleProcessImport(importText)}
                disabled={!importText.trim()}
                className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-bold text-xs shadow-md shadow-indigo-600/30 flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Importar Contactos</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ADD INDIVIDUAL LEAD */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Plus className="w-5 h-5 text-indigo-400" />
                <h3 className="text-base font-bold text-white">Agregar Contacto a la Lista</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 rounded text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddManualLead} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-bold mb-1">Nombre del Cliente *</label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Ej: Lic. Juan Pérez"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">Número de Teléfono *</label>
                <input
                  type="text"
                  required
                  value={newNumber}
                  onChange={(e) => setNewNumber(e.target.value)}
                  placeholder="Ej: +18095550199"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white font-mono focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">Empresa / Razón Social</label>
                <input
                  type="text"
                  value={newCompany}
                  onChange={(e) => setNewCompany(e.target.value)}
                  placeholder="Ej: Inversiones Globales"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">Notas u Observaciones Iniciales</label>
                <textarea
                  rows={2}
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  placeholder="Ej: Contacto de referencia, interesado en PBX nube"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md shadow-indigo-600/30 flex items-center gap-1.5 transition-all cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Guardar Contacto</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
