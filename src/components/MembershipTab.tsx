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
  DollarSign,
  Users,
  Receipt,
  Sliders,
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
  demoDays: 1,
  weekDays: 7,
  initialMonthPriceUsd: 150,
  weeklyPriceUsd: 45,
  callCenterBasePriceUsd: 0,
  callCenterPerAgentMonthPriceUsd: 25,
  callCenterPerAgentWeekPriceUsd: 8,
  defaultCallCenterAgents: 5,
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

function formatUsd(val?: number | null): string {
  if (typeof val !== 'number' || !Number.isFinite(val)) return '—';
  return `$${val.toLocaleString('en-US', { minimumFractionDigits: val % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })} USD`;
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
      label: !eff.initialMonthActivated && eff.demoUsed ? 'Demo Finalizado (1er Mes Pendiente)' : 'Vencida',
      classes: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
    };
  }
  if (eff.status === 'active') {
    if (eff.isDemo) {
      return {
        label: `DEMO • ${eff.remainingDays}d ${eff.remainingHours}h`,
        classes: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
      };
    }
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

function computeSuggestedUsd(
  scope: 'tenant' | 'user',
  action: 'initial_month' | 'weekly_extension',
  settings: MembershipSettings,
  eff?: EffectiveMembershipStatus,
  weeksCount = 1,
  agentsCount?: number
): number {
  if (scope === 'tenant') {
    const agents = Math.max(
      1,
      Math.floor(Number(agentsCount ?? eff?.licensedAgents ?? settings.defaultCallCenterAgents ?? 5) || 5)
    );
    if (action === 'initial_month') {
      if (typeof eff?.customMonthPriceUsd === 'number' && agentsCount === eff?.licensedAgents) {
        return eff.customMonthPriceUsd;
      }
      return Math.round(
        ((settings.callCenterBasePriceUsd ?? 0) + agents * (settings.callCenterPerAgentMonthPriceUsd ?? 25)) * 100
      ) / 100;
    }
    const w = Math.max(1, Math.floor(weeksCount || 1));
    if (typeof eff?.customWeeklyPriceUsd === 'number' && agentsCount === eff?.licensedAgents) {
      return Math.round(w * eff.customWeeklyPriceUsd * 100) / 100;
    }
    return Math.round(w * agents * (settings.callCenterPerAgentWeekPriceUsd ?? 8) * 100) / 100;
  }

  if (action === 'initial_month') {
    if (typeof eff?.customMonthPriceUsd === 'number') return eff.customMonthPriceUsd;
    return settings.initialMonthPriceUsd;
  }
  const w = Math.max(1, Math.floor(weeksCount || 1));
  if (typeof eff?.customWeeklyPriceUsd === 'number') {
    return Math.round(w * eff.customWeeklyPriceUsd * 100) / 100;
  }
  return Math.round(w * settings.weeklyPriceUsd * 100) / 100;
}

interface ActionModalState {
  mode: 'initial_month' | 'weekly_extension' | 'plan_update' | 'approve_request';
  targetType: 'tenant' | 'user';
  targetId: string;
  targetName: string;
  effective?: EffectiveMembershipStatus;
  request?: MembershipRenewalRequest;
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

  const [adminScopeTab, setAdminScopeTab] = useState<'tenants' | 'users' | 'ledger' | 'requests' | 'settings'>('tenants');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'unactivated' | 'active' | 'expired' | 'suspended'>('all');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Unified Action / Custom Price / Call Center Agents Modal
  const [actionModal, setActionModal] = useState<ActionModalState | null>(null);
  const [modalWeeks, setModalWeeks] = useState<number>(1);
  const [modalAgents, setModalAgents] = useState<number>(5);
  const [modalPriceStr, setModalPriceStr] = useState<string>('150');
  const [modalPriceManuallyEdited, setModalPriceManuallyEdited] = useState<boolean>(false);
  const [modalSaveAsCustomRate, setModalSaveAsCustomRate] = useState<boolean>(false);
  const [modalCustomMonthStr, setModalCustomMonthStr] = useState<string>('');
  const [modalCustomWeeklyStr, setModalCustomWeeklyStr] = useState<string>('');
  const [modalMethod, setModalMethod] = useState<string>('transferencia');
  const [modalReference, setModalReference] = useState<string>('');
  const [modalNotes, setModalNotes] = useState<string>('');

  // History modal
  const [historyModal, setHistoryModal] = useState<{
    title: string;
    history: MembershipHistoryEntry[];
  } | null>(null);

  // Admin settings form
  const [settingsForm, setSettingsForm] = useState<MembershipSettings>({
    ...DEFAULT_SETTINGS,
    ...settings,
  });
  React.useEffect(() => {
    setSettingsForm({
      ...DEFAULT_SETTINGS,
      ...settings,
    });
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
  const clientScope: 'tenant' | 'user' = myMembership?.scope === 'tenant' ? 'tenant' : 'user';
  const clientInitialDone = Boolean(myMembership?.initialMonthActivated);
  const clientPlanType: 'initial_month' | 'weekly_extension' = clientInitialDone
    ? 'weekly_extension'
    : 'initial_month';
  const clientDaysToAdd =
    clientPlanType === 'initial_month'
      ? settings.initialMonthDays
      : Math.max(1, Math.floor(reqWeeks || 1)) * settings.weekDays;
  const clientLicensedAgents =
    clientScope === 'tenant'
      ? (myMembership?.licensedAgents || settings.defaultCallCenterAgents || 5)
      : undefined;
  const clientEstimatedUsd = computeSuggestedUsd(
    clientScope,
    clientPlanType,
    settings,
    myMembership || undefined,
    Math.max(1, Math.floor(reqWeeks || 1)),
    clientLicensedAgents
  );
  const clientWeeklyUnitUsd = computeSuggestedUsd(
    clientScope,
    'weekly_extension',
    settings,
    myMembership || undefined,
    1,
    clientLicensedAgents
  );

  const clientProjectedExpiry = useMemo(() => {
    const now = Date.now();
    const curExp = myMembership?.expiresAt ? Date.parse(myMembership.expiresAt) : NaN;
    const base = !isNaN(curExp) && curExp > now ? curExp : now;
    return new Date(base + clientDaysToAdd * 86400000).toISOString();
  }, [myMembership?.expiresAt, clientDaysToAdd]);

  // Admin statistics & helpers
  const pendingRequests = useMemo(
    () => requests.filter((r) => r.status === 'pending'),
    [requests]
  );

  const nonAdminStandaloneUsers = useMemo(
    () => users.filter((u) => !(u.role === 'admin' && !u.tenantId)),
    [users]
  );

  const standaloneBillableUsers = useMemo(
    () => nonAdminStandaloneUsers.filter((u) => !u.tenantId || u.membership?.independent),
    [nonAdminStandaloneUsers]
  );

  const activeAgentsByTenant = useMemo(() => {
    const map = new Map<string, number>();
    for (const u of users) {
      if (u.tenantId && !(u.role === 'admin' && !u.tenantId)) {
        map.set(u.tenantId, (map.get(u.tenantId) || 0) + 1);
      }
    }
    return map;
  }, [users]);

  const adminStats = useMemo(() => {
    const allEff: EffectiveMembershipStatus[] = [
      ...tenants.map((t) => t.effectiveMembership).filter(Boolean) as EffectiveMembershipStatus[],
      ...standaloneBillableUsers
        .map((u) => u.effectiveMembership)
        .filter(Boolean) as EffectiveMembershipStatus[],
    ];
    const totalRevenueUsd = allEff.reduce((sum, e) => sum + (Number(e.totalPaidUsd) || 0), 0);
    return {
      activeCount: allEff.filter((e) => e.status === 'active').length,
      expiringSoonCount: allEff.filter((e) => e.status === 'active' && e.remainingDays <= 3).length,
      inactiveCount: allEff.filter((e) => e.status === 'unactivated' || e.status === 'expired' || e.status === 'suspended').length,
      pendingCount: pendingRequests.length,
      totalRevenueUsd: Math.round(totalRevenueUsd * 100) / 100,
    };
  }, [tenants, standaloneBillableUsers, pendingRequests]);

  // Consolidated chronological payment movements across all accounts
  const allPaymentMovements = useMemo(() => {
    const rows: Array<{
      id: string;
      timestamp: string;
      targetType: 'tenant' | 'user';
      targetName: string;
      action: string;
      amountPaid: number;
      licensedAgents?: number;
      paymentMethod?: string;
      reference?: string;
      performedBy: string;
      notes?: string;
    }> = [];

    for (const t of tenants) {
      const hist = t.effectiveMembership?.history || t.membership?.history || [];
      for (const h of hist) {
        if (typeof h.amountPaid === 'number' && h.action !== 'demo_1_day') {
          rows.push({
            id: `${t.id}-${h.id}`,
            timestamp: h.timestamp,
            targetType: 'tenant',
            targetName: t.name,
            action: h.action,
            amountPaid: h.amountPaid,
            licensedAgents: h.licensedAgents,
            paymentMethod: h.paymentMethod,
            reference: h.reference,
            performedBy: h.performedBy,
            notes: h.notes,
          });
        }
      }
    }

    for (const u of standaloneBillableUsers) {
      const hist = u.effectiveMembership?.history || u.membership?.history || [];
      for (const h of hist) {
        if (typeof h.amountPaid === 'number' && h.action !== 'demo_1_day') {
          rows.push({
            id: `${u.id}-${h.id}`,
            timestamp: h.timestamp,
            targetType: 'user',
            targetName: u.name,
            action: h.action,
            amountPaid: h.amountPaid,
            paymentMethod: h.paymentMethod,
            reference: h.reference,
            performedBy: h.performedBy,
            notes: h.notes,
          });
        }
      }
    }

    return rows.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  }, [tenants, standaloneBillableUsers]);

  const openActionModal = (params: {
    mode: ActionModalState['mode'];
    targetType: 'tenant' | 'user';
    targetId: string;
    targetName: string;
    effective?: EffectiveMembershipStatus;
    initialWeeks?: number;
    defaultAgents?: number;
    request?: MembershipRenewalRequest;
  }) => {
    const weeks = params.initialWeeks || params.request?.weeksCount || 1;
    const agents =
      params.defaultAgents ??
      params.request?.licensedAgents ??
      params.effective?.licensedAgents ??
      settings.defaultCallCenterAgents ??
      5;

    setModalWeeks(weeks);
    setModalAgents(Math.max(1, agents));
    setModalPriceManuallyEdited(false);
    setModalSaveAsCustomRate(false);
    setModalMethod(params.request?.paymentMethod || 'transferencia');
    setModalReference(params.request?.reference || '');
    setModalNotes('');

    if (params.mode === 'initial_month') {
      const suggested = computeSuggestedUsd(params.targetType, 'initial_month', settings, params.effective, 1, agents);
      setModalPriceStr(String(suggested));
    } else if (params.mode === 'weekly_extension') {
      const suggested = computeSuggestedUsd(params.targetType, 'weekly_extension', settings, params.effective, weeks, agents);
      setModalPriceStr(String(suggested));
    } else if (params.mode === 'approve_request' && params.request) {
      setModalPriceStr(String(params.request.estimatedPriceUsd));
    } else if (params.mode === 'plan_update') {
      setModalCustomMonthStr(
        typeof params.effective?.customMonthPriceUsd === 'number' ? String(params.effective.customMonthPriceUsd) : ''
      );
      setModalCustomWeeklyStr(
        typeof params.effective?.customWeeklyPriceUsd === 'number' ? String(params.effective.customWeeklyPriceUsd) : ''
      );
    }

    setActionModal({
      mode: params.mode,
      targetType: params.targetType,
      targetId: params.targetId,
      targetName: params.targetName,
      effective: params.effective,
      request: params.request,
    });
  };

  const handleModalWeeksOrAgentsChange = (nextWeeks: number, nextAgents: number) => {
    setModalWeeks(nextWeeks);
    setModalAgents(nextAgents);
    if (!actionModal || modalPriceManuallyEdited) return;
    if (actionModal.mode === 'initial_month') {
      const suggested = computeSuggestedUsd(actionModal.targetType, 'initial_month', settings, actionModal.effective, 1, nextAgents);
      setModalPriceStr(String(suggested));
    } else if (actionModal.mode === 'weekly_extension') {
      const suggested = computeSuggestedUsd(actionModal.targetType, 'weekly_extension', settings, actionModal.effective, nextWeeks, nextAgents);
      setModalPriceStr(String(suggested));
    }
  };

  const handleAdminActivate = async (
    targetType: 'tenant' | 'user',
    targetId: string,
    action: 'initial_month' | 'demo_1_day' | 'weekly_extension' | 'suspend' | 'reactivate' | 'plan_update' | 'reset',
    weeksCount?: number,
    extra?: {
      paymentMethod?: string;
      reference?: string;
      notes?: string;
      amountPaid?: number;
      licensedAgents?: number;
      customMonthPriceUsd?: number;
      customWeeklyPriceUsd?: number;
      clearCustomPrices?: boolean;
    }
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
        return false;
      }
      notify(data.message || 'Membresía actualizada.', 'success');
      await onRefresh();
      return true;
    } catch (err: any) {
      notify(err?.message || 'Error de conexión.', 'error');
      return false;
    } finally {
      setBusyKey(null);
    }
  };

  const handleSubmitActionModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actionModal) return;

    if (actionModal.mode === 'approve_request' && actionModal.request) {
      const parsedAmount = Number(modalPriceStr);
      if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
        notify('Ingresa un monto válido en USD (0 o mayor).', 'error');
        return;
      }
      const reqItem = actionModal.request;
      setActionModal(null);
      await handleResolveRequest(reqItem.id, 'approve', {
        amountPaid: parsedAmount,
        licensedAgents: reqItem.targetType === 'tenant' ? modalAgents : undefined,
      });
      return;
    }

    if (actionModal.mode === 'plan_update') {
      const customMonth = modalCustomMonthStr.trim() === '' ? undefined : Number(modalCustomMonthStr);
      const customWeekly = modalCustomWeeklyStr.trim() === '' ? undefined : Number(modalCustomWeeklyStr);
      if (customMonth !== undefined && (!Number.isFinite(customMonth) || customMonth < 0)) {
        notify('El precio mensual personalizado debe ser válido.', 'error');
        return;
      }
      if (customWeekly !== undefined && (!Number.isFinite(customWeekly) || customWeekly < 0)) {
        notify('El precio semanal personalizado debe ser válido.', 'error');
        return;
      }
      const clearCustom = modalCustomMonthStr.trim() === '' && modalCustomWeeklyStr.trim() === '';
      const target = actionModal;
      setActionModal(null);
      await handleAdminActivate(target.targetType, target.targetId, 'plan_update', undefined, {
        licensedAgents: target.targetType === 'tenant' ? modalAgents : undefined,
        customMonthPriceUsd: customMonth,
        customWeeklyPriceUsd: customWeekly,
        clearCustomPrices: clearCustom,
        notes: modalNotes.trim() || undefined,
      });
      return;
    }

    const parsedAmount = Number(modalPriceStr);
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
      notify('Ingresa un precio válido en USD (0 o mayor).', 'error');
      return;
    }

    const target = actionModal;
    setActionModal(null);

    if (target.mode === 'initial_month') {
      await handleAdminActivate(target.targetType, target.targetId, 'initial_month', undefined, {
        amountPaid: parsedAmount,
        licensedAgents: target.targetType === 'tenant' ? modalAgents : undefined,
        customMonthPriceUsd: modalSaveAsCustomRate ? parsedAmount : undefined,
        paymentMethod: modalMethod,
        reference: modalReference.trim(),
        notes: modalNotes.trim() || undefined,
      });
    } else if (target.mode === 'weekly_extension') {
      await handleAdminActivate(target.targetType, target.targetId, 'weekly_extension', modalWeeks, {
        amountPaid: parsedAmount,
        licensedAgents: target.targetType === 'tenant' ? modalAgents : undefined,
        customWeeklyPriceUsd:
          modalSaveAsCustomRate && modalWeeks > 0
            ? Math.round((parsedAmount / modalWeeks) * 100) / 100
            : undefined,
        paymentMethod: modalMethod,
        reference: modalReference.trim(),
        notes: modalNotes.trim() || undefined,
      });
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

  const handleResolveRequest = async (
    requestId: string,
    decision: 'approve' | 'reject',
    extra?: { amountPaid?: number; licensedAgents?: number }
  ) => {
    setBusyKey(`req:${requestId}:${decision}`);
    try {
      const res = await fetch(`/api/membership/requests/${encodeURIComponent(requestId)}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          amountPaid: extra?.amountPaid,
          licensedAgents: extra?.licensedAgents,
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
                      : myMembership?.status === 'expired' && !clientInitialDone && myMembership?.demoUsed
                      ? 'Demo de Prueba Finalizado — Activa tu 1er Mes Principal'
                      : myMembership?.status === 'expired'
                      ? 'Membresía Vencida — Renovación Requerida'
                      : 'Activación Inicial Requerida (Membresía 1 Mes)'}
                  </h2>
                  <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                    {myMembership?.status === 'suspended'
                      ? 'Tu acceso operativo ha sido pausado temporalmente por el Administrador. Comunícate con soporte o verifica tu renovación.'
                      : !clientInitialDone && myMembership?.demoUsed
                      ? `Tu período Demo de ${settings.demoDays || 1} día(s) ha terminado. Para continuar usando el sistema, solicita o activa tu Membresía Principal de 1 Mes (${settings.initialMonthDays} días). Luego podrás renovar por 1 semana en adelante.`
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
                  Cobertura:{' '}
                  <strong className="text-slate-200">
                    {clientScope === 'tenant'
                      ? `Plan Call Center (${myMembership?.targetName}) • ${myMembership?.activeAgentsCount ?? 0} / ${clientLicensedAgents} agentes`
                      : `Cuenta Individual (${myMembership?.targetName || currentUser?.name})`}
                  </strong>
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
                ) : myMembership?.isDemo && myMembership?.status === 'active' ? (
                  <>
                    <Sparkles className="w-4 h-4 text-violet-400" />
                    <span className="text-violet-300">Demo Activo ({settings.demoDays || 1}d)</span>
                  </>
                ) : (
                  <>
                    <Lock className="w-4 h-4 text-amber-400" />
                    <span className="text-amber-300">Pendiente (1 Mes)</span>
                  </>
                )}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                {clientInitialDone
                  ? formatDateTimeEs(myMembership?.initialActivatedAt)
                  : myMembership?.isDemo && myMembership?.status === 'active'
                  ? 'Prueba temporal vigente'
                  : 'Obligatorio al iniciar'}
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
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                {clientScope === 'tenant' ? 'Agentes del Plan' : 'Semanas Renovadas'}
              </div>
              <div className="text-xl font-black font-mono text-purple-300 mt-0.5">
                {clientScope === 'tenant'
                  ? `${myMembership?.activeAgentsCount ?? 0} / ${clientLicensedAgents}`
                  : `${myMembership?.totalWeeksAdded || 0} sem`}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                {clientScope === 'tenant'
                  ? `${myMembership?.totalWeeksAdded || 0} sem renovadas`
                  : clientInitialDone
                  ? 'Renovaciones por semana activas'
                  : 'Se habilita tras el 1er mes'}
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
                    <span className="text-sm font-black text-white">
                      {clientScope === 'tenant'
                        ? `Plan Call Center (${clientLicensedAgents} agentes) — 1 Mes`
                        : 'Membresía Principal — 1 Mes'}
                    </span>
                    <span className="text-base font-mono font-black text-emerald-400">
                      ${clientEstimatedUsd} USD
                    </span>
                  </div>
                  <p className="text-xs text-slate-300">
                    Activación inicial obligatoria de <strong>{settings.initialMonthDays} días completos</strong>.
                    {clientScope === 'tenant'
                      ? ` Incluye licencia para hasta ${clientLicensedAgents} agente(s) en tu Call Center.`
                      : ' Incluye acceso al marcador, extensiones, audios y recepción OTP.'}
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 opacity-70 flex items-start gap-2.5">
                  <Lock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div className="text-[11px] text-slate-400 leading-relaxed">
                    <strong className="text-amber-300 block">Planes por Semana (1 semana en adelante):</strong>
                    Las renovaciones semanales (${clientWeeklyUnitUsd} USD / {settings.weekDays} días) se desbloquean automáticamente después de activar tu primer mes principal.
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-slate-400">
                  Ya completaste tu Membresía Principal de 1 Mes. Ahora puedes sumar tiempo contando{' '}
                  <strong className="text-white">desde 1 semana en adelante</strong> ({settings.weekDays} días por semana):
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
                      <div className="text-[10px] font-mono text-slate-400">${Math.round(w * clientWeeklyUnitUsd * 100) / 100}</div>
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
                        Ref: {r.reference} • ${r.approvedAmountUsd ?? r.estimatedPriceUsd} USD • {formatDateTimeEs(r.createdAt)}
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
                      {typeof h.amountPaid === 'number' && (
                        <span className="text-[11px] font-mono font-bold text-amber-300 shrink-0">
                          {formatUsd(h.amountPaid)}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono mt-1">
                      +{h.daysAdded} días • Vence: {formatDateTimeEs(h.newExpiresAt)} • {formatDateTimeEs(h.timestamp)}
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

  const ledgerAccounts = [
    ...tenants.map((t) => ({
      id: t.id,
      type: 'tenant' as const,
      name: t.name,
      sublabel: `${t.code} • Ext ${t.extensionStart}-${t.extensionEnd}`,
      eff: t.effectiveMembership,
      licensedAgents: t.effectiveMembership?.licensedAgents ?? t.licensedAgents ?? settings.defaultCallCenterAgents ?? 5,
      activeAgents: t.effectiveMembership?.activeAgentsCount ?? activeAgentsByTenant.get(t.id) ?? 0,
    })),
    ...standaloneBillableUsers.map((u) => ({
      id: u.id,
      type: 'user' as const,
      name: u.name,
      sublabel: `@${u.username || u.email}`,
      eff: u.effectiveMembership,
      licensedAgents: undefined,
      activeAgents: undefined,
    })),
  ].filter((acc) => {
    const q = searchTerm.toLowerCase();
    const matchesSearch = !q || acc.name.toLowerCase().includes(q) || acc.sublabel.toLowerCase().includes(q);
    if (!matchesSearch) return false;
    if (statusFilter === 'all') return true;
    return (acc.eff?.status || 'unactivated') === statusFilter;
  });

  const unactivatedCount =
    tenants.filter((t) => !t.effectiveMembership?.initialMonthActivated).length +
    standaloneBillableUsers.filter((u) => !u.effectiveMembership?.initialMonthActivated).length;

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
                <span>Control de Membresías, Precios & Planes Call Center</span>
                <span className={`text-[10px] font-mono px-2.5 py-0.5 rounded-full border ${settings.enforceMembershipSystem ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>
                  {settings.enforceMembershipSystem ? 'CONTROL ACTIVO' : 'MODO LIBRE'}
                </span>
              </h1>
              <p className="text-xs text-slate-300 mt-1">
                Precio a voluntad por cliente, historial exacto de cobros y <strong className="text-amber-300">Plan Call Center por cantidad de agentes</strong> (${settings.callCenterPerAgentMonthPriceUsd ?? 25}/ag/mes · ${settings.callCenterPerAgentWeekPriceUsd ?? 8}/ag/sem).
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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-5">
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
          <div className="p-3.5 rounded-xl bg-slate-950/80 border border-amber-500/30 col-span-2 sm:col-span-1">
            <div className="text-[10px] uppercase text-amber-300 font-semibold">Total Cobrado</div>
            <div className="text-2xl font-black font-mono text-amber-400 mt-0.5">${adminStats.totalRevenueUsd.toLocaleString('en-US')}</div>
            <div className="text-[10px] text-slate-500">Activaciones y renovaciones</div>
          </div>
        </div>
      </div>

      {/* Sub-navigation + Filters */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-800 pb-3">
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
            onClick={() => setAdminScopeTab('ledger')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
              adminScopeTab === 'ledger'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'text-slate-400 hover:text-white bg-slate-900 border border-slate-800'
            }`}
          >
            <Receipt className="w-3.5 h-3.5" />
            <span>Registro de Precios ({ledgerAccounts.length})</span>
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
                ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40'
                : 'text-slate-400 hover:text-white bg-slate-900 border border-slate-800'
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Reglas & Tarifas</span>
          </button>
        </div>

        {(adminScopeTab === 'tenants' || adminScopeTab === 'users' || adminScopeTab === 'ledger') && (
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

      {/* TENANTS LIST (CALL CENTER PLAN BY AGENT COUNT) */}
      {adminScopeTab === 'tenants' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredTenants.map((tenant) => {
            const eff = tenant.effectiveMembership;
            const badge = getMembershipBadge(eff);
            const hasInitial = Boolean(eff?.initialMonthActivated);
            const licensedAgents = eff?.licensedAgents ?? tenant.licensedAgents ?? settings.defaultCallCenterAgents ?? 5;
            const activeAgents = eff?.activeAgentsCount ?? activeAgentsByTenant.get(tenant.id) ?? 0;
            const suggestedMonth = computeSuggestedUsd('tenant', 'initial_month', settings, eff, 1, licensedAgents);
            const suggestedWeek = computeSuggestedUsd('tenant', 'weekly_extension', settings, eff, 1, licensedAgents);
            const atSeatLimit = licensedAgents > 0 && activeAgents >= licensedAgents;

            return (
              <div key={tenant.id} className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3.5 shadow-lg">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
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

                {/* Call Center Agent Seat Plan Bar */}
                <div className="p-3 rounded-xl bg-indigo-950/30 border border-indigo-500/30 space-y-1.5">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-bold text-indigo-200 flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Plan Call Center: {activeAgents} / {licensedAgents} agentes</span>
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        openActionModal({
                          mode: 'plan_update',
                          targetType: 'tenant',
                          targetId: tenant.id,
                          targetName: tenant.name,
                          effective: eff,
                          defaultAgents: licensedAgents,
                        })
                      }
                      className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-200 border border-indigo-500/40 flex items-center gap-1 cursor-pointer"
                    >
                      <Sliders className="w-3 h-3" />
                      <span>Agentes / Tarifa</span>
                    </button>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-slate-900 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${atSeatLimit ? 'bg-amber-400' : 'bg-indigo-400'}`}
                      style={{ width: `${Math.min(100, Math.round((activeAgents / Math.max(1, licensedAgents)) * 100))}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                    <span>
                      Tarifa {licensedAgents} ag.: <strong className="text-emerald-300">${suggestedMonth}/mes</strong> · <strong className="text-cyan-300">${suggestedWeek}/sem</strong>
                    </span>
                    {typeof eff?.customMonthPriceUsd === 'number' && (
                      <span className="text-amber-300 font-bold">Precio Personalizado</span>
                    )}
                  </div>
                </div>

                {/* Activation Price & Expiry Summary */}
                <div className="grid grid-cols-3 gap-2 p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-[11px]">
                  <div>
                    <span className="text-slate-500 block text-[10px]">Activación 1er Mes:</span>
                    <span className="font-mono font-bold text-amber-300">
                      {typeof eff?.initialActivationPriceUsd === 'number'
                        ? formatUsd(eff.initialActivationPriceUsd)
                        : hasInitial ? '$0 USD' : 'Pendiente'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Último / Total Cobro:</span>
                    <span className="font-mono font-bold text-emerald-300">
                      {typeof eff?.lastPaidAmountUsd === 'number' ? `$${eff.lastPaidAmountUsd}` : '—'}
                      <span className="text-slate-500 font-normal"> / ${eff?.totalPaidUsd || 0}</span>
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Vencimiento:</span>
                    <span className="font-mono text-cyan-300 font-semibold">
                      {formatDateTimeEs(eff?.expiresAt)}
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  {!hasInitial ? (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={busyKey !== null}
                          onClick={() =>
                            openActionModal({
                              mode: 'initial_month',
                              targetType: 'tenant',
                              targetId: tenant.id,
                              targetName: tenant.name,
                              effective: eff,
                              defaultAgents: licensedAgents,
                            })
                          }
                          className="flex-1 py-2 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                          <Unlock className="w-3.5 h-3.5" />
                          <span>Activar 1er Mes (Precio a Voluntad)</span>
                        </button>
                        <button
                          type="button"
                          disabled={busyKey !== null || (eff?.isDemo && eff?.status === 'active')}
                          onClick={() => handleAdminActivate('tenant', tenant.id, 'demo_1_day', undefined, { licensedAgents })}
                          title={
                            eff?.isDemo && eff?.status === 'active'
                              ? 'Ya tiene un Demo activo en curso'
                              : `Otorgar Demo de prueba por ${settings.demoDays || 1} día(s) (24h)`
                          }
                          className="py-2 px-3 rounded-xl bg-violet-500/20 hover:bg-violet-500/30 text-violet-200 border border-violet-500/40 font-black text-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Sparkles className="w-3.5 h-3.5 text-violet-300" />
                          <span>
                            {eff?.isDemo && eff?.status === 'active'
                              ? 'Demo Activo'
                              : `Dar Demo (${settings.demoDays || 1}d)`}
                          </span>
                        </button>
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-slate-500 px-1">
                        <span className="flex items-center gap-1">
                          <Lock className="w-3 h-3 text-amber-400/70" />
                          <span>+Semanas bloqueado hasta activar 1er Mes Principal</span>
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {[1, 2, 3, 4].map((w) => (
                        <button
                          key={w}
                          type="button"
                          disabled={busyKey !== null}
                          onClick={() =>
                            openActionModal({
                              mode: 'weekly_extension',
                              targetType: 'tenant',
                              targetId: tenant.id,
                              targetName: tenant.name,
                              effective: eff,
                              initialWeeks: w,
                              defaultAgents: licensedAgents,
                            })
                          }
                          className="px-2.5 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 font-mono font-bold text-xs cursor-pointer disabled:opacity-50"
                          title={`Extender +${w} ${w === 1 ? 'semana' : 'semanas'} editando precio y agentes`}
                        >
                          +{w} Sem
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() =>
                          openActionModal({
                            mode: 'weekly_extension',
                            targetType: 'tenant',
                            targetId: tenant.id,
                            targetName: tenant.name,
                            effective: eff,
                            initialWeeks: 1,
                            defaultAgents: licensedAgents,
                          })
                        }
                        className="px-2.5 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-500/40 font-bold text-xs flex items-center gap-1 cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                        <span>N Sem / Precio</span>
                      </button>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-1 border-t border-slate-800/80 text-[11px]">
                    <button
                      type="button"
                      onClick={() =>
                        setHistoryModal({
                          title: `Historial de Precios y Activaciones: ${tenant.name}`,
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
                      ) : hasInitial || eff?.isDemo ? (
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

                      {(hasInitial || eff?.isDemo || eff?.demoUsed) && (
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
                      Hereda membresía de su Call Center: <strong className="text-white">{parentTenant?.name || user.tenantId}</strong>. Adminístrala en Grupos Call Center.
                    </div>
                  ) : (
                    <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-[11px] space-y-1">
                      <div className="flex justify-between">
                        <span className="text-slate-400">Precio Activación (1er Mes):</span>
                        <span className="font-mono text-amber-300 font-bold">
                          {typeof eff?.initialActivationPriceUsd === 'number'
                            ? formatUsd(eff.initialActivationPriceUsd)
                            : hasInitial ? '$0 USD' : 'Pendiente'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Último / Total Cobrado:</span>
                        <span className="font-mono text-emerald-300 font-bold">
                          {typeof eff?.lastPaidAmountUsd === 'number' ? `$${eff.lastPaidAmountUsd}` : '—'}
                          <span className="text-slate-500 font-normal"> / ${eff?.totalPaidUsd || 0} USD</span>
                        </span>
                      </div>
                      {(typeof eff?.customMonthPriceUsd === 'number' || typeof eff?.customWeeklyPriceUsd === 'number') && (
                        <div className="flex justify-between text-[10px] text-amber-200 bg-amber-500/10 px-1.5 py-0.5 rounded">
                          <span>Tarifa acordada:</span>
                          <span className="font-mono font-bold">
                            {typeof eff?.customMonthPriceUsd === 'number' ? `Mes $${eff.customMonthPriceUsd}` : ''}
                            {typeof eff?.customMonthPriceUsd === 'number' && typeof eff?.customWeeklyPriceUsd === 'number' ? ' · ' : ''}
                            {typeof eff?.customWeeklyPriceUsd === 'number' ? `Sem $${eff.customWeeklyPriceUsd}` : ''}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-slate-400">Vence ({eff?.totalWeeksAdded || 0} sem):</span>
                        <span className="font-mono text-cyan-300">{formatDateTimeEs(eff?.expiresAt)}</span>
                      </div>
                    </div>
                  )}
                </div>

                {!belongsToTenant && (
                  <div className="space-y-2 pt-2 border-t border-slate-800">
                    {!hasInitial ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          disabled={busyKey !== null}
                          onClick={() =>
                            openActionModal({
                              mode: 'initial_month',
                              targetType: 'user',
                              targetId: user.id,
                              targetName: user.name,
                              effective: eff,
                            })
                          }
                          className="flex-1 py-2 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                          <Unlock className="w-3.5 h-3.5" />
                          <span>1er Mes (Precio)</span>
                        </button>
                        <button
                          type="button"
                          disabled={busyKey !== null || (eff?.isDemo && eff?.status === 'active')}
                          onClick={() => handleAdminActivate('user', user.id, 'demo_1_day')}
                          title={
                            eff?.isDemo && eff?.status === 'active'
                              ? 'Ya tiene un Demo activo'
                              : `Otorgar Demo de prueba (${settings.demoDays || 1} día)`
                          }
                          className="py-2 px-3 rounded-xl bg-violet-500/20 hover:bg-violet-500/30 text-violet-200 border border-violet-500/40 font-black text-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Sparkles className="w-3.5 h-3.5 text-violet-300" />
                          <span>
                            {eff?.isDemo && eff?.status === 'active'
                              ? 'Demo Activo'
                              : `Demo (${settings.demoDays || 1}d)`}
                          </span>
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {[1, 2, 4].map((w) => (
                          <button
                            key={w}
                            type="button"
                            disabled={busyKey !== null}
                            onClick={() =>
                              openActionModal({
                                mode: 'weekly_extension',
                                targetType: 'user',
                                targetId: user.id,
                                targetName: user.name,
                                effective: eff,
                                initialWeeks: w,
                              })
                            }
                            className="px-2 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 font-mono font-bold text-[11px] cursor-pointer"
                          >
                            +{w} Sem
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() =>
                            openActionModal({
                              mode: 'weekly_extension',
                              targetType: 'user',
                              targetId: user.id,
                              targetName: user.name,
                              effective: eff,
                              initialWeeks: 1,
                            })
                          }
                          className="px-2 py-1 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-500/40 font-bold text-[11px] cursor-pointer"
                        >
                          +N Sem
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            openActionModal({
                              mode: 'plan_update',
                              targetType: 'user',
                              targetId: user.id,
                              targetName: user.name,
                              effective: eff,
                            })
                          }
                          className="px-2 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 font-bold text-[11px] cursor-pointer"
                          title="Fijar tarifa personalizada"
                        >
                          Tarifa
                        </button>
                      </div>
                    )}

                    <div className="flex items-center justify-between text-[11px] pt-1">
                      <button
                        type="button"
                        onClick={() =>
                          setHistoryModal({
                            title: `Historial de Precios: ${user.name}`,
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
                        ) : hasInitial || eff?.isDemo ? (
                          <button
                            type="button"
                            onClick={() => handleAdminActivate('user', user.id, 'suspend')}
                            className="text-rose-400 hover:text-rose-300 font-semibold cursor-pointer"
                          >
                            Suspender
                          </button>
                        ) : null}

                        {(hasInitial || eff?.isDemo || eff?.demoUsed) && (
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

      {/* PRICE LEDGER TAB (CLIENT ACTIVATION PRICE AUDIT) */}
      {adminScopeTab === 'ledger' && (
        <div className="space-y-6">
          <div className="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden shadow-xl">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between flex-wrap gap-2">
              <div>
                <h3 className="text-sm font-black text-white flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-amber-400" />
                  <span>Registro de Precio de Activación por Cliente y Call Center</span>
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Consulta exactamente qué precio de activación inicial, tarifa acordada y total cobrado tiene cada cuenta.
                </p>
              </div>
              <span className="text-xs font-mono font-bold text-amber-300 bg-amber-500/15 border border-amber-500/30 px-3 py-1 rounded-xl">
                Total Acumulado: ${adminStats.totalRevenueUsd.toLocaleString('en-US')} USD
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="px-4 py-3">Cliente / Call Center</th>
                    <th className="px-4 py-3">Plan & Agentes</th>
                    <th className="px-4 py-3">Estado</th>
                    <th className="px-4 py-3">Precio Activación (1er Mes)</th>
                    <th className="px-4 py-3">Tarifa Fija Acordada</th>
                    <th className="px-4 py-3">Último Cobro</th>
                    <th className="px-4 py-3">Total Pagado</th>
                    <th className="px-4 py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {ledgerAccounts.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                        No hay cuentas que coincidan con el filtro.
                      </td>
                    </tr>
                  ) : (
                    ledgerAccounts.map((acc) => {
                      const badge = getMembershipBadge(acc.eff);
                      const hasCustom =
                        typeof acc.eff?.customMonthPriceUsd === 'number' ||
                        typeof acc.eff?.customWeeklyPriceUsd === 'number';
                      return (
                        <tr key={`${acc.type}:${acc.id}`} className="hover:bg-slate-800/30">
                          <td className="px-4 py-3">
                            <div className="font-bold text-white flex items-center gap-1.5">
                              {acc.type === 'tenant' ? (
                                <Building2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                              ) : (
                                <UserIcon className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                              )}
                              <span>{acc.name}</span>
                            </div>
                            <div className="text-[10px] font-mono text-slate-400">{acc.sublabel}</div>
                          </td>
                          <td className="px-4 py-3 font-mono text-[11px]">
                            {acc.type === 'tenant' ? (
                              <span className="px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 font-bold">
                                Call Center • {acc.activeAgents}/{acc.licensedAgents} ag.
                              </span>
                            ) : (
                              <span className="text-slate-300">Individual</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${badge.classes}`}>
                              {badge.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono font-black text-amber-300">
                            {typeof acc.eff?.initialActivationPriceUsd === 'number'
                              ? formatUsd(acc.eff.initialActivationPriceUsd)
                              : acc.eff?.initialMonthActivated ? '$0 USD' : '—'}
                          </td>
                          <td className="px-4 py-3 font-mono text-[11px]">
                            {hasCustom ? (
                              <span className="text-amber-200 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded">
                                {typeof acc.eff?.customMonthPriceUsd === 'number' ? `M:$${acc.eff.customMonthPriceUsd}` : ''}
                                {typeof acc.eff?.customMonthPriceUsd === 'number' && typeof acc.eff?.customWeeklyPriceUsd === 'number' ? ' ' : ''}
                                {typeof acc.eff?.customWeeklyPriceUsd === 'number' ? `S:$${acc.eff.customWeeklyPriceUsd}` : ''}
                              </span>
                            ) : (
                              <span className="text-slate-500">Estándar / Variable</span>
                            )}
                          </td>
                          <td className="px-4 py-3 font-mono text-emerald-300 font-bold">
                            {typeof acc.eff?.lastPaidAmountUsd === 'number'
                              ? formatUsd(acc.eff.lastPaidAmountUsd)
                              : '—'}
                          </td>
                          <td className="px-4 py-3 font-mono text-white font-black">
                            {formatUsd(acc.eff?.totalPaidUsd || 0)}
                          </td>
                          <td className="px-4 py-3 text-right space-x-1.5 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() =>
                                openActionModal({
                                  mode: 'plan_update',
                                  targetType: acc.type,
                                  targetId: acc.id,
                                  targetName: acc.name,
                                  effective: acc.eff,
                                  defaultAgents: acc.licensedAgents,
                                })
                              }
                              className="px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-200 border border-indigo-500/30 text-[11px] font-bold cursor-pointer"
                            >
                              Editar Plan
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setHistoryModal({
                                  title: `Historial de Precios: ${acc.name}`,
                                  history: acc.eff?.history || [],
                                })
                              }
                              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-bold cursor-pointer"
                            >
                              Historial ({acc.eff?.history?.length || 0})
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Chronological Payment Log */}
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-3">
            <h4 className="text-sm font-bold text-white flex items-center gap-2">
              <History className="w-4 h-4 text-emerald-400" />
              <span>Bitácora Cronológica de Cobros y Activaciones ({allPaymentMovements.length})</span>
            </h4>
            {allPaymentMovements.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">No hay cobros de activación registrados todavía.</p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {allPaymentMovements.map((m) => (
                  <div
                    key={m.id}
                    className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                  >
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-white">{m.targetName}</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                          {m.targetType === 'tenant' ? 'Call Center' : 'Individual'}
                        </span>
                        {m.licensedAgents && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                            {m.licensedAgents} agentes
                          </span>
                        )}
                        <span className="text-emerald-300 font-semibold">{m.notes || m.action}</span>
                      </div>
                      <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                        {formatDateTimeEs(m.timestamp)} • Método: {m.paymentMethod || 'admin'}
                        {m.reference ? ` • Ref: ${m.reference}` : ''} • Por: {m.performedBy}
                      </div>
                    </div>
                    <span className="text-sm font-mono font-black text-amber-300 shrink-0">
                      {formatUsd(m.amountPaid)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
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
                      {r.targetType === 'tenant' ? `Call Center${r.licensedAgents ? ` (${r.licensedAgents} ag.)` : ''}` : 'Cliente Individual'}
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
                    Solicitó: @{r.requestedByUsername} • Método: {r.paymentMethod} • Ref: <strong className="text-white">{r.reference}</strong> • Monto: <strong className="text-amber-300">${r.approvedAmountUsd ?? r.estimatedPriceUsd} USD</strong>
                  </div>
                  {r.notes && <div className="text-xs text-slate-300">Nota: {r.notes}</div>}
                </div>

                {r.status === 'pending' ? (
                  <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    <button
                      type="button"
                      disabled={busyKey !== null}
                      onClick={() =>
                        openActionModal({
                          mode: 'approve_request',
                          targetType: r.targetType,
                          targetId: r.targetId,
                          targetName: r.targetName,
                          defaultAgents: r.licensedAgents,
                          request: r,
                        })
                      }
                      className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Aprobar (Editar Precio)</span>
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

      {/* GLOBAL SETTINGS (INDIVIDUAL + CALL CENTER AGENT PLAN) */}
      {adminScopeTab === 'settings' && (
        <form onSubmit={handleSaveSettings} className="space-y-6 max-w-4xl">
          <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              <span>Reglas Generales & Plan Individual</span>
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

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
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
                <label className="block text-slate-300 font-semibold mb-1">Días de Demo para Nuevos Clientes</label>
                <input
                  type="number"
                  min={1}
                  max={14}
                  value={settingsForm.demoDays ?? 1}
                  onChange={(e) => setSettingsForm({ ...settingsForm, demoDays: Math.max(1, Math.min(14, Number(e.target.value) || 1)) })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-violet-500/40 text-violet-300 font-mono font-bold"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Precio Base Individual 1er Mes ($ USD)</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={settingsForm.initialMonthPriceUsd}
                  onChange={(e) => setSettingsForm({ ...settingsForm, initialMonthPriceUsd: Math.max(0, Number(e.target.value) || 0) })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-emerald-300 font-mono font-bold"
                />
                <p className="text-[10px] text-slate-500 mt-1">Valor sugerido por defecto; siempre podrás cambiarlo a voluntad al activar.</p>
              </div>
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Precio Base Individual por Semana ($ USD)</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
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
          </div>

          {/* CALL CENTER AGENT-BASED PLAN CONFIGURATION */}
          <div className="p-6 rounded-2xl bg-slate-900 border border-indigo-500/40 space-y-4">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Building2 className="w-5 h-5 text-indigo-400" />
                <span>Plan Call Center (Calculado por Cantidad de Agentes)</span>
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Define el precio por agente para Call Centers. Al activar o renovar un Call Center, podrás ajustar su cantidad de agentes y también modificar el precio final a voluntad.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Base Mensual Fija ($ USD)</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={settingsForm.callCenterBasePriceUsd ?? 0}
                  onChange={(e) => setSettingsForm({ ...settingsForm, callCenterBasePriceUsd: Math.max(0, Number(e.target.value) || 0) })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono font-bold"
                />
                <span className="text-[10px] text-slate-500">0 = solo cobro por agente</span>
              </div>
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Mensual por Agente ($ USD)</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={settingsForm.callCenterPerAgentMonthPriceUsd ?? 25}
                  onChange={(e) => setSettingsForm({ ...settingsForm, callCenterPerAgentMonthPriceUsd: Math.max(0, Number(e.target.value) || 0) })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-indigo-500/40 text-emerald-300 font-mono font-bold"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Semanal por Agente ($ USD)</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={settingsForm.callCenterPerAgentWeekPriceUsd ?? 8}
                  onChange={(e) => setSettingsForm({ ...settingsForm, callCenterPerAgentWeekPriceUsd: Math.max(0, Number(e.target.value) || 0) })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-indigo-500/40 text-cyan-300 font-mono font-bold"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Agentes por Defecto</label>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={settingsForm.defaultCallCenterAgents ?? 5}
                  onChange={(e) => setSettingsForm({ ...settingsForm, defaultCallCenterAgents: Math.max(1, Math.floor(Number(e.target.value) || 5)) })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-amber-300 font-mono font-bold"
                />
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
              <div className="text-[11px] font-bold text-indigo-300 mb-2">Vista Previa de Precios por Tamaño de Call Center:</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs font-mono">
                {[5, 10, 20].map((ag) => {
                  const mUsd = Math.round(((settingsForm.callCenterBasePriceUsd ?? 0) + ag * (settingsForm.callCenterPerAgentMonthPriceUsd ?? 25)) * 100) / 100;
                  const wUsd = Math.round(ag * (settingsForm.callCenterPerAgentWeekPriceUsd ?? 8) * 100) / 100;
                  return (
                    <div key={ag} className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between">
                      <span className="text-slate-300 font-bold">{ag} agentes</span>
                      <span className="text-emerald-300">${mUsd}/mes · <span className="text-cyan-300">${wUsd}/sem</span></span>
                    </div>
                  );
                })}
              </div>
            </div>

            <button
              type="submit"
              disabled={busyKey === 'save-settings'}
              className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs cursor-pointer disabled:opacity-50"
            >
              {busyKey === 'save-settings' ? 'Guardando...' : 'Guardar Reglas y Tarifas'}
            </button>
          </div>
        </form>
      )}

      {/* MODAL: FLEXIBLE PRICE ACTIVATION / CALL CENTER AGENTS / CUSTOM RATE */}
      {actionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <form
            onSubmit={handleSubmitActionModal}
            className="bg-slate-900 border border-emerald-500/40 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="font-bold text-white text-base">
                  {actionModal.mode === 'initial_month'
                    ? `Activar 1er Mes (${settings.initialMonthDays} días)`
                    : actionModal.mode === 'weekly_extension'
                    ? 'Extender por Semanas (Precio a Voluntad)'
                    : actionModal.mode === 'approve_request'
                    ? 'Aprobar Solicitud y Confirmar Precio'
                    : 'Configurar Plan, Agentes y Tarifa Acordada'}
                </h3>
                <p className="text-xs text-slate-400">
                  {actionModal.targetName} • {actionModal.targetType === 'tenant' ? 'Call Center' : 'Cliente Individual'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActionModal(null)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              {actionModal.mode === 'weekly_extension' && (
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Cantidad de Semanas (1 en adelante)
                  </label>
                  <div className="flex items-center gap-1.5 mb-2">
                    {[1, 2, 3, 4].map((w) => (
                      <button
                        key={w}
                        type="button"
                        onClick={() => handleModalWeeksOrAgentsChange(w, modalAgents)}
                        className={`px-2.5 py-1 rounded-lg border font-mono font-bold text-xs cursor-pointer ${
                          modalWeeks === w
                            ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                            : 'bg-slate-950 border-slate-800 text-slate-400'
                        }`}
                      >
                        +{w} Sem
                      </button>
                    ))}
                  </div>
                  <input
                    type="number"
                    min={1}
                    max={104}
                    value={modalWeeks}
                    onChange={(e) => handleModalWeeksOrAgentsChange(Math.max(1, Math.min(104, Math.floor(Number(e.target.value) || 1))), modalAgents)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono font-bold text-base"
                  />
                  <p className="text-[11px] text-emerald-400 font-mono mt-1">
                    +{modalWeeks} {modalWeeks === 1 ? 'semana' : 'semanas'} = +{modalWeeks * settings.weekDays} días
                  </p>
                </div>
              )}

              {actionModal.targetType === 'tenant' && (
                <div className="p-3 rounded-xl bg-indigo-950/30 border border-indigo-500/30 space-y-1.5">
                  <label className="block text-indigo-200 font-bold">
                    Cantidad de Agentes del Call Center (Límite Contratado)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    value={modalAgents}
                    onChange={(e) => handleModalWeeksOrAgentsChange(modalWeeks, Math.max(1, Math.min(1000, Math.floor(Number(e.target.value) || 1))))}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-indigo-500/40 text-indigo-200 font-mono font-bold text-sm"
                  />
                  <p className="text-[10px] text-slate-400">
                    {actionModal.mode === 'weekly_extension'
                      ? `Referencia semanal: ${modalWeeks} sem × ${modalAgents} ag. × $${settings.callCenterPerAgentWeekPriceUsd ?? 8} = $${computeSuggestedUsd('tenant', 'weekly_extension', settings, actionModal.effective, modalWeeks, modalAgents)} USD`
                      : `Referencia mensual: Base $${settings.callCenterBasePriceUsd ?? 0} + ${modalAgents} ag. × $${settings.callCenterPerAgentMonthPriceUsd ?? 25} = $${computeSuggestedUsd('tenant', 'initial_month', settings, actionModal.effective, 1, modalAgents)} USD`}
                  </p>
                </div>
              )}

              {actionModal.mode === 'plan_update' ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-slate-300 font-semibold mb-1">
                        Precio Mensual Acordado ($ USD)
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        placeholder="Automático / Estándar"
                        value={modalCustomMonthStr}
                        onChange={(e) => setModalCustomMonthStr(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-amber-500/40 text-amber-300 font-mono font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-300 font-semibold mb-1">
                        Precio Semanal Acordado ($ USD)
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        placeholder="Automático / Estándar"
                        value={modalCustomWeeklyStr}
                        onChange={(e) => setModalCustomWeeklyStr(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-cyan-500/40 text-cyan-300 font-mono font-bold"
                      />
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-400">
                    Deja ambos precios vacíos si deseas usar el cálculo automático estándar.
                  </p>
                </div>
              ) : (
                <>
                  <div className="p-3 rounded-xl bg-amber-950/20 border border-amber-500/40 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <label className="block text-amber-200 font-bold">
                        Precio de Activación / Cobro ($ USD) — A Voluntad
                      </label>
                      {modalPriceManuallyEdited && (
                        <button
                          type="button"
                          onClick={() => {
                            setModalPriceManuallyEdited(false);
                            const sug =
                              actionModal.mode === 'approve_request' && actionModal.request
                                ? actionModal.request.estimatedPriceUsd
                                : computeSuggestedUsd(
                                    actionModal.targetType,
                                    actionModal.mode === 'weekly_extension' ? 'weekly_extension' : 'initial_month',
                                    settings,
                                    actionModal.effective,
                                    modalWeeks,
                                    modalAgents
                                  );
                            setModalPriceStr(String(sug));
                          }}
                          className="text-[10px] text-cyan-300 hover:underline cursor-pointer"
                        >
                          Restaurar sugerido
                        </button>
                      )}
                    </div>
                    <input
                      type="number"
                      min={0}
                      max={1000000}
                      step="0.01"
                      required
                      value={modalPriceStr}
                      onChange={(e) => {
                        setModalPriceManuallyEdited(true);
                        setModalPriceStr(e.target.value);
                      }}
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-amber-500/60 text-amber-300 font-mono font-black text-lg focus:outline-none focus:border-amber-400"
                    />
                    <p className="text-[10px] text-slate-400">
                      Puedes cobrar cualquier monto personalizado ($0, descuento, acuerdo especial o precio completo). Quedará registrado en el historial de este cliente.
                    </p>
                    {(actionModal.mode === 'initial_month' || actionModal.mode === 'weekly_extension') && (
                      <label className="flex items-center gap-2 text-[11px] text-slate-300 pt-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={modalSaveAsCustomRate}
                          onChange={(e) => setModalSaveAsCustomRate(e.target.checked)}
                          className="rounded border-slate-700 text-amber-500 bg-slate-950"
                        />
                        <span>Recordar este precio como tarifa fija acordada para este cliente</span>
                      </label>
                    )}
                  </div>

                  {actionModal.mode !== 'approve_request' && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-slate-400 mb-1">Método de Pago</label>
                        <select
                          value={modalMethod}
                          onChange={(e) => setModalMethod(e.target.value)}
                          className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white text-xs"
                        >
                          <option value="transferencia">Transferencia</option>
                          <option value="zelle">Zelle</option>
                          <option value="usdt_crypto">USDT / Cripto</option>
                          <option value="efectivo">Efectivo</option>
                          <option value="acuerdo_admin">Acuerdo Admin</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-slate-400 mb-1">Referencia</label>
                        <input
                          type="text"
                          placeholder="Opcional"
                          value={modalReference}
                          onChange={(e) => setModalReference(e.target.value)}
                          className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white text-xs font-mono"
                        />
                      </div>
                    </div>
                  )}
                </>
              )}

              {actionModal.mode !== 'approve_request' && (
                <div>
                  <label className="block text-slate-400 mb-1">Notas (Opcional)</label>
                  <input
                    type="text"
                    placeholder="Ej. Precio especial acordado / Renovación"
                    value={modalNotes}
                    onChange={(e) => setModalNotes(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white text-xs"
                  />
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setActionModal(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={busyKey !== null}
                className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs cursor-pointer disabled:opacity-50"
              >
                {actionModal.mode === 'initial_month'
                  ? `Activar 1er Mes ($${modalPriceStr || 0} USD)`
                  : actionModal.mode === 'weekly_extension'
                  ? `Aplicar +${modalWeeks} Sem ($${modalPriceStr || 0} USD)`
                  : actionModal.mode === 'approve_request'
                  ? `Aprobar por $${modalPriceStr || 0} USD`
                  : 'Guardar Plan y Tarifa'}
              </button>
            </div>
          </form>
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
                      {typeof h.amountPaid === 'number' && (
                        <span className="text-xs font-mono font-black text-amber-300 shrink-0">
                          {formatUsd(h.amountPaid)}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] font-mono text-slate-400">
                      +{h.daysAdded}d
                      {h.licensedAgents ? ` • ${h.licensedAgents} ag.` : ''}
                      {' '}• Vence: {formatDateTimeEs(h.newExpiresAt)} • Por: {h.performedBy}
                    </div>
                    <div className="text-[10px] font-mono text-slate-500">
                      {formatDateTimeEs(h.timestamp)}
                      {h.paymentMethod ? ` • Método: ${h.paymentMethod}` : ''}
                      {h.reference ? ` • Ref: ${h.reference}` : ''}
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
