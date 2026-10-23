import { SystemUser } from '../types';

export type AppModuleId =
  | 'production'
  | 'live-calls'
  | 'call-spy'
  | 'prompt'
  | 'extensions'
  | 'reseller'
  | 'carriers'
  | 'ivr'
  | 'sqlite'
  | 'audios'
  | 'users'
  | 'sync'
  | 'diagnostics'
  | 'configs';

/**
 * Validates strictly whether the given module / tab is accessible by the specified user
 * according to Role-Based Access Control (RBAC) and explicit permission flags.
 */
export function isTabAllowedForUser(tabId: string, user?: SystemUser | null): boolean {
  if (!user) return false;

  // 1. Super Administrator: unrestricted full access
  if (user.role === 'admin') {
    return true;
  }

  const perms = user.permissions || {
    canManageExtensions: false,
    canManageCarriers: false,
    canManageIVR: false,
    canUploadAudio: false,
    canSyncAsterisk: false,
    canUseSoftphone: true,
    canManageUsers: false,
    canExportConfigs: false,
  };

  // 2. Agent (Operador / Asesor telefónico):
  // Exclusively allowed to make/receive calls, handle live calls on their extension, and use the softphone.
  // All system configs, user management, trunks, databases, audios, and spy modules are completely restricted.
  if (user.role === 'agent') {
    return tabId === 'production' || tabId === 'live-calls';
  }

  // 3. Reseller Client (Cliente VoIP prepago):
  // Allowed to use dialer and check their own minute balance / billing
  if (user.role === 'reseller_client') {
    return tabId === 'production' || tabId === 'reseller';
  }

  // 4. Supervisor:
  // Operational supervision: production calls, live calls, live spy (ChanSpy/Whisper), diagnostics,
  // and IVR/extensions/audios/configs ONLY if explicitly permitted.
  // NEVER allowed: user management, carrier trunks, raw SQLite database, AMI sync console, or master AI prompt.
  if (user.role === 'supervisor') {
    if (tabId === 'production' || tabId === 'live-calls' || tabId === 'call-spy' || tabId === 'diagnostics') {
      return true;
    }
    if (tabId === 'extensions') return Boolean(perms.canManageExtensions);
    if (tabId === 'ivr') return Boolean(perms.canManageIVR);
    if (tabId === 'audios') return Boolean(perms.canUploadAudio);
    if (tabId === 'configs') return Boolean(perms.canExportConfigs);
    return false;
  }

  // 5. Custom role: verify granular permissions
  if (tabId === 'production' || tabId === 'live-calls') return true;
  if (tabId === 'extensions') return Boolean(perms.canManageExtensions);
  if (tabId === 'carriers') return Boolean(perms.canManageCarriers);
  if (tabId === 'ivr') return Boolean(perms.canManageIVR);
  if (tabId === 'audios') return Boolean(perms.canUploadAudio);
  if (tabId === 'sync') return Boolean(perms.canSyncAsterisk);
  if (tabId === 'users') return Boolean(perms.canManageUsers);
  if (tabId === 'configs') return Boolean(perms.canExportConfigs);

  return false;
}

/**
 * Returns default landing tab for user based on role
 */
export function getDefaultTabForUser(user?: SystemUser | null): AppModuleId {
  return 'production';
}

/**
 * Returns visual badge label and color for user role
 */
export function getRoleBadgeInfo(role: SystemUser['role']) {
  switch (role) {
    case 'admin':
      return {
        label: 'ADMINISTRADOR',
        subtitle: 'Acceso Total al Sistema',
        color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
      };
    case 'supervisor':
      return {
        label: 'SUPERVISOR',
        subtitle: 'Supervisión y Escucha',
        color: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
      };
    case 'agent':
      return {
        label: 'AGENTE (SOLO LLAMADAS)',
        subtitle: 'Lanzador & Softphone',
        color: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
      };
    case 'reseller_client':
      return {
        label: 'CLIENTE PREPAGO',
        subtitle: 'Saldo y Softphone',
        color: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
      };
    default:
      return {
        label: 'PERSONALIZADO',
        subtitle: 'Permisos Granulares',
        color: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
      };
  }
}
