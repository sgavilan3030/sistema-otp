import React, { useState, useEffect, useRef } from 'react';
import { authFetch as fetch } from '../utils/authClient';
import { PjsipExtension, SystemUser } from '../types';
import {
  PhoneCall,
  PhoneOff,
  Music,
  Clock,
  User,
  Building2,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Volume2,
  Users,
  Search,
  Headphones,
  Check,
  ArrowRight,
  KeyRound,
  Copy,
  XCircle,
  BellRing,
  Send,
} from 'lucide-react';

export interface LiveCallItem {
  id: string;
  number: string;
  clientName?: string;
  agent: string;
  agentName?: string;
  status:
    | 'dialing'
    | 'ringing'
    | 'in_ivr'
    | 'talking'
    | 'on_hold'
    | 'pressed_1'
    | 'asking_cancel_code'
    | 'otp_valid'
    | 'otp_invalid'
    | 'transferred'
    | 'machine'
    | 'ended';
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
  holdStartedAt?: number;
  callerId?: string;
  mode?: string;
  tenantId?: string;
  capturedOtp?: string;
  otpStatus?: 'pending' | 'valid' | 'invalid';
  otpRecordId?: string;
  otpService?: string;
  otpTimestamp?: string;
}

export interface OtpRecordItem {
  id: string;
  number: string;
  otp: string;
  timestamp: string;
  createdAt?: number;
  channel?: string;
  service?: string;
  status: 'pending' | 'valid' | 'invalid';
  agent?: string;
  tenantId?: string;
}

interface LiveCallsTabProps {
  extensions: PjsipExtension[];
  currentUser?: SystemUser;
  globalLiveCalls?: LiveCallItem[];
  globalLiveCallsUpdatedAt?: number;
  globalOtpAlert?: {
    id: string;
    number: string;
    otp: string;
    status: string;
    timestamp: string;
    agent?: string;
    service?: string;
  } | null;
  globalOtpRecords?: OtpRecordItem[];
  onGlobalOtpDecision?: (
    status: 'valid' | 'invalid',
    target?: { id?: string; number: string; otp: string; agent?: string }
  ) => Promise<{ success: boolean; error?: string } | void>;
  onRefreshLiveTelemetry?: () => Promise<void> | void;
  onNavigateToProduction?: () => void;
}

export const LiveCallsTab: React.FC<LiveCallsTabProps> = ({
  extensions,
  currentUser,
  globalLiveCalls,
  globalLiveCallsUpdatedAt,
  globalOtpAlert,
  globalOtpRecords,
  onGlobalOtpDecision,
  onRefreshLiveTelemetry,
  onNavigateToProduction,
}) => {
  const isSuperAdmin = !currentUser || (currentUser.role === 'admin' && !currentUser.tenantId);
  const canSpy = currentUser
    ? currentUser.role === 'admin' || currentUser.role === 'supervisor' || !!currentUser.permissions?.canSpy
    : true;

  const [liveCalls, setLiveCalls] = useState<LiveCallItem[]>(() => globalLiveCalls || []);
  const [otpRecords, setOtpRecords] = useState<OtpRecordItem[]>(() => globalOtpRecords || []);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date>(() =>
    globalLiveCallsUpdatedAt ? new Date(globalLiveCallsUpdatedAt) : new Date()
  );
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [feedbackMsg, setFeedbackMsg] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [decidingKey, setDecidingKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [showAllOtpHistory, setShowAllOtpHistory] = useState<boolean>(false);
  const [sendingCancelNum, setSendingCancelNum] = useState<string | null>(null);

  const seenPendingKeysRef = useRef<Set<string>>(new Set());
  const seenCancelPress1Ref = useRef<Set<string>>(new Set());
  const initialOtpLoadRef = useRef<boolean>(true);

  const playOtpAlertChime = () => {
    if (!soundEnabled || typeof window === 'undefined') return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;
      [660, 880].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.11);
        gain.gain.setValueAtTime(0.06, now + idx * 0.11);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.11 + 0.16);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.11);
        osc.stop(now + idx * 0.11 + 0.18);
      });
      setTimeout(() => ctx.close().catch(() => {}), 600);
    } catch (_) {}
  };

  const playCancelPress1Chime = () => {
    if (!soundEnabled || typeof window === 'undefined') return;
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
  };

  // Sync live calls directly from centralized polling in App.tsx & alert on Press-1 across all modes
  useEffect(() => {
    if (Array.isArray(globalLiveCalls)) {
      setLiveCalls(globalLiveCalls);
      setLastUpdated(globalLiveCallsUpdatedAt ? new Date(globalLiveCallsUpdatedAt) : new Date());
      const press1Calls = globalLiveCalls.filter(
        (c) =>
          c.status !== 'ended' &&
          c.status !== 'machine' &&
          c.status !== 'machine_detected' &&
          !c.capturedOtp &&
          (c.status === 'pressed_1' ||
            (c.digit === '1' &&
              !!c.pressed1At &&
              c.status !== 'asking_cancel_code' &&
              c.status !== 'cancel_valid' &&
              c.status !== 'cancel_invalid' &&
              c.status !== 'otp_valid' &&
              c.status !== 'otp_invalid'))
      );
      let hasNewPress1 = false;
      press1Calls.forEach((c) => {
        const key = `${c.id || c.number}_${c.pressed1At || c.startTime || ''}_press1`;
        if (!seenCancelPress1Ref.current.has(key)) {
          seenCancelPress1Ref.current.add(key);
          hasNewPress1 = true;
        }
      });
      if (hasNewPress1) {
        playCancelPress1Chime();
      }
    }
  }, [globalLiveCalls, globalLiveCallsUpdatedAt]);

  // Sync OTP records & play chime only on newly arrived pending codes
  useEffect(() => {
    if (!Array.isArray(globalOtpRecords)) return;
    const pendingNow = globalOtpRecords.filter((r) => r.status === 'pending');
    if (!initialOtpLoadRef.current) {
      const hasNewPending = pendingNow.some((r) => !seenPendingKeysRef.current.has(`${r.id}_${r.otp}`));
      if (hasNewPending) playOtpAlertChime();
    }
    pendingNow.forEach((r) => seenPendingKeysRef.current.add(`${r.id}_${r.otp}`));
    initialOtpLoadRef.current = false;
    setOtpRecords(globalOtpRecords);
  }, [globalOtpRecords]);

  // Reflect immediate decisions triggered from the floating notification banner
  useEffect(() => {
    if (!globalOtpAlert) return;
    const alertStatus = globalOtpAlert.status as 'pending' | 'valid' | 'invalid';
    setOtpRecords((prev) =>
      prev.map((r) =>
        (globalOtpAlert.id && r.id === globalOtpAlert.id) ||
        (r.number === globalOtpAlert.number && r.otp === globalOtpAlert.otp)
          ? { ...r, status: alertStatus }
          : r
      )
    );
    setLiveCalls((prev) =>
      prev.map((c) => {
        const c10 = c.number.replace(/[^0-9]/g, '').slice(-10);
        const a10 = globalOtpAlert.number.replace(/[^0-9]/g, '').slice(-10);
        if (c.number === globalOtpAlert.number || (c10 && c10 === a10)) {
          return {
            ...c,
            capturedOtp: c.capturedOtp || globalOtpAlert.otp,
            otpStatus: alertStatus,
            status:
              alertStatus === 'valid'
                ? 'otp_valid'
                : alertStatus === 'invalid'
                ? 'otp_invalid'
                : c.status,
          };
        }
        return c;
      })
    );
  }, [globalOtpAlert?.id, globalOtpAlert?.otp, globalOtpAlert?.status]);

  // Manual refresh (uses centralized App.tsx refresher or direct fallback)
  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      if (onRefreshLiveTelemetry) {
        await onRefreshLiveTelemetry();
      } else {
        const params = new URLSearchParams();
        if (currentUser?.tenantId) params.set('tenantId', currentUser.tenantId);
        const assignedExts = Array.isArray(currentUser?.assignedExtensions)
          ? currentUser.assignedExtensions.map((x) => String(x).trim()).filter(Boolean)
          : [];
        if (assignedExts.length > 0) params.set('extensions', assignedExts.join(','));
        const qs = params.toString() ? `?${params.toString()}` : '';
        const [callsRes, otpRes] = await Promise.all([
          fetch(`/api/asterisk/live/calls${qs}`),
          fetch(`/api/asterisk/otp/records${qs}`),
        ]);
        if (callsRes.ok) {
          const data = await callsRes.json();
          if (data.success && Array.isArray(data.calls)) setLiveCalls(data.calls);
        }
        if (otpRes.ok) {
          const otpData = await otpRes.json();
          if (otpData.success && Array.isArray(otpData.records)) setOtpRecords(otpData.records);
        }
        setLastUpdated(new Date());
      }
    } catch (_) {
    } finally {
      setIsRefreshing(false);
    }
  };

  // Live 1-second timer tick on active calls
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
          holdMusic: call.holdMusic || 'default',
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
        if (onRefreshLiveTelemetry) onRefreshLiveTelemetry();
      }
    } catch (_) {
      setFeedbackMsg({ text: 'Error al cambiar estado de Hold.', type: 'error' });
    }
    setTimeout(() => setFeedbackMsg(null), 4000);
  };

  const handleHangupCall = async (call: LiveCallItem) => {
    try {
      const res = await fetch('/api/asterisk/call/hangup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          number: call.number,
          channel: call.channel,
          all: false,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.success === false) {
        setFeedbackMsg({ text: data?.error || `No se pudo colgar el canal (HTTP ${res.status}).`, type: 'error' });
      } else {
        setLiveCalls((prev) => prev.filter((c) => c.id !== call.id && c.number !== call.number));
        setFeedbackMsg({ text: `Llamada con ${call.number} finalizada correctamente.`, type: 'info' });
        if (onRefreshLiveTelemetry) onRefreshLiveTelemetry();
      }
    } catch (_) {
      setFeedbackMsg({ text: 'Error al colgar canal en Asterisk.', type: 'error' });
    }
    setTimeout(() => setFeedbackMsg(null), 3000);
  };

  const handleStartSpy = async (call: LiveCallItem) => {
    try {
      const defaultSup = isSuperAdmin ? '1000' : currentUser?.assignedExtensions?.[0] || '1000';
      const supervisorExten = localStorage.getItem('ast20_supervisor_exten') || defaultSup;
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
        setFeedbackMsg({ text: data.error || 'Error al iniciar escucha ChanSpy.', type: 'error' });
      }
    } catch (_) {
      setFeedbackMsg({ text: 'Error de conexión con Asterisk.', type: 'error' });
    }
    setTimeout(() => setFeedbackMsg(null), 5000);
  };

  // Validate or reject captured OTP in real-time (optimistic UI + global state + API persistence)
  const handleValidateOtp = async (
    decision: 'valid' | 'invalid',
    payload: { id?: string; number: string; otp: string; agent?: string },
    itemKey: string
  ) => {
    setDecidingKey(itemKey);

    // 1. Immediate optimistic UI update (mirrors floating notification banner responsiveness)
    const p10 = payload.number.replace(/[^0-9]/g, '').slice(-10);
    const matchesPayloadRecord = (r: { id?: string; number: string; otp: string }) => {
      if (payload.id && r.id === payload.id) return true;
      const r10 = r.number.replace(/[^0-9]/g, '').slice(-10);
      const numMatch = r.number === payload.number || (p10.length >= 7 && r10 === p10);
      return numMatch && r.otp === payload.otp;
    };

    setOtpRecords((prev) => {
      const exists = prev.some(matchesPayloadRecord);
      if (!exists) {
        return [
          {
            id: payload.id || `otp_${Date.now()}`,
            number: payload.number,
            otp: payload.otp,
            agent: payload.agent,
            status: decision,
            timestamp: new Date().toLocaleTimeString(),
            createdAt: Date.now(),
            service: 'IVR Captura OTP',
          },
          ...prev,
        ];
      }
      return prev.map((r) =>
        matchesPayloadRecord(r) ? { ...r, status: decision } : r
      );
    });

    setLiveCalls((prev) =>
      prev.map((c) => {
        const c10 = c.number.replace(/[^0-9]/g, '').slice(-10);
        const p10 = payload.number.replace(/[^0-9]/g, '').slice(-10);
        if (c.number === payload.number || (c10 && c10 === p10)) {
          return {
            ...c,
            otpStatus: decision,
            status: decision === 'valid' ? 'otp_valid' : 'otp_invalid',
            statusText:
              decision === 'valid'
                ? 'Código OTP Validado'
                : 'Código OTP Rechazado (Reintentando)',
          };
        }
        return c;
      })
    );

    setFeedbackMsg({
      text:
        decision === 'valid'
          ? `✓ Código ${payload.otp} (${payload.number}) validado — Reproduciendo audio de confirmación en la llamada.`
          : `✕ Código ${payload.otp} (${payload.number}) rechazado — Solicitando nuevo código de verificación al cliente.`,
      type: decision === 'valid' ? 'success' : 'info',
    });

    try {
      let ok = false;
      let errMsg = '';

      if (onGlobalOtpDecision) {
        const result = await onGlobalOtpDecision(decision, payload);
        ok = !result || result.success !== false;
        errMsg = (result && result.error) || '';
      } else {
        const res = await fetch('/api/asterisk/otp/decision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: payload.id,
            number: payload.number,
            otp: payload.otp,
            agent: payload.agent && payload.agent !== 'ringall' ? payload.agent : undefined,
            status: decision,
            action: decision === 'invalid' ? 'request_retry' : undefined,
          }),
        });
        const data = await res.json().catch(() => ({}));
        ok = res.ok && data.success !== false;
        errMsg = data.error || '';
      }

      if (ok) {
        await handleManualRefresh();
      } else {
        setFeedbackMsg({
          text: errMsg || 'Error al registrar decisión del código OTP.',
          type: 'error',
        });
      }
    } catch (_) {
      setFeedbackMsg({ text: 'Error de conexión al validar código OTP.', type: 'error' });
    } finally {
      setDecidingKey(null);
      setTimeout(() => setFeedbackMsg(null), 4500);
    }
  };

  const handleCopyOtp = async (otp: string, key: string) => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(otp);
      }
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    } catch (_) {}
  };

  const handleNotifyCancelCodeSent = async (call: LiveCallItem) => {
    setSendingCancelNum(call.number);
    try {
      const res = await fetch('/api/asterisk/call/cancel-code-sent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          number: call.number,
          agent: call.agent && call.agent !== 'ringall' ? call.agent : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setLiveCalls((prev) =>
          prev.map((c) =>
            c.id === call.id || c.number === call.number
              ? {
                  ...c,
                  status: 'asking_cancel_code',
                  statusText: 'Solicitando al cliente digitar el código',
                }
              : c
          )
        );
        setFeedbackMsg({
          text: `✓ Señal enviada para ${call.number}: Asterisk le está pidiendo al cliente que digite el código de cancelación.`,
          type: 'success',
        });
        if (onRefreshLiveTelemetry) onRefreshLiveTelemetry();
      } else {
        setFeedbackMsg({
          text: data.error || 'No se pudo indicar a Asterisk que pida el código.',
          type: 'error',
        });
      }
    } catch (_) {
      setFeedbackMsg({ text: 'Error de conexión al notificar código enviado.', type: 'error' });
    } finally {
      setSendingCancelNum(null);
      setTimeout(() => setFeedbackMsg(null), 4500);
    }
  };

  // Scope visible extensions by tenant / assignedExtensions when not SuperAdmin
  const visibleExtensions = extensions.filter((ext) => {
    if (isSuperAdmin) return true;
    const assigned = currentUser?.assignedExtensions || [];
    if (assigned.length > 0 && currentUser?.role === 'agent') {
      return assigned.includes(ext.extension);
    }
    if (currentUser?.tenantId && ext.tenantId) {
      return ext.tenantId === currentUser.tenantId;
    }
    return true;
  });

  // Filtered calls
  const filteredCalls = liveCalls.filter((c) => {
    if (filterStatus === 'talking' && c.status !== 'talking' && c.status !== 'transferred') return false;
    if (filterStatus === 'hold' && !c.isOnHold && c.status !== 'on_hold') return false;
    if (
      filterStatus === 'ivr' &&
      c.status !== 'in_ivr' &&
      c.status !== 'pressed_1' &&
      c.status !== 'asking_cancel_code' &&
      c.status !== 'asking_otp' &&
      c.status !== 'otp_valid' &&
      c.status !== 'otp_invalid'
    )
      return false;
    if (
      filterStatus === 'otp_pending' &&
      !(c.capturedOtp && c.otpStatus === 'pending') &&
      !((c.mode === 'otp_press1' || c.mode === 'cancel_code') && (c.status === 'pressed_1' || c.status === 'asking_cancel_code' || c.status === 'asking_otp'))
    )
      return false;
    if (filterStatus === 'ringing' && c.status !== 'ringing' && c.status !== 'dialing') return false;

    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      const matchNum = c.number.toLowerCase().includes(q);
      const matchAgent = (c.agent || '').toLowerCase().includes(q) || (c.agentName || '').toLowerCase().includes(q);
      const matchEntity = (c.entityName || '').toLowerCase().includes(q);
      const matchOtp = (c.capturedOtp || '').toLowerCase().includes(q);
      return matchNum || matchAgent || matchEntity || matchOtp;
    }
    return true;
  });

  const activeCount = liveCalls.filter((c) => c.status !== 'ended').length;
  const talkingCount = liveCalls.filter((c) => (c.status === 'talking' || c.status === 'transferred') && !c.isOnHold).length;
  const holdCount = liveCalls.filter((c) => c.isOnHold || c.status === 'on_hold').length;
  const ivrCount = liveCalls.filter(
    (c) =>
      c.status === 'in_ivr' ||
      c.status === 'pressed_1' ||
      c.status === 'asking_cancel_code' ||
      c.status === 'asking_otp' ||
      c.status === 'otp_valid' ||
      c.status === 'otp_invalid'
  ).length;
  const pendingOtps = otpRecords.filter((r) => r.status === 'pending');
  const decidedOtps = otpRecords.filter((r) => r.status !== 'pending');
  const pendingCallsOtpCount = liveCalls.filter(
    (c) =>
      (c.capturedOtp && c.otpStatus === 'pending') ||
      ((c.mode === 'otp_press1' || c.mode === 'cancel_code') && (c.status === 'pressed_1' || c.status === 'asking_cancel_code' || c.status === 'asking_otp'))
  ).length;
  const avgDuration =
    activeCount > 0
      ? Math.round(liveCalls.reduce((acc, curr) => acc + (curr.duration || 0), 0) / activeCount)
      : 0;

  return (
    <div className="space-y-6">
      {/* 1. Header con Resumen de Telemetría en Vivo */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg relative overflow-hidden">
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
              Monitoreo continuo de llamadas activas en Asterisk, control de{' '}
              <strong className="text-emerald-400">Hold</strong> y validación inmediata del{' '}
              <strong className="text-indigo-400">IVR de Captura OTP</strong>.
            </p>
          </div>

          <div className="flex items-center flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSoundEnabled((prev) => !prev)}
              className={`px-3 py-2 rounded-xl border text-xs font-mono font-bold flex items-center space-x-1.5 transition-all cursor-pointer ${
                soundEnabled
                  ? 'bg-amber-500/15 text-amber-300 border-amber-500/40 hover:bg-amber-500/25'
                  : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
              }`}
              title="Activar o silenciar alerta sonora cuando llega un código OTP nuevo"
            >
              <BellRing className="w-3.5 h-3.5" />
              <span>{soundEnabled ? 'Alerta ON' : 'Alerta OFF'}</span>
            </button>

            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-60 text-slate-200 border border-slate-700 text-xs font-mono flex items-center space-x-1.5 transition-all cursor-pointer"
              title="Actualizar canales en Asterisk"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-slate-300 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>Refrescar</span>
            </button>
          </div>
        </div>

        {/* HUD de Métricas en Vivo */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-5 pt-4 border-t border-slate-800/80">
          <div className="bg-slate-950/60 border border-slate-800 p-3 rounded-xl">
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span>Llamadas en Curso</span>
              <PhoneCall className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-black text-white font-mono mt-1">{activeCount}</div>
            <div className="text-[10px] text-emerald-400 mt-0.5">Canales activos Asterisk</div>
          </div>

          <div
            className={`p-3 rounded-xl border transition-all ${
              pendingOtps.length > 0
                ? 'bg-indigo-950/50 border-indigo-500/60 shadow-md shadow-indigo-500/10'
                : 'bg-slate-950/60 border-slate-800'
            }`}
          >
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span>OTP por Validar</span>
              <KeyRound className={`w-4 h-4 ${pendingOtps.length > 0 ? 'text-indigo-400 animate-pulse' : 'text-slate-500'}`} />
            </div>
            <div className={`text-2xl font-black font-mono mt-1 ${pendingOtps.length > 0 ? 'text-indigo-300' : 'text-slate-300'}`}>
              {pendingOtps.length}
            </div>
            <div className="text-[10px] text-indigo-400 mt-0.5">
              {pendingOtps.length > 0 ? 'Requiere decisión del agente' : 'Sin códigos pendientes'}
            </div>
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
            <div className="text-[10px] text-slate-400 mt-0.5">Actualizado {lastUpdated.toLocaleTimeString()}</div>
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

      {/* Consola en Tiempo Real: Estado de la Captura OTP y Validación */}
      <div
        className={`rounded-2xl p-5 border shadow-lg transition-all ${
          pendingOtps.length > 0
            ? 'bg-gradient-to-br from-indigo-950/60 via-slate-900 to-slate-900 border-indigo-500/60 shadow-indigo-500/10'
            : 'bg-slate-900 border-slate-800'
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center space-x-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center border ${
                pendingOtps.length > 0
                  ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300 animate-pulse'
                  : 'bg-slate-800 border-slate-700 text-slate-400'
              }`}
            >
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-2 flex-wrap">
                <span>Estado de Captura OTP en Tiempo Real</span>
                {pendingOtps.length > 0 ? (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-indigo-500 text-white">
                    {pendingOtps.length} PENDIENTE{pendingOtps.length > 1 ? 'S' : ''} DE VALIDAR
                  </span>
                ) : decidedOtps.length > 0 ? (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/15 text-emerald-300 border border-emerald-500/40">
                    SIN PENDIENTES ({decidedOtps.length} PROCESADO{decidedOtps.length > 1 ? 'S' : ''})
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-slate-800 text-slate-400 border border-slate-700">
                    ESPERANDO CAPTURA
                  </span>
                )}
              </h3>
              <p className="text-[11px] text-slate-400">
                Supervisa el estado de la captura OTP tras presionar <strong className="text-indigo-300">1</strong> y valida o rechaza el código con actualización global inmediata.
              </p>
            </div>
          </div>

          {decidedOtps.length > 0 && (
            <button
              type="button"
              onClick={() => setShowAllOtpHistory((prev) => !prev)}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-mono transition-all cursor-pointer self-start sm:self-auto"
            >
              {showAllOtpHistory
                ? 'Ocultar Historial Reciente'
                : `Ver Validados / Rechazados (${decidedOtps.length})`}
            </button>
          )}
        </div>

        {pendingOtps.length === 0 && decidedOtps.length === 0 && (
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4 flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
            <div>
              <div className="text-xs font-bold text-slate-200 font-mono">
                Captura OTP en escucha en tiempo real ({lastUpdated.toLocaleTimeString()})
              </div>
              <div className="text-[11px] text-slate-400">
                Cuando un cliente presione 1 y digite su código de verificación en una llamada real, aparecerá aquí automáticamente para que puedas Validarlo o Rechazarlo al instante.
              </div>
            </div>
          </div>
        )}

        {pendingOtps.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {pendingOtps.map((rec) => {
              const itemKey = `queue_${rec.id}_${rec.otp}`;
              const isBusy = decidingKey === itemKey;
              const digits = String(rec.otp || '').split('');

              return (
                <div
                  key={itemKey}
                  className="bg-slate-950/90 border border-indigo-500/50 rounded-xl p-4 flex flex-col justify-between gap-3 shadow-md"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                        <span className="text-sm font-black text-white font-mono">{rec.number}</span>
                        <span className="px-2 py-0.5 rounded bg-indigo-500/20 border border-indigo-500/40 text-[10px] font-mono text-indigo-300">
                          {rec.service || 'IVR Captura OTP'}
                        </span>
                        {rec.agent && (
                          <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] font-mono text-slate-300">
                            Ext. {rec.agent}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono mt-1">
                        Capturado: {rec.timestamp || 'Recién recibido'}
                      </div>
                    </div>

                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 shrink-0">
                      PENDIENTE
                    </span>
                  </div>

                  {/* Dígitos del Código Capturado */}
                  <div className="flex items-center justify-between gap-2 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {digits.map((d, idx) => (
                        <span
                          key={idx}
                          className="w-8 h-10 rounded-lg bg-indigo-950/90 border border-indigo-500/60 text-indigo-200 font-mono text-lg font-black flex items-center justify-center shadow-inner"
                        >
                          {d}
                        </span>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopyOtp(rec.otp, itemKey)}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-mono flex items-center space-x-1 transition-all cursor-pointer shrink-0"
                      title="Copiar código OTP"
                    >
                      {copiedKey === itemKey ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-emerald-300">Copiado</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copiar</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Botones Validar / Rechazar */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() =>
                        handleValidateOtp(
                          'valid',
                          { id: rec.id, number: rec.number, otp: rec.otp, agent: rec.agent },
                          itemKey
                        )
                      }
                      className="px-3 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-mono text-xs font-black flex items-center justify-center space-x-1.5 shadow-md shadow-emerald-500/20 transition-all cursor-pointer"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{isBusy ? 'Procesando...' : 'Validar (Válido)'}</span>
                    </button>

                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() =>
                        handleValidateOtp(
                          'invalid',
                          { id: rec.id, number: rec.number, otp: rec.otp, agent: rec.agent },
                          itemKey
                        )
                      }
                      className="px-3 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/35 disabled:opacity-50 text-rose-200 border border-rose-500/50 font-mono text-xs font-bold flex items-center justify-center space-x-1.5 transition-all cursor-pointer"
                    >
                      <XCircle className="w-4 h-4 text-rose-400" />
                      <span>Rechazar (Inválido)</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {(showAllOtpHistory || pendingOtps.length === 0) && decidedOtps.length > 0 && (
          <div className={`${pendingOtps.length > 0 ? 'mt-4 pt-4 border-t border-slate-800/80' : ''} space-y-2`}>
            <div className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">
              Últimas Capturas OTP ({Math.min(decidedOtps.length, 6)})
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {decidedOtps.slice(0, 6).map((rec) => {
                const histKey = `hist_${rec.id}_${rec.otp}`;
                const isBusy = decidingKey === histKey;
                const isValid = rec.status === 'valid';
                return (
                  <div
                    key={histKey}
                    className={`p-3 rounded-xl border flex flex-col justify-between gap-2.5 text-xs ${
                      isValid
                        ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-200'
                        : 'bg-rose-950/30 border-rose-500/40 text-rose-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-mono font-bold text-white truncate">{rec.number}</div>
                        <div className="flex items-center space-x-2 mt-0.5">
                          <span className="font-mono font-black text-sm tracking-widest text-white">{rec.otp}</span>
                          <span className="text-[10px] opacity-80 font-mono">Ext. {rec.agent || '1001'}</span>
                        </div>
                      </div>
                      <div className="flex items-center space-x-1.5 shrink-0">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                            isValid
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                          }`}
                        >
                          {isValid ? 'VALIDADO ✓' : 'RECHAZADO ✕'}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopyOtp(rec.otp, histKey)}
                          className="p-1.5 rounded-lg bg-slate-900/70 hover:bg-slate-800 text-slate-300 cursor-pointer"
                          title="Copiar código"
                        >
                          {copiedKey === histKey ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-slate-800/60">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          handleValidateOtp(
                            'valid',
                            { id: rec.id, number: rec.number, otp: rec.otp, agent: rec.agent },
                            histKey
                          )
                        }
                        className={`px-2 py-1.5 rounded-lg font-mono text-[11px] font-bold flex items-center justify-center space-x-1 transition-all cursor-pointer ${
                          isValid
                            ? 'bg-emerald-500 text-slate-950 font-black'
                            : 'bg-emerald-600/30 hover:bg-emerald-500/40 text-emerald-200 border border-emerald-500/40'
                        }`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{isValid ? 'Validado ✓' : 'Validar'}</span>
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          handleValidateOtp(
                            'invalid',
                            { id: rec.id, number: rec.number, otp: rec.otp, agent: rec.agent },
                            histKey
                          )
                        }
                        className={`px-2 py-1.5 rounded-lg font-mono text-[11px] font-bold flex items-center justify-center space-x-1 transition-all cursor-pointer ${
                          !isValid
                            ? 'bg-rose-500 text-white font-black'
                            : 'bg-rose-600/25 hover:bg-rose-500/40 text-rose-200 border border-rose-500/40'
                        }`}
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>{!isValid ? 'Rechazado ✕' : 'Rechazar'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 2. Sección Principal: Llamadas en Vivo Activas + Estado de Agentes */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Columna Izquierda/Central: Lista de Llamadas en Tiempo Real (2 columnas) */}
        <div className="lg:col-span-2 space-y-4">
          {/* Barra de Filtros y Búsqueda */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900 border border-slate-800 p-3 rounded-xl">
            <div className="flex items-center space-x-1.5 overflow-x-auto text-xs font-mono">
              <button
                type="button"
                onClick={() => setFilterStatus('all')}
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  filterStatus === 'all'
                    ? 'bg-emerald-500 text-slate-950 font-bold'
                    : 'text-slate-400 hover:text-white bg-slate-800/60'
                }`}
              >
                Todas ({liveCalls.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterStatus('otp_pending')}
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  filterStatus === 'otp_pending'
                    ? 'bg-indigo-500 text-white font-bold'
                    : 'text-indigo-300 hover:text-white bg-indigo-950/50 border border-indigo-500/30'
                }`}
              >
                OTP Pendientes ({pendingCallsOtpCount})
              </button>
              <button
                type="button"
                onClick={() => setFilterStatus('talking')}
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
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
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
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
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
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
                placeholder="Buscar cliente, agente u OTP..."
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
                Cuando lances una llamada real desde el <strong>Centro de Producción</strong>, aparecerá aquí con su duración en vivo, estado del IVR de Captura OTP y controles de agente.
              </p>
              {onNavigateToProduction && (
                <div className="pt-2 flex items-center justify-center">
                  <button
                    type="button"
                    onClick={onNavigateToProduction}
                    className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-mono font-bold flex items-center space-x-1.5 shadow-md transition-all cursor-pointer"
                  >
                    <span>Ir a Centro de Producción</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredCalls.map((call) => {
                const isHold = !!call.isOnHold || call.status === 'on_hold';
                const isTalking = (call.status === 'talking' || call.status === 'transferred') && !isHold;
                const isPressed1 = call.status === 'pressed_1';
                const isAskingCancelCode = call.status === 'asking_cancel_code' || call.status === 'asking_otp';
                const isCancelCode = call.mode === 'cancel_code';
                const isOtpValid = call.status === 'otp_valid' || call.otpStatus === 'valid';
                const isOtpInvalid = call.status === 'otp_invalid' || call.otpStatus === 'invalid';
                const isIvr = call.status === 'in_ivr' || isPressed1 || isAskingCancelCode || isOtpValid || isOtpInvalid;
                const hasInlineOtp =
                  call.mode === 'otp_press1' ||
                  isCancelCode ||
                  !!call.capturedOtp ||
                  isPressed1 ||
                  isAskingCancelCode ||
                  isOtpValid ||
                  isOtpInvalid;
                const cardOtpKey = `card_${call.id || call.number}_${call.capturedOtp || 'wait'}`;
                const isCardDeciding = decidingKey === cardOtpKey;

                return (
                  <div
                    key={call.id || call.number}
                    className={`bg-slate-900 border rounded-2xl p-4 sm:p-5 transition-all shadow-md ${
                      call.capturedOtp && call.otpStatus === 'pending'
                        ? 'border-indigo-500/70 shadow-indigo-500/15'
                        : isHold
                        ? 'border-amber-500/50 shadow-amber-500/5'
                        : isTalking
                        ? 'border-emerald-500/50 shadow-emerald-500/5'
                        : isIvr
                        ? 'border-cyan-500/40'
                        : 'border-slate-800'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-start space-x-3">
                        <div
                          className={`w-11 h-11 rounded-xl flex items-center justify-center text-lg shrink-0 shadow-md ${
                            call.capturedOtp && call.otpStatus === 'pending'
                              ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/50 animate-pulse'
                              : isHold
                              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 animate-pulse'
                              : isTalking
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                              : isIvr
                              ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                              : 'bg-slate-800 text-slate-300 border border-slate-700'
                          }`}
                        >
                          {call.capturedOtp && call.otpStatus === 'pending' ? (
                            <KeyRound className="w-5 h-5" />
                          ) : isHold ? (
                            <Music className="w-5 h-5" />
                          ) : (
                            <PhoneCall className="w-5 h-5" />
                          )}
                        </div>

                        <div>
                          <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                            <span className="text-base sm:text-lg font-black text-white font-mono tracking-tight">
                              {call.number}
                            </span>
                            {call.clientName && (
                              <span className="text-xs text-slate-300 font-medium">({call.clientName})</span>
                            )}
                            {call.mode === 'otp_press1' && (
                              <span className="px-2 py-0.5 rounded bg-indigo-500/20 border border-indigo-500/40 text-[10px] font-mono font-bold text-indigo-300">
                                IVR CAPTURA OTP
                              </span>
                            )}
                            {isCancelCode && (
                              <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-[10px] font-mono font-bold text-amber-300">
                                PRESS-1 + CÓDIGO CANCELACIÓN
                              </span>
                            )}
                          </div>

                          <div className="flex items-center flex-wrap gap-2 mt-1">
                            <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700 text-[10px] font-mono text-slate-300">
                              <Building2 className="w-3 h-3 text-emerald-400" />
                              <span>{call.entityName || 'Guión General'}</span>
                            </span>

                            <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-[10px] font-mono text-amber-300">
                              <Music className="w-3 h-3 text-amber-400" />
                              <span>MOH: {call.holdMusicName || call.holdMusic || 'Corporativa'}</span>
                            </span>

                            {call.trunk && (
                              <span className="text-[10px] text-slate-400 font-mono">
                                Troncal: <strong className="text-slate-300">{call.trunk}</strong>
                              </span>
                            )}
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
                            {formatDuration(call.duration)}
                          </span>
                        </div>

                        <div className="mt-1">
                          {isHold ? (
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/50 flex items-center space-x-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping"></span>
                              <span>EN ESPERA (HOLD)</span>
                            </span>
                          ) : isOtpValid ? (
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/50">
                              OTP VALIDADO ✓
                            </span>
                          ) : isOtpInvalid ? (
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-rose-500/20 text-rose-300 border border-rose-500/50">
                              OTP RECHAZADO (REINTENTO)
                            </span>
                          ) : isAskingCancelCode ? (
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-cyan-500/25 text-cyan-200 border border-cyan-500/50 flex items-center space-x-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping"></span>
                              <span>PIDIENDO CÓDIGO AL CLIENTE</span>
                            </span>
                          ) : isPressed1 && isCancelCode ? (
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/25 text-amber-200 border border-amber-500/60 flex items-center space-x-1 animate-pulse">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping"></span>
                              <span>MARCÓ 1 — ENVÍA EL CÓDIGO</span>
                            </span>
                          ) : isPressed1 && call.mode === 'otp_press1' ? (
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-indigo-500/25 text-indigo-200 border border-indigo-500/50 flex items-center space-x-1 animate-pulse">
                              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-ping"></span>
                              <span>PRESIONÓ 1 — ENVIANDO CÓDIGO</span>
                            </span>
                          ) : isPressed1 ? (
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/25 text-amber-200 border border-amber-500/60 flex items-center space-x-1 animate-pulse">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping"></span>
                              <span>¡PRESIONÓ 1! — CONECTANDO ASESOR</span>
                            </span>
                          ) : isTalking ? (
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 flex items-center space-x-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                              <span>{call.digit === '1' ? '¡PRESIONÓ 1! • HABLANDO CON AGENTE' : 'HABLANDO CON AGENTE'}</span>
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

                    {/* Panel Inline de Validación OTP en Tiempo Real para la Llamada */}
                    {hasInlineOtp && (
                      <div
                        className={`mt-3 rounded-xl p-3 border ${
                          call.capturedOtp && call.otpStatus === 'pending'
                            ? 'bg-indigo-950/50 border-indigo-500/60'
                            : isOtpValid
                            ? 'bg-emerald-950/35 border-emerald-500/40'
                            : isOtpInvalid
                            ? 'bg-rose-950/35 border-rose-500/40'
                            : 'bg-slate-950/80 border-indigo-500/30'
                        }`}
                      >
                        {call.capturedOtp ? (
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="flex items-center flex-wrap gap-2">
                              <span className="text-[11px] font-mono font-bold text-indigo-300 flex items-center gap-1">
                                <KeyRound className="w-3.5 h-3.5" />
                                <span>Código Capturado:</span>
                              </span>
                              <div className="flex items-center gap-1">
                                {String(call.capturedOtp)
                                  .split('')
                                  .map((digit, i) => (
                                    <span
                                      key={i}
                                      className="w-7 h-8 rounded-md bg-slate-900 border border-indigo-500/50 text-white font-mono text-base font-black flex items-center justify-center"
                                    >
                                      {digit}
                                    </span>
                                  ))}
                              </div>
                              <button
                                type="button"
                                onClick={() => handleCopyOtp(call.capturedOtp!, cardOtpKey)}
                                className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-mono flex items-center space-x-1 cursor-pointer"
                                title="Copiar dígitos"
                              >
                                {copiedKey === cardOtpKey ? (
                                  <Check className="w-3 h-3 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                                <span>{copiedKey === cardOtpKey ? 'Copiado' : 'Copiar'}</span>
                              </button>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                disabled={isCardDeciding}
                                onClick={() =>
                                  handleValidateOtp(
                                    'valid',
                                    {
                                      id: call.otpRecordId,
                                      number: call.number,
                                      otp: call.capturedOtp!,
                                      agent: call.agent,
                                    },
                                    cardOtpKey
                                  )
                                }
                                className={`px-3 py-1.5 rounded-lg font-mono text-xs flex items-center space-x-1 shadow-sm transition-all cursor-pointer disabled:opacity-50 ${
                                  isOtpValid
                                    ? 'bg-emerald-500 text-slate-950 font-black ring-2 ring-emerald-300/40'
                                    : 'bg-emerald-600 hover:bg-emerald-500 text-white font-bold'
                                }`}
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>{isOtpValid ? 'Validado ✓' : 'Validar'}</span>
                              </button>
                              <button
                                type="button"
                                disabled={isCardDeciding}
                                onClick={() =>
                                  handleValidateOtp(
                                    'invalid',
                                    {
                                      id: call.otpRecordId,
                                      number: call.number,
                                      otp: call.capturedOtp!,
                                      agent: call.agent,
                                    },
                                    cardOtpKey
                                  )
                                }
                                className={`px-3 py-1.5 rounded-lg font-mono text-xs flex items-center space-x-1 transition-all cursor-pointer disabled:opacity-50 ${
                                  isOtpInvalid
                                    ? 'bg-rose-500 text-white font-black ring-2 ring-rose-300/40'
                                    : 'bg-rose-500/20 hover:bg-rose-500/35 text-rose-200 border border-rose-500/50 font-bold'
                                }`}
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                <span>{isOtpInvalid ? 'Rechazado ✕' : 'Rechazar'}</span>
                              </button>
                            </div>
                          </div>
                        ) : isCancelCode && isPressed1 ? (
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-amber-500/15 border border-amber-500/50 rounded-lg p-2.5">
                            <div className="flex items-start gap-2 text-xs font-mono text-amber-200">
                              <BellRing className="w-4 h-4 text-amber-400 animate-bounce shrink-0 mt-0.5" />
                              <div>
                                <div className="font-black text-amber-300 uppercase tracking-wide">
                                  ¡Cliente presionó 1! — Envía el código de cancelación ahora
                                </div>
                                <div className="text-[11px] text-amber-100/80 mt-0.5">
                                  Asterisk está esperando en línea tras reproducir el aviso. Envíale el código al cliente y pulsa el botón para que lo digite:
                                </div>
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={sendingCancelNum === call.number}
                              onClick={() => handleNotifyCancelCodeSent(call)}
                              className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-mono text-xs font-black flex items-center justify-center gap-1.5 shadow-md shadow-emerald-500/25 transition-all cursor-pointer disabled:opacity-50 shrink-0"
                            >
                              <Send className="w-3.5 h-3.5" />
                              <span>
                                {sendingCancelNum === call.number
                                  ? 'Activando...'
                                  : 'Ya Envié el Código → Pedir que Digite'}
                              </span>
                            </button>
                          </div>
                        ) : isAskingCancelCode ? (
                          <div className="flex items-center justify-between gap-2 text-xs font-mono text-cyan-200">
                            <span className="flex items-center gap-2">
                              <Volume2 className="w-4 h-4 text-cyan-400 animate-pulse shrink-0" />
                              <span>
                                {call.status === 'asking_otp' || call.mode === 'otp_press1'
                                  ? 'Solicitando al cliente digitar el código OTP en su teclado — Esperando dígitos...'
                                  : 'Solicitando al cliente digitar el código de cancelación en su teclado — Esperando dígitos...'}
                              </span>
                            </span>
                            <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 text-[10px] shrink-0 font-bold">
                              ESPERANDO DÍGITOS
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-2 text-xs font-mono text-indigo-200">
                            <span className="flex items-center gap-2">
                              <Volume2 className="w-4 h-4 text-indigo-400 animate-pulse shrink-0" />
                              <span>
                                {call.statusText ||
                                  "Cliente presionó 1 — Reproduciendo: 'Un momento por favor, le estamos enviando su código de verificación' — Esperando dígitos..."}
                              </span>
                            </span>
                            <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 text-[10px] shrink-0">
                              ESPERANDO OTP
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Fila Inferior: Agente Asignado & Botones de Acción */}
                    <div className="mt-4 pt-3 border-t border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
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

                      <div className="flex items-center space-x-2 w-full sm:w-auto justify-end">
                        {canSpy && (
                          <button
                            type="button"
                            onClick={() => handleStartSpy(call)}
                            className="px-3 py-1.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-xs font-mono font-bold flex items-center space-x-1.5 transition-all cursor-pointer shadow-sm hover:scale-[1.02]"
                            title="Llama a tu extensión para escuchar la llamada en vivo (ChanSpy silencioso)"
                          >
                            <Headphones className="w-3.5 h-3.5 text-cyan-400" />
                            <span>Espiar</span>
                          </button>
                        )}

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

        {/* Columna Derecha: Estado de Agentes & Extensiones PJSIP */}
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-emerald-400" />
                <span>Agentes & Extensiones</span>
              </h3>
              <span className="text-[10px] text-emerald-400 font-mono font-bold">
                {visibleExtensions.length} Extensiones
              </span>
            </div>

            <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
              {visibleExtensions.map((ext) => {
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
