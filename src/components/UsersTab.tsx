import React, { useState } from 'react';
import { SystemUser, PjsipExtension, UserPermissions } from '../types';
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
} from 'lucide-react';

interface UsersTabProps {
  users: SystemUser[];
  extensions: PjsipExtension[];
  currentUserId: string;
  onSwitchUser: (userId: string) => void;
  onAddUser: (user: SystemUser) => void;
  onUpdateUser: (user: SystemUser) => void;
  onDeleteUser: (userId: string) => void;
}

export const UsersTab: React.FC<UsersTabProps> = ({
  users,
  extensions,
  currentUserId,
  onSwitchUser,
  onAddUser,
  onUpdateUser,
  onDeleteUser,
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
  const [formStatus, setFormStatus] = useState<SystemUser['status']>('active');
  const [selectedExts, setSelectedExts] = useState<string[]>([]);
  const [revealedPasswords, setRevealedPasswords] = useState<Record<string, boolean>>({});
  const [copiedUserId, setCopiedUserId] = useState<string | null>(null);
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
    const text = `Usuario: ${user.username || user.email.split('@')[0]}\nContraseña: ${user.password || 'password123'}\nCorreo: ${user.email}\nExtensiones: ${user.assignedExtensions.join(', ') || '1001'}`;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
    }
    setCopiedUserId(user.id);
    setTimeout(() => setCopiedUserId(null), 2500);
  };

  const handleOpenCreateModal = () => {
    setEditingUser(null);
    setFormName('');
    setFormEmail('');
    setFormUsername('');
    setFormPassword('');
    setShowPassword(false);
    setFormRole('agent');
    setFormStatus('active');
    // Default assign first available extension >= 1001
    setSelectedExts(availableExtensions.length > 0 ? [availableExtensions[0].extension] : ['1001']);
    applyRolePreset('agent');
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

    const usernameFinal = formUsername.trim() || formEmail.split('@')[0] || formName.toLowerCase().replace(/\s+/g, '.');
    const passwordFinal = formPassword.trim() || editingUser?.password || 'password123';

    if (editingUser) {
      onUpdateUser({
        ...editingUser,
        name: formName,
        email: formEmail,
        username: usernameFinal,
        password: passwordFinal,
        role: formRole,
        status: formStatus,
        assignedExtensions: selectedExts,
        permissions,
      });
    } else {
      const colors = [
        'from-emerald-500 to-teal-700',
        'from-blue-500 to-indigo-600',
        'from-emerald-600 to-green-500',
        'from-purple-500 to-pink-600',
        'from-teal-500 to-emerald-600',
      ];
      const randomColor = colors[Math.floor(Math.random() * colors.length)];

      onAddUser({
        id: `user-${Date.now()}`,
        name: formName,
        username: usernameFinal,
        email: formEmail,
        password: passwordFinal,
        role: formRole,
        assignedExtensions: selectedExts,
        permissions,
        status: formStatus,
        avatarColor: randomColor,
        createdAt: new Date().toISOString().split('T')[0],
        lastLogin: 'Pendiente primer inicio',
      });
    }
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
                        : user.role === 'agent'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                    }`}
                  >
                    {user.role}
                  </span>
                </div>

                {/* User Credentials (Username & Password with show/copy) */}
                <div className="mb-3 py-2 px-2.5 rounded-lg bg-slate-950 border border-slate-800/80 flex items-center justify-between text-xs font-mono">
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
                      title="Copiar credenciales completas (Usuario y Contraseña)"
                    >
                      {copiedUserId === user.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
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
                      onChange={(e) => setFormUsername(e.target.value)}
                      placeholder="Ej. juan.perez o agente1001"
                      className="w-full px-3 py-2 rounded-md bg-slate-900 border border-slate-800 text-white font-mono focus:border-emerald-500 focus:outline-none"
                    />
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Identificador para iniciar sesión en la pantalla de bienvenida.
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
                        : 'El agente usará esta clave para ingresar al sistema.'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Role Presets */}
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Rol y Plantilla de Accesos
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => applyRolePreset('admin')}
                    className={`p-2.5 rounded-lg border text-left transition-all ${
                      formRole === 'admin'
                        ? 'bg-emerald-500/20 border-emerald-500 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800'
                    }`}
                  >
                    <div className="font-bold text-xs">Administrador</div>
                    <div className="text-[10px] text-slate-400">Control total del sistema y AMI</div>
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
                    <div className="text-[10px] text-slate-400">Extensiones, IVR y Audioteca</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => applyRolePreset('agent')}
                    className={`p-2.5 rounded-lg border text-left transition-all ${
                      formRole === 'agent'
                        ? 'bg-emerald-500/20 border-emerald-500 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800'
                    }`}
                  >
                    <div className="font-bold text-xs">Agente</div>
                    <div className="text-[10px] text-slate-400">Solo Softphone y llamadas</div>
                  </button>
                </div>
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
    </div>
  );
};
