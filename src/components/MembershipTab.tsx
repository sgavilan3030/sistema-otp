import React, { useMemo, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  ShieldCheck,
  ShieldAlert,
  Lock,
  Unlock,
  Plus,
  Search,
  RefreshCw,
  Building2,
  User as UserIcon,
  History,
  Settings,
  AlertTriangle,
  PauseCircle,
  PlayCircle,
  RotateCcw,
  Send,
  LogOut,
  Check,
  X,
  Wallet,
  Sparkles,
} from 'lucide-react';
import { authFetch as fetch } from '../utils/authClient';
import {
  CallCenterTenant,
  EffectiveMembershipStatus,
  MembershipHistoryEntry,
  MembershipRenewalRequest,
  MembershipSettings,
  SystemUser,
} from '../types';

interface MembershipTabProps {
  currentUser?: SystemUser;
  myMembership?: EffectiveMembershipStatus | null;
  settings?: MembershipSettings;
  users?: SystemUser[];
  tenants?: CallCenterTenant[];
  requests?: MembershipRenewalRequest[];
  onRefresh: () => Promise<void> | void;
  lockMode?: boolean;
  onLogout?: () => void;
  onShowToast?: (msg: string, type?: 'success' | 'info' | 'error') => void;
}

const DEFAULT_SETTINGS: MembershipSettings = {
  enforceMembershipSystem: true,
  initialMonthDays: 30,
  weekDays: 7,
  initialMonthPriceUsd: 150,
  weeklyPriceUsd: 45,
  allowSelfRenewalFromBalance: false,
};

function formatDateTimeEs(iso?: string | null): string {
  if (!iso) return '—';
  const ts = Date.parse(iso);
  if (isNaN(ts)) return iso;
  return new Date(ts).toLocaleString('es-ES', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getMembershipBadge(eff?: EffectiveMembershipStatus) {
  if (!eff) {
    return {
      label: 'Sin Activar',
      classes: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
    };
  }
  if (eff.exempt) {
    return {
      label: 'Exento (Super Admin)',
      classes: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40',
    };
  }
  if (eff.status === 'suspended') {
    return {
      label: 'Suspendida',
      classes: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
    };
  }
  if (eff.status === 'expired') {
    return {
      label: 'Vencida',
      classes: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
    };
  }
  if (eff.status === 'active') {
    if (eff.remainingDays <= 3) {
      return {
        label: `Por Vencer • ${eff.remainingDays}d ${eff.remainingHours}h`,
        classes: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
      };
    }
    return {
      label: `Activa • ${eff.remainingDays}d ${eff.remainingHours}h`,
      classes: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    };
  }
  return {
    label: 'Sin Activar (1er Mes Pendiente)',
    classes: 'bg-slate-800 text-amber-300 border-amber-500/30',
  };
}

export const MembershipTab: React.FC<MembershipTabProps> = ({
  currentUser,
  myMembership,
  settings = DEFAULT_SETTINGS,
  users = [],
  tenants = [],
  requests = [],
  onRefresh,
  lockMode = false,
  onLogout,
  onShowToast,
}) => {
  const isGlobalSuperAdmin = Boolean(currentUser?.role === 'admin' && !currentUser?.tenantId);

  const [adminScopeTab, setAdminScopeTab] = useState<'tenants' | 'users' | 'requests' | 'settings'>('tenants');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'unactivated' | 'active' | 'expired' | 'suspended'>('all');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Admin custom weeks modal
  const [customModalTarget, setCustomModalTarget] = useState<{
    targetType: 'tenant' | 'user';
    targetId: string;
    targetName: string;
    effective?: EffectiveMembershipStatus;
  } | null>(null);
  const [customWeeks, setCustomWeeks] = useState<number>(1);
  const [customMethod, setCustomMethod] = useState<string>('transferencia');
  const [customReference, setCustomReference] = useState<string>('');
  const [customNotes, setCustomNotes] = useState<string>('');

  // History modal
  const [historyModal, setHistoryModal] = useState<{
    title: string;
    history: MembershipHistoryEntry[];
  } | null>(null);

  // Admin settings form
  const [settingsForm, setSettingsForm] = useState<MembershipSettings>(settings);
  React.useEffect(() => {
    setSettingsForm(settings);
  }, [settings]);

  // Client renewal request form
  const [reqWeeks, setReqWeeks] = useState<number>(1);
  const [reqPaymentMethod, setReqPaymentMethod] = useState<string>('zelle');
  const [reqReference, setReqReference] = useState<string>('');
  const [reqNotes, setReqNotes] = useState<string>('');

  const notify = (text: string, type: 'success' | 'error' = 'success') => {
    setFeedback({ text, type });
    if (onShowToast) onShowToast(text, type);
    setTimeout(() => setFeedback(null), 5000);
  };

  // Client effective status helpers
  const clientInitialDone = Boolean(myMembership?.initialMonthActivated);
  const clientPlanType: 'initial_month' | 'weekly_extension' = clientInitialDone
    ? 'weekly_extension'
    : 'initial_month';
  const clientDaysToAdd =
    clientPlanType === 'initial_month'
      ? settings.initialMonthDays
      : Math.max(1, Math.floor(reqWeeks || 1)) * settings.weekDays;
  const clientEstimatedUsd =
    clientPlanType === 'initial_month'
      ? settings.initialMonthPriceUsd
      : Math.max(1, Math.floor(reqWeeks || 1)) * settings.weeklyPriceUsd;

  const clientProjectedExpiry = useMemo(() => {
    const now = Date.now();
    const curExp = myMembership?.expiresAt ? Date.parse(myMembership.expiresAt) : NaN;
    const base = !isNaN(curExp) && curExp > now ? curExp : now;
    return new Date(base + clientDaysToAdd * 86400000).toISOString();
  }, [myMembership?.expiresAt, clientDaysToAdd]);

  // Admin statistics
  const pendingRequests = useMemo(
    () => requests.filter((r) => r.status === 'pending'),
    [requests]
  );

  const nonAdminStandaloneUsers = useMemo(
    () => users.filter((u) => !(u.role === 'admin' && !u.tenantId)),
    [users]
  );

  const adminStats = useMemo(() => {
    const allEff: EffectiveMembershipStatus[] = [
      ...tenants.map((t) => t.effectiveMembership).filter(Boolean) as EffectiveMembershipStatus[],
      ...nonAdminStandaloneUsers
        .filter((u) => !u.tenantId || u.membership?.independent)
        .map((u) => u.effectiveMembership)
        .filter(Boolean) as EffectiveMembershipStatus[],
    ];
    return {
      activeCount: allEff.filter((e) => e.status === 'active').length,
      expiringSoonCount: allEff.filter((e) => e.status === 'active' && e.remainingDays <= 3).length,
      inactiveCount: allEff.filter((e) => e.status === 'unactivated' || e.status === 'expired' || e.status === 'suspended').length,
      pendingCount: pendingRequests.length,
    };
  }, [tenants, nonAdminStandaloneUsers, pendingRequests]);

  const handleAdminActivate = async (
    targetType: 'tenant' | 'user',
    targetId: string,
    action: 'initial_month' | 'weekly_extension' | 'suspend' | 'reactivate' | 'reset',
    weeksCount?: number,
    extra?: { paymentMethod?: string; reference?: string; notes?: string; amountPaid?: number }
  ) => {
    const key = `${targetType}:${targetId}:${action}:${weeksCount || 0}`;
    setBusyKey(key);
    try {
      const res = await fetch('/api/membership/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetType,
          targetId,
          action,
          weeksCount,
          ...extra,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        notify(data.error || 'No se pudo actualizar la membresía.', 'error');
        return;
      }
      notify(data.message || 'Membresía actualizada.', 'success');
      await onRefresh();
    } catch (err: any) {
      notify(err?.message || 'Error de conexión.', 'error');
    } finally {
      setBusyKey(null);
    }
  };

  const handleBulkActivateLegacy = async () => {
    setBusyKey('bulk-legacy');
    try {
      const res = await fetch('/api/membership/bulk-activate-legacy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        notify(data.error || 'Error en activación masiva.', 'error');
        return;
      }
      notify(data.message || 'Activación inicial aplicada.', 'success');
      await onRefresh();
    } catch (err: any) {
      notify(err?.message || 'Error de conexión.', 'error');
    } finally {
      setBusyKey(null);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyKey('save-settings');
    try {
      const res = await fetch('/api/membership/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settingsForm),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        notify(data.error || 'Error guardando configuración.', 'error');
        return;
      }
      notify(data.message || 'Configuración de membresías guardada.', 'success');
      await onRefresh();
    } catch (err: any) {
      notify(err?.message || 'Error de conexión.', 'error');
    } finally {
      setBusyKey(null);
    }
  };

  const handleResolveRequest = async (requestId: string, decision: 'approve' | 'reject') => {
    setBusyKey(`req:${requestId}:${decision}`);
    try {
      const res = await fetch(`/api/membership/requests/${encodeURIComponent(requestId)}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          rejectionReason: decision === 'reject' ? 'Comprobante no verificado por el Administrador' : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        notify(data.error || 'No se pudo procesar la solicitud.', 'error');
        return;
      }
      notify(data.message || 'Solicitud procesada.', 'success');
      await onRefresh();
    } catch (err: any) {
      notify(err?.message || 'Error de conexión.', 'error');
    } finally {
      setBusyKey(null);
    }
  };

  const handleSubmitClientRequest = async (payWithBalance: boolean) => {
    if (!payWithBalance && !reqReference.trim()) {
      notify('Ingresa la referencia o comprobante de pago antes de enviar.', 'error');
      return;
    }
    setBusyKey(payWithBalance ? 'client-balance' : 'client-request');
    try {
      const res = await fetch('/api/membership/request-renewal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planType: clientPlanType,
          weeksCount: clientPlanType === 'weekly_extension' ? Math.max(1, Math.floor(reqWeeks || 1)) : 0,
          paymentMethod: payWithBalance ? 'saldo_prepago' : reqPaymentMethod,
          reference: payWithBalance ? 'AUTO-SALDO' : reqReference.trim(),
          notes: reqNotes.trim(),
          payWithBalance,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        notify(data.error || 'No se pudo procesar la solicitud.', 'error');
        return;
      }
      notify(data.message || 'Solicitud enviada.', 'success');
      setReqReference('');
      setReqNotes('');
      await onRefresh();
    } catch (err: any) {
      notify(err?.message || 'Error de conexión.', 'error');
    } finally {
      setBusyKey(null);
    }
  };

  // =========================================================================
  // CLIENT / CALL CENTER MEMBER VIEW (INCLUDES LOCK PAYWALL MODE)
  // =========================================================================
  if (!isGlobalSuperAdmin || lockMode) {
    const badge = getMembershipBadge(myMembership || undefined);
    const activeBadgeColor =
      myMembership?.status === 'active'
        ? 'border-emerald-500/40 bg-emerald-950/20'
        : 'border-rose-500/40 bg-rose-950/20';

    return (
      <div className="space-y-6 max-w-5xl mx-auto">
        {feedback && (
          <div
            className={`p-3.5 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
              feedback.type === 'success'
                ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-200'
                : 'bg-rose-950/60 border-rose-500/50 text-rose-200'
            }`}
          >
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span>{feedback.text}</span>
          </div>
        )}

        {/* Lock Banner when subscription is inactive/expired */}
        {lockMode && (
          <div className="p-6 rounded-2xl bg-gradient-to-r from-rose-950/80 via-slate-900 to-amber-950/50 border-2 border-rose-500/50 shadow-2xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-2xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400 shrink-0">
                  <ShieldAlert className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-lg font-black text-white">
                    {myMembership?.status === 'suspended'
                      ? 'Cuenta Suspendida — Membresía Inactiva'
                      : myMembership?.status === 'expired'
                      ? 'Membresía Vencida — Renovación Requerida'
                      : 'Activación Inicial Requerida (Membresía 1 Mes)'}
                  </h2>
                  <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                    {myMembership?.status === 'suspended'
                      ? 'Tu acceso operativo ha sido pausado temporalmente por el Administrador. Comunícate con soporte o verifica tu renovación.'
                      : !clientInitialDone
                      ? `Para usar el sistema por primera vez debes activar tu Membresía Principal de 1 Mes (${settings.initialMonthDays} días). Una vez activado ese primer mes, podrás renovar por 1 semana en adelante contando por semanas.`
                      : 'Tu tiempo de membresía ha finalizado. Solicita o activa 1 semana o más para reanudar tus llamadas y operaciones.'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => onRefresh()}
                  className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Verificar Estado</span>
                </button>
                {onLogout && (
                  <button
                    type="button"
                    onClick={onLogout}
                    className="px-3.5 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Salir</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Current Membership Status Overview */}
        <div className={`p-6 rounded-2xl border ${activeBadgeColor} shadow-xl space-y-5`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-slate-900 border border-slate-700 flex items-center justify-center text-emerald-400">
                <CalendarClock className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-black text-white">Estado de Mi Membresía</h2>
                  <span className={`text-[11px] font-mono font-bold px-2.5 py-0.5 rounded-full border ${badge.classes}`}>
                    {badge.label}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Cobertura: <strong className="text-slate-200">{myMembership?.scope === 'tenant' ? `Grupo Call Center (${myMembership?.targetName})` : `Cuenta Individual (${myMembership?.targetName || currentUser?.name})`}</strong>
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onRefresh()}
              className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-200 flex items-center gap-1.5 cursor-pointer self-start"
            >
              <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
              <span>Actualizar</span>
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Primer Mes Principal</div>
              <div className="text-sm font-black text-white mt-1 flex items-center gap-1.5">
                {clientInitialDone ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span className="text-emerald-300">Activado</span>
                  </>
                ) : (
                  <>
                    <Lock className="w-4 h-4 text-amber-400" />
                    <span className="text-amber-300">Pendiente (1 Mes)</span>
                  </>
                )}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                {clientInitialDone ? formatDateTimeEs(myMembership?.initialActivatedAt) : 'Obligatorio al iniciar'}
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Tiempo Restante</div>
              <div className="text-xl font-black font-mono text-white mt-0.5">
                {myMembership?.status === 'active'
                  ? `${myMembership.remainingDays}d ${myMembership.remainingHours}h`
                  : '0d 0h'}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                {myMembership?.status === 'active' ? 'Acceso operativo habilitado' : 'Requiere activación'}
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Fecha de Vencimiento</div>
              <div className="text-xs font-mono font-bold text-cyan-300 mt-1.5">
                {formatDateTimeEs(myMembership?.expiresAt)}
              </div>
              <div className="text-[10px] text-slate-500 mt-1">Hora local del sistema</div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Semanas Renovadas</div>
              <div className="text-xl font-black font-mono text-purple-300 mt-0.5">
                {myMembership?.totalWeeksAdded || 0} sem
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                {clientInitialDone ? 'Renovaciones por semana activas' : 'Se habilita tras el 1er mes'}
              </div>
            </div>
          </div>
        </div>

        {/* Plan Activation / Extension Request Card */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-emerald-400" />
                <span>
                  {!clientInitialDone
                    ? 'Paso 1: Activar Membresía Principal (1 Mes)'
                    : 'Extender Membresía por Semanas'}
                </span>
              </h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                {!clientInitialDone ? `${settings.initialMonthDays} días` : `${settings.weekDays} días / semana`}
              </span>
            </div>

            {!clientInitialDone ? (
              <div className="space-y-3">
                <div className="p-4 rounded-xl bg-emerald-950/30 border-2 border-emerald-500/50 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-black text-white">Membresía Principal — 1 Mes</span>
                    <span className="text-base font-mono font-black text-emerald-400">
                      ${settings.initialMonthPriceUsd} USD
                    </span>
                  </div>
                  <p className="text-xs text-slate-300">
                    Activación inicial obligatoria de <strong>{settings.initialMonthDays} días completos</strong>. Incluye acceso al marcador, extensiones, audios y recepción OTP.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 opacity-70 flex items-start gap-2.5">
                  <Lock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div className="text-[11px] text-slate-400 leading-relaxed">
                    <strong className="text-amber-300 block">Planes por Semana (1 semana en adelante):</strong>
                    Las renovaciones semanales (${settings.weeklyPriceUsd} USD / {settings.weekDays} días) se desbloquean automáticamente después de activar tu primer mes principal.
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-slate-400">
                  Ya completaste tu Membresía Principal de 1 Mes. Ahora puedes sumar tiempo contando <strong className="text-white">desde 1 semana en adelante</strong> ({settings.weekDays} días por semana):
                </p>

                <div className="grid grid-cols-4 gap-2">
                  {[1, 2, 3, 4].map((w) => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => setReqWeeks(w)}
                      className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                        reqWeeks === w
                          ? 'bg-emerald-500/20 border-emerald-400 text-white shadow-md'
                          : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <div className="text-xs font-black">{w} {w === 1 ? 'Sem' : 'Sems'}</div>
                      <div className="text-[10px] font-mono text-emerald-400">{w * settings.weekDays}d</div>
                      <div className="text-[10px] font-mono text-slate-400">${w * settings.weeklyPriceUsd}</div>
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-3 items-end">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                      Semanas exactas (1 en adelante)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={52}
                      value={reqWeeks}
                      onChange={(e) => setReqWeeks(Math.max(1, Math.min(52, Math.floor(Number(e.target.value) || 1))))}
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono font-bold text-sm focus:outline-none focus:border-emerald-400"
                    />
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs">
                    <div className="text-[10px] text-slate-400">Total a sumar:</div>
                    <div className="font-mono font-black text-emerald-400">
                      +{clientDaysToAdd} días (${clientEstimatedUsd} USD)
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs flex items-center justify-between">
              <span className="text-slate-400">Nuevo vencimiento estimado:</span>
              <span className="font-mono font-bold text-cyan-300">{formatDateTimeEs(clientProjectedExpiry)}</span>
            </div>
          </div>

          {/* Payment Reference / Submit Request */}
          <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Send className="w-5 h-5 text-cyan-400" />
              <span>Solicitar Activación / Reportar Pago</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">Método de Pago</label>
                <select
                  value={reqPaymentMethod}
                  onChange={(e) => setReqPaymentMethod(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-emerald-400"
                >
                  <option value="zelle">Zelle</option>
                  <option value="usdt_crypto">USDT / Cripto</option>
                  <option value="transferencia">Transferencia Bancaria</option>
                  <option value="efectivo">Efectivo / Acuerdo Admin</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">Referencia / Comprobante *</label>
                <input
                  type="text"
                  placeholder="Ej. ZLL-49102 o Hash USDT"
                  value={reqReference}
                  onChange={(e) => setReqReference(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white font-mono focus:outline-none focus:border-emerald-400"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">Notas para el Administrador (Opcional)</label>
              <input
                type="text"
                placeholder="Ej. Pago enviado desde cuenta ..."
                value={reqNotes}
                onChange={(e) => setReqNotes(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-emerald-400"
              />
            </div>

            <div className="space-y-2 pt-1">
              <button
                type="button"
                disabled={busyKey !== null}
                onClick={() => handleSubmitClientRequest(false)}
                className="w-full py-2.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 transition-all cursor-pointer disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
                <span>
                  {busyKey === 'client-request'
                    ? 'Enviando solicitud...'
                    : !clientInitialDone
                    ? `Solicitar Membresía Principal 1 Mes ($${clientEstimatedUsd} USD)`
                    : `Solicitar +${reqWeeks} ${reqWeeks === 1 ? 'Semana' : 'Semanas'} ($${clientEstimatedUsd} USD)`}
                </span>
              </button>

              {settings.allowSelfRenewalFromBalance && (
                <button
                  type="button"
                  disabled={busyKey !== null}
                  onClick={() => handleSubmitClientRequest(true)}
                  className="w-full py-2.5 px-4 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-500/40 font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                >
                  <Wallet className="w-4 h-4" />
                  <span>
                    {busyKey === 'client-balance'
                      ? 'Activando...'
                      : `Activar al Instante con mi Saldo ($${clientEstimatedUsd} USD)`}
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Client's Requests & History */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
            <h4 className="text-sm font-bold text-white flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-400" />
              <span>Mis Solicitudes de Renovación ({requests.length})</span>
            </h4>
            {requests.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">No has enviado solicitudes todavía.</p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {requests.map((r) => (
                  <div key={r.id} className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs flex items-center justify-between gap-2">
                    <div>
                      <div className="font-bold text-white">
                        {r.planType === 'initial_month'
                          ? `1er Mes Principal (${r.daysCount}d)`
                          : `+${r.weeksCount} ${r.weeksCount === 1 ? 'Semana' : 'Semanas'} (${r.daysCount}d)`}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono">
                        Ref: {r.reference} • ${r.estimatedPriceUsd} USD • {formatDateTimeEs(r.createdAt)}
                      </div>
                      {r.rejectionReason && (
                        <div className="text-[11px] text-rose-400 mt-0.5">Motivo: {r.rejectionReason}</div>
                      )}
                    </div>
                    <span
                      className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border shrink-0 ${
                        r.status === 'approved'
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                          : r.status === 'rejected'
                          ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                          : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                      }`}
                    >
                      {r.status === 'approved' ? 'Aprobada' : r.status === 'rejected' ? 'Rechazada' : 'Pendiente'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
            <h4 className="text-sm font-bold text-white flex items-center gap-2">
              <History className="w-4 h-4 text-emerald-400" />
              <span>Historial de Activaciones ({myMembership?.history?.length || 0})</span>
            </h4>
            {!myMembership?.history?.length ? (
              <p className="text-xs text-slate-500 py-4 text-center">Sin movimientos registrados.</p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {myMembership.history.map((h) => (
                  <div key={h.id} className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-emerald-300">{h.notes || h.action}</span>
                      <span className="text-[10px] font-mono text-slate-400">{formatDateTimeEs(h.timestamp)}</span>
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono mt-1">
                      +{h.daysAdded} días • Vence: {formatDateTimeEs(h.newExpiresAt)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // SUPER ADMIN GLOBAL MANAGEMENT CONSOLE
  // =========================================================================
  const filteredTenants = tenants.filter((t) => {
    const q = searchTerm.toLowerCase();
    const matchesSearch =
      !q ||
      t.name.toLowerCase().includes(q) ||
      t.code.toLowerCase().includes(q) ||
      String(t.contactName || '').toLowerCase().includes(q);
    if (!matchesSearch) return false;
    if (statusFilter === 'all') return true;
    return (t.effectiveMembership?.status || 'unactivated') === statusFilter;
  });

  const filteredUsers = nonAdminStandaloneUsers.filter((u) => {
    const q = searchTerm.toLowerCase();
    const matchesSearch =
      !q ||
      u.name.toLowerCase().includes(q) ||
      String(u.username || '').toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q);
    if (!matchesSearch) return false;
    if (statusFilter === 'all') return true;
    const effStatus = u.effectiveMembership?.status || 'unactivated';
    return effStatus === statusFilter;
  });

  const unactivatedCount =
    tenants.filter((t) => !t.effectiveMembership?.initialMonthActivated).length +
    nonAdminStandaloneUsers.filter((u) => !u.tenantId && !u.effectiveMembership?.initialMonthActivated).length;

  return (
    <div className="space-y-6">
      {feedback && (
        <div
          className={`p-3.5 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
            feedback.type === 'success'
              ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-200'
              : 'bg-rose-950/60 border-rose-500/50 text-rose-200'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Top Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-emerald-950/35 to-slate-900 border border-emerald-500/30 rounded-2xl p-6 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="p-2.5 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shrink-0">
              <CalendarClock className="w-6 h-6" />
            </span>
            <div>
              <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2 flex-wrap">
                <span>Control de Membresías & Suscripciones</span>
                <span className={`text-[10px] font-mono px-2.5 py-0.5 rounded-full border ${settings.enforceMembershipSystem ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>
                  {settings.enforceMembershipSystem ? 'CONTROL ACTIVO' : 'MODO LIBRE'}
                </span>
              </h1>
              <p className="text-xs text-slate-300 mt-1">
                Regla activa: Primera activación obligatoria de <strong>1 Mes ({settings.initialMonthDays} días)</strong>. Luego puedes extender en bloques de <strong>1 semana en adelante ({settings.weekDays} días c/u)</strong>.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {unactivatedCount > 0 && (
              <button
                type="button"
                disabled={busyKey === 'bulk-legacy'}
                onClick={handleBulkActivateLegacy}
                className="px-3.5 py-2 rounded-xl text-xs font-bold bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                title="Otorgar el 1er Mes inicial (30 días) a todas las cuentas existentes sin membresía configurada"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Activar 1er Mes a Existentes ({unactivatedCount})</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => onRefresh()}
              className="px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
              <span>Actualizar</span>
            </button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
          <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800">
            <div className="text-[10px] uppercase text-slate-400 font-semibold">Membresías Activas</div>
            <div className="text-2xl font-black text-emerald-400 mt-0.5">{adminStats.activeCount}</div>
            <div className="text-[10px] text-slate-500">Con tiempo vigente</div>
          </div>
          <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800">
            <div className="text-[10px] uppercase text-slate-400 font-semibold">Por Vencer (≤ 3d)</div>
            <div className="text-2xl font-black text-amber-400 mt-0.5">{adminStats.expiringSoonCount}</div>
            <div className="text-[10px] text-slate-500">Listas para renovar semanas</div>
          </div>
          <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800">
            <div className="text-[10px] uppercase text-slate-400 font-semibold">Vencidas / Sin Activar</div>
            <div className="text-2xl font-black text-rose-400 mt-0.5">{adminStats.inactiveCount}</div>
            <div className="text-[10px] text-slate-500">Bloqueadas para operar</div>
          </div>
          <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800">
            <div className="text-[10px] uppercase text-slate-400 font-semibold">Solicitudes Pendientes</div>
            <div className="text-2xl font-black text-cyan-400 mt-0.5">{adminStats.pendingCount}</div>
            <div className="text-[10px] text-slate-500">Pagos por aprobar</div>
          </div>
        </div>
      </div>

      {/* Sub-navigation + Filters */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setAdminScopeTab('tenants')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
              adminScopeTab === 'tenants'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : 'text-slate-400 hover:text-white bg-slate-900 border border-slate-800'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>Grupos Call Center ({tenants.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setAdminScopeTab('users')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
              adminScopeTab === 'users'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : 'text-slate-400 hover:text-white bg-slate-900 border border-slate-800'
            }`}
          >
            <UserIcon className="w-3.5 h-3.5" />
            <span>Clientes & Usuarios ({nonAdminStandaloneUsers.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setAdminScopeTab('requests')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
              adminScopeTab === 'requests'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                : 'text-slate-400 hover:text-white bg-slate-900 border border-slate-800'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Solicitudes ({pendingRequests.length} pend.)</span>
          </button>

          <button
            type="button"
            onClick={() => setAdminScopeTab('settings')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
              adminScopeTab === 'settings'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'text-slate-400 hover:text-white bg-slate-900 border border-slate-800'
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Reglas & Precios</span>
          </button>
        </div>

        {(adminScopeTab === 'tenants' || adminScopeTab === 'users') && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Buscar cuenta..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 pr-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-emerald-400"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-slate-200 focus:outline-none focus:border-emerald-400"
            >
              <option value="all">Todos los estados</option>
              <option value="active">Activas</option>
              <option value="unactivated">Sin Activar (1er Mes)</option>
              <option value="expired">Vencidas</option>
              <option value="suspended">Suspendidas</option>
            </select>
          </div>
        )}
      </div>

      {/* TENANTS LIST */}
      {adminScopeTab === 'tenants' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredTenants.map((tenant) => {
            const eff = tenant.effectiveMembership;
            const badge = getMembershipBadge(eff);
            const hasInitial = Boolean(eff?.initialMonthActivated);

            return (
              <div key={tenant.id} className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4 shadow-lg">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 font-mono font-bold text-[11px]">
                        {tenant.code}
                      </span>
                      <h3 className="font-bold text-white text-sm">{tenant.name}</h3>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1 font-mono">
                      Ext {tenant.extensionStart}-{tenant.extensionEnd} • Saldo ${tenant.dollarBalance.toFixed(2)}
                    </p>
                  </div>
                  <span className={`text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full border shrink-0 ${badge.classes}`}>
                    {badge.label}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-[11px]">
                  <div>
                    <span className="text-slate-500 block text-[10px]">1er Mes (30d):</span>
                    <span className={`font-bold ${hasInitial ? 'text-emerald-300' : 'text-amber-300'}`}>
                      {hasInitial ? '✓ Completado' : 'Pendiente'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Vencimiento:</span>
                    <span className="font-mono text-cyan-300 font-semibold">
                      {formatDateTimeEs(eff?.expiresAt)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Semanas Sumadas:</span>
                    <span className="font-mono text-purple-300 font-bold">{eff?.totalWeeksAdded || 0} sem</span>
                  </div>
                </div>

                <div className="space-y-2">
                  {!hasInitial ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={busyKey !== null}
                        onClick={() => handleAdminActivate('tenant', tenant.id, 'initial_month')}
                        className="flex-1 py-2 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <Unlock className="w-3.5 h-3.5" />
                        <span>Activar 1er Mes Principal ({settings.initialMonthDays} días)</span>
                      </button>
                      <button
                        type="button"
                        disabled
                        title="Primero debes activar la Membresía Principal de 1 Mes"
                        className="py-2 px-3 rounded-xl bg-slate-950 text-slate-500 border border-slate-800 text-xs font-mono flex items-center gap-1 opacity-60 cursor-not-allowed"
                      >
                        <Lock className="w-3 h-3" />
                        <span>+Semanas</span>
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {[1, 2, 3, 4].map((w) => (
                        <button
                          key={w}
                          type="button"
                          disabled={busyKey !== null}
                          onClick={() => handleAdminActivate('tenant', tenant.id, 'weekly_extension', w)}
                          className="px-2.5 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 font-mono font-bold text-xs cursor-pointer disabled:opacity-50"
                          title={`Agregar +${w} ${w === 1 ? 'semana' : 'semanas'} (${w * settings.weekDays} días)`}
                        >
                          +{w} Sem
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          setCustomModalTarget({
                            targetType: 'tenant',
                            targetId: tenant.id,
                            targetName: tenant.name,
                            effective: eff,
                          });
                          setCustomWeeks(1);
                          setCustomReference('');
                          setCustomNotes('');
                        }}
                        className="px-2.5 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-500/40 font-bold text-xs flex items-center gap-1 cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                        <span>N Semanas</span>
                      </button>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-1 border-t border-slate-800/80 text-[11px]">
                    <button
                      type="button"
                      onClick={() =>
                        setHistoryModal({
                          title: `Historial: ${tenant.name}`,
                          history: eff?.history || [],
                        })
                      }
                      className="text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
                    >
                      <History className="w-3.5 h-3.5" />
                      <span>Historial ({eff?.history?.length || 0})</span>
                    </button>

                    <div className="flex items-center gap-2">
                      {eff?.status === 'suspended' ? (
                        <button
                          type="button"
                          disabled={busyKey !== null}
                          onClick={() => handleAdminActivate('tenant', tenant.id, 'reactivate')}
                          className="text-emerald-400 hover:text-emerald-300 font-semibold flex items-center gap-1 cursor-pointer"
                        >
                          <PlayCircle className="w-3.5 h-3.5" />
                          <span>Reactivar</span>
                        </button>
                      ) : hasInitial ? (
                        <button
                          type="button"
                          disabled={busyKey !== null}
                          onClick={() => handleAdminActivate('tenant', tenant.id, 'suspend')}
                          className="text-rose-400 hover:text-rose-300 font-semibold flex items-center gap-1 cursor-pointer"
                        >
                          <PauseCircle className="w-3.5 h-3.5" />
                          <span>Suspender</span>
                        </button>
                      ) : null}

                      {hasInitial && (
                        <button
                          type="button"
                          disabled={busyKey !== null}
                          onClick={() => {
                            if (confirm(`¿Reiniciar la membresía de "${tenant.name}"? Volverá a exigir activación inicial de 1 Mes.`)) {
                              handleAdminActivate('tenant', tenant.id, 'reset');
                            }
                          }}
                          className="text-slate-500 hover:text-amber-300 flex items-center gap-1 cursor-pointer"
                          title="Reiniciar membresía"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Reiniciar</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* USERS LIST */}
      {adminScopeTab === 'users' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredUsers.map((user) => {
            const eff = user.effectiveMembership;
            const badge = getMembershipBadge(eff);
            const belongsToTenant = Boolean(user.tenantId && !user.membership?.independent);
            const parentTenant = belongsToTenant ? tenants.find((t) => t.id === user.tenantId) : null;
            const hasInitial = Boolean(user.membership?.initialMonthActivated);

            return (
              <div key={user.id} className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3 flex flex-col justify-between">
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <h3 className="font-bold text-white text-sm truncate">{user.name}</h3>
                      <p className="text-[11px] text-slate-400 font-mono truncate">
                        @{user.username || user.email} • Ext {user.assignedExtensions?.join(', ') || '—'}
                      </p>
                    </div>
                    <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border shrink-0 ${badge.classes}`}>
                      {badge.label}
                    </span>
                  </div>

                  {belongsToTenant ? (
                    <div className="p-2.5 rounded-xl bg-indigo-950/30 border border-indigo-500/30 text-[11px] text-indigo-200">
                      Hereda membresía de su Call Center: <strong className="text-white">{parentTenant?.name || user.tenantId}</strong>. Adminístrala en la pestaña Grupos Call Center.
                    </div>
                  ) : (
                    <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-[11px] space-y-1">
                      <div className="flex justify-between">
                        <span className="text-slate-400">1er Mes Principal:</span>
                        <span className={hasInitial ? 'text-emerald-300 font-bold' : 'text-amber-300 font-bold'}>
                          {hasInitial ? '✓ Completado' : 'Pendiente (30d)'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Vence:</span>
                        <span className="font-mono text-cyan-300">{formatDateTimeEs(eff?.expiresAt)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Semanas añadidas:</span>
                        <span className="font-mono text-purple-300 font-bold">{eff?.totalWeeksAdded || 0} sem</span>
                      </div>
                    </div>
                  )}
                </div>

                {!belongsToTenant && (
                  <div className="space-y-2 pt-2 border-t border-slate-800">
                    {!hasInitial ? (
                      <button
                        type="button"
                        disabled={busyKey !== null}
                        onClick={() => handleAdminActivate('user', user.id, 'initial_month')}
                        className="w-full py-2 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <Unlock className="w-3.5 h-3.5" />
                        <span>Activar 1er Mes ({settings.initialMonthDays}d)</span>
                      </button>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {[1, 2, 4].map((w) => (
                          <button
                            key={w}
                            type="button"
                            disabled={busyKey !== null}
                            onClick={() => handleAdminActivate('user', user.id, 'weekly_extension', w)}
                            className="px-2 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 font-mono font-bold text-[11px] cursor-pointer"
                          >
                            +{w} Sem
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => {
                            setCustomModalTarget({
                              targetType: 'user',
                              targetId: user.id,
                              targetName: user.name,
                              effective: eff,
                            });
                            setCustomWeeks(1);
                            setCustomReference('');
                            setCustomNotes('');
                          }}
                          className="px-2 py-1 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-500/40 font-bold text-[11px] cursor-pointer"
                        >
                          +N Sem
                        </button>
                      </div>
                    )}

                    <div className="flex items-center justify-between text-[11px] pt-1">
                      <button
                        type="button"
                        onClick={() =>
                          setHistoryModal({
                            title: `Historial: ${user.name}`,
                            history: eff?.history || [],
                          })
                        }
                        className="text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
                      >
                        <History className="w-3.5 h-3.5" />
                        <span>Historial ({eff?.history?.length || 0})</span>
                      </button>

                      <div className="flex items-center gap-2">
                        {eff?.status === 'suspended' ? (
                          <button
                            type="button"
                            onClick={() => handleAdminActivate('user', user.id, 'reactivate')}
                            className="text-emerald-400 hover:text-emerald-300 font-semibold cursor-pointer"
                          >
                            Reactivar
                          </button>
                        ) : hasInitial ? (
                          <button
                            type="button"
                            onClick={() => handleAdminActivate('user', user.id, 'suspend')}
                            className="text-rose-400 hover:text-rose-300 font-semibold cursor-pointer"
                          >
                            Suspender
                          </button>
                        ) : null}

                        {hasInitial && (
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm(`¿Reiniciar la membresía de "${user.name}"?`)) {
                                handleAdminActivate('user', user.id, 'reset');
                              }
                            }}
                            className="text-slate-500 hover:text-amber-300 cursor-pointer"
                          >
                            Reiniciar
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* REQUESTS QUEUE */}
      {adminScopeTab === 'requests' && (
        <div className="space-y-3">
          {requests.length === 0 ? (
            <div className="p-8 rounded-2xl bg-slate-900 border border-slate-800 text-center text-xs text-slate-400">
              No hay solicitudes de activación o renovación registradas.
            </div>
          ) : (
            requests.map((r) => (
              <div
                key={r.id}
                className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-black text-white">{r.targetName}</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                      {r.targetType === 'tenant' ? 'Call Center' : 'Cliente Individual'}
                    </span>
                    <span className="text-[11px] font-mono font-bold text-emerald-400">
                      {r.planType === 'initial_month'
                        ? `1er Mes Principal (${r.daysCount} días)`
                        : `+${r.weeksCount} ${r.weeksCount === 1 ? 'Semana' : 'Semanas'} (${r.daysCount} días)`}
                    </span>
                    <span
                      className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${
                        r.status === 'pending'
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                          : r.status === 'approved'
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                          : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                      }`}
                    >
                      {r.status === 'pending' ? 'PENDIENTE' : r.status === 'approved' ? 'APROBADA' : 'RECHAZADA'}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 font-mono">
                    Solicitó: @{r.requestedByUsername} • Método: {r.paymentMethod} • Ref: <strong className="text-white">{r.reference}</strong> • ${r.estimatedPriceUsd} USD
                  </div>
                  {r.notes && <div className="text-xs text-slate-300">Nota: {r.notes}</div>}
                </div>

                {r.status === 'pending' ? (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={busyKey !== null}
                      onClick={() => handleResolveRequest(r.id, 'approve')}
                      className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Aprobar y Activar</span>
                    </button>
                    <button
                      type="button"
                      disabled={busyKey !== null}
                      onClick={() => handleResolveRequest(r.id, 'reject')}
                      className="px-3.5 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 font-bold text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Rechazar</span>
                    </button>
                  </div>
                ) : (
                  <div className="text-[11px] font-mono text-slate-500">
                    Resuelta por {r.resolvedBy || 'admin'} • {formatDateTimeEs(r.resolvedAt)}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* GLOBAL SETTINGS */}
      {adminScopeTab === 'settings' && (
        <form onSubmit={handleSaveSettings} className="p-6 rounded-2xl bg-slate-900 border border-slate-800 max-w-2xl space-y-4">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <span>Configuración Global del Sistema de Membresías</span>
          </h3>

          <label className="flex items-start gap-3 p-3.5 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
            <input
              type="checkbox"
              checked={settingsForm.enforceMembershipSystem}
              onChange={(e) => setSettingsForm({ ...settingsForm, enforceMembershipSystem: e.target.checked })}
              className="mt-0.5 rounded border-slate-700 text-emerald-500 bg-slate-900"
            />
            <div>
              <span className="text-xs font-bold text-white block">Exigir Membresía Activa para Operar</span>
              <span className="text-[11px] text-slate-400">
                Si está activo, los clientes y Call Centers sin 1er Mes o con membresía vencida quedan bloqueados hasta renovar.
              </span>
            </div>
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Días de Membresía Principal (1er Mes)</label>
              <input
                type="number"
                min={1}
                max={365}
                value={settingsForm.initialMonthDays}
                onChange={(e) => setSettingsForm({ ...settingsForm, initialMonthDays: Math.max(1, Number(e.target.value) || 30) })}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono font-bold"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Días por Cada Semana de Renovación</label>
              <input
                type="number"
                min={1}
                max={31}
                value={settingsForm.weekDays}
                onChange={(e) => setSettingsForm({ ...settingsForm, weekDays: Math.max(1, Number(e.target.value) || 7) })}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono font-bold"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Precio Referencial 1er Mes ($ USD)</label>
              <input
                type="number"
                min={0}
                step="1"
                value={settingsForm.initialMonthPriceUsd}
                onChange={(e) => setSettingsForm({ ...settingsForm, initialMonthPriceUsd: Math.max(0, Number(e.target.value) || 0) })}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-emerald-300 font-mono font-bold"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Precio Referencial por Semana ($ USD)</label>
              <input
                type="number"
                min={0}
                step="1"
                value={settingsForm.weeklyPriceUsd}
                onChange={(e) => setSettingsForm({ ...settingsForm, weeklyPriceUsd: Math.max(0, Number(e.target.value) || 0) })}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-cyan-300 font-mono font-bold"
              />
            </div>
          </div>

          <label className="flex items-start gap-3 p-3.5 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
            <input
              type="checkbox"
              checked={settingsForm.allowSelfRenewalFromBalance}
              onChange={(e) => setSettingsForm({ ...settingsForm, allowSelfRenewalFromBalance: e.target.checked })}
              className="mt-0.5 rounded border-slate-700 text-cyan-500 bg-slate-900"
            />
            <div>
              <span className="text-xs font-bold text-white block">Permitir Auto-Activación Instantánea con Saldo Prepago ($)</span>
              <span className="text-[11px] text-slate-400">
                Si está activo, el cliente puede descontar automáticamente el costo de su billetera sin esperar aprobación manual.
              </span>
            </div>
          </label>

          <button
            type="submit"
            disabled={busyKey === 'save-settings'}
            className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs cursor-pointer disabled:opacity-50"
          >
            {busyKey === 'save-settings' ? 'Guardando...' : 'Guardar Reglas de Membresía'}
          </button>
        </form>
      )}

      {/* MODAL: CUSTOM WEEKS ACTIVATION */}
      {customModalTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-emerald-500/40 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="font-bold text-white text-base">Extender por Semanas</h3>
                <p className="text-xs text-slate-400">{customModalTarget.targetName}</p>
              </div>
              <button
                type="button"
                onClick={() => setCustomModalTarget(null)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Cantidad de Semanas (1 en adelante)
                </label>
                <input
                  type="number"
                  min={1}
                  max={104}
                  value={customWeeks}
                  onChange={(e) => setCustomWeeks(Math.max(1, Math.min(104, Math.floor(Number(e.target.value) || 1))))}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono font-bold text-base"
                />
                <p className="text-[11px] text-emerald-400 font-mono mt-1">
                  +{customWeeks} {customWeeks === 1 ? 'semana' : 'semanas'} = +{customWeeks * settings.weekDays} días • Sugerido: ${customWeeks * settings.weeklyPriceUsd} USD
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-400 mb-1">Método</label>
                  <input
                    type="text"
                    value={customMethod}
                    onChange={(e) => setCustomMethod(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white text-xs"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Referencia</label>
                  <input
                    type="text"
                    placeholder="Opcional"
                    value={customReference}
                    onChange={(e) => setCustomReference(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white text-xs font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Notas</label>
                <input
                  type="text"
                  placeholder="Ej. Renovación semanal confirmada"
                  value={customNotes}
                  onChange={(e) => setCustomNotes(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white text-xs"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setCustomModalTarget(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={busyKey !== null}
                onClick={async () => {
                  const t = customModalTarget;
                  setCustomModalTarget(null);
                  await handleAdminActivate(t.targetType, t.targetId, 'weekly_extension', customWeeks, {
                    paymentMethod: customMethod,
                    reference: customReference,
                    notes: customNotes || undefined,
                  });
                }}
                className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs cursor-pointer"
              >
                Aplicar +{customWeeks} {customWeeks === 1 ? 'Semana' : 'Semanas'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: HISTORY */}
      {historyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                <History className="w-4 h-4 text-emerald-400" />
                <span>{historyModal.title}</span>
              </h3>
              <button
                type="button"
                onClick={() => setHistoryModal(null)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            {historyModal.history.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">No hay eventos registrados aún.</p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {historyModal.history.map((h) => (
                  <div key={h.id} className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-emerald-300">{h.notes || h.action}</span>
                      <span className="text-[10px] font-mono text-slate-400">{formatDateTimeEs(h.timestamp)}</span>
                    </div>
                    <div className="text-[11px] font-mono text-slate-400">
                      +{h.daysAdded}d • Vence: {formatDateTimeEs(h.newExpiresAt)} • Por: {h.performedBy}
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
