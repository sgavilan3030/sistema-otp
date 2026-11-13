import React from 'react';
import {
  Rocket,
  PhoneCall,
  RefreshCw,
  Server,
  ShieldCheck,
  Volume2,
  Users,
  LogOut,
  Radio,
  Headphones,
  Building2,
  X,
  Sun,
  Moon,
  PhoneForwarded,
  Cpu,
  Mic,
} from 'lucide-react';
import { AsteriskConnectionSettings, SystemUser } from '../types';
import { isTabAllowedForUser, getRoleBadgeInfo } from '../utils/rbac';
import { BrandLogo, BrandWordmark } from './BrandLogo';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  connectionSettings: AsteriskConnectionSettings;
  currentUser?: SystemUser;
  onQuickSync: () => void;
  onLogout: () => void;
  isSyncing: boolean;
  isOpenMobile?: boolean;
  onCloseMobile?: () => void;
  extensionCount?: number;
  carrierCount?: number;
  activeCallCount?: number;
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
  amdEnabled?: boolean;
  onOpenAmdModal?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  connectionSettings,
  currentUser,
  onQuickSync,
  onLogout,
  isSyncing,
  isOpenMobile,
  onCloseMobile,
  extensionCount = 4,
  carrierCount = 2,
  activeCallCount = 0,
  theme = 'light',
  onToggleTheme,
  amdEnabled = true,
  onOpenAmdModal,
}) => {
  const navItems = [
    {
      id: 'production',
      label: 'Centro de Producción',
      subtitle: 'Lanzador & Captura OTP',
      icon: Rocket,
      badge: 'PROD',
      badgeColor: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
    },
    {
      id: 'manual-dialer',
      label: 'Marcación por Lista',
      subtitle: '1-Clic Operadores & Auditoría',
      icon: PhoneForwarded,
      badge: '1-CLIC',
      badgeColor: 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30',
    },
    {
      id: 'live-calls',
      label: 'Llamadas en Vivo',
      subtitle: 'Clientes, Duración & Agentes',
      icon: Radio,
      badge: activeCallCount > 0 ? `${activeCallCount} Live` : 'Live',
      badgeColor:
        activeCallCount > 0
          ? 'bg-emerald-500 text-slate-950 font-black animate-pulse shadow-sm shadow-emerald-500/50'
          : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
    },
    {
      id: 'call-spy',
      label: 'Escucha en Vivo (Espía)',
      subtitle: 'Audio ChanSpy & Whisper',
      icon: Headphones,
      badge: 'AUDIO',
      badgeColor: 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30',
    },
    {
      id: 'tenants',
      label: 'Grupos Call Center',
      subtitle: 'Multi-Tenant & MagnusBilling',
      icon: Building2,
      badge: 'BPO',
      badgeColor: 'bg-amber-500/20 text-amber-300 border border-amber-500/30',
    },
    {
      id: 'extensions',
      label: 'Extensiones PJSIP',
      subtitle: '≥ 1001 Endpoints & Nombres',
      icon: PhoneCall,
      badge: `${extensionCount}`,
      badgeColor: 'bg-blue-500/20 text-blue-300 border border-blue-500/30',
    },
    {
      id: 'carriers',
      label: 'Carriers / Troncales',
      subtitle: 'Solo Super Admin',
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
      id: 'telemetry',
      label: 'Telemetría del Sistema',
      subtitle: 'CPU, RAM, Latencia & Logs',
      icon: Cpu,
      badge: 'Live',
      badgeColor: 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30',
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
            <div className="flex items-center space-x-3 min-w-0">
              <BrandLogo size="md" />
              <BrandWordmark variant="sidebar" subtitle="Cloud PBX Enterprise" />
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
        </div>

        {/* Quick Actions Buttons */}
        <div className="px-3 pt-3 pb-2 space-y-2 flex-shrink-0">

          {(currentUser?.role === 'admin' || currentUser?.permissions?.canSyncAsterisk) && (
            <button
              id="sidebar-btn-sync-asterisk"
              onClick={onQuickSync}
              disabled={isSyncing}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                isSyncing
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 cursor-wait'
                  : 'bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-emerald-500/40 text-emerald-400'
              }`}
            >
              <div className="flex items-center space-x-2">
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin text-emerald-400' : ''}`} />
                <span>{isSyncing ? 'Sincronizando...' : 'Recarga en Caliente'}</span>
              </div>
              <span className="text-[9px] text-slate-400 font-mono">PBX</span>
            </button>
          )}

          {onOpenAmdModal && (
            <button
              id="sidebar-btn-amd-config"
              type="button"
              onClick={() => {
                onOpenAmdModal();
                if (onCloseMobile) onCloseMobile();
              }}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                amdEnabled
                  ? 'bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-emerald-500/40 text-slate-200'
                  : 'bg-rose-950/30 hover:bg-rose-950/50 border border-rose-500/30 text-rose-300'
              }`}
              title="Configurar Detección de Grabadora / Contestador (AMD) y límite de reintentos"
            >
              <div className="flex items-center space-x-2 min-w-0">
                <Mic className={`w-3.5 h-3.5 shrink-0 ${amdEnabled ? 'text-emerald-400' : 'text-rose-400'}`} />
                <span className="truncate">Detección AMD</span>
              </div>
              <span
                className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-bold shrink-0 ${
                  amdEnabled
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                }`}
              >
                {amdEnabled ? 'ACTIVA' : 'OFF'}
              </span>
            </button>
          )}
        </div>

        {/* Navigation Items (Filtered by RBAC Role and Permissions) */}
        <div className="flex-1 overflow-y-auto px-3 py-1 space-y-1 scrollbar-thin scrollbar-thumb-slate-800">

          <div className="px-2 pt-1 pb-1 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Módulos Disponibles
            </span>
            {currentUser?.role === 'agent' && (
              <span className="text-[9px] font-mono font-bold text-amber-400 bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-500/30">
                Solo Llamadas
              </span>
            )}
          </div>

          {navItems
            .filter((item) => isTabAllowedForUser(item.id, currentUser))
            .map((item) => {
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
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-semibold shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/80 border border-transparent'
                  }`}
                >
                  <div className="flex items-center space-x-2.5 min-w-0">
                    <Icon
                      className={`w-4 h-4 flex-shrink-0 transition-colors ${
                        isActive ? 'text-emerald-400' : 'text-slate-500 group-hover:text-slate-300'
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
          {currentUser && (() => {
            const roleInfo = getRoleBadgeInfo(currentUser.role);
            return (
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
                    <div className="flex flex-wrap items-center gap-1 mt-1">
                      <span
                        className={`text-[9px] uppercase px-1.5 py-0.5 rounded font-mono font-bold border ${roleInfo.color}`}
                      >
                        {roleInfo.label}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        Ext {currentUser.assignedExtensions && currentUser.assignedExtensions.length > 0 ? currentUser.assignedExtensions.join(', ') : '1001'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Theme Mode Selector in Sidebar */}
          {onToggleTheme && (
            <button
              onClick={onToggleTheme}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium bg-slate-900/90 hover:bg-slate-800/90 border border-slate-800 text-slate-300 transition-all cursor-pointer shadow-sm"
              title="Cambiar apariencia visual (Modo Claro / Modo Oscuro)"
            >
              <div className="flex items-center space-x-2">
                {theme === 'light' ? (
                  <Sun className="w-3.5 h-3.5 text-emerald-500" />
                ) : (
                  <Moon className="w-3.5 h-3.5 text-emerald-400" />
                )}
                <span>Apariencia:</span>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded font-mono bg-slate-800 text-slate-200">
                {theme === 'light' ? 'Modo Claro' : 'Modo Oscuro'}
              </span>
            </button>
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
