import React, { useState, useEffect, useCallback } from 'react';
import { authFetch as fetch } from '../utils/authClient';
import { SystemUser, PjsipExtension, UserPermissions, CarrierTrunk, CallCenterTenant, CallFlowMode } from '../types';

const CALL_FLOW_MODE_OPTIONS: { id: CallFlowMode; label: string }[] = [
  { id: 'otp', label: '1. Captura OTP' },
  { id: 'press1', label: '2. Press-1 (Asesor)' },
  { id: 'hybrid', label: '3. Híbrido (OTP + Asesor)' },
  { id: 'cancel_code', label: '4. Código de Cancelación' },
  { id: 'otp_press1', label: '5. IVR de Captura OTP' },
];
import {
  Users,
  UserPlus,
  Shield,
  Phone,
  Trash2,
  Edit2,
  CheckCircle,
  XCircle,
  KeyRound,
  Check,
  Radio,
  Sliders,
  Sparkles,
  Eye,
  EyeOff,
  Lock,
  Copy,
  DollarSign,
  Download,
  HelpCircle,
  AlertCircle,
  RefreshCw,
  Smartphone,
  ChevronRight,
  Network,
  Building2,
  BookOpen,
} from 'lucide-react';

interface UsersTabProps {
  users: SystemUser[];
  extensions: PjsipExtension[];
  carriers?: CarrierTrunk[];
  tenants?: CallCenterTenant[];
  currentUserId: string;
  currentUser?: SystemUser;
  onSwitchUser: (userId: string) => void;
  onAddUser: (user: SystemUser) => void;
  onUpdateUser: (user: SystemUser) => void;
  onDeleteUser: (userId: string) => void;
  onAddExtension?: (ext: PjsipExtension) => void;
  onNavigateToProduction?: () => void;
}

export const UsersTab: React.FC<UsersTabProps> = ({
  users,
  extensions,
  carriers = [],
  tenants = [],
  currentUserId,
  currentUser,
  onSwitchUser,
  onAddUser,
  onUpdateUser,
  onDeleteUser,
  onAddExtension,
  onNavigateToProduction,
}) => {
  const activeUser = currentUser || users.find((u) => u.id === currentUserId);
  const canManageUsers = activeUser ? (activeUser.role === 'admin' || !!activeUser.permissions?.canManageUsers) : false;
  const isGlobalSuperAdmin = Boolean(activeUser && activeUser.role === 'admin' && !activeUser.tenantId);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<SystemUser | null>(null);

  // Form State
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formUsername, setFormUsername] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [formRole, setFormRole] = useState<SystemUser['role']>('agent');
  const [formAccountType, setFormAccountType] = useState<'agent' | 'reseller_client'>('reseller_client');
  const [formBalance, setFormBalance] = useState<number>(10.00);
  const [formRate, setFormRate] = useState<number>(0.02);
  const [formCutoffOnZero, setFormCutoffOnZero] = useState<boolean>(true);
  const [formCarrierId, setFormCarrierId] = useState<string>('auto');
  const [formTenantId, setFormTenantId] = useState<string>('');
  const [filterTenantId, setFilterTenantId] = useState<string>('all');
  const [formStatus, setFormStatus] = useState<SystemUser['status']>('active');
  const [selectedExts, setSelectedExts] = useState<string[]>([]);
  const [formAssignedEntityIds, setFormAssignedEntityIds] = useState<string[]>([]);
  const [formAssignedCallFlowMode, setFormAssignedCallFlowMode] = useState<CallFlowMode>('press1');
  const [formAllowedCallFlowModes, setFormAllowedCallFlowModes] = useState<CallFlowMode[]>(['press1']);
  const [revealedPasswords, setRevealedPasswords] = useState<Record<string, boolean>>({});
  const [copiedUserId, setCopiedUserId] = useState<string | null>(null);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  // Real active IVR scripts/entities list (loaded ONLY from Admin's active scripts — no fake inactive templates)
  const [availableEntities, setAvailableEntities] = useState<{ id: string; name: string; subtitle?: string }[]>(() => {
    try {
      const saved = localStorage.getItem('prod_campaign_entities_v3');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed
            .filter((e: any) => e && e.id && e.isActive !== false)
            .map((e: any) => ({ id: e.id, name: e.name, subtitle: e.subtitle }));
        }
      }
    } catch (_) {}
    return [];
  });

  const refreshMasterEntities = useCallback(() => {
    fetch('/api/app/master-entities')
      .then((r) => r.json())
      .then((data) => {
        if (data.success && Array.isArray(data.entities)) {
          setAvailableEntities(
            data.entities
              .filter((e: any) => e && e.id && e.isActive !== false)
              .map((e: any) => ({ id: e.id, name: e.name, subtitle: e.subtitle }))
          );
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshMasterEntities();
    const onFocus = () => refreshMasterEntities();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshMasterEntities]);

  // Modals for MicroSIP setup, balance recharge, and scripts assignment
  const [microsipModalUser, setMicrosipModalUser] = useState<SystemUser | null>(null);
  const [rechargeModalUser, setRechargeModalUser] = useState<SystemUser | null>(null);
  const [rechargeAmount, setRechargeAmount] = useState<number>(10);
  const [scriptsModalUser, setScriptsModalUser] = useState<SystemUser | null>(null);
  const [scriptsModalSelectedIds, setScriptsModalSelectedIds] = useState<string[]>([]);

  const [permissions, setPermissions] = useState<UserPermissions>({
    canManageExtensions: false,
    canManageCarriers: false,
    canManageIVR: false,
    canUploadAudio: false,
    canSyncAsterisk: false,
    canUseSoftphone: true,
    canManageUsers: false,
    canExportConfigs: false,
    canSpy: false,
    canUseMassCalls: false,
  });

  // Compute next free 2001+ extension for standalone (non-Call Center) clients
  const getNextClientExtension2001 = (): string => {
    const usedNums = new Set<number>();
    extensions.forEach((e) => {
      const n = parseInt(e.extension, 10);
      if (!isNaN(n)) usedNums.add(n);
    });
    users.forEach((u) => {
      (u.assignedExtensions || []).forEach((extStr) => {
        const n = parseInt(extStr, 10);
        if (!isNaN(n)) usedNums.add(n);
      });
    });
    let candidate = 2001;
    while (usedNums.has(candidate)) {
      candidate++;
    }
    return String(candidate);
  };

  // Filter extensions: 1000 only shown to Global Super Admin; 1001+ for agents/call centers/clients
  const availableExtensions = extensions.filter((e) => {
    const num = parseInt(e.extension, 10);
    if (isNaN(num)) return false;
    if (num === 1000) return formRole === 'admin' && !formTenantId;
    return num >= 1001;
  });

  const applyRolePreset = (role: SystemUser['role']) => {
    setFormRole(role);
    if (role === 'admin') {
      setFormAccountType('agent');
      setPermissions({
        canManageExtensions: true,
        canManageCarriers: true,
        canManageIVR: true,
        canUploadAudio: true,
        canSyncAsterisk: true,
        canUseSoftphone: true,
        canManageUsers: true,
        canExportConfigs: true,
        canSpy: true,
        canUseMassCalls: !formTenantId,
      });
    } else if (role === 'supervisor') {
      setFormAccountType('agent');
      setPermissions({
        canManageExtensions: true,
        canManageCarriers: false,
        canManageIVR: true,
        canUploadAudio: true,
        canSyncAsterisk: true,
        canUseSoftphone: true,
        canManageUsers: false,
        canExportConfigs: true,
        canSpy: true,
        canUseMassCalls: false,
      });
    } else if (role === 'agent') {
      setFormAccountType('agent');
      setPermissions({
        canManageExtensions: false,
        canManageCarriers: false,
        canManageIVR: false,
        canUploadAudio: false,
        canSyncAsterisk: false,
        canUseSoftphone: true,
        canManageUsers: false,
        canExportConfigs: false,
        canSpy: false,
        canUseMassCalls: false,
      });
    } else if (role === 'reseller_client') {
      setFormAccountType('reseller_client');
      setPermissions({
        canManageExtensions: false,
        canManageCarriers: false,
        canManageIVR: false,
        canUploadAudio: false,
        canSyncAsterisk: false,
        canUseSoftphone: true,
        canManageUsers: false,
        canExportConfigs: false,
        canSpy: false,
        canUseMassCalls: false,
      });
      if (!editingUser && !formTenantId) {
        const nextClientExt = getNextClientExtension2001();
        setSelectedExts((prev) =>
          prev.some((x) => parseInt(x, 10) >= 2001) ? prev : [nextClientExt]
        );
      }
    }
  };

  const generateSecurePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*';
    let pass = '';
    for (let i = 0; i < 10; i++) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setFormPassword(pass);
    setShowPassword(true);
  };

  const toggleRevealPassword = (userId: string) => {
    setRevealedPasswords((prev) => ({
      ...prev,
      [userId]: !prev[userId],
    }));
  };

  const handleCopyCredentials = (user: SystemUser) => {
    const cleanUser = String(user.username || user.email.split('@')[0]).trim().toLowerCase().replace(/[^a-zA-Z0-9_\-]/g, '');
    const passLabel = user.password || '(gestionada en servidor — usa "Descargar microsip.ini")';
    const text = `Servidor SIP: ${window.location.hostname || 'IP_DEL_VPS'}:47923\nUsuario: ${cleanUser}\nDominio: ${window.location.hostname || 'IP_DEL_VPS'}\nLogin: ${cleanUser}\nContraseña: ${passLabel}\nExtensiones: ${user.assignedExtensions.join(', ') || cleanUser}`;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
    }
    setCopiedUserId(user.id);
    setTimeout(() => setCopiedUserId(null), 2500);
  };

  // Helper to download microsip.ini directly from authenticated backend endpoint
  const downloadMicrosipIni = async (user: SystemUser) => {
    const cleanUser = String(user.username || user.email.split('@')[0]).trim().toLowerCase().replace(/[^a-zA-Z0-9_\-]/g, '');
    try {
      const res = await fetch(`/api/reseller/microsip-ini/${encodeURIComponent(cleanUser)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setSyncFeedback(`⚠ No se pudo descargar microsip.ini: ${err.error || 'Error de autorización'}`);
        setTimeout(() => setSyncFeedback(null), 4000);
        return;
      }
      const content = await res.text();
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `microsip_${cleanUser}.ini`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setSyncFeedback(`⚠ Error al descargar microsip.ini: ${err?.message || 'Sin conexión'}`);
      setTimeout(() => setSyncFeedback(null), 4000);
    }
  };

  const handleOpenCreateModal = () => {
    refreshMasterEntities();
    setEditingUser(null);
    setFormName('');
    setFormEmail('');
    setFormUsername('');
    setFormPassword('');
    setShowPassword(false);
    setFormRole('reseller_client');
    setFormAccountType('reseller_client');
    setFormBalance(10.00);
    setFormRate(0.02);
    setFormCutoffOnZero(true);
    setFormCarrierId('auto');
    setFormTenantId('');
    setFormStatus('active');
    setFormAssignedEntityIds([]);
    setFormAssignedCallFlowMode('press1');
    setFormAllowedCallFlowModes(['press1']);
    // Standalone non-Call-Center clients default to next free 2001+ extension
    const nextClientExt = getNextClientExtension2001();
    setSelectedExts([nextClientExt]);
    applyRolePreset('reseller_client');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (user: SystemUser) => {
    refreshMasterEntities();
    setEditingUser(user);
    setFormName(user.name);
    setFormEmail(user.email);
    setFormUsername(user.username || user.email.split('@')[0]);
    setFormPassword('');
    setShowPassword(false);
    setFormRole(user.role);
    setFormAccountType(user.accountType || (user.role === 'reseller_client' ? 'reseller_client' : 'agent'));
    setFormBalance(typeof user.balance === 'number' ? user.balance : 10.00);
    setFormRate(typeof user.costPerMinute === 'number' ? user.costPerMinute : 0.02);
    setFormCutoffOnZero(user.cutoffOnZero !== false);
    const rawUserCarrier = user.carrierId || user.assignedCarrierId || '';
    const matchedCarrierForSelect = rawUserCarrier
      ? carriers.find(
          (c) =>
            c.id === rawUserCarrier ||
            c.name === rawUserCarrier ||
            c.name.replace(/\s+/g, '_') === rawUserCarrier ||
            c.name.toLowerCase().replace(/[^a-z0-9_]/g, '_') === rawUserCarrier.toLowerCase().replace(/[^a-z0-9_]/g, '_')
        )
      : null;
    setFormCarrierId(matchedCarrierForSelect ? matchedCarrierForSelect.name.replace(/\s+/g, '_') : (rawUserCarrier || 'auto'));
    setFormTenantId(user.tenantId || '');
    setFormStatus(user.status);
    setSelectedExts(user.assignedExtensions);
    setPermissions({
      ...user.permissions,
      canUseMassCalls: Boolean(user.permissions?.canUseMassCalls),
    });
    const activeIdSet = new Set(availableEntities.map((e) => e.id));
    if (Array.isArray(user.assignedEntityIds)) {
      setFormAssignedEntityIds(
        user.assignedEntityIds.filter((id) => activeIdSet.size === 0 || activeIdSet.has(id))
      );
    } else if (user.tenantId) {
      const userTenantObj = tenants.find((t) => t.id === user.tenantId);
      setFormAssignedEntityIds(
        Array.isArray(userTenantObj?.assignedEntityIds)
          ? userTenantObj.assignedEntityIds.filter((id) => activeIdSet.size === 0 || activeIdSet.has(id))
          : availableEntities.map((e) => e.id)
      );
    } else {
      setFormAssignedEntityIds(availableEntities.map((e) => e.id));
    }
    const tenantForUser = user.tenantId ? tenants.find((t) => t.id === user.tenantId) : null;
    const primaryFlow: CallFlowMode =
      user.assignedCallFlowMode || tenantForUser?.assignedCallFlowMode || 'press1';
    const rawAllowedFlows =
      Array.isArray(user.allowedCallFlowModes) && user.allowedCallFlowModes.length > 0
        ? user.allowedCallFlowModes
        : Array.isArray(tenantForUser?.allowedCallFlowModes) && tenantForUser.allowedCallFlowModes.length > 0
        ? tenantForUser.allowedCallFlowModes
        : [primaryFlow];
    setFormAssignedCallFlowMode(primaryFlow);
    setFormAllowedCallFlowModes(Array.from(new Set<CallFlowMode>([primaryFlow, ...rawAllowedFlows])));
    setIsModalOpen(true);
  };

  const handleOpenUserScriptsModal = (user: SystemUser) => {
    refreshMasterEntities();
    const activeIdSet = new Set(availableEntities.map((e) => e.id));
    setScriptsModalUser(user);
    if (Array.isArray(user.assignedEntityIds)) {
      setScriptsModalSelectedIds(
        user.assignedEntityIds.filter((id) => activeIdSet.size === 0 || activeIdSet.has(id))
      );
    } else if (user.tenantId) {
      const userTenantObj = tenants.find((t) => t.id === user.tenantId);
      setScriptsModalSelectedIds(
        Array.isArray(userTenantObj?.assignedEntityIds)
          ? userTenantObj.assignedEntityIds.filter((id) => activeIdSet.size === 0 || activeIdSet.has(id))
          : availableEntities.map((e) => e.id)
      );
    } else {
      setScriptsModalSelectedIds(availableEntities.map((e) => e.id));
    }
  };

  const handleSaveUserScripts = () => {
    if (!scriptsModalUser) return;
    const isGlobalSuperAdmin = scriptsModalUser.role === 'admin' && !scriptsModalUser.tenantId;
    const updatedUser: SystemUser = {
      ...scriptsModalUser,
      assignedEntityIds: isGlobalSuperAdmin ? undefined : [...scriptsModalSelectedIds],
    };
    onUpdateUser(updatedUser);
    fetch('/api/users/sync-sip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: updatedUser }),
    }).catch(() => {});
    setSyncFeedback(`✓ Guiones actualizados para ${scriptsModalUser.name} (${scriptsModalSelectedIds.length} activos asignados).`);
    setTimeout(() => setSyncFeedback(null), 4000);
    setScriptsModalUser(null);
  };

  const toggleExtensionAssignment = (extNum: string) => {
    if (selectedExts.includes(extNum)) {
      setSelectedExts(selectedExts.filter((e) => e !== extNum));
    } else {
      setSelectedExts([...selectedExts, extNum]);
    }
  };

  const togglePermission = (key: keyof UserPermissions) => {
    setPermissions((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
    setFormRole('custom');
  };

  const handleSaveUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName || !formEmail) return;

    const rawUsername = formUsername.trim() || formEmail.split('@')[0] || formName.toLowerCase().replace(/\s+/g, '.');
    const usernameFinal = rawUsername.toLowerCase().replace(/[^a-zA-Z0-9_\-]/g, '');
    const trimmedPass = formPassword.trim();
    const generatedPass = !editingUser && !trimmedPass
      ? (() => {
          const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*';
          let p = '';
          for (let i = 0; i < 12; i++) p += chars.charAt(Math.floor(Math.random() * chars.length));
          return p;
        })()
      : undefined;
    const passwordFinal = trimmedPass || generatedPass;

    const colors = [
      'from-emerald-500 to-teal-700',
      'from-blue-500 to-indigo-600',
      'from-emerald-600 to-green-500',
      'from-purple-500 to-pink-600',
      'from-teal-500 to-emerald-600',
    ];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];

    const finalRole = formAccountType === 'reseller_client' ? 'reseller_client' : formRole;
    const targetIsGlobalSuperAdmin = finalRole === 'admin' && !formTenantId;
    const normalizedAllowedFlows: CallFlowMode[] = Array.from(
      new Set<CallFlowMode>([formAssignedCallFlowMode, ...formAllowedCallFlowModes])
    );
    const effectivePermissions: UserPermissions = {
      ...permissions,
      canUseMassCalls: targetIsGlobalSuperAdmin
        ? true
        : isGlobalSuperAdmin
        ? Boolean(permissions.canUseMassCalls)
        : Boolean(editingUser?.permissions?.canUseMassCalls),
    };

    const userObj: SystemUser = {
      ...(editingUser || {}),
      id: editingUser ? editingUser.id : `user-${Date.now()}`,
      name: formName,
      email: formEmail,
      username: usernameFinal,
      ...(passwordFinal ? { password: passwordFinal } : {}),
      role: finalRole,
      accountType: formAccountType,
      balance: formBalance,
      costPerMinute: formRate,
      allocatedMinutes: Math.round(formBalance / (formRate || 0.02)),
      usedMinutes: editingUser?.usedMinutes || 0,
      cutoffOnZero: formCutoffOnZero,
      carrierId: formCarrierId === 'auto' ? undefined : formCarrierId,
      assignedCarrierId: formCarrierId === 'auto' ? undefined : formCarrierId,
      tenantId: formTenantId ? formTenantId : undefined,
      assignedExtensions: selectedExts,
      assignedEntityIds: targetIsGlobalSuperAdmin ? undefined : [...formAssignedEntityIds],
      assignedCallFlowMode: targetIsGlobalSuperAdmin ? undefined : formAssignedCallFlowMode,
      allowedCallFlowModes: targetIsGlobalSuperAdmin ? undefined : normalizedAllowedFlows,
      permissions: effectivePermissions,
      status: formStatus,
      avatarColor: editingUser?.avatarColor || randomColor,
      createdAt: editingUser?.createdAt || new Date().toISOString().split('T')[0],
      lastLogin: editingUser?.lastLogin || 'Pendiente primer inicio',
    };

    if (editingUser) {
      onUpdateUser(userObj);
    } else {
      onAddUser(userObj);
    }

    // Ensure any assigned 2001+ client extension that doesn't yet exist in ExtensionsTab is created automatically
    if (onAddExtension) {
      selectedExts.forEach((extNum) => {
        const cleanNum = String(extNum).trim();
        if (!/^\d{4,}$/.test(cleanNum)) return;
        const alreadyExists = extensions.some((ext) => ext.extension === cleanNum);
        if (!alreadyExists) {
          onAddExtension({
            id: `ext-${cleanNum}`,
            extension: cleanNum,
            name: `${formName} (Cliente ${cleanNum})`,
            secret: passwordFinal || '',
            context: 'from-internal',
            transport: 'transport-udp',
            port: 47923,
            maxContacts: 5,
            codecs: ['opus', 'g722', 'ulaw', 'alaw', 'g729'],
            status: 'unknown',
            tenantId: formTenantId || undefined,
          });
        }
      });
    }

    // Auto-provision immediately in Asterisk 20 PJSIP
    fetch('/api/users/sync-sip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: userObj }),
    })
      .then((r) => r.json())
      .then(() => {
        setSyncFeedback(`✓ Usuario "${usernameFinal}" (Ext: ${selectedExts.join(', ') || usernameFinal}) registrado en Asterisk PJSIP (Puerto 47923). MicroSIP ya puede conectarse.`);
        setTimeout(() => setSyncFeedback(null), 6000);
      })
      .catch(() => {});

    setIsModalOpen(false);
  };

  const permissionList: { key: keyof UserPermissions; label: string; desc: string }[] = [
    {
      key: 'canManageExtensions',
      label: 'Gestionar Extensiones PJSIP',
      desc: 'Crear, editar contraseñas y configurar extensiones PJSIP (>= 1001)',
    },
    {
      key: 'canManageCarriers',
      label: 'Administrar Troncales SIP / Carriers',
      desc: 'Configurar proveedores IP Auth y Registros SIP externos',
    },
    {
      key: 'canManageIVR',
      label: 'Configurar IVR Press 1 y Captura OTP',
      desc: 'Modificar flujos de bienvenida, dígitos y webhooks de validación',
    },
    {
      key: 'canUploadAudio',
      label: 'Audioteca de Prompts Pregrabados',
      desc: 'Subir archivos WAV/MP3, grabar voz y asignar a campañas',
    },
    {
      key: 'canSyncAsterisk',
      label: 'Sincronización en Caliente y Consola AMI',
      desc: 'Disparar recargas AMI/ARI y ejecutar comandos directos al motor',
    },
    {
      key: 'canUseSoftphone',
      label: 'Simulador Softphone Asterisk',
      desc: 'Realizar llamadas de prueba, marcar DTMF y testear flujos de voz',
    },
    {
      key: 'canManageUsers',
      label: 'Administración de Usuarios y Roles',
      desc: 'Crear usuarios del sistema y asignar extensiones y permisos RBAC',
    },
    {
      key: 'canSpy',
      label: 'Modo Espía ChanSpy (*55/*56/*57) y Grabaciones',
      desc: 'Escuchar, susurrar e intervenir llamadas en vivo y gestionar grabaciones',
    },
  ];

  const handleToggleUserMassCalls = (user: SystemUser) => {
    if (!isGlobalSuperAdmin) return;
    const nextValue = !Boolean(user.permissions?.canUseMassCalls);
    const updatedUser: SystemUser = {
      ...user,
      permissions: {
        ...user.permissions,
        canUseMassCalls: nextValue,
      },
    };
    onUpdateUser(updatedUser);
    fetch('/api/users/sync-sip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: updatedUser }),
    }).catch(() => {});
    setSyncFeedback(
      nextValue
        ? `✓ Acceso al Centro de Llamadas Masivas habilitado para ${user.name}.`
        : `✓ Acceso al Centro de Llamadas Masivas revocado para ${user.name}.`
    );
    setTimeout(() => setSyncFeedback(null), 4000);
  };

  if (!canManageUsers) {
    return (
      <div className="p-8 max-w-2xl mx-auto my-12 bg-slate-900 border-2 border-rose-500/40 rounded-2xl text-center space-y-4 shadow-2xl">
        <div className="w-16 h-16 rounded-2xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center mx-auto text-rose-400">
          <Lock className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-white">Acceso Denegado: Gestión de Usuarios</h2>
        <p className="text-xs text-slate-300 leading-relaxed">
          Tu usuario actual (<strong className="text-white">{activeUser?.name || 'Usuario'}</strong> - Rol: <strong className="text-amber-400 uppercase font-mono">{activeUser?.role || 'Agente'}</strong>) no cuenta con privilegios administrativos para gestionar cuentas, ver credenciales o editar permisos del sistema.
        </p>
        <div className="pt-2">
          {onNavigateToProduction && (
            <button
              type="button"
              onClick={onNavigateToProduction}
              className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-lg transition-all cursor-pointer"
            >
              Ir a Centro de Operaciones
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header and User Count */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Users className="w-6 h-6 text-emerald-400" />
            <span>Panel de Usuarios y Permisos del Sistema</span>
            <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
              {users.length} usuarios
            </span>
          </h2>
          <p className="text-sm text-slate-400">
            Convención de extensiones: <strong className="text-cyan-300">1000</strong> Espía Super Admin • <strong className="text-amber-300">1001–1999</strong> Call Centers • <strong className="text-emerald-300">2001+</strong> Clientes Individuales (No Call Center).
          </p>
        </div>

        <button
          onClick={handleOpenCreateModal}
          className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-lg text-sm font-semibold bg-emerald-500 hover:bg-emerald-400 text-black shadow-md shadow-emerald-500/20 font-bold transition-all"
        >
          <UserPlus className="w-4 h-4" />
          <span>Crear Nuevo Usuario</span>
        </button>
      </div>

      {/* Switch Current Active User (Impersonation Banner) */}
      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-400 font-medium">Sesión Actual Activa en la Interfaz:</div>
            <div className="text-sm font-bold text-white flex items-center gap-2">
              <span>{users.find((u) => u.id === currentUserId)?.name || 'Administrador'}</span>
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono">
                {users.find((u) => u.id === currentUserId)?.role || 'admin'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="text-slate-400">Cambiar perfil para probar permisos:</span>
          {users.map((user) => (
            <button
              key={user.id}
              onClick={() => onSwitchUser(user.id)}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 ${
                currentUserId === user.id
                  ? 'bg-emerald-500 text-black font-bold shadow-md'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <span>{user.name.split(' ')[0]}</span>
              <span className="text-[10px] opacity-75">({user.role})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Call Center Filter Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-slate-900 border border-slate-800 rounded-xl">
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-indigo-400" />
          <span className="text-xs font-bold text-slate-200">Filtrar Usuarios por Call Center:</span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => setFilterTenantId('all')}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
              filterTenantId === 'all'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            Todos ({users.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterTenantId('global')}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
              filterTenantId === 'global'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            🌐 Globales ({users.filter((u) => !u.tenantId).length})
          </button>
          {tenants.map((t) => {
            const count = users.filter((u) => u.tenantId === t.id).length;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setFilterTenantId(t.id)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${
                  filterTenantId === t.id
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <span>🏢 {t.name}</span>
                <span className="text-[10px] opacity-75">({count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Users List / Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {users
          .filter((user) => {
            if (filterTenantId === 'all') return true;
            if (filterTenantId === 'global') return !user.tenantId;
            return user.tenantId === filterTenantId;
          })
          .map((user) => {
          const isCurrentUser = user.id === currentUserId;
          const activePermCount = Object.values(user.permissions).filter(Boolean).length;

          return (
            <div
              key={user.id}
              className={`p-5 rounded-xl bg-slate-900 border transition-all flex flex-col justify-between ${
                isCurrentUser ? 'border-emerald-500/50 shadow-lg shadow-emerald-500/5' : 'border-slate-800 hover:border-slate-700'
              }`}
            >
              <div>
                {/* User Header */}
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex items-center space-x-3">
                    <div
                      className={`w-10 h-10 rounded-full bg-gradient-to-tr ${user.avatarColor} flex items-center justify-center text-white font-bold text-sm shadow-inner`}
                    >
                      {user.name
                        .split(' ')
                        .map((n) => n[0])
                        .slice(0, 2)
                        .join('')}
                    </div>
                    <div>
                      <h3 className="font-bold text-white text-sm leading-tight flex items-center gap-1.5">
                        <span>{user.name}</span>
                        {isCurrentUser && (
                          <span className="w-2 h-2 rounded-full bg-emerald-400" title="Tú estás conectado"></span>
                        )}
                      </h3>
                      <p className="text-xs text-slate-400 truncate max-w-[170px]">{user.email}</p>
                    </div>
                  </div>

                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                      user.role === 'admin'
                        ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                        : user.role === 'supervisor'
                        ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                        : user.accountType === 'reseller_client' || user.role === 'reseller_client'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold'
                        : user.role === 'agent'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                    }`}
                  >
                    {user.accountType === 'reseller_client' || user.role === 'reseller_client' ? 'Cliente VoIP Minutos' : user.role}
                  </span>
                </div>

                {/* User Credentials (Username & Password with show/copy) */}
                <div className="mb-2 py-2 px-2.5 rounded-lg bg-slate-950 border border-slate-800/80 flex items-center justify-between text-xs font-mono">
                  <div className="flex items-center gap-2 overflow-hidden">
                    <KeyRound className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                      <span className="text-slate-400">Usuario:</span>
                      <span className="text-white font-bold">{user.username || user.email.split('@')[0]}</span>
                      <span className="text-slate-600">|</span>
                      <span className="text-slate-400">Clave:</span>
                      <span className="text-emerald-300 font-bold">
                        {revealedPasswords[user.id]
                          ? user.password || '(oculta en servidor)'
                          : '••••••••'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => toggleRevealPassword(user.id)}
                      className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
                      title={revealedPasswords[user.id] ? 'Ocultar contraseña' : 'Ver contraseña'}
                    >
                      {revealedPasswords[user.id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopyCredentials(user)}
                      className="p-1 rounded text-slate-400 hover:text-emerald-300 hover:bg-slate-800 transition-colors cursor-pointer"
                      title="Copiar credenciales completas para MicroSIP"
                    >
                      {copiedUserId === user.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {/* MicroSIP Softphone & Reseller Balance Box */}
                <div className="mb-3 p-2.5 rounded-lg bg-emerald-950/20 border border-emerald-500/30 text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-emerald-400 flex items-center gap-1.5 text-[11px]">
                      <Smartphone className="w-3.5 h-3.5" />
                      <span>Softphone MicroSIP</span>
                    </span>
                    <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      Puerto 47923
                    </span>
                  </div>

                  {/* Reseller balance info if user is reseller_client or has balance */}
                  {(user.accountType === 'reseller_client' || user.role === 'reseller_client' || typeof user.balance === 'number') && (
                    <div className="pt-1 border-t border-emerald-500/20 grid grid-cols-2 gap-1.5 text-[11px] font-mono">
                      <div className="bg-slate-950/80 p-1.5 rounded border border-slate-800">
                        <span className="text-slate-400 block text-[9px] uppercase">Saldo Prepago:</span>
                        <span className="text-emerald-300 font-bold">${(user.balance || 0).toFixed(2)} USD</span>
                      </div>
                      <div className="bg-slate-950/80 p-1.5 rounded border border-slate-800">
                        <span className="text-slate-400 block text-[9px] uppercase">Tarifa Minuto:</span>
                        <span className="text-sky-300 font-bold">${user.costPerMinute || 0.02}/min</span>
                      </div>
                    </div>
                  )}

                  {/* Direct Action buttons: Descargar microsip.ini & Guía */}
                  <div className="pt-1 flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => downloadMicrosipIni(user)}
                      className="flex-1 py-1.5 px-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] flex items-center justify-center gap-1 shadow-sm transition-all cursor-pointer"
                      title="Descargar archivo microsip.ini preconfigurado con usuario y contraseña"
                    >
                      <Download className="w-3 h-3" />
                      <span>Descargar microsip.ini</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setMicrosipModalUser(user)}
                      className="py-1.5 px-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[10px] font-medium flex items-center justify-center gap-1 transition-all cursor-pointer"
                      title="Ver datos exactos para configurar MicroSIP a mano"
                    >
                      <HelpCircle className="w-3 h-3 text-emerald-400" />
                      <span>Guía</span>
                    </button>
                    {(user.accountType === 'reseller_client' || user.role === 'reseller_client' || typeof user.balance === 'number') && (
                      <button
                        type="button"
                        onClick={() => {
                          setRechargeModalUser(user);
                          setRechargeAmount(10);
                        }}
                        className="py-1.5 px-2 rounded bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold flex items-center justify-center gap-1 transition-all cursor-pointer"
                        title="Recargar saldo a este cliente"
                      >
                        <DollarSign className="w-3 h-3" />
                        <span>Recargar</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Assigned Dialing Plan Badge */}
                <div className="py-1.5 px-2 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between text-xs mb-2">
                  <span className="text-slate-400 font-medium flex items-center gap-1.5 text-[11px]">
                    <Lock className="w-3.5 h-3.5 text-amber-400" />
                    <span>Plan de Marcación:</span>
                  </span>
                  {user.role === 'admin' && !user.tenantId ? (
                    <span className="text-[10px] font-mono font-bold text-emerald-300 bg-emerald-950/70 px-2 py-0.5 rounded border border-emerald-500/30">
                      Todos (Admin)
                    </span>
                  ) : (() => {
                    const tObj = user.tenantId ? tenants.find((t) => t.id === user.tenantId) : null;
                    const primary = user.assignedCallFlowMode || tObj?.assignedCallFlowMode || 'press1';
                    const allowed = Array.isArray(user.allowedCallFlowModes) && user.allowedCallFlowModes.length > 0
                      ? user.allowedCallFlowModes
                      : Array.isArray(tObj?.allowedCallFlowModes) && tObj.allowedCallFlowModes.length > 0
                      ? tObj.allowedCallFlowModes
                      : [primary];
                    const optLabel = CALL_FLOW_MODE_OPTIONS.find((m) => m.id === primary)?.label || primary;
                    return (
                      <span className="text-[10px] font-mono font-bold text-amber-300 bg-amber-950/70 px-2 py-0.5 rounded border border-amber-500/30">
                        {optLabel}{allowed.length > 1 ? ` (+${allowed.length - 1})` : ''}
                      </span>
                    );
                  })()}
                </div>

                {/* Centro de Llamadas Masivas Access Badge */}
                <div className="py-1.5 px-2 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between text-xs mb-2">
                  <span className="text-slate-400 font-medium flex items-center gap-1.5 text-[11px]">
                    <Users className="w-3.5 h-3.5 text-purple-400" />
                    <span>Centro Masivas:</span>
                  </span>
                  {user.role === 'admin' && !user.tenantId ? (
                    <span className="text-[10px] font-mono font-bold text-emerald-300 bg-emerald-950/70 px-2 py-0.5 rounded border border-emerald-500/30">
                      Acceso Total (Admin)
                    </span>
                  ) : (() => {
                    const userTenantObj = user.tenantId ? tenants.find((t) => t.id === user.tenantId) : null;
                    const directEnabled = Boolean(user.permissions?.canUseMassCalls);
                    const tenantEnabled = Boolean(userTenantObj?.allowMassCalls && user.role !== 'agent');
                    const effectiveEnabled = directEnabled || tenantEnabled;
                    return (
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${
                            effectiveEnabled
                              ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                              : 'bg-slate-900 text-slate-400 border-slate-700'
                          }`}
                        >
                          {directEnabled ? '⚡ Habilitado' : tenantEnabled ? '⚡ Por Call Center' : '🔒 Bloqueado'}
                        </span>
                        {isGlobalSuperAdmin && (
                          <button
                            type="button"
                            onClick={() => handleToggleUserMassCalls(user)}
                            className={`text-[10px] font-bold px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                              directEnabled
                                ? 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border-rose-500/30'
                                : 'bg-purple-500/20 hover:bg-purple-500/30 text-purple-200 border-purple-500/40'
                            }`}
                            title={directEnabled ? 'Revocar acceso directo al Centro de Llamadas Masivas' : 'Dar acceso directo al Centro de Llamadas Masivas'}
                          >
                            {directEnabled ? 'Quitar' : 'Dar Acceso'}
                          </button>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Default Carrier Badge */}
                <div className="py-1.5 px-2 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between text-xs mb-2">
                  <span className="text-slate-400 font-medium flex items-center gap-1.5 text-[11px]">
                    <Network className="w-3.5 h-3.5 text-sky-400" />
                    <span>Ruta Predeterminada:</span>
                  </span>
                  {user.carrierId ? (
                    <span className="text-[10px] font-mono font-bold text-sky-300 bg-sky-950/80 px-2 py-0.5 rounded border border-sky-500/40">
                      📡 {user.carrierId} (libre)
                    </span>
                  ) : (
                    <span className="text-[10px] text-emerald-300 font-medium bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                      🌐 Selección Libre de Ruta
                    </span>
                  )}
                </div>

                {/* Assigned Call Center Badge */}
                <div className="py-1.5 px-2 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between text-xs mb-2">
                  <span className="text-slate-400 font-medium flex items-center gap-1.5 text-[11px]">
                    <Building2 className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Call Center:</span>
                  </span>
                  {user.tenantId ? (
                    <span className="text-[10px] font-mono font-bold text-indigo-300 bg-indigo-950/80 px-2 py-0.5 rounded border border-indigo-500/40">
                      🏢 {tenants.find((t) => t.id === user.tenantId)?.name || user.tenantId}
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-400 font-medium bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                      🌐 Cliente / Global
                    </span>
                  )}
                </div>

                {/* Assigned Guiones / Entidades IVR Badge */}
                <div className="mb-2.5 p-2 rounded-lg bg-slate-950/80 border border-sky-500/25 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold text-sky-300 flex items-center gap-1">
                      <BookOpen className="w-3.5 h-3.5 text-sky-400" />
                      <span>Guiones IVR Asignados</span>
                    </span>
                    {!(user.role === 'admin' && !user.tenantId) && (
                      <button
                        type="button"
                        onClick={() => handleOpenUserScriptsModal(user)}
                        className="text-[10px] font-bold text-sky-300 hover:text-sky-200 bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 px-2 py-0.5 rounded transition-colors cursor-pointer"
                      >
                        Agregar / Quitar
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {user.role === 'admin' && !user.tenantId ? (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                        Acceso Global ({availableEntities.length} activos)
                      </span>
                    ) : !Array.isArray(user.assignedEntityIds) ? (
                      user.tenantId ? (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                          Hereda del Call Center
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                          Todos los activos ({availableEntities.length})
                        </span>
                      )
                    ) : (() => {
                      const activeIds = availableEntities.length > 0
                        ? user.assignedEntityIds.filter((id) => availableEntities.some((e) => e.id === id))
                        : user.assignedEntityIds;
                      if (activeIds.length === 0) {
                        return (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                            Sin guiones asignados (0/{availableEntities.length})
                          </span>
                        );
                      }
                      return activeIds.map((entId) => {
                        const entMeta = availableEntities.find((e) => e.id === entId);
                        return (
                          <span
                            key={entId}
                            className="text-[10px] font-semibold px-2 py-0.5 rounded bg-sky-500/15 text-sky-200 border border-sky-500/30"
                          >
                            {entMeta ? entMeta.name : entId}
                          </span>
                        );
                      });
                    })()}
                  </div>
                </div>

                {/* Assigned Extensions (>= 1001) */}
                <div className="py-2.5 border-t border-b border-slate-800 space-y-1.5 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400 font-medium">Extensiones Asignadas:</span>
                    <span className="text-[11px] text-emerald-400/80 font-mono">(≥ 1001)</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 min-h-[26px]">
                    {user.assignedExtensions.length > 0 ? (
                      user.assignedExtensions.map((extNum) => (
                        <span
                          key={extNum}
                          className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-emerald-300 font-mono font-bold text-xs flex items-center gap-1"
                        >
                          <Phone className="w-3 h-3 text-emerald-400" />
                          <span>Ext {extNum}</span>
                        </span>
                      ))
                    ) : (
                      <span className="text-slate-500 italic text-xs">Ninguna asignada</span>
                    )}
                  </div>
                </div>

                {/* Permissions Snapshot */}
                <div className="py-3 space-y-1 text-xs">
                  <div className="flex justify-between items-center text-slate-400">
                    <span>Permisos activos:</span>
                    <span className="font-bold text-slate-200">
                      {activePermCount} de 8 módulos
                    </span>
                  </div>
                  <div className="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-emerald-400 h-full rounded-full transition-all"
                      style={{ width: `${(activePermCount / 8) * 100}%` }}
                    ></div>
                  </div>
                  <div className="pt-2 grid grid-cols-2 gap-1 text-[11px] text-slate-400">
                    <span className={user.permissions.canManageExtensions ? 'text-emerald-400' : 'text-slate-600'}>
                      {user.permissions.canManageExtensions ? '✓ Extensiones' : '✗ Extensiones'}
                    </span>
                    <span className={user.permissions.canManageCarriers ? 'text-emerald-400' : 'text-slate-600'}>
                      {user.permissions.canManageCarriers ? '✓ Carriers' : '✗ Carriers'}
                    </span>
                    <span className={user.permissions.canManageIVR ? 'text-emerald-400' : 'text-slate-600'}>
                      {user.permissions.canManageIVR ? '✓ IVR / OTP' : '✗ IVR / OTP'}
                    </span>
                    <span className={user.permissions.canUploadAudio ? 'text-emerald-400' : 'text-slate-600'}>
                      {user.permissions.canUploadAudio ? '✓ Audioteca' : '✗ Audioteca'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Card Footer Actions */}
              <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
                <span className="text-[11px] text-slate-500 font-mono">{user.lastLogin}</span>

                <div className="flex items-center space-x-2">
                  {!(user.role === 'admin' && !user.tenantId) && (
                    <button
                      type="button"
                      onClick={() => handleOpenUserScriptsModal(user)}
                      className="px-2 py-1 rounded text-[11px] font-semibold text-sky-300 bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 transition-colors flex items-center gap-1 cursor-pointer"
                      title="Asignar o quitar Guiones / Entidades activos para este usuario"
                    >
                      <BookOpen className="w-3.5 h-3.5" />
                      <span>
                        Guiones (
                        {Array.isArray(user.assignedEntityIds)
                          ? user.assignedEntityIds.filter((id) => availableEntities.length === 0 || availableEntities.some((e) => e.id === id)).length
                          : availableEntities.length}
                        /{availableEntities.length})
                      </span>
                    </button>
                  )}
                  <button
                    onClick={() => handleOpenEditModal(user)}
                    className="p-1.5 rounded text-slate-400 hover:text-blue-400 hover:bg-slate-800 transition-colors"
                    title="Editar usuario y permisos"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  {users.length > 1 && (
                    <button
                      onClick={() => onDeleteUser(user.id)}
                      className="p-1.5 rounded text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors"
                      title="Eliminar usuario"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal: Crear / Editar Usuario */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Users className="w-5 h-5 text-emerald-400" />
                <span>{editingUser ? 'Modificar Usuario y Permisos' : 'Crear Nuevo Usuario del Sistema'}</span>
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-white text-lg font-mono"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleSaveUser} className="space-y-4 text-xs">
              {/* General Info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Nombre Completo *</label>
                  <input
                    type="text"
                    required
                    value={formName}
                    onChange={(e) => {
                      setFormName(e.target.value);
                      if (!formUsername && !editingUser) {
                        setFormUsername(e.target.value.toLowerCase().trim().replace(/\s+/g, '.'));
                      }
                    }}
                    placeholder="Ej. Juan Pérez"
                    className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Correo Electrónico *</label>
                  <input
                    type="email"
                    required
                    value={formEmail}
                    onChange={(e) => {
                      setFormEmail(e.target.value);
                      if (!formUsername && !editingUser) {
                        setFormUsername(e.target.value.split('@')[0]);
                      }
                    }}
                    placeholder="juan.perez@empresa.com"
                    className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Login Credentials Section: Usuario y Contraseña */}
              <div className="p-3.5 rounded-lg bg-slate-950/80 border border-emerald-500/30 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-emerald-400 font-semibold text-xs">
                    <KeyRound className="w-4 h-4" />
                    <span>Credenciales de Acceso al Sistema y Softphone</span>
                  </div>
                  <span className="text-[10px] text-slate-400">Autenticación de Agente</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      Nombre de Usuario / Login *
                    </label>
                    <input
                      type="text"
                      required
                      value={formUsername}
                      onChange={(e) => setFormUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_\-]/g, ''))}
                      placeholder="Ej. juan o agente1001"
                      className="w-full px-3 py-2 rounded-md bg-slate-900 border border-slate-800 text-white font-mono focus:border-emerald-500 focus:outline-none"
                    />
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Identificador único en minúsculas para iniciar sesión en la web y en MicroSIP.
                    </p>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-slate-300 font-medium">
                        Contraseña de Acceso *
                      </label>
                      <button
                        type="button"
                        onClick={generateSecurePassword}
                        className="text-[10px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 font-semibold cursor-pointer"
                        title="Generar contraseña segura automática"
                      >
                        <Sparkles className="w-3 h-3" />
                        <span>Generar Clave</span>
                      </button>
                    </div>

                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required={!editingUser}
                        value={formPassword}
                        onChange={(e) => setFormPassword(e.target.value)}
                        placeholder={editingUser ? 'Dejar vacía para mantener la actual' : 'Introduce la contraseña...'}
                        className="w-full pl-3 pr-10 py-2 rounded-md bg-slate-900 border border-slate-800 text-white font-mono focus:border-emerald-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-0.5 cursor-pointer"
                        title={showPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {editingUser
                        ? 'Si deseas cambiarla, escribe la nueva contraseña.'
                        : 'El agente usará esta misma clave para ingresar a la web y a MicroSIP.'}
                    </p>
                  </div>
                </div>

                {/* Previsualización en Vivo de Datos para MicroSIP */}
                <div className="p-2.5 rounded-lg bg-emerald-950/30 border border-emerald-500/30 text-xs font-mono space-y-1.5">
                  <div className="text-emerald-400 font-bold flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <Smartphone className="w-3.5 h-3.5" />
                      <span>Credenciales Exactas para MicroSIP (Sin Error de Contraseña):</span>
                    </span>
                    <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 text-[10px]">
                      Puerto 47923
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px] text-slate-300">
                    <div className="bg-slate-950/70 p-1.5 rounded border border-slate-800">
                      <span className="text-slate-500 block text-[9px] uppercase">Servidor SIP & Dominio:</span>
                      <span className="text-white font-bold">{window.location.hostname || 'IP_DEL_VPS'}:47923</span>
                    </div>
                    <div className="bg-slate-950/70 p-1.5 rounded border border-slate-800">
                      <span className="text-slate-500 block text-[9px] uppercase">Usuario / Login / Auth ID:</span>
                      <span className="text-emerald-300 font-bold">{formUsername || 'ej. juan'}</span>
                    </div>
                    <div className="bg-slate-950/70 p-1.5 rounded border border-slate-800">
                      <span className="text-slate-500 block text-[9px] uppercase">Contraseña SIP:</span>
                      <span className="text-emerald-300 font-bold">{formPassword || (editingUser ? '(mantener actual)' : 'Introduce clave')}</span>
                    </div>
                    <div className="bg-slate-950/70 p-1.5 rounded border border-slate-800">
                      <span className="text-slate-500 block text-[9px] uppercase">Extensión Alterna:</span>
                      <span className="text-sky-300 font-bold">{selectedExts[0] || '1001'} (usa misma clave)</span>
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-400 pt-1 border-t border-emerald-500/20 font-sans">
                    ✓ <b>Asterisk 20</b> autenticará este usuario tanto si en MicroSIP escribes el <b>Nombre de Usuario</b> (<span className="text-emerald-300 font-mono">{formUsername || 'juan'}</span>) o el <b>Número de Extensión</b> (<span className="text-sky-300 font-mono">{selectedExts[0] || '1001'}</span>) con esta misma contraseña.
                  </p>
                </div>
              </div>

              {/* Role Presets */}
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Rol y Tipo de Cuenta
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <button
                    type="button"
                    onClick={() => applyRolePreset('reseller_client')}
                    className={`p-2.5 rounded-lg border text-left transition-all ${
                      formAccountType === 'reseller_client' || formRole === 'reseller_client'
                        ? 'bg-emerald-500/20 border-emerald-500 text-white shadow-sm'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800'
                    }`}
                  >
                    <div className="font-bold text-xs text-emerald-400 flex items-center gap-1">
                      <DollarSign className="w-3.5 h-3.5" />
                      <span>Cliente VoIP Minutos</span>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">Marcación manual MicroSIP con saldo prepago</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => applyRolePreset('agent')}
                    className={`p-2.5 rounded-lg border text-left transition-all ${
                      formRole === 'agent' && formAccountType !== 'reseller_client'
                        ? 'bg-emerald-500/20 border-emerald-500 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800'
                    }`}
                  >
                    <div className="font-bold text-xs">Agente Interno</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">Solo softphone y campañas internas</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => applyRolePreset('supervisor')}
                    className={`p-2.5 rounded-lg border text-left transition-all ${
                      formRole === 'supervisor'
                        ? 'bg-blue-500/20 border-blue-500 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800'
                    }`}
                  >
                    <div className="font-bold text-xs">Supervisor</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">Extensiones, IVR y Audioteca</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => applyRolePreset('admin')}
                    className={`p-2.5 rounded-lg border text-left transition-all ${
                      formRole === 'admin'
                        ? 'bg-red-500/20 border-red-500 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800'
                    }`}
                  >
                    <div className="font-bold text-xs">Administrador</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">Control total del sistema y AMI</div>
                  </button>
                </div>
              </div>

              {/* Parametros de Reventa de Minutos si es Cliente VoIP */}
              {(formAccountType === 'reseller_client' || formRole === 'reseller_client') && (
                <div className="p-3.5 rounded-lg bg-emerald-950/20 border border-emerald-500/40 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-emerald-400 text-xs flex items-center gap-1.5">
                      <DollarSign className="w-4 h-4" />
                      <span>Configuración de Saldo Prepago y Facturación por Minuto</span>
                    </span>
                    <span className="text-[10px] text-emerald-300 font-mono font-bold bg-emerald-500/20 px-2 py-0.5 rounded border border-emerald-500/30">
                      Reventa de Minutos
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div>
                      <label className="block text-slate-300 font-medium mb-1">
                        Saldo Prepago Inicial ($ USD)
                      </label>
                      <input
                        type="number"
                        step="0.50"
                        min="0"
                        value={formBalance}
                        onChange={(e) => setFormBalance(parseFloat(e.target.value) || 0)}
                        className="w-full px-3 py-2 rounded-md bg-slate-900 border border-slate-800 text-emerald-300 font-mono font-bold focus:border-emerald-500 focus:outline-none"
                      />
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        Saldo disponible para llamadas salientes.
                      </p>
                    </div>

                    <div>
                      <label className="block text-slate-300 font-medium mb-1">
                        Tarifa por Minuto ($ USD / min)
                      </label>
                      <input
                        type="number"
                        step="0.005"
                        min="0.001"
                        value={formRate}
                        onChange={(e) => setFormRate(parseFloat(e.target.value) || 0.02)}
                        className="w-full px-3 py-2 rounded-md bg-slate-900 border border-slate-800 text-sky-300 font-mono font-bold focus:border-emerald-500 focus:outline-none"
                      />
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        Costo deducido por cada minuto conectado.
                      </p>
                    </div>

                    <div>
                      <label className="block text-slate-300 font-medium mb-1">
                        Minutos Aproximados
                      </label>
                      <div className="px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-emerald-400 font-mono font-bold text-sm flex items-center justify-between">
                        <span>{Math.round(formBalance / (formRate || 0.02))} min</span>
                        <span className="text-[10px] text-slate-500">al agotar saldo</span>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        Calculado en tiempo real según la tarifa.
                      </p>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-emerald-500/20 flex items-center justify-between">
                    <label className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formCutoffOnZero}
                        onChange={(e) => setFormCutoffOnZero(e.target.checked)}
                        className="rounded bg-slate-900 border-slate-700 text-emerald-500 focus:ring-0"
                      />
                      <span>Cortar llamada saliente automáticamente si el saldo llega a $0.00 USD</span>
                    </label>
                  </div>
                </div>
              )}

              {/* Default Carrier / Trunk Selector */}
              <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800 space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-slate-200 font-semibold flex items-center gap-1.5 text-xs">
                    <Network className="w-4 h-4 text-sky-400" />
                    <span>Ruta Saliente Predeterminada (Opcional)</span>
                  </label>
                  <span className="text-[10px] text-sky-300 font-mono bg-sky-500/20 px-2 py-0.5 rounded border border-sky-500/30">
                    El cliente elige ruta
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Ruta inicial sugerida; el cliente podrá elegir libremente entre las rutas salientes activas al lanzar llamadas.
                </p>

                <select
                  value={formCarrierId}
                  onChange={(e) => setFormCarrierId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-xs focus:outline-none focus:border-sky-400 font-mono"
                >
                  <option value="auto">🌐 Automático / Pool General (Failover estándar entre troncales activas)</option>
                  {carriers.map((c) => {
                    const cSlug = c.name.replace(/\s+/g, '_');
                    return (
                      <option key={c.id} value={cSlug}>
                        📡 {c.name} ({c.host}:{c.port || 5060}) {c.status === 'reachable' ? '● En línea' : ''}
                      </option>
                    );
                  })}
                </select>
                {formCarrierId !== 'auto' && (
                  <p className="text-[10px] text-emerald-400 font-medium">
                    ✓ Ruta predeterminada sugerida: <strong className="font-mono text-white">{formCarrierId}</strong> (el cliente puede cambiarla en el marcador).
                  </p>
                )}
              </div>

              {/* Asignación de Call Center para Administrador o Agente (Partición de Audios y Base de Datos OTP) */}
              <div className="p-3.5 rounded-lg bg-indigo-950/20 border border-indigo-500/40 space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-indigo-200 font-semibold flex items-center gap-1.5 text-xs">
                    <Building2 className="w-4 h-4 text-indigo-400" />
                    <span>Asignar a un Call Center (Base de Datos y Audios Divididos)</span>
                  </label>
                  <span className="text-[10px] text-indigo-300 font-mono bg-indigo-500/20 px-2 py-0.5 rounded border border-indigo-500/30">
                    Aislamiento Multi-Tenant
                  </span>
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  Cuando creas o editas este administrador o agente, al asignarle un Call Center su base de datos queda <strong>estrictamente dividida</strong>: solo tendrá acceso a los audios subidos para su centro y solo verá/validará los códigos OTP capturados por sus agentes.
                </p>

                <select
                  value={formTenantId}
                  onChange={(e) => {
                    const nextTenantId = e.target.value;
                    setFormTenantId(nextTenantId);
                    if (!editingUser && nextTenantId) {
                      const t = tenants.find((item) => item.id === nextTenantId);
                      if (t && Array.isArray(t.assignedEntityIds)) {
                        const activeIdSet = new Set(availableEntities.map((ent) => ent.id));
                        setFormAssignedEntityIds(
                          t.assignedEntityIds.filter((id) => activeIdSet.size === 0 || activeIdSet.has(id))
                        );
                      }
                      if (t?.assignedCallFlowMode) {
                        const primary = t.assignedCallFlowMode;
                        const allowed =
                          Array.isArray(t.allowedCallFlowModes) && t.allowedCallFlowModes.length > 0
                            ? Array.from(new Set<CallFlowMode>([primary, ...t.allowedCallFlowModes]))
                            : [primary];
                        setFormAssignedCallFlowMode(primary);
                        setFormAllowedCallFlowModes(allowed);
                      }
                    }
                  }}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-indigo-500/30 text-slate-200 text-xs focus:outline-none focus:border-indigo-400 font-mono"
                >
                  <option value="">🌐 Sin asignar (Cliente Individual 2001+ o Administrador Global)</option>
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      🏢 {t.name} [{t.code}] — Rango Ext: {t.extensionStart}-{t.extensionEnd} ({t.dialplanContext})
                    </option>
                  ))}
                </select>

                {formTenantId ? (
                  <div className="p-2.5 rounded bg-indigo-950/40 border border-indigo-500/30 text-[11px] text-indigo-200 flex items-start gap-2">
                    <Shield className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold">Partición Activa para este Administrador / Agente:</span> Perteneciente al Call Center <strong className="text-white font-mono">{tenants.find((t) => t.id === formTenantId)?.name || formTenantId}</strong>. Sus audios, guiones y registros OTP no se cruzarán con otros grupos.
                    </div>
                  </div>
                ) : (
                  <p className="text-[10px] text-slate-400">
                    💡 Sin Call Center: Ideal para Clientes Individuales (extensión 2001+) o Super Administrador Global.
                  </p>
                )}
              </div>

              {/* Plan de Marcación Asignado (Solo Administrador) */}
              <div className="p-3.5 rounded-lg bg-slate-950 border border-amber-500/35 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <label className="text-amber-300 font-bold flex items-center gap-1.5 text-xs">
                      <Lock className="w-4 h-4 text-amber-400" />
                      <span>Plan de Marcación Asignado (Solo Administrador)</span>
                    </label>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {formRole === 'admin' && !formTenantId
                        ? 'El Super Administrador Global tiene acceso completo para asignar y configurar todos los planes de marcación.'
                        : 'Solo el Administrador puede asignar qué plan(es) de marcación ejecutará este cliente.'}
                    </p>
                  </div>
                </div>

                {formRole === 'admin' && !formTenantId ? (
                  <div className="p-2.5 rounded-lg bg-emerald-950/25 border border-emerald-500/30 text-[11px] text-emerald-300">
                    ✓ Acceso completo a todos los planes de marcación para Super Administrador Global.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                    <div>
                      <label className="block text-[11px] text-slate-300 font-semibold mb-1">
                        Plan Principal Asignado
                      </label>
                      <select
                        value={formAssignedCallFlowMode}
                        onChange={(e) => {
                          const nextPrimary = e.target.value as CallFlowMode;
                          setFormAssignedCallFlowMode(nextPrimary);
                          setFormAllowedCallFlowModes((prev) =>
                            Array.from(new Set<CallFlowMode>([nextPrimary, ...prev]))
                          );
                        }}
                        className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-amber-300 font-bold text-xs focus:outline-none focus:border-amber-400"
                      >
                        {CALL_FLOW_MODE_OPTIONS.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] text-slate-300 font-semibold mb-1">
                        Planes Permitidos ({formAllowedCallFlowModes.length}/{CALL_FLOW_MODE_OPTIONS.length})
                      </label>
                      <div className="space-y-1">
                        {CALL_FLOW_MODE_OPTIONS.map((opt) => {
                          const isPrimary = formAssignedCallFlowMode === opt.id;
                          const isChecked = isPrimary || formAllowedCallFlowModes.includes(opt.id);
                          return (
                            <label
                              key={opt.id}
                              className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                                isChecked
                                  ? 'bg-amber-950/40 border-amber-500/50 text-white'
                                  : 'bg-slate-900/70 border-slate-800 text-slate-400 hover:border-slate-700'
                              }`}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  disabled={isPrimary}
                                  onChange={(e) => {
                                    if (isPrimary) return;
                                    setFormAllowedCallFlowModes((prev) => {
                                      const next = e.target.checked
                                        ? Array.from(new Set<CallFlowMode>([...prev, opt.id]))
                                        : prev.filter((m) => m !== opt.id);
                                      return next.length > 0 ? next : [formAssignedCallFlowMode];
                                    });
                                  }}
                                  className="rounded border-slate-700 text-amber-500 focus:ring-amber-500 bg-slate-950"
                                />
                                <span className="truncate font-semibold">{opt.label}</span>
                              </div>
                              {isPrimary && (
                                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 shrink-0">
                                  Principal
                                </span>
                              )}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Acceso a Centro de Llamadas Masivas (Solo Administrador) */}
              <div className="p-3.5 rounded-lg bg-slate-950 border border-purple-500/35 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-purple-300 font-bold flex items-center gap-1.5 text-xs">
                    <Users className="w-4 h-4 text-purple-400" />
                    <span>Centro de Llamadas Masivas (Solo Administrador)</span>
                  </label>
                  <span
                    className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${
                      (formRole === 'admin' && !formTenantId) || permissions.canUseMassCalls
                        ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                        : 'bg-slate-900 text-slate-400 border-slate-700'
                    }`}
                  >
                    {(formRole === 'admin' && !formTenantId) || permissions.canUseMassCalls ? '⚡ Habilitado' : '🔒 Bloqueado'}
                  </span>
                </div>

                {formRole === 'admin' && !formTenantId ? (
                  <div className="p-2.5 rounded-lg bg-emerald-950/25 border border-emerald-500/30 text-[11px] text-emerald-300">
                    ✓ El Super Administrador Global siempre tiene acceso al Centro de Llamadas Masivas.
                  </div>
                ) : (
                  <label className={`flex items-start gap-2.5 p-2.5 rounded-lg border transition-colors ${isGlobalSuperAdmin ? 'cursor-pointer bg-slate-900/70 border-slate-800 hover:border-purple-500/40' : 'opacity-60 cursor-not-allowed bg-slate-900/40 border-slate-800'}`}>
                    <input
                      type="checkbox"
                      checked={Boolean(permissions.canUseMassCalls)}
                      disabled={!isGlobalSuperAdmin}
                      onChange={(e) => {
                        if (!isGlobalSuperAdmin) return;
                        setPermissions((prev) => ({
                          ...prev,
                          canUseMassCalls: e.target.checked,
                        }));
                      }}
                      className="mt-0.5 rounded border-slate-700 text-purple-500 focus:ring-purple-500 bg-slate-950"
                    />
                    <div className="text-[11px] text-slate-300 leading-relaxed">
                      <span className="font-bold text-white block">
                        Permitir acceso al Centro de Llamadas Masivas (Ring-All)
                      </span>
                      <span className="text-slate-400">
                        Solo el Administrador puede habilitar esta función para clientes. Si está desactivada, solo podrá usar el Disparador Individual (1 a 1).
                      </span>
                    </div>
                  </label>
                )}
              </div>

              {/* Guiones / Entidades a Simular Permitidos para este Usuario */}
              <div className="p-3.5 rounded-lg bg-slate-950 border border-sky-500/30 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <label className="text-sky-300 font-bold flex items-center gap-1.5 text-xs">
                      <BookOpen className="w-4 h-4 text-sky-400" />
                      <span>
                        Guiones / Entidades a Simular Permitidos (
                        {formRole === 'admin' && !formTenantId
                          ? availableEntities.length
                          : formAssignedEntityIds.filter((id) => availableEntities.some((e) => e.id === id)).length}
                        /{availableEntities.length})
                      </span>
                    </label>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {formRole === 'admin' && !formTenantId
                        ? 'El Super Administrador Global tiene acceso total a todos los guiones activos.'
                        : 'Solo aparecen tus guiones activos reales. Selecciona cuáles podrá trabajar este usuario cada día sin mezclarse con otros.'}
                    </p>
                  </div>
                  {!(formRole === 'admin' && !formTenantId) && availableEntities.length > 0 && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => setFormAssignedEntityIds(availableEntities.map((e) => e.id))}
                        className="px-2 py-1 rounded text-[10px] font-bold bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/30 cursor-pointer"
                      >
                        Todos
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormAssignedEntityIds([])}
                        className="px-2 py-1 rounded text-[10px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer"
                      >
                        Ninguno
                      </button>
                    </div>
                  )}
                </div>

                {formRole === 'admin' && !formTenantId ? (
                  <div className="p-2.5 rounded-lg bg-emerald-950/25 border border-emerald-500/30 text-[11px] text-emerald-300">
                    ✓ Acceso completo habilitado para Super Administrador Global.
                  </div>
                ) : availableEntities.length === 0 ? (
                  <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-500/30 text-[11px] text-amber-200">
                    No hay guiones activos configurados todavía. Ve a <strong>Operaciones → Guión / Entidad a Simular</strong> para crear o activar los guiones reales que utilizas.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto pr-1">
                    {availableEntities.map((ent) => {
                      const checked = formAssignedEntityIds.includes(ent.id);
                      const tenantObj = formTenantId ? tenants.find((t) => t.id === formTenantId) : null;
                      const blockedByTenant = Boolean(
                        tenantObj &&
                          Array.isArray(tenantObj.assignedEntityIds) &&
                          !tenantObj.assignedEntityIds.includes(ent.id)
                      );
                      return (
                        <label
                          key={ent.id}
                          className={`flex items-center gap-2.5 p-2 rounded-lg border cursor-pointer transition-colors ${
                            checked
                              ? 'bg-sky-950/50 border-sky-500/50 text-white'
                              : 'bg-slate-900/70 border-slate-800 text-slate-400 hover:border-slate-700'
                          } ${blockedByTenant ? 'opacity-60' : ''}`}
                          title={blockedByTenant ? 'Este guión no está habilitado en el Call Center seleccionado' : ent.name}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? [...formAssignedEntityIds, ent.id]
                                : formAssignedEntityIds.filter((id) => id !== ent.id);
                              setFormAssignedEntityIds(next);
                            }}
                            className="rounded border-slate-700 text-sky-500 focus:ring-sky-500 bg-slate-950"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-bold truncate">{ent.name}</div>
                            {ent.subtitle && <div className="text-[10px] text-slate-400 truncate">{ent.subtitle}</div>}
                            {blockedByTenant && (
                              <div className="text-[9px] text-amber-400">No activo en su Call Center</div>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Assign Extensions Section (1000 Admin Spy, 1001-1999 Call Centers, 2001+ Clientes) */}
              <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800 space-y-2">
                <div className="flex flex-wrap justify-between items-center gap-2">
                  <label className="text-slate-200 font-semibold flex items-center gap-1.5">
                    <Phone className="w-4 h-4 text-emerald-400" />
                    <span>Asignar Extensiones PJSIP (1001–1999 Call Centers • 2001+ Clientes)</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const nextExt = getNextClientExtension2001();
                        if (!selectedExts.includes(nextExt)) {
                          setSelectedExts([...selectedExts.filter((e) => parseInt(e, 10) >= 2001), nextExt]);
                        }
                      }}
                      className="px-2 py-0.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-[10px] font-mono font-bold cursor-pointer"
                      title="Asigna automáticamente la siguiente extensión libre a partir de la 2001 para clientes individuales"
                    >
                      + Auto-Ext Cliente ({getNextClientExtension2001()})
                    </button>
                    <span className="text-[11px] text-slate-400 font-mono">
                      {selectedExts.length} asignadas
                    </span>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400">
                  Clientes individuales (sin Call Center) operan en el rango <strong className="text-emerald-300 font-mono">2001+</strong>; si la extensión seleccionada aún no existe, se creará automáticamente al guardar.
                </p>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                  {selectedExts
                    .filter((extNum) => !availableExtensions.some((e) => e.extension === extNum))
                    .map((extNum) => (
                      <button
                        type="button"
                        key={`pending-${extNum}`}
                        onClick={() => toggleExtensionAssignment(extNum)}
                        className="p-2 rounded border text-left font-mono transition-all flex items-center justify-between bg-emerald-500/20 border-emerald-500/60 text-emerald-200"
                      >
                        <div>
                          <div className="font-bold text-xs">{extNum}</div>
                          <div className="text-[10px] truncate max-w-[90px] font-sans text-emerald-300">Nueva Cliente</div>
                        </div>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      </button>
                    ))}
                  {availableExtensions.map((ext) => {
                    const isSelected = selectedExts.includes(ext.extension);
                    const extInt = parseInt(ext.extension, 10);
                    return (
                      <button
                        type="button"
                        key={ext.id}
                        onClick={() => toggleExtensionAssignment(ext.extension)}
                        className={`p-2 rounded border text-left font-mono transition-all flex items-center justify-between ${
                          isSelected
                            ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-200'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <div>
                          <div className="font-bold text-xs flex items-center gap-1">
                            <span>{ext.extension}</span>
                            {extInt === 1000 && <span className="text-[9px] text-cyan-400">ESPÍA</span>}
                            {extInt >= 2001 && <span className="text-[9px] text-emerald-400">CLI</span>}
                          </div>
                          <div className="text-[10px] truncate max-w-[80px] font-sans text-slate-400">{ext.name}</div>
                        </div>
                        {isSelected && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Granular Permissions Checklist */}
              <div className="space-y-2">
                <label className="block text-slate-200 font-semibold flex items-center gap-1.5">
                  <Sliders className="w-4 h-4 text-emerald-400" />
                  <span>¿Qué puede usar del sistema? (Permisos específicos)</span>
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {permissionList.map(({ key, label, desc }) => {
                    const hasPerm = permissions[key];
                    return (
                      <div
                        key={key}
                        onClick={() => togglePermission(key)}
                        className={`p-2.5 rounded-lg border cursor-pointer transition-all flex items-start space-x-2.5 ${
                          hasPerm
                            ? 'bg-slate-800/80 border-emerald-500/40 text-slate-200'
                            : 'bg-slate-950 border-slate-800 text-slate-400 opacity-60 hover:opacity-100'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={hasPerm}
                          onChange={() => {}} // handled by parent div
                          className="mt-0.5 rounded bg-slate-900 border-slate-700 text-emerald-500 focus:ring-0 pointer-events-none"
                        />
                        <div>
                          <div className="font-medium text-xs leading-tight">{label}</div>
                          <div className="text-[10px] text-slate-400 leading-snug">{desc}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Form Buttons */}
              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-bold"
                >
                  {editingUser ? 'Guardar Cambios' : 'Crear Usuario'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Guía Paso a Paso MicroSIP para el Usuario */}
      {microsipModalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border border-emerald-500/40 rounded-xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-white">Configurar MicroSIP para {microsipModalUser.name}</h3>
                  <p className="text-xs text-slate-400">Asterisk 20 PJSIP (Puerto 47923)</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMicrosipModalUser(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-lg bg-emerald-950/30 border border-emerald-500/30 text-emerald-300">
                <span className="font-bold block mb-1">✓ Autenticación Verificada sin Error de Contraseña:</span>
                Asterisk 20 reconoce tanto el <b>Nombre de Usuario</b> como la <b>Extensión</b> con la contraseña configurada.
              </div>

              {/* Exact Credentials Table */}
              <div className="rounded-lg border border-slate-800 overflow-hidden font-mono text-[11px]">
                <div className="flex justify-between py-1.5 px-3 bg-slate-950 border-b border-slate-800">
                  <span className="text-slate-400">Servidor SIP:</span>
                  <span className="text-emerald-400 font-bold">{window.location.hostname || 'IP_DEL_VPS'}:47923</span>
                </div>
                <div className="flex justify-between py-1.5 px-3 bg-slate-900 border-b border-slate-800">
                  <span className="text-slate-400">Proxy SIP:</span>
                  <span className="text-slate-500">(dejar vacío)</span>
                </div>
                <div className="flex justify-between py-1.5 px-3 bg-slate-950 border-b border-slate-800">
                  <span className="text-slate-400">Usuario (User):</span>
                  <span className="text-white font-bold">{microsipModalUser.username || microsipModalUser.email.split('@')[0]}</span>
                </div>
                <div className="flex justify-between py-1.5 px-3 bg-slate-900 border-b border-slate-800">
                  <span className="text-slate-400">Dominio:</span>
                  <span className="text-emerald-400 font-bold">{window.location.hostname || 'IP_DEL_VPS'}:47923</span>
                </div>
                <div className="flex justify-between py-1.5 px-3 bg-slate-950 border-b border-slate-800">
                  <span className="text-slate-400">Login / Auth ID:</span>
                  <span className="text-white font-bold">{microsipModalUser.username || microsipModalUser.email.split('@')[0]}</span>
                </div>
                <div className="flex justify-between py-1.5 px-3 bg-slate-900 border-b border-slate-800">
                  <span className="text-slate-400">Contraseña:</span>
                  <span className="text-emerald-300 font-bold">{microsipModalUser.password || '(usa "Descargar microsip.ini" para obtenerla)'}</span>
                </div>
                <div className="flex justify-between py-1.5 px-3 bg-slate-950 border-b border-slate-800">
                  <span className="text-slate-400">Extensión Alterna:</span>
                  <span className="text-sky-300 font-bold">{microsipModalUser.assignedExtensions?.[0] || '1001'}</span>
                </div>
                <div className="flex justify-between py-1.5 px-3 bg-slate-900">
                  <span className="text-slate-400">Transporte:</span>
                  <span className="text-slate-300 font-bold">UDP</span>
                </div>
              </div>

              {/* Instructions steps */}
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1.5 text-slate-300">
                <div className="font-bold text-white text-xs">Instrucciones Rápidas:</div>
                <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-400">
                  <li>Opción 1 (Automática): Haz clic en <b>"Descargar microsip.ini"</b> y ábrelo con MicroSIP.</li>
                  <li>Opción 2 (Manual): En MicroSIP pulsa la flecha superior derecha -&gt; <b>Añadir Cuenta</b>.</li>
                  <li>Copia y pega los campos de la tabla arriba con el puerto <b>47923</b>.</li>
                  <li>Pulsa Guardar. Verás el punto verde <b>En Línea / Online</b> de inmediato.</li>
                </ol>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => downloadMicrosipIni(microsipModalUser)}
                className="flex-1 py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-md transition-all"
              >
                <Download className="w-4 h-4" />
                <span>Descargar microsip.ini</span>
              </button>
              <button
                type="button"
                onClick={() => handleCopyCredentials(microsipModalUser)}
                className="py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all"
              >
                <Copy className="w-4 h-4 text-emerald-400" />
                <span>Copiar Datos</span>
              </button>
              <button
                type="button"
                onClick={() => setMicrosipModalUser(null)}
                className="py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white text-xs cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Recargar Saldo de Minutos */}
      {rechargeModalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border border-emerald-500/40 rounded-xl max-w-sm w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400">
                  <DollarSign className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-white">Recargar Minutos VoIP</h3>
                  <p className="text-xs text-slate-400">{rechargeModalUser.name}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRechargeModalUser(null)}
                className="p-1 rounded text-slate-400 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-2.5 rounded bg-slate-950 border border-slate-800 flex justify-between items-center font-mono">
                <span className="text-slate-400">Saldo Actual:</span>
                <span className="text-emerald-400 font-bold">${(rechargeModalUser.balance || 0).toFixed(2)} USD</span>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Monto a Recargar ($ USD)
                </label>
                <input
                  type="number"
                  step="1"
                  min="1"
                  value={rechargeAmount}
                  onChange={(e) => setRechargeAmount(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-emerald-300 font-mono font-bold text-base focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-4 gap-1.5 pt-1">
                {[5, 10, 20, 50].map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setRechargeAmount(amt)}
                    className={`py-1.5 rounded border text-xs font-mono font-bold transition-all ${
                      rechargeAmount === amt
                        ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800'
                    }`}
                  >
                    +${amt}
                  </button>
                ))}
              </div>

              <div className="p-2.5 rounded bg-emerald-950/20 border border-emerald-500/30 text-[11px] text-emerald-300 font-mono flex justify-between items-center">
                <span>Nuevo Saldo:</span>
                <span className="font-bold text-white">${((rechargeModalUser.balance || 0) + rechargeAmount).toFixed(2)} USD</span>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  const newBal = (rechargeModalUser.balance || 0) + rechargeAmount;
                  const updated: SystemUser = {
                    ...rechargeModalUser,
                    balance: newBal,
                    allocatedMinutes: Math.round(newBal / (rechargeModalUser.costPerMinute || 0.02)),
                  };
                  onUpdateUser(updated);
                  fetch('/api/users/sync-sip', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user: updated }),
                  }).catch(() => {});
                  setRechargeModalUser(null);
                  setSyncFeedback(`✓ Saldo de $${rechargeAmount} USD acreditado a ${rechargeModalUser.name}. Saldo total: $${newBal.toFixed(2)} USD.`);
                  setTimeout(() => setSyncFeedback(null), 5000);
                }}
                className="flex-1 py-2 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-md transition-all"
              >
                <Check className="w-4 h-4" />
                <span>Confirmar Recarga</span>
              </button>
              <button
                type="button"
                onClick={() => setRechargeModalUser(null)}
                className="py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white text-xs cursor-pointer"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Asignar / Quitar Guiones IVR Activos para Usuario */}
      {scriptsModalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-sky-500/40 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <BookOpen className="w-5 h-5 text-sky-400" />
                <div>
                  <h3 className="font-bold text-white text-base">
                    Guiones / Entidades para: {scriptsModalUser.name}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Elige qué guiones activos podrá usar este usuario sin mezclarse con otros Call Centers ni clientes.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setScriptsModalUser(null)}
                className="text-slate-400 hover:text-white text-sm px-2 py-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 font-semibold">
                Seleccionados: <strong className="text-sky-400 font-mono">{scriptsModalSelectedIds.filter((id) => availableEntities.some((e) => e.id === id)).length}</strong> de {availableEntities.length} activos
              </span>
              {availableEntities.length > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setScriptsModalSelectedIds(availableEntities.map((e) => e.id))}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/30 cursor-pointer"
                  >
                    Seleccionar Todos
                  </button>
                  <button
                    type="button"
                    onClick={() => setScriptsModalSelectedIds([])}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer"
                  >
                    Quitar Todos
                  </button>
                </div>
              )}
            </div>

            {availableEntities.length === 0 ? (
              <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-500/30 text-xs text-amber-200">
                No hay guiones activos creados todavía. Ve a <strong>Operaciones → Guión / Entidad a Simular</strong> para activar o crear tus guiones reales.
              </div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {availableEntities.map((ent) => {
                  const isAssigned = scriptsModalSelectedIds.includes(ent.id);
                  return (
                    <label
                      key={ent.id}
                      className={`flex items-center justify-between gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                        isAssigned
                          ? 'bg-sky-950/40 border-sky-500/50 text-white'
                          : 'bg-slate-950/70 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <input
                          type="checkbox"
                          checked={isAssigned}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setScriptsModalSelectedIds((prev) => [...prev, ent.id]);
                            } else {
                              setScriptsModalSelectedIds((prev) => prev.filter((id) => id !== ent.id));
                            }
                          }}
                          className="rounded border-slate-700 text-sky-500 focus:ring-sky-500 bg-slate-950"
                        />
                        <div className="min-w-0">
                          <div className="text-xs font-bold truncate">{ent.name}</div>
                          {ent.subtitle && <div className="text-[11px] text-slate-400 truncate">{ent.subtitle}</div>}
                        </div>
                      </div>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                          isAssigned
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'bg-slate-800 text-slate-500 border border-slate-700'
                        }`}
                      >
                        {isAssigned ? 'Habilitado' : 'Oculto'}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setScriptsModalUser(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveUserScripts}
                className="px-5 py-2 rounded-xl text-xs font-black text-slate-950 bg-sky-400 hover:bg-sky-300 transition-colors shadow-lg shadow-sky-500/20 cursor-pointer"
              >
                Guardar Guiones del Usuario
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
