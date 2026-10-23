import React, { useState } from 'react';
import { SystemUser, PjsipExtension, UserPermissions, CarrierTrunk } from '../types';
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
} from 'lucide-react';

interface UsersTabProps {
  users: SystemUser[];
  extensions: PjsipExtension[];
  carriers?: CarrierTrunk[];
  currentUserId: string;
  currentUser?: SystemUser;
  onSwitchUser: (userId: string) => void;
  onAddUser: (user: SystemUser) => void;
  onUpdateUser: (user: SystemUser) => void;
  onDeleteUser: (userId: string) => void;
  onNavigateToProduction?: () => void;
}

export const UsersTab: React.FC<UsersTabProps> = ({
  users,
  extensions,
  carriers = [],
  currentUserId,
  currentUser,
  onSwitchUser,
  onAddUser,
  onUpdateUser,
  onDeleteUser,
  onNavigateToProduction,
}) => {
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
  const [formStatus, setFormStatus] = useState<SystemUser['status']>('active');
  const [selectedExts, setSelectedExts] = useState<string[]>([]);
  const [revealedPasswords, setRevealedPasswords] = useState<Record<string, boolean>>({});
  const [copiedUserId, setCopiedUserId] = useState<string | null>(null);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  // Modals for MicroSIP setup and balance recharge
  const [microsipModalUser, setMicrosipModalUser] = useState<SystemUser | null>(null);
  const [rechargeModalUser, setRechargeModalUser] = useState<SystemUser | null>(null);
  const [rechargeAmount, setRechargeAmount] = useState<number>(10);

  const [permissions, setPermissions] = useState<UserPermissions>({
    canManageExtensions: false,
    canManageCarriers: false,
    canManageIVR: false,
    canUploadAudio: false,
    canSyncAsterisk: false,
    canUseSoftphone: true,
    canManageUsers: false,
    canExportConfigs: false,
  });

  // Filter only extensions >= 1001
  const availableExtensions = extensions.filter((e) => {
    const num = parseInt(e.extension, 10);
    return !isNaN(num) && num >= 1001;
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
      });
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
    const text = `Servidor SIP: ${window.location.hostname || 'IP_DEL_VPS'}:47923\nUsuario: ${cleanUser}\nDominio: ${window.location.hostname || 'IP_DEL_VPS'}\nLogin: ${cleanUser}\nContraseña: ${user.password || 'password123'}\nExtensiones: ${user.assignedExtensions.join(', ') || cleanUser}`;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
    }
    setCopiedUserId(user.id);
    setTimeout(() => setCopiedUserId(null), 2500);
  };

  // Helper to generate and download microsip.ini directly
  const downloadMicrosipIni = (user: SystemUser) => {
    const cleanUser = String(user.username || user.email.split('@')[0]).trim().toLowerCase().replace(/[^a-zA-Z0-9_\-]/g, '');
    const pass = user.password || 'password123';
    const host = window.location.hostname || '127.0.0.1';
    const port = 47923;

    const content = `[Settings]
autoAnswer=0
denyIncoming=0
directory=
disableLocalRing=0
enableLocalDTMF=1
enableLog=0
enableSTUN=0
forceCodec=
hideCallerId=0
localPort=0
ringtone=
server=${host}:${port}
singleMode=0
volumeIn=100
volumeOut=100

[Account1]
accountName=${user.name || cleanUser}
server=${host}:${port}
proxy=
user=${cleanUser}
domain=${host}:${port}
login=${cleanUser}
password=${pass}
displayName=${user.name || cleanUser}
authID=${cleanUser}
transport=UDP
mediaEncryption=
publish=0
regInterval=300
`;

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `microsip_${cleanUser}.ini`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleOpenCreateModal = () => {
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
    setFormStatus('active');
    // Default assign first available extension >= 1001
    setSelectedExts(availableExtensions.length > 0 ? [availableExtensions[0].extension] : ['1001']);
    applyRolePreset('reseller_client');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (user: SystemUser) => {
    setEditingUser(user);
    setFormName(user.name);
    setFormEmail(user.email);
    setFormUsername(user.username || user.email.split('@')[0]);
    setFormPassword(user.password || '');
    setShowPassword(false);
    setFormRole(user.role);
    setFormAccountType(user.accountType || (user.role === 'reseller_client' ? 'reseller_client' : 'agent'));
    setFormBalance(typeof user.balance === 'number' ? user.balance : 10.00);
    setFormRate(typeof user.costPerMinute === 'number' ? user.costPerMinute : 0.02);
    setFormCutoffOnZero(user.cutoffOnZero !== false);
    setFormCarrierId(user.carrierId || 'auto');
    setFormStatus(user.status);
    setSelectedExts(user.assignedExtensions);
    setPermissions(user.permissions);
    setIsModalOpen(true);
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
    const passwordFinal = formPassword.trim() || editingUser?.password || 'password123';

    const colors = [
      'from-emerald-500 to-teal-700',
      'from-blue-500 to-indigo-600',
      'from-emerald-600 to-green-500',
      'from-purple-500 to-pink-600',
      'from-teal-500 to-emerald-600',
    ];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];

    const userObj: SystemUser = {
      ...(editingUser || {}),
      id: editingUser ? editingUser.id : `user-${Date.now()}`,
      name: formName,
      email: formEmail,
      username: usernameFinal,
      password: passwordFinal,
      role: formAccountType === 'reseller_client' ? 'reseller_client' : formRole,
      accountType: formAccountType,
      balance: formBalance,
      costPerMinute: formRate,
      allocatedMinutes: Math.round(formBalance / (formRate || 0.02)),
      usedMinutes: editingUser?.usedMinutes || 0,
      cutoffOnZero: formCutoffOnZero,
      carrierId: formCarrierId === 'auto' ? undefined : formCarrierId,
      assignedExtensions: selectedExts,
      permissions,
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

    // Auto-provision immediately in Asterisk 20 PJSIP
    fetch('/api/users/sync-sip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: userObj }),
    })
      .then((r) => r.json())
      .then((data) => {
        setSyncFeedback(`✓ Usuario "${usernameFinal}" registrado en Asterisk PJSIP (Puerto 47923). MicroSIP ya puede conectarse.`);
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
      key: 'canExportConfigs',
      label: 'Exportar Archivos de Configuración',
      desc: 'Descargar pjsip.conf, extensions.conf y scripts de aprovisionamiento',
    },
  ];

  const activeUser = currentUser || users.find((u) => u.id === currentUserId);
  const canManageUsers = activeUser ? (activeUser.role === 'admin' || !!activeUser.permissions?.canManageUsers) : false;

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
            Crea operadores y supervisores, <strong>asígnales extensiones SIP (a partir de 1001)</strong> y controla exactamente qué módulos del sistema pueden utilizar.
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

      {/* Users List / Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {users.map((user) => {
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
                          ? user.password || 'password123'
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

                {/* Assigned Carrier Badge */}
                <div className="py-1.5 px-2 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between text-xs mb-2">
                  <span className="text-slate-400 font-medium flex items-center gap-1.5 text-[11px]">
                    <Network className="w-3.5 h-3.5 text-sky-400" />
                    <span>Troncal Saliente:</span>
                  </span>
                  {user.carrierId ? (
                    <span className="text-[10px] font-mono font-bold text-sky-300 bg-sky-950/80 px-2 py-0.5 rounded border border-sky-500/40">
                      📡 {user.carrierId}
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-500 font-medium bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                      🌐 Pool General
                    </span>
                  )}
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
                      <span className="text-emerald-300 font-bold">{formPassword || (editingUser?.password ? '(mantener actual)' : 'Introduce clave')}</span>
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

              {/* Dedicated Carrier / Trunk Selector */}
              <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800 space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-slate-200 font-semibold flex items-center gap-1.5 text-xs">
                    <Network className="w-4 h-4 text-sky-400" />
                    <span>Carrier / Troncal SIP Saliente Asignada</span>
                  </label>
                  <span className="text-[10px] text-sky-300 font-mono bg-sky-500/20 px-2 py-0.5 rounded border border-sky-500/30">
                    Ruta Dedicada
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Define por cuál troncal SIP saldrán las llamadas de este usuario cuando marque desde MicroSIP o el marcador web.
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
                    ✓ Asterisk enrutará prioritariamente las llamadas de este usuario por la troncal <strong className="font-mono text-white">{formCarrierId}</strong>.
                  </p>
                )}
              </div>

              {/* Assign Extensions Section (Enforces >= 1001) */}
              <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800 space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-slate-200 font-semibold flex items-center gap-1.5">
                    <Phone className="w-4 h-4 text-emerald-400" />
                    <span>Asignar Extensiones PJSIP (1001 en adelante)</span>
                  </label>
                  <span className="text-[11px] text-slate-400 font-mono">
                    {selectedExts.length} asignadas
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Selecciona qué extensiones puede operar este usuario desde su softphone.
                </p>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                  {availableExtensions.map((ext) => {
                    const isSelected = selectedExts.includes(ext.extension);
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
                          <div className="font-bold text-xs">{ext.extension}</div>
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
                  <span className="text-emerald-300 font-bold">{microsipModalUser.password || 'password123'}</span>
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
    </div>
  );
};
