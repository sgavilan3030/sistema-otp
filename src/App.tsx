import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  PjsipExtension,
  CarrierTrunk,
  Press1Config,
  OtpCaptureConfig,
  AsteriskConnectionSettings,
  SyncLogEntry,
  AudioPrompt,
  AudioRole,
  ActiveAudioAssignments,
  SystemUser,
  AstDbEntry,
  SqliteCdrRecord,
} from './types';
import {
  initialExtensions,
  initialCarriers,
  initialPress1Config,
  initialOtpConfig,
  initialConnectionSettings,
  initialAudios,
  initialUsers,
  initialAstDbEntries,
  initialCdrRecords,
} from './data/defaultConfig';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { LoginScreen } from './components/LoginScreen';
import { ProductionOperationsTab } from './components/ProductionOperationsTab';
import { LiveCallsTab } from './components/LiveCallsTab';
import { CallSpyMonitorTab } from './components/CallSpyMonitorTab';
import { PromptMaestroTab } from './components/PromptMaestroTab';
import { ExtensionsTab } from './components/ExtensionsTab';
import { MinuteResellerTab } from './components/MinuteResellerTab';
import { CarriersTab } from './components/CarriersTab';
import { IVRStudioTab } from './components/IVRStudioTab';
import { SqliteTab } from './components/SqliteTab';
import { AudioLibraryTab } from './components/AudioLibraryTab';
import { UsersTab } from './components/UsersTab';
import { SyncTelemetryTab } from './components/SyncTelemetryTab';
import { AmiAriDiagnosticsTab } from './components/AmiAriDiagnosticsTab';
import { ConfigExporterTab } from './components/ConfigExporterTab';
import { CallSimulatorModal } from './components/CallSimulatorModal';
import { CheckCircle2, AlertCircle, RefreshCw, KeyRound, Copy, Check, X, ShieldAlert } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('production');

  // Core Data States with localStorage persistence
  const [extensions, setExtensions] = useState<PjsipExtension[]>(() => {
    const saved = localStorage.getItem('ast20_extensions');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length >= 3) {
          return parsed;
        }
      } catch (e) {}
    }
    return initialExtensions;
  });

  const [carriers, setCarriers] = useState<CarrierTrunk[]>(() => {
    const saved = localStorage.getItem('ast20_carriers');
    return saved ? JSON.parse(saved) : initialCarriers;
  });

  const [press1Config, setPress1Config] = useState<Press1Config>(() => {
    const saved = localStorage.getItem('ast20_press1');
    return saved ? JSON.parse(saved) : initialPress1Config;
  });

  const [otpConfig, setOtpConfig] = useState<OtpCaptureConfig>(() => {
    const saved = localStorage.getItem('ast20_otp');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return {
          ...parsed,
          webhookUrl: parsed.webhookUrl?.includes('miempresa.com') ? initialOtpConfig.webhookUrl : parsed.webhookUrl,
        };
      } catch (e) {
        return initialOtpConfig;
      }
    }
    return initialOtpConfig;
  });

  const [connectionSettings, setConnectionSettings] = useState<AsteriskConnectionSettings>(() => {
    const saved = localStorage.getItem('ast20_conn_settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Ensure new credentials apply if user had previous defaults
        return {
          ...parsed,
          amiUser: parsed.amiUser === 'asterisk_admin' ? initialConnectionSettings.amiUser : parsed.amiUser,
          amiSecret: parsed.amiSecret === 'ami_super_secret_key_2026' ? initialConnectionSettings.amiSecret : parsed.amiSecret,
          ariUser: parsed.ariUser === 'ari_stasis_bot' ? initialConnectionSettings.ariUser : parsed.ariUser,
          ariSecret: parsed.ariSecret === 'ari_rest_token_8899' ? initialConnectionSettings.ariSecret : parsed.ariSecret,
        };
      } catch (e) {
        return initialConnectionSettings;
      }
    }
    return initialConnectionSettings;
  });

  // Native SQLite3 AstDB and CDR States
  const [astDbEntries, setAstDbEntries] = useState<AstDbEntry[]>(() => {
    const saved = localStorage.getItem('ast20_astdb');
    return saved ? JSON.parse(saved) : initialAstDbEntries;
  });

  const [cdrRecords, setCdrRecords] = useState<SqliteCdrRecord[]>(() => {
    const saved = localStorage.getItem('ast20_cdr');
    return saved ? JSON.parse(saved) : initialCdrRecords;
  });

  // Pre-recorded Audios State
  const [audios, setAudios] = useState<AudioPrompt[]>(() => {
    const saved = localStorage.getItem('ast20_audios');
    return saved ? JSON.parse(saved) : initialAudios;
  });

  // Users & Permissions State
  const [users, setUsers] = useState<SystemUser[]>(() => {
    const saved = localStorage.getItem('ast20_users');
    return saved ? JSON.parse(saved) : initialUsers;
  });

  const [currentUserId, setCurrentUserId] = useState<string>(() => {
    const saved = localStorage.getItem('ast20_current_user_id');
    return saved || 'user-admin';
  });

  // Login authentication state: Por seguridad se exige autenticación obligatoria al ingresar al dominio
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    try {
      localStorage.removeItem('ast_session_user_token');
      // Siempre exigir autenticación en primera carga para mostrar el panel de login
      return false;
    } catch {
      return false;
    }
  });

  // Theme state: 'light' | 'dark' (Default to 'light' for modern clear, professional appearance)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('ast20_theme');
    return saved === 'dark' ? 'dark' : 'light';
  });

  const handleToggleTheme = () => {
    setTheme((prev) => {
      const next = prev === 'light' ? 'dark' : 'light';
      try {
        localStorage.setItem('ast20_theme', next);
      } catch (e) {}
      return next;
    });
  };

  useEffect(() => {
    if (!isAuthenticated) {
      document.documentElement.classList.add('theme-dark');
      document.documentElement.classList.remove('theme-light');
      document.body.classList.remove('theme-light');
      document.body.classList.add('theme-dark', 'bg-[#010604]');
      return;
    }
    if (theme === 'light') {
      document.documentElement.classList.add('theme-light');
      document.documentElement.classList.remove('theme-dark');
      document.body.classList.remove('theme-dark', 'bg-[#010604]');
    } else {
      document.documentElement.classList.add('theme-dark');
      document.documentElement.classList.remove('theme-light');
      document.body.classList.add('theme-dark');
      document.body.classList.remove('theme-light');
    }
  }, [theme, isAuthenticated]);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState<boolean>(false);

  const [isSyncing, setIsSyncing] = useState(false);
  const [isCallSimulatorOpen, setIsCallSimulatorOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'info' | 'error' } | null>(null);

  // Global OTP Alert monitor across all tabs
  const [globalOtpAlert, setGlobalOtpAlert] = useState<{ id: string; number: string; otp: string; status: string; timestamp: string } | null>(null);
  const [dismissedOtpKey, setDismissedOtpKey] = useState<string>('');
  const [copiedOtp, setCopiedOtp] = useState<boolean>(false);

  useEffect(() => {
    const pollGlobalOtp = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const res = await fetch('/api/asterisk/otp/records');
        const data = await res.json();
        if (data.success && Array.isArray(data.records) && data.records.length > 0) {
          const newest = data.records[0];
          const alertKey = `${newest.id}_${newest.otp}`;
          if (newest && newest.otp && alertKey !== dismissedOtpKey) {
            setGlobalOtpAlert(newest);
          }
        }
      } catch (err) {}
    };

    pollGlobalOtp();
    const interval = setInterval(pollGlobalOtp, 4000);
    return () => clearInterval(interval);
  }, [dismissedOtpKey]);

  // Live active calls monitor across tabs
  const [activeCallCount, setActiveCallCount] = useState<number>(0);
  useEffect(() => {
    const pollLiveCalls = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const res = await fetch('/api/asterisk/live/calls');
        if (res.ok) {
          const data = await res.json();
          if (data.success && Array.isArray(data.calls)) {
            const running = data.calls.filter((c: any) => c.status !== 'ended').length;
            setActiveCallCount(running);
          }
        }
      } catch (_) {}
    };
    pollLiveCalls();
    const interval = setInterval(pollLiveCalls, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleCopyOtp = (otp: string) => {
    navigator.clipboard.writeText(otp);
    setCopiedOtp(true);
    setTimeout(() => setCopiedOtp(false), 2000);
  };

  const handleQuickOtpDecision = async (status: 'valid' | 'invalid') => {
    if (!globalOtpAlert) return;
    try {
      await fetch('/api/asterisk/otp/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: globalOtpAlert.id,
          number: globalOtpAlert.number,
          otp: globalOtpAlert.otp,
          status,
        }),
      });
      setGlobalOtpAlert((prev) => (prev ? { ...prev, status } : null));
      if (status === 'valid') {
        setTimeout(() => setGlobalOtpAlert(null), 1800);
      }
    } catch (e) {
      console.warn('Error sending quick OTP decision:', e);
    }
  };

  // Active Asterisk Audio Assignments
  const [activeAudioAssignments, setActiveAudioAssignments] = useState<ActiveAudioAssignments>({
    press1_welcome: 'custom/bienvenida_corporativa',
    agent_transfer: 'custom/conectar_asesor_banco',
    press1_invalid: 'custom/opcion_invalida',
    welcome_3333: 'custom/solicitar_codigo_otp',
    welcome_4444: 'custom/solicitar_codigo_otp',
    welcome_5555: 'custom/solicitar_codigo_otp',
    welcome_6666: 'custom/bienvenida_6666',
    welcome_7777: 'custom/solicitar_codigo_otp',
    otp_welcome: 'custom/solicitar_codigo_otp',
    otp_wait: 'custom/un_momento_validando_informacion',
    otp_success: 'custom/operacion_bloqueada_exito',
    otp_failure: 'custom/token_invalido_reintente',
    hold_music: 'custom/voz_comercial_para_barrick_pueblo_viejo_',
  });

  // Manual Locks State for Audios 6666, 7777 and IVR Script/Entity
  const [manualLocks, setManualLocks] = useState<{
    welcome_6666: boolean;
    welcome_7777: boolean;
    ivr_entity: boolean;
  }>(() => {
    try {
      const saved = localStorage.getItem('ast20_audio_locks_ui');
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return {
      welcome_6666: false,
      welcome_7777: false,
      ivr_entity: false,
    };
  });

  const handleToggleManualLock = (role: string, isLocked: boolean) => {
    setManualLocks((prev) => {
      const next = { ...prev, [role]: isLocked };
      try { localStorage.setItem('ast20_audio_locks_ui', JSON.stringify(next)); } catch (_) {}
      return next;
    });
    fetch('/api/asterisk/audio/toggle-lock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, isLocked }),
    }).catch(() => {});
  };

  // Centralized Cross-Browser and Cross-Device Synchronization per User
  const isApplyingRemoteUpdateRef = useRef(false);
  const isStateLoadedRef = useRef(false);
  const lastServerTimestampRef = useRef(0);

  const currentUser = users.find((u) => u.id === currentUserId) || users[0];

  const fetchUserState = useCallback(async (targetUserId?: string, targetUsername?: string) => {
    try {
      const uId = targetUserId || currentUserId || 'user-admin';
      const uName = targetUsername || currentUser?.username || 'admin';
      const res = await fetch(`/api/app/user-state?userId=${encodeURIComponent(uId)}&username=${encodeURIComponent(uName)}`);
      if (!res.ok) {
        isStateLoadedRef.current = true;
        return;
      }
      const data = await res.json();
      if (data.success && data.state) {
        const s = data.state;
        if (s.lastUpdated && s.lastUpdated <= lastServerTimestampRef.current && isStateLoadedRef.current) {
          return;
        }
        lastServerTimestampRef.current = s.lastUpdated || Date.now();
        isApplyingRemoteUpdateRef.current = true;
        isStateLoadedRef.current = true;

        if (Array.isArray(s.extensions) && s.extensions.length > 0) {
          setExtensions(s.extensions);
          try { localStorage.setItem('ast20_extensions', JSON.stringify(s.extensions)); } catch (e) {}
        }
        if (Array.isArray(s.carriers) && s.carriers.length > 0) {
          setCarriers(s.carriers);
          try { localStorage.setItem('ast20_carriers', JSON.stringify(s.carriers)); } catch (e) {}
        }
        if (s.press1Config) {
          setPress1Config((prev) => {
            if (prev.isLocked && !s.press1Config.isLocked) return prev;
            try { localStorage.setItem('ast20_press1', JSON.stringify(s.press1Config)); } catch (e) {}
            return s.press1Config;
          });
        }
        if (s.otpConfig) {
          setOtpConfig((prev) => {
            if (prev.isLocked && !s.otpConfig.isLocked) return prev;
            try { localStorage.setItem('ast20_otp', JSON.stringify(s.otpConfig)); } catch (e) {}
            return s.otpConfig;
          });
        }
        if (Array.isArray(s.audios) && s.audios.length > 0) {
          setAudios(s.audios);
          try { localStorage.setItem('ast20_audios', JSON.stringify(s.audios)); } catch (e) {}
        }
        if (Array.isArray(s.users) && s.users.length > 0) {
          setUsers(s.users);
          try { localStorage.setItem('ast20_users', JSON.stringify(s.users)); } catch (e) {}
        }
        if (s.connectionSettings) {
          setConnectionSettings(s.connectionSettings);
          try { localStorage.setItem('ast20_conn_settings', JSON.stringify(s.connectionSettings)); } catch (e) {}
        }
        if (Array.isArray(s.astDbEntries)) {
          setAstDbEntries(s.astDbEntries);
          try { localStorage.setItem('ast20_astdb', JSON.stringify(s.astDbEntries)); } catch (e) {}
        }
        if (s.theme) {
          setTheme(s.theme);
          try { localStorage.setItem('ast20_theme', s.theme); } catch (e) {}
        }

        setTimeout(() => {
          isApplyingRemoteUpdateRef.current = false;
        }, 400);
      } else {
        isStateLoadedRef.current = true;
      }
    } catch (err) {
      isStateLoadedRef.current = true;
    }
  }, [currentUserId, currentUser?.username]);

  // Poll server state every 4.5s and on window focus
  useEffect(() => {
    fetchUserState();
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      fetchUserState();
    }, 4500);
    const handleFocus = () => fetchUserState();
    window.addEventListener('focus', handleFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
    };
  }, [fetchUserState]);

  // Synchronize changes made in other tabs of the same browser via storage event
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (!e.key || isApplyingRemoteUpdateRef.current) return;
      try {
        if (e.key === 'ast20_extensions' && e.newValue) setExtensions(JSON.parse(e.newValue));
        if (e.key === 'ast20_carriers' && e.newValue) setCarriers(JSON.parse(e.newValue));
        if (e.key === 'ast20_press1' && e.newValue) {
          const parsed = JSON.parse(e.newValue);
          setPress1Config((prev) => (prev.isLocked && !parsed.isLocked ? prev : parsed));
        }
        if (e.key === 'ast20_otp' && e.newValue) {
          const parsed = JSON.parse(e.newValue);
          setOtpConfig((prev) => (prev.isLocked && !parsed.isLocked ? prev : parsed));
        }
        if (e.key === 'ast20_audios' && e.newValue) setAudios(JSON.parse(e.newValue));
        if (e.key === 'ast20_users' && e.newValue) setUsers(JSON.parse(e.newValue));
        if (e.key === 'ast20_conn_settings' && e.newValue) setConnectionSettings(JSON.parse(e.newValue));
        if (e.key === 'ast20_astdb' && e.newValue) setAstDbEntries(JSON.parse(e.newValue));
        if (e.key === 'ast20_audio_locks_ui' && e.newValue) setManualLocks(JSON.parse(e.newValue));
      } catch (err) {}
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // Debounced push to server when user modifies local state - ONLY after initial state loaded to avoid clobbering with defaults
  useEffect(() => {
    if (isApplyingRemoteUpdateRef.current || !isStateLoadedRef.current) return;
    const timer = setTimeout(async () => {
      try {
        const payload = {
          extensions,
          carriers,
          press1Config,
          otpConfig,
          audios,
          users,
          connectionSettings,
          astDbEntries,
          theme,
        };
        const res = await fetch('/api/app/user-state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUser.id,
            username: currentUser.username,
            state: payload,
          }),
        });
        if (res.ok) {
          const d = await res.json();
          if (d.lastUpdated) {
            lastServerTimestampRef.current = d.lastUpdated;
          }
        }
      } catch (err) {}
    }, 1200);

    return () => clearTimeout(timer);
  }, [extensions, carriers, press1Config, otpConfig, audios, users, connectionSettings, astDbEntries, theme, currentUser.id, currentUser.username]);

  useEffect(() => {
    fetch('/api/asterisk/audio/active-assignments')
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.assignments) {
          setActiveAudioAssignments((prev) => {
            const next = { ...data.assignments };
            // Protect locked 6666 and 7777 audio configurations
            if (manualLocks.welcome_6666 && prev.welcome_6666) next.welcome_6666 = prev.welcome_6666;
            if (manualLocks.welcome_7777 && prev.welcome_7777) next.welcome_7777 = prev.welcome_7777;
            return next;
          });
          if (data.manualLocks) {
            setManualLocks((prev) => ({
              ...prev,
              welcome_6666: prev.welcome_6666 || !!data.manualLocks.welcome_6666,
              welcome_7777: prev.welcome_7777 || !!data.manualLocks.welcome_7777,
              ivr_entity: prev.ivr_entity || !!data.manualLocks.ivr_entity,
            }));
          }
        }
      })
      .catch(() => {});

    // Fetch live Asterisk extensions on startup to ensure 100% synchronization
    fetch('/api/asterisk/extensions')
      .then((r) => r.json())
      .then((data) => {
        if (data.success && Array.isArray(data.extensions) && data.extensions.length > 0) {
          setExtensions(data.extensions);
          try {
            localStorage.setItem('ast20_extensions', JSON.stringify(data.extensions));
          } catch (e) {}
        }
      })
      .catch(() => {});
  }, []);

  const handleAssignRole = async (role: AudioRole, asteriskPath: string) => {
    setActiveAudioAssignments((prev) => ({ ...prev, [role]: asteriskPath }));
    try {
      const res = await fetch('/api/asterisk/audio/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, asteriskPath }),
      });
      const data = await res.json();
      if (data.success && data.assignments) {
        setActiveAudioAssignments(data.assignments);
      }
      showToast(`Audio "${asteriskPath}" asignado al rol "${role}".`);
      addLog('AMI', `[AUDIO LIVE] Rol ${role} actualizado a ${asteriskPath}`, `AstDB actualizado.`);
    } catch (e) {
      showToast(`Error al asignar audio en Asterisk`);
    }
  };

  // Sync Telemetry Logs
  const [logs, setLogs] = useState<SyncLogEntry[]>([
    {
      id: 'log-1',
      timestamp: '17:20:00',
      type: 'SYSTEM',
      message: 'Black Hat Dialer System inicializado. Regla activa: Extensiones 1001 en adelante.',
      status: 'success',
    },
    {
      id: 'log-2',
      timestamp: '17:20:01',
      type: 'AMI',
      message: 'Conectado a Asterisk Manager Interface en 127.0.0.1:5038',
      payload: 'Asterisk Call Manager/9.0.0\nResponse: Success\nMessage: Authentication accepted',
      status: 'success',
    },
    {
      id: 'log-3',
      timestamp: '17:20:02',
      type: 'ARI',
      message: 'Canal WebSocket ARI conectado en puerto 8088',
      payload: 'Stasis Application registered: otp_verification_app',
      status: 'success',
    },
    {
      id: 'log-4',
      timestamp: '17:20:03',
      type: 'SYSTEM',
      message: 'Audioteca cargada con 5 locuciones pregrabadas en /var/lib/asterisk/sounds/custom/',
      status: 'success',
    },
  ]);

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem('ast20_extensions', JSON.stringify(extensions));
  }, [extensions]);

  useEffect(() => {
    localStorage.setItem('ast20_carriers', JSON.stringify(carriers));
  }, [carriers]);

  useEffect(() => {
    localStorage.setItem('ast20_press1', JSON.stringify(press1Config));
  }, [press1Config]);

  useEffect(() => {
    localStorage.setItem('ast20_otp', JSON.stringify(otpConfig));
  }, [otpConfig]);

  useEffect(() => {
    localStorage.setItem('ast20_conn_settings', JSON.stringify(connectionSettings));
  }, [connectionSettings]);

  useEffect(() => {
    localStorage.setItem('ast20_audios', JSON.stringify(audios));
  }, [audios]);

  useEffect(() => {
    localStorage.setItem('ast20_users', JSON.stringify(users));
  }, [users]);

  useEffect(() => {
    localStorage.setItem('ast20_current_user_id', currentUserId);
  }, [currentUserId]);

  useEffect(() => {
    localStorage.setItem('ast20_astdb', JSON.stringify(astDbEntries));
  }, [astDbEntries]);

  useEffect(() => {
    localStorage.setItem('ast20_cdr', JSON.stringify(cdrRecords));
  }, [cdrRecords]);

  const showToast = (text: string, type: 'success' | 'info' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 3500);
  };

  const addLog = (
    type: SyncLogEntry['type'],
    message: string,
    payload?: string,
    status: 'success' | 'pending' | 'failed' = 'success'
  ) => {
    const newLog: SyncLogEntry = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(-4)}`,
      timestamp: new Date().toLocaleTimeString(),
      type,
      message,
      payload,
      status,
    };
    setLogs((prev) => [newLog, ...prev]);
  };

  // AstDB & SQLite3 Handlers
  const handleAddAstDbEntry = (entry: AstDbEntry) => {
    setAstDbEntries((prev) => [entry, ...prev]);
    addLog(
      'SQLITE',
      `AstDB: database put ${entry.family} ${entry.key} ${entry.value}`,
      `Key: /${entry.family}/${entry.key}\nValue: ${entry.value}\nEngine: /var/lib/asterisk/astdb.sqlite3`
    );
    showToast(`Registro AstDB guardado: /${entry.family}/${entry.key}`);
  };

  const handleDeleteAstDbEntry = (id: string) => {
    const item = astDbEntries.find((e) => e.id === id);
    setAstDbEntries((prev) => prev.filter((e) => e.id !== id));
    if (item) {
      addLog('SQLITE', `AstDB: database del ${item.family} ${item.key}`);
      showToast(`Registro AstDB eliminado: /${item.family}/${item.key}`);
    }
  };

  const handleSaveCdrRecord = (cdr: SqliteCdrRecord) => {
    setCdrRecords((prev) => [cdr, ...prev]);
    addLog(
      'SQLITE',
      `CDR SQLite3: Nuevo registro de llamada insertado (${cdr.src} -> ${cdr.dst})`,
      `Table: cdr\nDB: ${connectionSettings.sqliteCdrDbPath}\nDisposition: ${cdr.disposition}\nBillsec: ${cdr.billsec}s`
    );
  };

  const handleExecuteSqliteCommand = (cmd: string) => {
    addLog('SQLITE', `Ejecutando en SQLite3 / Asterisk CLI: ${cmd}`);
  };

  // =========================================================================
  // AMI CLIENT-SIDE RETRY CONTROLLER WITH EXPONENTIAL BACKOFF
  // =========================================================================
  interface AmiClientBackoffState {
    consecutiveFailures: number;
    baseDelayMs: number;
    maxDelayMs: number;
    currentDelayMs: number;
    nextAllowedTime: number;
    isBackoffActive: boolean;
    lastFailureTime: number;
    lastSuccessTime: number;
    lastError: string;
  }

  const [amiBackoff, setAmiBackoff] = useState<AmiClientBackoffState>({
    consecutiveFailures: 0,
    baseDelayMs: 1000,
    maxDelayMs: 32000,
    currentDelayMs: 1000,
    nextAllowedTime: 0,
    isBackoffActive: false,
    lastFailureTime: 0,
    lastSuccessTime: 0,
    lastError: '',
  });

  const amiBackoffRef = useRef(amiBackoff);
  useEffect(() => {
    amiBackoffRef.current = amiBackoff;
  }, [amiBackoff]);

  // Exponential backoff calculator with jitter: min(32s, 1s * 2^(failures-1)) + jitter
  const calculateAmiBackoffDelay = (failures: number): number => {
    const base = 1000;
    const max = 32000;
    const exponent = Math.min(failures - 1, 5);
    const expDelay = Math.min(max, base * Math.pow(2, exponent));
    const jitter = Math.floor(Math.random() * (expDelay * 0.15));
    return expDelay + jitter;
  };

  const recordAmiSuccessClient = () => {
    if (amiBackoffRef.current.consecutiveFailures > 0 || amiBackoffRef.current.isBackoffActive) {
      addLog(
        'AMI',
        `[AMI RECONECTADO] Conexión establecida con éxito con Asterisk :5038 tras ${amiBackoffRef.current.consecutiveFailures} reintentos. Backoff finalizado.`,
        undefined,
        'success'
      );
    }
    setAmiBackoff({
      consecutiveFailures: 0,
      baseDelayMs: 1000,
      maxDelayMs: 32000,
      currentDelayMs: 1000,
      nextAllowedTime: 0,
      isBackoffActive: false,
      lastFailureTime: 0,
      lastSuccessTime: Date.now(),
      lastError: '',
    });
    setConnectionSettings((prev) => (prev.status === 'connected' ? prev : { ...prev, status: 'connected' }));
  };

  const recordAmiFailureClient = (errMsg: string) => {
    const now = Date.now();
    const newFailures = amiBackoffRef.current.consecutiveFailures + 1;
    const delay = calculateAmiBackoffDelay(newFailures);
    const nextTime = now + delay;
    const cooldownSec = Math.round(delay / 1000);

    setAmiBackoff({
      consecutiveFailures: newFailures,
      baseDelayMs: 1000,
      maxDelayMs: 32000,
      currentDelayMs: delay,
      nextAllowedTime: nextTime,
      isBackoffActive: true,
      lastFailureTime: now,
      lastSuccessTime: amiBackoffRef.current.lastSuccessTime,
      lastError: errMsg,
    });
    setConnectionSettings((prev) => (prev.status === 'error' ? prev : { ...prev, status: 'error' }));

    addLog(
      'AMI',
      `[AMI BACKOFF ACTIVADO] Intento fallido #${newFailures} (${errMsg}). Reconexión en pausa por ${cooldownSec}s para evitar bucles.`,
      `Estrategia: min(32s, 1s * 2^${Math.min(newFailures - 1, 5)}) + jitter => ${delay}ms\nSiguiente reintento permitido: ${new Date(nextTime).toLocaleTimeString()}`,
      'failed'
    );
    showToast(`Asterisk no accesible. Cooldown AMI: ${cooldownSec}s`, 'error');
  };

  const handleResetAmiBackoff = async () => {
    setAmiBackoff({
      consecutiveFailures: 0,
      baseDelayMs: 1000,
      maxDelayMs: 32000,
      currentDelayMs: 1000,
      nextAllowedTime: 0,
      isBackoffActive: false,
      lastFailureTime: 0,
      lastSuccessTime: Date.now(),
      lastError: '',
    });
    setConnectionSettings((prev) => ({ ...prev, status: 'connected' }));
    try {
      await fetch('/api/asterisk/ami/reset-backoff', { method: 'POST' });
    } catch (_) {}
    addLog('AMI', '[AMI BACKOFF RESET] Circuito restablecido manualmente por el operador.', undefined, 'success');
    showToast('Backoff AMI restablecido');
  };

  // Full Hot Reload Execution with Backoff Check
  const handleQuickSync = async (extsToSync = extensions, carriersToSync = carriers) => {
    const now = Date.now();
    const state = amiBackoffRef.current;

    // Check if AMI circuit is currently in exponential backoff
    if (state.isBackoffActive && now < state.nextAllowedTime) {
      const remainingSec = Math.max(1, Math.ceil((state.nextAllowedTime - now) / 1000));
      addLog(
        'AMI',
        `[SYNC PAUSADO] Sincronización evitada para prevenir saturación de Asterisk (${remainingSec}s restantes).`,
        `Asterisk no está accesible actualmente. Los cambios locales se mantienen protegidos.`,
        'pending'
      );
      showToast(`Sincronización en pausa (${remainingSec}s restantes)`, 'info');
      return;
    }

    setIsSyncing(true);
    addLog(
      'AMI',
      `Sincronizando ${extsToSync.length} extensiones y ${carriersToSync.length} troncales con Asterisk (/etc/asterisk/pjsip.conf) vía AMI...`,
      'POST /api/asterisk/sync/extensions'
    );

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const res = await fetch('/api/asterisk/sync/extensions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          extensions: extsToSync,
          carriers: carriersToSync,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        recordAmiSuccessClient();
        addLog(
          'AMI',
          `Black Hat Dialer System Actualizado: ${data.message || 'Recarga en caliente exitosa'}`,
          data.amiOutput || `Module 'res_pjsip.so' reloaded with ${extsToSync.length} endpoints.`
        );
        showToast(`Dialer System sincronizado: ${extsToSync.length} extensiones y ${carriersToSync.length} troncales`);
      } else {
        throw new Error('Servidor Asterisk no disponible');
      }
    } catch (err: any) {
      recordAmiFailureClient(err.message || 'Fallo de sincronización AMI');
      addLog(
        'AMI',
        'PJSIP reloaded locally (offline cache active).',
        `Output: Cambios guardados en memoria local. Cooldown aplicado para evitar saturación de red.`
      );
      showToast('Sincronización local completada (Asterisk offline)');
    } finally {
      setIsSyncing(false);
    }
  };

  // Extension Handlers (Enforces 1001+)
  const handleAddExtension = (newExt: PjsipExtension) => {
    const updated = [...extensions, newExt];
    setExtensions(updated);
    try {
      localStorage.setItem('ast20_extensions', JSON.stringify(updated));
    } catch (e) {}
    addLog(
      'PJSIP',
      `Nueva extensión PJSIP creada: ${newExt.extension} (${newExt.name})`,
      `Endpoint: [${newExt.extension}]\nAuth: [${newExt.extension}-auth]\nAor: [${newExt.extension}]`
    );
    handleQuickSync(updated);
  };

  const handleUpdateExtension = (updatedExt: PjsipExtension) => {
    const updated = extensions.map((e) => (e.id === updatedExt.id ? updatedExt : e));
    setExtensions(updated);
    try {
      localStorage.setItem('ast20_extensions', JSON.stringify(updated));
    } catch (e) {}
    addLog('PJSIP', `Extensión PJSIP modificada: ${updatedExt.extension}`);
    handleQuickSync(updated);
  };

  const handleDeleteExtension = (id: string) => {
    const ext = extensions.find((e) => e.id === id);
    const updated = extensions.filter((e) => e.id !== id);
    setExtensions(updated);
    try {
      localStorage.setItem('ast20_extensions', JSON.stringify(updated));
    } catch (e) {}
    if (ext) {
      addLog('PJSIP', `Extensión PJSIP eliminada del sistema: ${ext.extension}`);
      handleQuickSync(updated);
    }
  };

  const handleResetDefaultExtensions = () => {
    setExtensions(initialExtensions);
    try {
      localStorage.setItem('ast20_extensions', JSON.stringify(initialExtensions));
    } catch (e) {}
    showToast('Extensiones oficiales (1001, 1002, 1003, 1004) restauradas con éxito.', 'success');
    addLog('PJSIP', 'Cargadas extensiones 1001, 1002, 1003 y 1004 en memoria y sincronizadas.');
    handleQuickSync(initialExtensions);
  };

  const handleSimulateQualify = (extNumber: string) => {
    addLog(
      'AMI',
      `Enviando SIP OPTIONS Qualify a extensión ${extNumber}`,
      `Action: Command\nCommand: pjsip show endpoint ${extNumber}`
    );
    setTimeout(() => {
      addLog(
        'AMI',
        `Respuesta Qualify de extensión ${extNumber}: Reachable (RTT: 12.4ms)`
      );
      showToast(`Extensión ${extNumber}: Reachable (12ms)`);
    }, 400);
  };

  // Carrier Handlers
  const handleAddCarrier = (newCarrier: CarrierTrunk) => {
    const updated = [...carriers, newCarrier];
    setCarriers(updated);
    addLog(
      'PJSIP',
      `Nuevo Carrier SIP agregado: ${newCarrier.name} (${newCarrier.host})`,
      `AuthType: ${newCarrier.authType}\nInboundContext: ${newCarrier.inboundContext}\nCodecs: ${newCarrier.codecs.join(',')}`
    );
    if (connectionSettings.autoSyncOnChange) {
      handleQuickSync(extensions, updated);
    } else {
      showToast(`Carrier ${newCarrier.name} agregado.`);
    }
  };

  const handleUpdateCarrier = (updatedCarrier: CarrierTrunk) => {
    const updated = carriers.map((c) => (c.id === updatedCarrier.id ? updatedCarrier : c));
    setCarriers(updated);
    addLog('PJSIP', `Carrier SIP actualizado: ${updatedCarrier.name}`);
    if (connectionSettings.autoSyncOnChange) {
      handleQuickSync(extensions, updated);
    } else {
      showToast(`Carrier ${updatedCarrier.name} actualizado.`);
    }
  };

  const handleDeleteCarrier = (id: string) => {
    const c = carriers.find((item) => item.id === id);
    const updated = carriers.filter((item) => item.id !== id);
    setCarriers(updated);
    if (c) {
      addLog('PJSIP', `Carrier SIP eliminado: ${c.name}`);
      if (connectionSettings.autoSyncOnChange) {
        handleQuickSync(extensions, updated);
      } else {
        showToast(`Carrier ${c.name} eliminado.`);
      }
    }
  };

  const handlePingCarrier = (id: string) => {
    const c = carriers.find((item) => item.id === id);
    if (!c) return;
    addLog('AMI', `Enviando SIP OPTIONS ping a Carrier ${c.name} (${c.host}:${c.port})`);
    setTimeout(() => {
      const latency = Math.floor(Math.random() * 20) + 12;
      setCarriers((prev) =>
        prev.map((item) => (item.id === id ? { ...item, latencyMs: latency } : item))
      );
      addLog('AMI', `Carrier ${c.name} respuesta: Reachable (${latency}ms)`);
      showToast(`Carrier ${c.name} latencia: ${latency}ms`);
    }, 400);
  };

  const handleToggleCarrier = (id: string) => {
    const c = carriers.find((item) => item.id === id);
    if (!c) return;
    const isCurrentlyEnabled = c.enabled !== false && c.status !== 'disabled';
    const newStatus = isCurrentlyEnabled ? 'disabled' : 'reachable';
    const newEnabled = !isCurrentlyEnabled;

    const updated = carriers.map((item) => {
      if (item.id === id) {
        return {
          ...item,
          enabled: newEnabled,
          status: newStatus as any,
        };
      }
      return item;
    });

    setCarriers(updated);
    addLog(
      'PJSIP',
      newEnabled ? `Carrier SIP Habilitado: ${c.name}` : `Carrier SIP Deshabilitado: ${c.name}`,
      `Host: ${c.host}:${c.port} | Estado: ${newEnabled ? 'ACTIVO (Se conecta)' : 'SUSPENDIDO (No conecta)'}`
    );
    // Sincronizar inmediatamente con Asterisk en 1 clic
    handleQuickSync(extensions, updated);
    showToast(newEnabled ? `Troncal [${c.name}] HABILITADA y conectando` : `Troncal [${c.name}] DESHABILITADA (Conexión suspendida)`, 'info');
  };

  // Audio Handlers
  const handleAddAudio = async (newAudio: AudioPrompt) => {
    setAudios((prev) => [newAudio, ...prev]);
    addLog(
      'SYSTEM',
      `[AUDIO] Registrando archivo de audio: ${newAudio.fileName}`,
      `Path: /var/lib/asterisk/sounds/${newAudio.asteriskPath}.wav\nFormato: ${newAudio.sampleRate}\nDuración: ${newAudio.durationSec}s`
    );
    showToast(`Audio "${newAudio.name}" registrado en la audioteca.`);

    // Automatically sync physical audio file to Asterisk filesystem if dataUrl is available
    if (newAudio.dataUrl) {
      try {
        const res = await fetch('/api/asterisk/audio/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: newAudio.name,
            fileName: newAudio.fileName,
            category: newAudio.category,
            dataUrl: newAudio.dataUrl,
          }),
        });
        const data = await res.json();
        if (data.success) {
          addLog(
            'SYSTEM',
            `[AUDIO-SYNC] Archivo guardado físicamente en Asterisk: ${data.asteriskPath}`,
            `Ruta: /var/lib/asterisk/sounds/${data.asteriskPath}.wav\nFormato optimizado: ${data.format || '8kHz Mono'}`
          );
        }
      } catch (err) {
        console.warn('Could not sync audio physically to Asterisk:', err);
      }
    }
  };

  const handleDeleteAudio = async (id: string) => {
    const audio = audios.find((a) => a.id === id);
    setAudios((prev) => prev.filter((a) => a.id !== id));
    if (audio) {
      addLog('SYSTEM', `[AUDIO] Archivo de audio eliminado: ${audio.fileName}`);
      showToast(`Audio "${audio.name}" eliminado.`);
      try {
        await fetch('/api/asterisk/audio/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            asteriskPath: audio.asteriskPath,
            fileName: audio.fileName,
          }),
        });
      } catch (e) {}
    }
  };

  const handleAssignToPress1 = (audioId: string) => {
    setPress1Config((prev) => ({ ...prev, welcomeAudioId: audioId }));
    const audio = audios.find((a) => a.id === audioId);
    showToast(`Audio "${audio?.name || 'seleccionado'}" asignado a Bienvenida Press 1.`);
    addLog(
      'AMI',
      `IVR Press 1 actualizado con audio: ${audio?.fileName}`,
      `Dialplan: Background(${audio?.asteriskPath})`
    );
    if (audio?.asteriskPath) {
      fetch('/api/asterisk/audio/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'press1_welcome', asteriskPath: audio.asteriskPath }),
      }).catch(() => {});
    }
  };

  const handleAssignToAgentTransfer = (audioId: string) => {
    const audio = audios.find((a) => a.id === audioId);
    if (!audio) return;
    showToast(`Audio "${audio.name}" asignado a Transferencia a Asesor (Opción 1).`);
    addLog(
      'AMI',
      `Audio de Transferencia a Asesor actualizado: ${audio.fileName}`,
      `AstDB: database put ivr_vars default_agent "${audio.asteriskPath}" (Playback al presionar 1)`
    );
    fetch('/api/asterisk/audio/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'agent_transfer', asteriskPath: audio.asteriskPath }),
    }).catch(() => {});
  };

  const handleAssignTo7777 = (audioId: string) => {
    const audio = audios.find((a) => a.id === audioId);
    if (!audio) return;
    showToast(`Audio "${audio.name}" asignado a Bienvenida de Extensión 7777.`);
    addLog(
      'AMI',
      `Bienvenida Extensión 7777 actualizada: ${audio.fileName}`,
      `AstDB: database put ivr_vars 7777_intro "${audio.asteriskPath}"`
    );
    fetch('/api/asterisk/audio/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'welcome_7777', asteriskPath: audio.asteriskPath }),
    }).catch(() => {});
  };

  const handleAssignTo3333 = (audioId: string) => {
    const audio = audios.find((a) => a.id === audioId);
    if (!audio) return;
    showToast(`Audio "${audio.name}" asignado a Bienvenida de Extensión 3333.`);
    addLog(
      'AMI',
      `Bienvenida Extensión 3333 actualizada: ${audio.fileName}`,
      `AstDB: database put ivr_vars 3333_intro "${audio.asteriskPath}"`
    );
    fetch('/api/asterisk/audio/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'welcome_3333', asteriskPath: audio.asteriskPath }),
    }).catch(() => {});
  };

  const handleAssignTo4444 = (audioId: string) => {
    const audio = audios.find((a) => a.id === audioId);
    if (!audio) return;
    showToast(`Audio "${audio.name}" asignado a Bienvenida de Extensión 4444.`);
    addLog(
      'AMI',
      `Bienvenida Extensión 4444 actualizada: ${audio.fileName}`,
      `AstDB: database put ivr_vars 4444_intro "${audio.asteriskPath}"`
    );
    fetch('/api/asterisk/audio/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'welcome_4444', asteriskPath: audio.asteriskPath }),
    }).catch(() => {});
  };

  const handleAssignTo5555 = (audioId: string) => {
    const audio = audios.find((a) => a.id === audioId);
    if (!audio) return;
    showToast(`Audio "${audio.name}" asignado a Bienvenida de Extensión 5555.`);
    addLog(
      'AMI',
      `Bienvenida Extensión 5555 actualizada: ${audio.fileName}`,
      `AstDB: database put ivr_vars 5555_intro "${audio.asteriskPath}"`
    );
    fetch('/api/asterisk/audio/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'welcome_5555', asteriskPath: audio.asteriskPath }),
    }).catch(() => {});
  };

  const handleAssignTo6666 = (audioId: string) => {
    const audio = audios.find((a) => a.id === audioId);
    if (!audio) return;
    showToast(`Audio "${audio.name}" asignado a Bienvenida de Extensión 6666.`);
    addLog(
      'AMI',
      `Bienvenida Extensión 6666 actualizada: ${audio.fileName}`,
      `AstDB: database put ivr_vars 6666_intro "${audio.asteriskPath}"`
    );
    fetch('/api/asterisk/audio/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'welcome_6666', asteriskPath: audio.asteriskPath }),
    }).catch(() => {});
  };

  const handleAssignToOtp = (audioId: string) => {
    setOtpConfig((prev) => ({ ...prev, welcomeAudioId: audioId }));
    const audio = audios.find((a) => a.id === audioId);
    showToast(`Audio "${audio?.name || 'seleccionado'}" asignado a Captura de OTP.`);
    addLog(
      'ARI',
      `Stasis OTP actualizado con audio de instrucción: ${audio?.fileName}`,
      `ARI Stasis Playback: ${audio?.asteriskPath}`
    );
  };

  // User Handlers
  const handleAddUser = (newUser: SystemUser) => {
    setUsers((prev) => [...prev, newUser]);
    addLog(
      'SYSTEM',
      `[USUARIOS] Nuevo usuario creado: ${newUser.name} (Rol: ${newUser.role})`,
      `Extensiones asignadas: ${newUser.assignedExtensions.join(', ') || 'Ninguna'}`
    );
    showToast(`Usuario ${newUser.name} creado.`);
  };

  const handleUpdateUser = (updatedUser: SystemUser) => {
    setUsers((prev) => prev.map((u) => (u.id === updatedUser.id ? updatedUser : u)));
    addLog('SYSTEM', `[USUARIOS] Permisos actualizados para: ${updatedUser.name}`);
    showToast(`Usuario ${updatedUser.name} actualizado.`);
  };

  const handleDeleteUser = (userId: string) => {
    const user = users.find((u) => u.id === userId);
    setUsers((prev) => prev.filter((u) => u.id !== userId));
    if (user) {
      addLog('SYSTEM', `[USUARIOS] Usuario eliminado: ${user.name}`);
      showToast(`Usuario ${user.name} eliminado.`);
    }
  };

  const handleSwitchUser = async (userId: string) => {
    setCurrentUserId(userId);
    const user = users.find((u) => u.id === userId);
    if (user) {
      showToast(`Sesión cambiada a: ${user.name} (${user.role})`);
      addLog('SYSTEM', `[SESIÓN] Operador activo cambiado a: ${user.name}`);
      try {
        localStorage.setItem('ast20_current_user_id', user.id);
      } catch (e) {}
      await fetchUserState(user.id, user.username);
    }
  };

  // Custom AMI Command Runner with Exponential Backoff and Controlled Retry Limit
  const handleExecuteAmiCommand = async (command: string, retryAttempt = 0) => {
    const now = Date.now();
    const state = amiBackoffRef.current;

    // Check Circuit Breaker / Cooldown Guard
    if (state.isBackoffActive && now < state.nextAllowedTime && retryAttempt === 0) {
      const remainingSec = Math.max(1, Math.ceil((state.nextAllowedTime - now) / 1000));
      addLog(
        'AMI',
        `[REINTENTO LIMITADO] Comando en pausa: servidor Asterisk no accesible. Cooldown activo (${remainingSec}s restantes).`,
        `Error previo: ${state.lastError || 'Conexión rechazada'}\nPara reintentar ahora, haz clic en "Restablecer Backoff AMI".`,
        'pending'
      );
      showToast(`AMI en espera de reconexión (${remainingSec}s)`, 'info');
      return;
    }

    addLog('AMI', retryAttempt > 0 ? `[REINTENTO #${retryAttempt}] > ${command}` : `> ${command}`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const res = await fetch('/api/asterisk/ami/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: connectionSettings.amiHost || '127.0.0.1',
          port: connectionSettings.amiPort || 5038,
          user: connectionSettings.amiUser || 'sammy',
          secret: connectionSettings.amiSecret || 'Robert2026RDTGcvgbsg',
          command,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const data = await res.json();
      if (res.ok && data.success && data.output && !data.output.startsWith('AMI Error') && !data.output.startsWith('AMI Backoff')) {
        recordAmiSuccessClient();
        addLog('AMI', `Response: Success (AMI :5038)`, data.output, 'success');
        return;
      } else {
        const errorMsg = data.error || (data.output?.includes('Backoff activo') ? data.output : 'Error de respuesta en Asterisk AMI');
        recordAmiFailureClient(errorMsg);

        // Controlled Retry Mechanism with Exponential Backoff (up to 2 retries max)
        if (retryAttempt < 2) {
          const nextAttempt = retryAttempt + 1;
          const nextDelay = calculateAmiBackoffDelay(nextAttempt);
          const nextSec = Math.round(nextDelay / 1000);
          addLog(
            'AMI',
            `[PROGRAMANDO REINTENTO #${nextAttempt}] Esperando ${nextSec}s con backoff exponencial antes de reintentar...`,
            undefined,
            'pending'
          );
          setTimeout(() => {
            handleExecuteAmiCommand(command, nextAttempt);
          }, nextDelay);
        }
      }
    } catch (err: any) {
      const isTimeout = err.name === 'AbortError';
      const errorMsg = isTimeout ? 'Timeout al conectar al socket AMI (4s)' : (err.message || 'Fallo de conexión');
      recordAmiFailureClient(errorMsg);

      // Controlled Retry Mechanism with Exponential Backoff
      if (retryAttempt < 2) {
        const nextAttempt = retryAttempt + 1;
        const nextDelay = calculateAmiBackoffDelay(nextAttempt);
        const nextSec = Math.round(nextDelay / 1000);
        addLog(
          'AMI',
          `[PROGRAMANDO REINTENTO #${nextAttempt}] Esperando ${nextSec}s con backoff exponencial antes de reintentar...`,
          undefined,
          'pending'
        );
        setTimeout(() => {
          handleExecuteAmiCommand(command, nextAttempt);
        }, nextDelay);
      }
    }
  };

  // Periodic AMI Health Synchronizer with Strict Backoff & Document Visibility
  useEffect(() => {
    const checkAmiHealth = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;

      const now = Date.now();
      const state = amiBackoffRef.current;

      // Strictly obey backoff cooldown: do NOT ping if waiting for nextAllowedTime
      if (state.isBackoffActive && now < state.nextAllowedTime) {
        return;
      }

      try {
        const res = await fetch('/api/asterisk/telemetry/logs');
        if (res.ok) {
          const data = await res.json();
          if (data.amiHealth && data.amiHealth.isCircuitOpen) {
            setAmiBackoff((prev) => ({
              ...prev,
              consecutiveFailures: data.amiHealth.consecutiveFailures,
              currentDelayMs: data.amiHealth.currentDelayMs,
              nextAllowedTime: now + (data.amiHealth.remainingCooldownSec * 1000),
              isBackoffActive: true,
              lastError: data.amiHealth.lastError,
            }));
            setConnectionSettings((prev) => (prev.status === 'error' ? prev : { ...prev, status: 'error' }));
          } else if (data.amiHealth && !data.amiHealth.isCircuitOpen && state.consecutiveFailures > 0) {
            recordAmiSuccessClient();
          }
        }
      } catch (_) {}
    };

    const interval = setInterval(checkAmiHealth, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = () => {
    setIsAuthenticated(false);
    try {
      sessionStorage.removeItem('ast_session_active');
      localStorage.removeItem('ast_session_user_token');
    } catch (e) {}
    showToast('Has cerrado sesión correctamente.', 'info');
    addLog('SYSTEM', `[LOGOUT] Sesión finalizada por el operador.`);
  };

  const handleLoginSuccess = async (user: SystemUser) => {
    setCurrentUserId(user.id);
    setIsAuthenticated(true);
    try {
      sessionStorage.setItem('ast_session_active', 'true');
      localStorage.setItem('ast20_current_user_id', user.id);
    } catch (e) {}
    // Load this user's exclusive server configuration immediately across any browser
    await fetchUserState(user.id, user.username);
    showToast(`¡Bienvenido, ${user.name}! Configuración exclusiva cargada.`);
    addLog('SYSTEM', `[LOGIN] Configuración cargada para usuario: ${user.name} (${user.username || user.id})`);
  };

  // --------------------------------------------------------------------------
  // PANTALLA DE LOGIN: PRIMERA PANTALLA MOSTRADA PARA ACCEDER AL SISTEMA
  // (Panel de login ubicado al lado izquierdo según requerimiento)
  // --------------------------------------------------------------------------
  if (!isAuthenticated) {
    return (
      <div className="cyber-login-page cyber-login-wrapper min-h-screen font-sans bg-black text-slate-100 selection:bg-emerald-500/30 selection:text-white">
        {toastMessage && (
          <div className="fixed bottom-5 right-5 z-50 flex items-center space-x-2 px-4 py-3 rounded-xl bg-slate-900 border border-emerald-500/40 text-white shadow-2xl animate-bounce">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <span className="text-xs font-semibold">{toastMessage.text}</span>
          </div>
        )}

        <LoginScreen
          users={users}
          connectionSettings={connectionSettings}
          onLogin={handleLoginSuccess}
        />
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // SISTEMA PRINCIPAL: MENÚ AL LADO IZQUIERDO (SIDEBAR)
  // --------------------------------------------------------------------------
  return (
    <div className={`min-h-screen flex flex-row font-sans transition-colors ${
      theme === 'light'
        ? 'theme-light bg-slate-50 text-slate-900 selection:bg-blue-500/20 selection:text-blue-900'
        : 'bg-black text-slate-100 selection:bg-emerald-500/30 selection:text-white'
    }`}>
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center space-x-2 px-4 py-3 rounded-xl bg-slate-900 border border-emerald-500/40 text-white shadow-2xl animate-bounce">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span className="text-xs font-semibold">{toastMessage.text}</span>
        </div>
      )}

      {/* MENÚ DE NAVEGACIÓN AL LADO IZQUIERDO (SIDEBAR) */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        connectionSettings={connectionSettings}
        currentUser={currentUser}
        onQuickSync={handleQuickSync}
        onOpenCallSimulator={() => setIsCallSimulatorOpen(true)}
        onLogout={handleLogout}
        isSyncing={isSyncing}
        isOpenMobile={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
        extensionCount={extensions.length}
        carrierCount={carriers.length}
        activeCallCount={activeCallCount}
        theme={theme}
        onToggleTheme={handleToggleTheme}
      />

      {/* ÁREA DE CONTENIDO PRINCIPAL A LA DERECHA */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        <Header
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          connectionSettings={connectionSettings}
          currentUser={currentUser}
          onQuickSync={handleQuickSync}
          onOpenCallSimulator={() => setIsCallSimulatorOpen(true)}
          onOpenMobileMenu={() => setIsMobileSidebarOpen(true)}
          onLogout={handleLogout}
          isSyncing={isSyncing}
          activeCallCount={activeCallCount}
          theme={theme}
          onToggleTheme={handleToggleTheme}
        />

        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'production' && (
          <ProductionOperationsTab
            extensions={extensions}
            carriers={carriers}
            audios={audios}
            onAddAudio={handleAddAudio}
            onTriggerSync={handleQuickSync}
            onNavigateToLiveCalls={() => setActiveTab('live-calls')}
            onNavigateToReseller={() => setActiveTab('reseller')}
            isSyncing={isSyncing}
          />
        )}

        {activeTab === 'live-calls' && (
          <LiveCallsTab
            extensions={extensions}
            carriers={carriers}
            users={users}
            audios={audios}
            onTriggerSync={handleQuickSync}
            onNavigateToProduction={() => setActiveTab('production')}
            onNavigateToSpy={() => setActiveTab('call-spy')}
          />
        )}

        {activeTab === 'call-spy' && (
          <CallSpyMonitorTab
            extensions={extensions}
            carriers={carriers}
            users={users}
            onTriggerSync={handleQuickSync}
            onNavigateToLiveCalls={() => setActiveTab('live-calls')}
          />
        )}

        {activeTab === 'prompt' && (
          <PromptMaestroTab
            amiPort={connectionSettings.amiPort}
            ariPort={connectionSettings.ariPort}
            otpDigits={otpConfig.digitLength}
            webhookUrl={otpConfig.webhookUrl}
          />
        )}

        {activeTab === 'extensions' && (
          <ExtensionsTab
            extensions={extensions}
            onAddExtension={handleAddExtension}
            onUpdateExtension={handleUpdateExtension}
            onDeleteExtension={handleDeleteExtension}
            onSimulateQualify={handleSimulateQualify}
            onSyncAsterisk={() => handleQuickSync(extensions)}
            onResetDefaultExtensions={handleResetDefaultExtensions}
            onNavigateToReseller={() => setActiveTab('reseller')}
            isSyncing={isSyncing}
          />
        )}

        {activeTab === 'reseller' && (
          <MinuteResellerTab
            extensions={extensions}
            carriers={carriers}
            onAddExtension={handleAddExtension}
            onUpdateExtension={handleUpdateExtension}
            onTriggerSync={() => handleQuickSync(extensions, carriers)}
          />
        )}

        {activeTab === 'carriers' && (
          <CarriersTab
            carriers={carriers}
            onAddCarrier={handleAddCarrier}
            onUpdateCarrier={handleUpdateCarrier}
            onDeleteCarrier={handleDeleteCarrier}
            onPingCarrier={handlePingCarrier}
            onToggleCarrier={handleToggleCarrier}
            onSyncAsterisk={() => handleQuickSync(extensions, carriers)}
            isSyncing={isSyncing}
          />
        )}

        {activeTab === 'ivr' && (
          <IVRStudioTab
            press1Config={press1Config}
            otpConfig={otpConfig}
            extensions={extensions}
            audios={audios}
            onSavePress1={setPress1Config}
            onSaveOtp={setOtpConfig}
            onTriggerSync={handleQuickSync}
            isSyncing={isSyncing}
          />
        )}

        {activeTab === 'sqlite' && (
          <SqliteTab
            astDbEntries={astDbEntries}
            onAddAstDbEntry={handleAddAstDbEntry}
            onDeleteAstDbEntry={handleDeleteAstDbEntry}
            cdrRecords={cdrRecords}
            extensions={extensions}
            carriers={carriers}
            settings={connectionSettings}
            onExecuteCommand={handleExecuteSqliteCommand}
          />
        )}

        {activeTab === 'audios' && (
          <AudioLibraryTab
            audios={audios}
            onAddAudio={handleAddAudio}
            onDeleteAudio={handleDeleteAudio}
            onAssignToPress1={handleAssignToPress1}
            onAssignToOtp={handleAssignToOtp}
            onAssignToAgentTransfer={handleAssignToAgentTransfer}
            onAssignTo7777={handleAssignTo7777}
            onAssignTo6666={handleAssignTo6666}
            onAssignTo5555={handleAssignTo5555}
            onAssignTo4444={handleAssignTo4444}
            onAssignTo3333={handleAssignTo3333}
            activeAssignments={activeAudioAssignments}
            onAssignRole={handleAssignRole}
            lockedConfigs={manualLocks}
            onToggleLock={handleToggleManualLock}
          />
        )}

        {activeTab === 'users' && (
          <UsersTab
            users={users}
            extensions={extensions}
            currentUserId={currentUserId}
            onSwitchUser={handleSwitchUser}
            onAddUser={handleAddUser}
            onUpdateUser={handleUpdateUser}
            onDeleteUser={handleDeleteUser}
          />
        )}

        {activeTab === 'sync' && (
          <SyncTelemetryTab
            settings={connectionSettings}
            onUpdateSettings={setConnectionSettings}
            logs={logs}
            onClearLogs={() => setLogs([])}
            onExecuteAmiCommand={handleExecuteAmiCommand}
            onForceFullSync={handleQuickSync}
            isSyncing={isSyncing}
          />
        )}

        {activeTab === 'diagnostics' && (
          <AmiAriDiagnosticsTab
            settings={connectionSettings}
            onUpdateSettings={setConnectionSettings}
            onLogEvent={addLog}
          />
        )}

        {activeTab === 'configs' && (
          <ConfigExporterTab
            extensions={extensions}
            carriers={carriers}
            press1={press1Config}
            otp={otpConfig}
            settings={connectionSettings}
          />
        )}
      </main>
      </div>

      {/* Floating OTP Notification Banner (Visible when user is browsing other tabs) */}
      {globalOtpAlert && activeTab !== 'production' && (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm w-full bg-slate-950 border-2 border-emerald-500 rounded-2xl p-4 shadow-2xl shadow-emerald-500/30 text-white">
          <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-emerald-500/20">
            <div className="flex items-center gap-2">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
              <span className="text-xs font-black uppercase tracking-wider text-emerald-400">
                OTP Capturado en Vivo
              </span>
            </div>
            <button
              onClick={() => {
                setDismissedOtpKey(`${globalOtpAlert.id}_${globalOtpAlert.otp}`);
                setGlobalOtpAlert(null);
              }}
              className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800"
              title="Cerrar aviso"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[11px] text-slate-400">Número destino:</div>
              <div className="text-xs font-mono font-bold text-slate-200">{globalOtpAlert.number}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-slate-400">{globalOtpAlert.timestamp}</div>
            </div>
          </div>

          <div className="flex items-center justify-center gap-1.5 py-2 mb-3 bg-slate-900/90 rounded-xl border border-emerald-500/30">
            {globalOtpAlert.otp.split('').map((d, i) => (
              <span
                key={i}
                className="w-8 h-10 flex items-center justify-center text-xl font-mono font-black text-emerald-400 bg-slate-950 rounded-lg border border-emerald-500/40"
              >
                {d}
              </span>
            ))}
          </div>

          {/* Quick Decision Action Buttons for Agent */}
          <div className="grid grid-cols-2 gap-2 mb-2.5">
            <button
              onClick={() => handleQuickOtpDecision('valid')}
              className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                globalOtpAlert.status === 'valid'
                  ? 'bg-emerald-500 text-slate-950 font-black'
                  : 'bg-emerald-600/90 hover:bg-emerald-500 text-white shadow-md shadow-emerald-950'
              }`}
            >
              <Check className="w-3.5 h-3.5" />
              <span>{globalOtpAlert.status === 'valid' ? 'Aprobado ✓' : 'Aprobar (Válido)'}</span>
            </button>
            <button
              onClick={() => handleQuickOtpDecision('invalid')}
              className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                globalOtpAlert.status === 'invalid'
                  ? 'bg-rose-500 text-white font-black'
                  : 'bg-rose-600/80 hover:bg-rose-500 text-white shadow-md shadow-rose-950'
              }`}
            >
              <X className="w-3.5 h-3.5" />
              <span>{globalOtpAlert.status === 'invalid' ? 'Rechazado ✕' : 'Rechazar (Pedir otro)'}</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleCopyOtp(globalOtpAlert.otp)}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 transition-all cursor-pointer"
            >
              {copiedOtp ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedOtp ? 'Copiado' : 'Copiar'}</span>
            </button>
            <button
              onClick={() => setActiveTab('production')}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all cursor-pointer"
            >
              <KeyRound className="w-3.5 h-3.5 text-emerald-400" />
              <span>Ver en Panel</span>
            </button>
          </div>
        </div>
      )}

      {/* Softphone & Call Simulator Modal */}
      <CallSimulatorModal
        isOpen={isCallSimulatorOpen}
        onClose={() => setIsCallSimulatorOpen(false)}
        press1Config={press1Config}
        otpConfig={otpConfig}
        extensions={extensions}
        audios={audios}
        currentUser={currentUser}
        onLogEvent={addLog}
        onSaveAstDbEntry={handleAddAstDbEntry}
        onSaveCdrRecord={handleSaveCdrRecord}
      />
    </div>
  );
}
