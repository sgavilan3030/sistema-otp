import React from 'react';
import {
  PhoneCall,
  RefreshCw,
  Server,
  Zap,
  Terminal,
  ShieldCheck,
  Volume2,
  Users,
  Database,
  LogOut,
  ChevronRight,
  ExternalLink,
  Activity,
  X,
} from 'lucide-react';
import { AsteriskConnectionSettings, SystemUser } from '../types';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  connectionSettings: AsteriskConnectionSettings;
  currentUser?: SystemUser;
  onQuickSync: () => void;
  onOpenCallSimulator: () => void;
  onLogout: () => void;
  isSyncing: boolean;
  isOpenMobile?: boolean;
  onCloseMobile?: () => void;
  extensionCount?: number;
  carrierCount?: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  connectionSettings,
  currentUser,
  onQuickSync,
  onOpenCallSimulator,
  onLogout,
  isSyncing,
  isOpenMobile,
  onCloseMobile,
  extensionCount = 4,
  carrierCount = 2,
}) => {
  const navItems = [
    {
      id: 'prompt',
      label: 'Prompt Maestro AI',
      subtitle: 'Instrucciones & Contexto',
      icon: Zap,
      badge: 'Core',
      badgeColor: 'bg-amber-500/20 text-amber-300 border border-amber-500/30',
    },
    {
      id: 'extensions',
      label: 'Extensiones PJSIP',
      subtitle: '≥ 1001 Endpoints',
      icon: PhoneCall,
      badge: `${extensionCount}`,
      badgeColor: 'bg-blue-500/20 text-blue-300 border border-blue-500/30',
    },
    {
      id: 'carriers',
      label: 'Carriers / Troncales',
      subtitle: 'sip.conf & Dialplan',
      icon: Server,
      badge: `${carrierCount}`,
      badgeColor: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
    },
    {
      id: 'ivr',
      label: 'IVR & Captura OTP',
      subtitle: 'Press-1 & Asesor',
      icon: ShieldCheck,
    },
    {
      id: 'sqlite',
      label: 'Base SQLite3 AstDB',
      subtitle: 'AstDB & Registros CDR',
      icon: Database,
      badge: 'Nativo',
      badgeColor: 'bg-purple-500/20 text-purple-300 border border-purple-500/30',
    },
    {
      id: 'audios',
      label: 'Audioteca de Prompts',
      subtitle: 'Locuciones Pregrabadas',
      icon: Volume2,
    },
    {
      id: 'users',
      label: 'Usuarios & Permisos',
      subtitle: 'Control de Roles RBAC',
      icon: Users,
    },
    {
      id: 'sync',
      label: 'Sincronizador AMI/ARI',
      subtitle: 'Telemetría & Reload',
      icon: Terminal,
    },
    {
      id: 'configs',
      label: 'Archivos .conf',
      subtitle: 'Exportador de Código',
      icon: RefreshCw,
    },
  ];

  return (
    <>
      {/* Backdrop for Mobile */}
      {isOpenMobile && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-sm lg:hidden"
        />
      )}

      {/* Sidebar Container: Placed on the LEFT side */}
      <aside
        className={`fixed lg:sticky top-0 left-0 z-50 lg:z-30 h-screen w-64 xl:w-72 bg-slate-950 border-r border-slate-800/80 flex flex-col justify-between transition-transform duration-300 ease-in-out select-none shadow-xl ${
          isOpenMobile ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Top Header: Branding & Close Button on Mobile */}
        <div className="p-4 border-b border-slate-800/80 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/20 text-slate-950 font-black text-xl tracking-tight flex-shrink-0">
                *20
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <h1 className="text-sm font-bold text-white tracking-tight leading-tight">
                    Asterisk 20 Gov
                  </h1>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                </div>
                <p className="text-[11px] text-slate-400 font-mono">
                  PJSIP &bull; AMI &bull; SQLite3
                </p>
              </div>
            </div>

            {/* Mobile close button */}
            {onCloseMobile && (
              <button
                onClick={onCloseMobile}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 lg:hidden"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>

          {/* Service Status Badges */}
          <div className="mt-3 grid grid-cols-3 gap-1 pt-2.5 border-t border-slate-900 text-[10px] font-mono">
            <div className="px-1.5 py-1 rounded bg-slate-900/80 border border-slate-800/60 text-center">
              <span className="text-slate-500 block">AMI</span>
              <span className="text-emerald-400 font-bold">:{connectionSettings.amiPort}</span>
            </div>
            <div className="px-1.5 py-1 rounded bg-slate-900/80 border border-slate-800/60 text-center">
              <span className="text-slate-500 block">ARI</span>
              <span className="text-blue-400 font-bold">:{connectionSettings.ariPort}</span>
            </div>
            <div className="px-1.5 py-1 rounded bg-slate-900/80 border border-slate-800/60 text-center">
              <span className="text-slate-500 block">DB</span>
              <span className="text-amber-400 font-bold">AstDB</span>
            </div>
          </div>
        </div>

        {/* Quick Actions Buttons */}
        <div className="px-3 pt-3 pb-2 space-y-2 flex-shrink-0">
          <button
            id="sidebar-btn-open-softphone"
            onClick={() => {
              onOpenCallSimulator();
              if (onCloseMobile) onCloseMobile();
            }}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-600/20 transition-all cursor-pointer font-medium"
          >
            <div className="flex items-center space-x-2">
              <PhoneCall className="w-4 h-4 text-blue-100" />
              <span>Probar Softphone</span>
            </div>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-700/60 text-blue-200 font-mono">
              DTMF
            </span>
          </button>

          <button
            id="sidebar-btn-sync-asterisk"
            onClick={onQuickSync}
            disabled={isSyncing}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              isSyncing
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 cursor-wait'
                : 'bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-amber-500/40 text-amber-400'
            }`}
          >
            <div className="flex items-center space-x-2">
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin text-amber-400' : ''}`} />
              <span>{isSyncing ? 'Sincronizando...' : 'Recarga en Caliente'}</span>
            </div>
            <span className="text-[9px] text-slate-400 font-mono">AMI</span>
          </button>
        </div>

        {/* Navigation Items (Scrollable List) */}
        <div className="flex-1 overflow-y-auto px-3 py-1 space-y-1 scrollbar-thin scrollbar-thumb-slate-800">
          <div className="px-2 pt-1 pb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Módulos del Sistema
            </span>
          </div>

          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                id={`sidebar-tab-${item.id}`}
                onClick={() => {
                  setActiveTab(item.id);
                  if (onCloseMobile) onCloseMobile();
                }}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs transition-all text-left group ${
                  isActive
                    ? 'bg-gradient-to-r from-amber-500/15 to-orange-500/5 text-amber-400 border border-amber-500/30 font-semibold shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/80 border border-transparent'
                }`}
              >
                <div className="flex items-center space-x-2.5 min-w-0">
                  <Icon
                    className={`w-4 h-4 flex-shrink-0 transition-colors ${
                      isActive ? 'text-amber-400' : 'text-slate-500 group-hover:text-slate-300'
                    }`}
                  />
                  <div className="truncate">
                    <span className="block truncate font-medium text-xs">{item.label}</span>
                    <span className="block text-[10px] text-slate-500 truncate">{item.subtitle}</span>
                  </div>
                </div>

                {item.badge && (
                  <span
                    className={`ml-2 px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold flex-shrink-0 ${
                      item.badgeColor || 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Footer: User Profile Card & Logout Button */}
        <div className="p-3 border-t border-slate-800/80 bg-slate-950/90 flex-shrink-0">
          {currentUser && (
            <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800/80 mb-2">
              <div className="flex items-center space-x-2.5">
                <div
                  className={`w-8 h-8 rounded-lg bg-gradient-to-tr ${currentUser.avatarColor} flex items-center justify-center text-white text-xs font-bold flex-shrink-0 shadow-sm`}
                >
                  {currentUser.name[0]}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-white truncate leading-tight">
                    {currentUser.name}
                  </p>
                  <div className="flex items-center space-x-1.5 mt-0.5">
                    <span
                      className={`text-[9px] uppercase px-1.5 py-0.2 rounded font-mono font-bold ${
                        currentUser.role === 'admin'
                          ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                          : currentUser.role === 'supervisor'
                          ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                          : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      }`}
                    >
                      {currentUser.role}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      Ext {currentUser.assignedExtensions[0] || '1001'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Logout Button */}
          <button
            id="btn-sidebar-logout"
            onClick={onLogout}
            className="w-full flex items-center justify-center space-x-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-rose-300 hover:bg-rose-500/10 border border-slate-800/60 hover:border-rose-500/30 transition-all cursor-pointer"
            title="Cerrar sesión y volver al panel de login"
          >
            <LogOut className="w-3.5 h-3.5 text-rose-400" />
            <span>Cerrar Sesión</span>
          </button>
        </div>
      </aside>
    </>
  );
};
