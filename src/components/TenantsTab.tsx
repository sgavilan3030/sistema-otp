import React, { useState, useMemo } from 'react';
import {
  Building2,
  PhoneCall,
  Plus,
  Search,
  DollarSign,
  Clock,
  ShieldCheck,
  Server,
  Zap,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Check,
  FileCode,
  Users,
  Layers,
  ArrowRight,
  TrendingUp,
  CreditCard,
  Edit2,
  Trash2,
  Sparkles,
  RefreshCw,
  Sliders,
  PhoneForwarded,
  Info
} from 'lucide-react';
import { CallCenterTenant, TenantRechargeHistory, PjsipExtension, CarrierTrunk, SystemUser } from '../types';

interface TenantsTabProps {
  tenants: CallCenterTenant[];
  onAddTenant: (tenant: CallCenterTenant) => void;
  onUpdateTenant: (tenant: CallCenterTenant) => void;
  onDeleteTenant: (id: string) => void;
  onRechargeTenant: (tenantId: string, amountDollars: number, paymentMethod: 'zelle' | 'cash' | 'usdt_crypto' | 'bank_transfer' | 'credit_card', reference: string, notes?: string) => void;
  onAutoProvisionExtensions?: (tenant: CallCenterTenant) => void;
  extensions: PjsipExtension[];
  carriers: CarrierTrunk[];
  users?: SystemUser[];
  currentUser?: SystemUser;
  onSyncAsterisk?: () => void;
  onNavigateToManualDialer?: () => void;
}

export const TenantsTab: React.FC<TenantsTabProps> = ({
  tenants,
  onAddTenant,
  onUpdateTenant,
  onDeleteTenant,
  onRechargeTenant,
  onAutoProvisionExtensions,
  extensions,
  carriers,
  users = [],
  currentUser,
  onSyncAsterisk,
  onNavigateToManualDialer,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'groups' | 'ranges' | 'dialplan' | 'recharges'>('groups');
  const [searchTerm, setSearchTerm] = useState('');
  const [copiedContext, setCopiedContext] = useState<string | null>(null);

  // Modal states
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingTenant, setEditingTenant] = useState<CallCenterTenant | null>(null);
  const [rechargeModalTenant, setRechargeModalTenant] = useState<CallCenterTenant | null>(null);
  const [provisionConfirmTenant, setProvisionConfirmTenant] = useState<CallCenterTenant | null>(null);

  // Form states for Create/Edit Tenant
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    extensionStart: 1001,
    extensionEnd: 1020,
    maxConcurrentCalls: 10,
    carrierId: carriers[0]?.id || '',
    outboundCallerId: '+18005550199',
    outboundCallerName: 'CALL CENTER',
    dollarBalance: 50.0,
    ratePerMinute: 0.015,
    cutoffOnZero: true,
    contactName: '',
    contactPhone: '',
    contactEmail: '',
    notes: '',
  });

  // Recharge modal form
  const [rechargeAmount, setRechargeAmount] = useState<number>(50);
  const [rechargeMethod, setRechargeMethod] = useState<'zelle' | 'cash' | 'usdt_crypto' | 'bank_transfer' | 'credit_card'>('zelle');
  const [rechargeRef, setRechargeRef] = useState('');
  const [rechargeNotes, setRechargeNotes] = useState('');

  // Local storage for recharge history
  const [rechargeHistory, setRechargeHistory] = useState<TenantRechargeHistory[]>(() => {
    try {
      const saved = localStorage.getItem('ast20_tenant_recharges');
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return [
      {
        id: 'rec-1',
        tenantId: 'tenant-alpha',
        tenantName: 'Call Center Alpha (Ventas & OTP)',
        amountDollars: 100.0,
        minutesAdded: 6666,
        paymentMethod: 'zelle',
        reference: 'ZLL-94810294',
        timestamp: '2026-10-25 14:32:00',
        notes: 'Recarga inicial mensual para 20 operadores',
      },
      {
        id: 'rec-2',
        tenantId: 'tenant-bpo',
        tenantName: 'BPO Solutions (Cobranzas & Retención)',
        amountDollars: 180.0,
        minutesAdded: 12000,
        paymentMethod: 'bank_transfer',
        reference: 'TRF-5892019',
        timestamp: '2026-10-26 10:15:00',
        notes: 'Paquete de cobranzas con Carrier IP Directo',
      },
    ];
  });

  const saveRechargeHistory = (records: TenantRechargeHistory[]) => {
    setRechargeHistory(records);
    try {
      localStorage.setItem('ast20_tenant_recharges', JSON.stringify(records));
    } catch (_) {}
  };

  // Open Create Modal
  const handleOpenCreateModal = () => {
    // Propose an unallocated range
    const maxEnd = tenants.reduce((max, t) => Math.max(max, t.extensionEnd), 1000);
    const nextStart = Math.ceil((maxEnd + 1) / 100) * 100 + 1; // e.g. 1020 -> 1101 or 2001
    const proposedStart = nextStart > 9000 ? 5001 : nextStart;
    const proposedEnd = proposedStart + 19;

    setFormData({
      name: '',
      code: '',
      extensionStart: proposedStart,
      extensionEnd: proposedEnd,
      maxConcurrentCalls: 10,
      carrierId: carriers[0]?.id || '',
      outboundCallerId: '+18005550199',
      outboundCallerName: 'CALL CENTER',
      dollarBalance: 50.0,
      ratePerMinute: 0.015,
      cutoffOnZero: true,
      contactName: '',
      contactPhone: '',
      contactEmail: '',
      notes: '',
    });
    setEditingTenant(null);
    setIsCreateModalOpen(true);
  };

  // Open Edit Modal
  const handleOpenEditModal = (tenant: CallCenterTenant) => {
    setFormData({
      name: tenant.name,
      code: tenant.code,
      extensionStart: tenant.extensionStart,
      extensionEnd: tenant.extensionEnd,
      maxConcurrentCalls: tenant.maxConcurrentCalls,
      carrierId: tenant.carrierId || carriers[0]?.id || '',
      outboundCallerId: tenant.outboundCallerId,
      outboundCallerName: tenant.outboundCallerName || '',
      dollarBalance: tenant.dollarBalance,
      ratePerMinute: tenant.ratePerMinute,
      cutoffOnZero: tenant.cutoffOnZero,
      contactName: tenant.contactName || '',
      contactPhone: tenant.contactPhone || '',
      contactEmail: tenant.contactEmail || '',
      notes: tenant.notes || '',
    });
    setEditingTenant(tenant);
    setIsCreateModalOpen(true);
  };

  // Save Tenant (Create or Edit)
  const handleSaveTenant = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    const code = formData.code.trim().toUpperCase() || formData.name.substring(0, 5).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const dialplanContext = `tenant_${code.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    const calculatedMinutes = Math.floor(formData.dollarBalance / (formData.ratePerMinute || 0.015));

    if (editingTenant) {
      const updated: CallCenterTenant = {
        ...editingTenant,
        name: formData.name.trim(),
        code,
        extensionStart: Number(formData.extensionStart),
        extensionEnd: Number(formData.extensionEnd),
        maxConcurrentCalls: Number(formData.maxConcurrentCalls),
        carrierId: formData.carrierId,
        outboundCallerId: formData.outboundCallerId.trim(),
        outboundCallerName: formData.outboundCallerName.trim(),
        dollarBalance: Number(formData.dollarBalance),
        ratePerMinute: Number(formData.ratePerMinute),
        minuteBalance: calculatedMinutes,
        cutoffOnZero: formData.cutoffOnZero,
        contactName: formData.contactName.trim(),
        contactPhone: formData.contactPhone.trim(),
        contactEmail: formData.contactEmail.trim(),
        notes: formData.notes.trim(),
        dialplanContext,
      };
      onUpdateTenant(updated);
    } else {
      const newTenant: CallCenterTenant = {
        id: `tenant-${Date.now().toString(36)}`,
        name: formData.name.trim(),
        code,
        extensionStart: Number(formData.extensionStart),
        extensionEnd: Number(formData.extensionEnd),
        maxConcurrentCalls: Number(formData.maxConcurrentCalls),
        carrierId: formData.carrierId,
        outboundCallerId: formData.outboundCallerId.trim(),
        outboundCallerName: formData.outboundCallerName.trim(),
        dollarBalance: Number(formData.dollarBalance),
        ratePerMinute: Number(formData.ratePerMinute),
        minuteBalance: calculatedMinutes,
        usedMinutes: 0,
        status: Number(formData.dollarBalance) > 10 ? 'active' : 'low_balance',
        cutoffOnZero: formData.cutoffOnZero,
        contactName: formData.contactName.trim(),
        contactPhone: formData.contactPhone.trim(),
        contactEmail: formData.contactEmail.trim(),
        notes: formData.notes.trim(),
        createdAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
        dialplanContext,
      };
      onAddTenant(newTenant);
    }

    setIsCreateModalOpen(false);
    setEditingTenant(null);
  };

  // Execute Recharge
  const handleExecuteRecharge = (e: React.FormEvent) => {
    e.preventDefault();
    if (!rechargeModalTenant || rechargeAmount <= 0) return;

    const tenant = rechargeModalTenant;
    const rate = tenant.ratePerMinute > 0 ? tenant.ratePerMinute : 0.015;
    const minutesAdded = Math.floor(rechargeAmount / rate);
    const newDollarBalance = tenant.dollarBalance + rechargeAmount;
    const newMinuteBalance = tenant.minuteBalance + minutesAdded;

    const updatedTenant: CallCenterTenant = {
      ...tenant,
      dollarBalance: newDollarBalance,
      minuteBalance: newMinuteBalance,
      status: newDollarBalance > 10 ? 'active' : 'low_balance',
      lastRechargeDate: new Date().toISOString().replace('T', ' ').substring(0, 16),
    };

    onUpdateTenant(updatedTenant);
    onRechargeTenant(tenant.id, rechargeAmount, rechargeMethod, rechargeRef.trim() || `REC-${Date.now()}`, rechargeNotes.trim());

    // Record in history
    const historyItem: TenantRechargeHistory = {
      id: `rec-${Date.now()}`,
      tenantId: tenant.id,
      tenantName: tenant.name,
      amountDollars: rechargeAmount,
      minutesAdded,
      paymentMethod: rechargeMethod,
      reference: rechargeRef.trim() || `REC-${Date.now().toString().slice(-6)}`,
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
      notes: rechargeNotes.trim(),
    };
    saveRechargeHistory([historyItem, ...rechargeHistory]);

    setRechargeModalTenant(null);
    setRechargeAmount(50);
    setRechargeRef('');
    setRechargeNotes('');
  };

  // Range collision detection
  const collisions = useMemo(() => {
    const list: { tenantA: CallCenterTenant; tenantB: CallCenterTenant; overlapRange: string }[] = [];
    for (let i = 0; i < tenants.length; i++) {
      for (let j = i + 1; j < tenants.length; j++) {
        const a = tenants[i];
        const b = tenants[j];
        if (a.extensionStart <= b.extensionEnd && a.extensionEnd >= b.extensionStart) {
          const startOverlap = Math.max(a.extensionStart, b.extensionStart);
          const endOverlap = Math.min(a.extensionEnd, b.extensionEnd);
          list.push({
            tenantA: a,
            tenantB: b,
            overlapRange: `${startOverlap}-${endOverlap}`,
          });
        }
      }
    }
    return list;
  }, [tenants]);

  // Total summary metrics
  const totalStats = useMemo(() => {
    const totalTenants = tenants.length;
    const totalAllocatedExtensions = tenants.reduce((acc, t) => acc + (t.extensionEnd - t.extensionStart + 1), 0);
    const totalBalance = tenants.reduce((acc, t) => acc + t.dollarBalance, 0);
    const totalMinutes = tenants.reduce((acc, t) => acc + t.minuteBalance, 0);
    const totalUsedMinutes = tenants.reduce((acc, t) => acc + (t.usedMinutes || 0), 0);
    return {
      totalTenants,
      totalAllocatedExtensions,
      totalBalance,
      totalMinutes,
      totalUsedMinutes,
    };
  }, [tenants]);

  // Filtered tenants
  const filteredTenants = useMemo(() => {
    return tenants.filter((t) => {
      const q = searchTerm.toLowerCase();
      return (
        t.name.toLowerCase().includes(q) ||
        t.code.toLowerCase().includes(q) ||
        t.dialplanContext.toLowerCase().includes(q) ||
        t.outboundCallerId.toLowerCase().includes(q) ||
        t.extensionStart.toString().includes(q) ||
        t.extensionEnd.toString().includes(q)
      );
    });
  }, [tenants, searchTerm]);

  // Copy helper
  const handleCopyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedContext(id);
    setTimeout(() => setCopiedContext(null), 2000);
  };

  // Generate Asterisk dialplan for all tenants
  const fullAsteriskDialplan = useMemo(() => {
    return tenants
      .map((t) => {
        const carrier = carriers.find((c) => c.id === t.carrierId) || carriers[0];
        const carrierTrunkName = carrier ? carrier.name : 'trunk-televox';
        return `; =========================================================================
; CONTEXTO AISLADO PARA TENANT: ${t.name.toUpperCase()} (Código: ${t.code})
; Rangos de extensiones autorizadas: ${t.extensionStart} a ${t.extensionEnd}
; =========================================================================
[${t.dialplanContext}]
; 1. Marcación interna exclusiva entre operadores del mismo Call Center
exten => _${t.extensionStart.toString().slice(0, 2)}XX,1,NoOp(Llamada interna Grupo ${t.code} a \${EXTEN})
same => n,Set(__CALLING_TENANT=${t.code})
same => n,Dial(PJSIP/\${EXTEN},30,Tt)
same => n,Hangup()

; 2. Verificación de saldo y minutos antes de marcar hacia el exterior
exten => _X.,1,NoOp(Saliente Grupo ${t.code} solicitando destino \${EXTEN})
same => n,Set(__TENANT_ID=${t.id})
same => n,Set(__TENANT_RATE=${t.ratePerMinute})
${t.cutoffOnZero ? `same => n,GotoIf($[${t.dollarBalance} <= 0]?saldo_agotado,1)` : ''}

; 3. Inyección automática de Caller ID corporativo del Tenant
same => n,Set(CALLERID(num)=${t.outboundCallerId})
same => n,Set(CALLERID(name)=${t.outboundCallerName || t.name})
same => n,Set(PJSIP_HEADER(add,P-Asserted-Identity)=<sip:${t.outboundCallerId.replace(/[^0-9+]/g, '')}@${carrier?.host || '127.0.0.1'}>)

; 4. Envío de llamada por troncal asignada (${carrierTrunkName})
same => n,Dial(PJSIP/\${EXTEN}@${carrierTrunkName},60,Tor)
same => n,Hangup()

exten => saldo_agotado,1,NoOp(Llamada rechazada por falta de saldo en Grupo ${t.code})
same => n,Playback(custom/press1_invalid)
same => n,Congestion()
same => n,Hangup()
`;
      })
      .join('\n');
  }, [tenants, carriers]);

  return (
    <div className="space-y-6">
      {/* Top Banner / Hero Header */}
      <div className="bg-gradient-to-r from-slate-900 via-amber-950/40 to-slate-900 border border-amber-500/30 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/40 shadow-inner">
                <Building2 className="w-6 h-6" />
              </span>
              <div>
                <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-3">
                  Grupos de Call Centers & Reventa
                  <span className="text-xs font-mono px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 uppercase">
                    Multi-Tenant V20
                  </span>
                </h1>
                <p className="text-xs sm:text-sm text-slate-300">
                  Crea y administra múltiples grupos de call centers independientes, asigna rangos de extensiones exclusivos (ej: 1001-1020, 2001-2030), controla minutos prepago y aísla el tráfico en Asterisk.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {onSyncAsterisk && (
              <button
                onClick={onSyncAsterisk}
                className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-200 bg-slate-800/80 hover:bg-slate-700 border border-slate-700 flex items-center gap-2 transition-all shadow-sm"
              >
                <RefreshCw className="w-4 h-4 text-amber-400" />
                Sincronizar Asterisk
              </button>
            )}

            <button
              onClick={handleOpenCreateModal}
              className="px-5 py-2.5 rounded-xl text-xs font-black text-slate-950 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 shadow-lg shadow-amber-500/20 flex items-center gap-2 transition-all active:scale-95"
            >
              <Plus className="w-4 h-4" />
              Crear Nuevo Call Center
            </button>
          </div>
        </div>

        {/* Global Summary Metric Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mt-6">
          <div className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-3.5 backdrop-blur-sm">
            <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider flex items-center justify-between">
              Call Centers Activos
              <Building2 className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div className="text-xl sm:text-2xl font-black text-white mt-1">
              {totalStats.totalTenants}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">Empresas / Grupos configurados</div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-3.5 backdrop-blur-sm">
            <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider flex items-center justify-between">
              Extensiones Asignadas
              <PhoneCall className="w-3.5 h-3.5 text-blue-400" />
            </div>
            <div className="text-xl sm:text-2xl font-black text-blue-400 mt-1">
              {totalStats.totalAllocatedExtensions}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">Repartidas por rangos sin choques</div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-3.5 backdrop-blur-sm">
            <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider flex items-center justify-between">
              Saldo Total Clientes
              <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="text-xl sm:text-2xl font-black text-emerald-400 mt-1">
              ${totalStats.totalBalance.toFixed(2)} USD
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">Saldo en billetera prepago</div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-3.5 backdrop-blur-sm">
            <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider flex items-center justify-between">
              Minutos Disponibles
              <Clock className="w-3.5 h-3.5 text-purple-400" />
            </div>
            <div className="text-xl sm:text-2xl font-black text-purple-400 mt-1">
              {totalStats.totalMinutes.toLocaleString()} min
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">Consumidos: {totalStats.totalUsedMinutes.toLocaleString()} min</div>
          </div>
        </div>
      </div>

      {/* Collision Alert Banner (if any overlap exists) */}
      {collisions.length > 0 ? (
        <div className="p-4 bg-red-950/40 border border-red-500/50 rounded-xl flex items-center justify-between gap-4 text-red-200">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-6 h-6 text-red-400 shrink-0 animate-bounce" />
            <div>
              <span className="font-bold text-red-300">¡Advertencia de Conflicto de Rangos PJSIP!</span>
              <p className="text-xs text-red-200/80">
                Se detectó solapamiento de extensiones entre{' '}
                <span className="font-bold underline">{collisions[0].tenantA.name}</span> y{' '}
                <span className="font-bold underline">{collisions[0].tenantB.name}</span> en el rango{' '}
                <span className="font-mono bg-red-900/60 px-1.5 py-0.5 rounded text-white">{collisions[0].overlapRange}</span>.
                Por favor edita uno de los grupos para evitar duplicados en Asterisk.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="px-4 py-2.5 bg-emerald-950/20 border border-emerald-500/30 rounded-xl flex items-center gap-2.5 text-xs text-emerald-400">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>
            <strong>Rangos de Extensiones Seguros:</strong> Todos los grupos de Call Center operan en rangos numéricos 100% aislados y sin colisiones.
          </span>
        </div>
      )}

      {/* Subtabs Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveSubTab('groups')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
              activeSubTab === 'groups'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Building2 className="w-4 h-4" />
            Grupos de Call Centers ({tenants.length})
          </button>

          <button
            onClick={() => setActiveSubTab('ranges')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
              activeSubTab === 'ranges'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Layers className="w-4 h-4" />
            Mapa de Rangos de Extensiones
          </button>

          <button
            onClick={() => setActiveSubTab('dialplan')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
              activeSubTab === 'dialplan'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <FileCode className="w-4 h-4" />
            Dialplan Asterisk [tenant_xxx]
          </button>

          <button
            onClick={() => setActiveSubTab('recharges')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
              activeSubTab === 'recharges'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <CreditCard className="w-4 h-4" />
            Historial de Recargas ({rechargeHistory.length})
          </button>
        </div>

        {activeSubTab === 'groups' && (
          <div className="relative min-w-[240px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar por nombre, código o rango..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
            />
          </div>
        )}
      </div>

      {/* SUBTAB 1: CALL CENTER GROUPS LIST */}
      {activeSubTab === 'groups' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredTenants.map((tenant) => {
            const count = tenant.extensionEnd - tenant.extensionStart + 1;
            const carrier = carriers.find((c) => c.id === tenant.carrierId) || carriers[0];
            const isLowBalance = tenant.dollarBalance <= 10;

            return (
              <div
                key={tenant.id}
                className="bg-slate-900/90 border border-slate-800 hover:border-amber-500/40 rounded-2xl p-5 shadow-lg transition-all flex flex-col justify-between group"
              >
                <div>
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center font-black text-amber-400 text-sm">
                        {tenant.code}
                      </div>
                      <div>
                        <h3 className="font-bold text-white text-base leading-snug group-hover:text-amber-300 transition-colors">
                          {tenant.name}
                        </h3>
                        <div className="text-[11px] font-mono text-slate-400">
                          Contexto: <span className="text-amber-400/90">[{tenant.dialplanContext}]</span>
                        </div>
                      </div>
                    </div>

                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        tenant.status === 'active' && !isLowBalance
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                          : isLowBalance
                          ? 'bg-amber-500/10 text-amber-400 border-amber-500/30 animate-pulse'
                          : 'bg-red-500/10 text-red-400 border-red-500/30'
                      }`}
                    >
                      {tenant.status === 'active' && !isLowBalance ? 'ACTIVO' : isLowBalance ? 'SALDO BAJO' : 'SUSPENDIDO'}
                    </span>
                  </div>

                  {/* Extension Range Badge */}
                  <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3 mb-4">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-slate-400 flex items-center gap-1.5">
                        <PhoneCall className="w-3.5 h-3.5 text-blue-400" />
                        Rango Asignado:
                      </span>
                      <span className="font-mono font-black text-blue-300">
                        {tenant.extensionStart} - {tenant.extensionEnd}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span>Total extensiones:</span>
                      <span className="font-bold text-slate-300">{count} operadores</span>
                    </div>
                  </div>

                  {/* Operational Settings Details */}
                  <div className="space-y-2 text-xs mb-4">
                    <div className="flex items-center justify-between text-slate-300">
                      <span className="text-slate-400 flex items-center gap-1.5">
                        <Server className="w-3.5 h-3.5 text-amber-400" />
                        Carrier Troncal:
                      </span>
                      <span className="font-medium text-slate-200">
                        {carrier ? carrier.name : 'Troncal por defecto'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-slate-300">
                      <span className="text-slate-400 flex items-center gap-1.5">
                        <PhoneForwarded className="w-3.5 h-3.5 text-indigo-400" />
                        Caller ID Saliente:
                      </span>
                      <span className="font-mono text-indigo-300 font-bold">
                        {tenant.outboundCallerId}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-slate-300">
                      <span className="text-slate-400 flex items-center gap-1.5">
                        <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                        Tarifa / Minuto:
                      </span>
                      <span className="font-mono text-emerald-400 font-bold">
                        ${tenant.ratePerMinute.toFixed(3)} USD
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-slate-300">
                      <span className="text-slate-400 flex items-center gap-1.5">
                        <Zap className="w-3.5 h-3.5 text-purple-400" />
                        Canales Concurrentes:
                      </span>
                      <span className="font-mono text-slate-200 font-bold">
                        {tenant.maxConcurrentCalls} simultáneas
                      </span>
                    </div>

                    {tenant.contactName && (
                      <div className="flex items-center justify-between text-slate-400 text-[11px] pt-1 border-t border-slate-800/60">
                        <span>Contacto: {tenant.contactName}</span>
                        <span>{tenant.contactPhone || tenant.contactEmail}</span>
                      </div>
                    )}
                  </div>

                  {/* Wallet / Balance Info */}
                  <div className="bg-gradient-to-br from-slate-950 to-slate-900 border border-emerald-500/20 rounded-xl p-3.5 mb-4">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs text-slate-400 font-medium">Billetera Prepago</span>
                      <span className="text-xs font-mono font-black text-emerald-400">
                        ${tenant.dollarBalance.toFixed(2)} USD
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>Minutos disponibles:</span>
                      <span className="font-mono font-bold text-purple-300">
                        {tenant.minuteBalance.toLocaleString()} min
                      </span>
                    </div>
                    {tenant.usedMinutes > 0 && (
                      <div className="text-[10px] text-slate-500 mt-1 text-right">
                        Consumidos este ciclo: {tenant.usedMinutes.toLocaleString()} min
                      </div>
                    )}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="pt-3 border-t border-slate-800 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setRechargeModalTenant(tenant)}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-950 bg-emerald-400 hover:bg-emerald-300 transition-colors flex items-center gap-1.5 shadow-sm"
                      title="Recargar saldo en dólares o minutos"
                    >
                      <DollarSign className="w-3.5 h-3.5" />
                      Recargar
                    </button>

                    <button
                      onClick={() => setProvisionConfirmTenant(tenant)}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 hover:text-white border border-slate-700 transition-colors flex items-center gap-1"
                      title="Auto-generar extensiones PJSIP para este rango en Asterisk"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                      PJSIP
                    </button>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleOpenEditModal(tenant)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                      title="Editar configuración del Call Center"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => {
                        if (confirm(`¿Estás seguro de eliminar el Call Center "${tenant.name}"?`)) {
                          onDeleteTenant(tenant.id);
                        }
                      }}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      title="Eliminar grupo"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* SUBTAB 2: EXTENSION RANGE VISUAL MAP */}
      {activeSubTab === 'ranges' && (
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
            <h3 className="text-base font-bold text-white mb-2 flex items-center gap-2">
              <Layers className="w-5 h-5 text-amber-400" />
              Asignación Visual de Rangos Numéricos PJSIP
            </h3>
            <p className="text-xs text-slate-400 mb-6">
              Cada grupo de Call Center tiene asignado un bloque contiguo de extensiones (ej. 1001-1020). Asterisk utiliza este rango para autenticar y enrutar las llamadas a través de su contexto correspondiente.
            </p>

            <div className="space-y-4">
              {tenants.map((t) => {
                const count = t.extensionEnd - t.extensionStart + 1;
                // Calculate position relative to range 1000 - 5000
                const minScale = 1000;
                const maxScale = 5000;
                const leftPercent = Math.max(0, Math.min(100, ((t.extensionStart - minScale) / (maxScale - minScale)) * 100));
                const widthPercent = Math.max(3, Math.min(100, (count / (maxScale - minScale)) * 100));

                return (
                  <div key={t.id} className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-sm">{t.name}</span>
                        <span className="text-xs font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
                          {t.code}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-slate-400">
                          Exts:{' '}
                          <strong className="text-blue-400 font-mono">
                            {t.extensionStart} - {t.extensionEnd}
                          </strong>
                        </span>
                        <span className="text-slate-500">({count} puestos)</span>
                        <span className="text-emerald-400 font-mono font-bold">${t.dollarBalance.toFixed(2)}</span>
                      </div>
                    </div>

                    {/* Visual Bar Indicator */}
                    <div className="w-full bg-slate-900 h-4 rounded-full overflow-hidden relative border border-slate-800">
                      <div
                        className="h-full bg-gradient-to-r from-amber-500 to-indigo-500 rounded-full"
                        style={{
                          marginLeft: `${leftPercent}%`,
                          width: `${widthPercent}%`,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* SUBTAB 3: ASTERISK DIALPLAN CONFIG GENERATOR */}
      {activeSubTab === 'dialplan' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <FileCode className="w-5 h-5 text-amber-400" />
                Configuración Dialplan Multi-Tenant (/etc/asterisk/extensions.conf)
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Asterisk aísla cada grupo en su propio contexto para que un Call Center no pueda espiar ni interferir en las llamadas de otro.
              </p>
            </div>

            <button
              onClick={() => handleCopyText(fullAsteriskDialplan, 'full_dialplan')}
              className="px-4 py-2 rounded-xl text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 transition-colors flex items-center gap-2 shrink-0 self-start sm:self-auto"
            >
              {copiedContext === 'full_dialplan' ? (
                <>
                  <Check className="w-4 h-4 text-emerald-950" />
                  ¡Copiado al Portapapeles!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  Copiar Todo el Dialplan
                </>
              )}
            </button>
          </div>

          <div className="relative">
            <pre className="p-4 bg-slate-950 rounded-xl border border-slate-800 text-xs font-mono text-emerald-400/90 overflow-x-auto max-h-[500px] leading-relaxed selection:bg-amber-500 selection:text-slate-950">
              {fullAsteriskDialplan}
            </pre>
          </div>
        </div>
      )}

      {/* SUBTAB 4: RECHARGES HISTORY */}
      {activeSubTab === 'recharges' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-emerald-400" />
              Historial de Recargas & Billetera por Call Center
            </h3>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950 text-slate-400 uppercase font-mono border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">Fecha y Hora</th>
                  <th className="py-3 px-4">Call Center</th>
                  <th className="py-3 px-4">Monto ($ USD)</th>
                  <th className="py-3 px-4">Minutos Añadidos</th>
                  <th className="py-3 px-4">Método</th>
                  <th className="py-3 px-4">Referencia</th>
                  <th className="py-3 px-4">Notas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-300">
                {rechargeHistory.map((rec) => (
                  <tr key={rec.id} className="hover:bg-slate-800/40">
                    <td className="py-3 px-4 font-mono text-slate-400">{rec.timestamp}</td>
                    <td className="py-3 px-4 font-bold text-white">{rec.tenantName}</td>
                    <td className="py-3 px-4 font-mono font-bold text-emerald-400">
                      +${rec.amountDollars.toFixed(2)} USD
                    </td>
                    <td className="py-3 px-4 font-mono text-purple-400">
                      +{rec.minutesAdded.toLocaleString()} min
                    </td>
                    <td className="py-3 px-4 uppercase font-bold text-slate-400">{rec.paymentMethod}</td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-400">{rec.reference}</td>
                    <td className="py-3 px-4 text-slate-400 italic">{rec.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL: CREATE / EDIT TENANT */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-5 my-8">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <Building2 className="w-5 h-5 text-amber-400" />
                <h3 className="font-bold text-white text-lg">
                  {editingTenant ? 'Editar Grupo de Call Center' : 'Nuevo Grupo de Call Center'}
                </h3>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="text-slate-400 hover:text-white text-sm px-2 py-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveTenant} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Nombre del Call Center *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ej. Alpha Ventas Internacional"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Código Corto / Sigla *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ej. ALPHA"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono uppercase focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              {/* Extension Range Block */}
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4">
                <div className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-2 flex items-center justify-between">
                  <span>Rango de Extensiones Asignadas</span>
                  <span className="text-[11px] font-mono text-slate-400">
                    Total: {Math.max(0, formData.extensionEnd - formData.extensionStart + 1)} puestos
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Extensión Inicial</label>
                    <input
                      type="number"
                      required
                      min={1001}
                      max={9990}
                      value={formData.extensionStart}
                      onChange={(e) => setFormData({ ...formData, extensionStart: Number(e.target.value) })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Extensión Final</label>
                    <input
                      type="number"
                      required
                      min={formData.extensionStart}
                      max={9999}
                      value={formData.extensionEnd}
                      onChange={(e) => setFormData({ ...formData, extensionEnd: Number(e.target.value) })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>
              </div>

              {/* Carrier & Caller ID */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Carrier Troncal Asignado
                  </label>
                  <select
                    value={formData.carrierId}
                    onChange={(e) => setFormData({ ...formData, carrierId: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  >
                    {carriers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.authType === 'ip_auth' ? 'IP-a-IP' : 'Registro'}) - {c.host}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Caller ID Saliente (Número)
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="+18005550199"
                    value={formData.outboundCallerId}
                    onChange={(e) => setFormData({ ...formData, outboundCallerId: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              {/* Financial & Concurrency */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Saldo Inicial ($ USD)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={formData.dollarBalance}
                    onChange={(e) => setFormData({ ...formData, dollarBalance: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Tarifa por Minuto ($/min)
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    min={0.001}
                    value={formData.ratePerMinute}
                    onChange={(e) => setFormData({ ...formData, ratePerMinute: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Canales Concurrentes
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={formData.maxConcurrentCalls}
                    onChange={(e) => setFormData({ ...formData, maxConcurrentCalls: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              {/* Contact Info */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Nombre Contacto</label>
                  <input
                    type="text"
                    placeholder="Ej. Juan Pérez"
                    value={formData.contactName}
                    onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Teléfono Contacto</label>
                  <input
                    type="text"
                    placeholder="+1 809-555-0101"
                    value={formData.contactPhone}
                    onChange={(e) => setFormData({ ...formData, contactPhone: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Email Contacto</label>
                  <input
                    type="email"
                    placeholder="contacto@callcenter.com"
                    value={formData.contactEmail}
                    onChange={(e) => setFormData({ ...formData, contactEmail: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                  />
                </div>
              </div>

              {/* Cutoff on zero checkbox */}
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="cutoffOnZero"
                  checked={formData.cutoffOnZero}
                  onChange={(e) => setFormData({ ...formData, cutoffOnZero: e.target.checked })}
                  className="rounded border-slate-700 text-amber-500 focus:ring-amber-500 bg-slate-950"
                />
                <label htmlFor="cutoffOnZero" className="text-xs text-slate-300">
                  Corte automático de llamadas salientes cuando el saldo llegue a $0.00
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl text-xs font-black text-slate-950 bg-amber-400 hover:bg-amber-300 transition-colors shadow-lg shadow-amber-500/20"
                >
                  {editingTenant ? 'Guardar Cambios' : 'Crear Call Center'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: RECHARGE BALANCE */}
      {rechargeModalTenant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-white text-base">
                  Recargar Saldo: {rechargeModalTenant.name}
                </h3>
              </div>
              <button
                onClick={() => setRechargeModalTenant(null)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleExecuteRecharge} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Monto a Recargar ($ USD) *
                </label>
                <input
                  type="number"
                  required
                  min={5}
                  step="1"
                  value={rechargeAmount}
                  onChange={(e) => setRechargeAmount(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-base font-bold text-emerald-400 font-mono focus:outline-none focus:border-emerald-500"
                />
                <div className="text-[11px] text-slate-400 mt-1">
                  Equivale a aprox.{' '}
                  <strong className="text-purple-400 font-mono">
                    {Math.floor(rechargeAmount / (rechargeModalTenant.ratePerMinute || 0.015)).toLocaleString()} minutos
                  </strong>{' '}
                  de llamadas.
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Método de Pago *
                </label>
                <select
                  value={rechargeMethod}
                  onChange={(e) => setRechargeMethod(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                >
                  <option value="zelle">Zelle (Transferencia Instantánea)</option>
                  <option value="usdt_crypto">USDT / Criptomoneda</option>
                  <option value="bank_transfer">Transferencia Bancaria Local</option>
                  <option value="cash">Efectivo en Oficina</option>
                  <option value="credit_card">Tarjeta de Crédito / Débito</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Número de Referencia / Comprobante
                </label>
                <input
                  type="text"
                  placeholder="Ej. ZLL-9821034"
                  value={rechargeRef}
                  onChange={(e) => setRechargeRef(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Notas Adicionales
                </label>
                <input
                  type="text"
                  placeholder="Ej. Paquete mensual de 10 operadores"
                  value={rechargeNotes}
                  onChange={(e) => setRechargeNotes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setRechargeModalTenant(null)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl text-xs font-black text-slate-950 bg-emerald-400 hover:bg-emerald-300 transition-colors shadow-lg shadow-emerald-500/20"
                >
                  Confirmar Recarga
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: PROVISION CONFIRMATION */}
      {provisionConfirmTenant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-2.5 text-amber-400">
              <Sparkles className="w-5 h-5" />
              <h3 className="font-bold text-white text-base">
                Auto-Generar Extensiones PJSIP
              </h3>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              ¿Deseas auto-aprovisionar las extensiones desde la{' '}
              <strong className="text-blue-400 font-mono">{provisionConfirmTenant.extensionStart}</strong> hasta la{' '}
              <strong className="text-blue-400 font-mono">{provisionConfirmTenant.extensionEnd}</strong> en Asterisk?
            </p>

            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-[11px] text-slate-400 space-y-1">
              <div>• Contexto asignado: <span className="font-mono text-amber-300">[{provisionConfirmTenant.dialplanContext}]</span></div>
              <div>• Contraseñas generadas automáticamente con alta seguridad.</div>
              <div>• Listas para registrar en MicroSIP, Zoiper o WebRTC.</div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setProvisionConfirmTenant(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  if (onAutoProvisionExtensions) {
                    onAutoProvisionExtensions(provisionConfirmTenant);
                  }
                  setProvisionConfirmTenant(null);
                }}
                className="px-4 py-2 rounded-xl text-xs font-black text-slate-950 bg-amber-400 hover:bg-amber-300 transition-colors shadow-lg shadow-amber-500/20"
              >
                Sí, Generar Extensiones
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
