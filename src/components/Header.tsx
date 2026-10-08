import React from 'react';
import {
  PhoneCall,
  Headphones,
  DollarSign,
  RefreshCw,
  Menu,
  LogOut,
  ChevronRight,
  ShieldCheck,
  Server,
  Zap,
  Terminal,
  Volume2,
  Users,
  Database,
  Sun,
  Moon,
  Radio,
} from 'lucide-react';
import { AsteriskConnectionSettings, SystemUser } from '../types';

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  connectionSettings: AsteriskConnectionSettings;
  currentUser?: SystemUser;
  onQuickSync: () => void;
  onOpenCallSimulator: () => void;
  onOpenMobileMenu?: () => void;
  onLogout?: () => void;
  isSyncing: boolean;
  activeCallCount?: number;
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  connectionSettings,
  currentUser,
  onQuickSync,
  onOpenCallSimulator,
  onOpenMobileMenu,
  onLogout,
  isSyncing,
  activeCallCount = 0,
  theme = 'light',
  onToggleTheme,
}) => {
  const tabTitles: Record<string, { title: string; subtitle: string; icon: React.ElementType }> = {
    production: {
      title: 'Centro de Producción',
      subtitle: 'Lanzador telefónico, entidades a simular y captura de OTP en tiempo real',
      icon: ShieldCheck,
    },
    'live-calls': {
      title: 'Llamadas en Vivo & Supervisión',
      subtitle: 'Monitoreo en tiempo real de clientes, agentes, duración y control de Hold con música',
      icon: PhoneCall,
    },
    'call-spy': {
      title: 'Módulo de Escucha en Vivo (ChanSpy)',
      subtitle: 'Escucha en tiempo real de llamadas entre operadores y clientes, modo susurro y conferencia',
      icon: Headphones,
    },
    prompt: {
      title: 'Prompt Maestro AI',
      subtitle: 'Instrucciones maestras para Black Hat Dialer System y reglas de telefonía',
      icon: Zap,
    },
    extensions: {
      title: 'Extensiones PJSIP',
      subtitle: 'Endpoints numéricos ≥ 1001 y por Nombre para MicroSIP, transporte UDP/TLS/WSS y códecs',
      icon: PhoneCall,
    },
    reseller: {
      title: 'Reventa de Minutos & Facturación VoIP',
      subtitle: 'Administración de clientes prepago, paquetes de minutos, recargas y registro por nombre en MicroSIP',
      icon: DollarSign,
    },
    carriers: {
      title: 'Carriers / Troncales SIP',
      subtitle: 'Carrier Account Entry (sip.conf) & Dialplan (extensions.conf)',
      icon: Server,
    },
    ivr: {
      title: 'IVR Press-1 & Captura OTP',
      subtitle: 'Flujo de locución, captura de dígitos y validación manual por asesor',
      icon: ShieldCheck,
    },
    sqlite: {
      title: 'Base de Datos SQLite3',
      subtitle: 'AstDB (/var/lib/asterisk/astdb.sqlite3) y registros CDR de llamadas',
      icon: Database,
    },
    audios: {
      title: 'Audioteca de Prompts',
      subtitle: 'Locuciones pregrabadas en formato WAV mono 8000Hz estándar Asterisk',
      icon: Volume2,
    },
    users: {
      title: 'Usuarios & Permisos',
      subtitle: 'Control de acceso RBAC para Administradores, Supervisores y Operadores',
      icon: Users,
    },
    sync: {
      title: 'Sincronizador AMI / ARI',
      subtitle: 'Telemetría de eventos en tiempo real y recargas de dialplan en caliente',
      icon: Terminal,
    },
    configs: {
      title: 'Archivos .conf & Scripts',
      subtitle: 'Exportador descargable para despliegue en servidores Linux Debian / Rocky',
      icon: RefreshCw,
    },
  };

  const currentTabInfo = tabTitles[activeTab] || tabTitles.prompt;
  const CurrentIcon = currentTabInfo.icon;

  return (
    <header className="border-b border-slate-800/80 bg-slate-950/90 backdrop-blur sticky top-0 z-20">
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between py-3 gap-4">
          {/* Left: Mobile Hamburger & Active Breadcrumb */}
          <div className="flex items-center space-x-3">
            {onOpenMobileMenu && (
              <button
                id="btn-open-sidebar-mobile"
                onClick={onOpenMobileMenu}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 border border-slate-800 lg:hidden cursor-pointer"
                title="Abrir Menú de Navegación"
              >
                <Menu className="w-5 h-5" />
              </button>
            )}

            <div className="flex items-center space-x-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 flex-shrink-0">
                <CurrentIcon className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <span className="text-xs text-slate-500 font-mono hidden sm:inline">
                    Black Hat Dialer System /
                  </span>
                  <h2 className="text-sm sm:text-base font-bold text-white tracking-tight leading-none">
                    {currentTabInfo.title}
                  </h2>
                </div>
                <p className="text-[11px] text-slate-400 hidden sm:block truncate max-w-md mt-0.5">
                  {currentTabInfo.subtitle}
                </p>
              </div>
            </div>
          </div>

          {/* Right: Telemetry Badges & Action Buttons */}
          <div className="flex items-center space-x-2 sm:space-x-3">
            {/* Live Calls Indicator Pill */}
            {activeCallCount > 0 && (
              <button
                type="button"
                onClick={() => setActiveTab('live-calls')}
                className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-xs font-mono font-bold animate-pulse transition-all cursor-pointer shadow-sm"
                title="Ver llamadas en vivo activas"
              >
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                <span>{activeCallCount} EN VIVO</span>
              </button>
            )}

            {/* Live Services Pill */}
            <div className="hidden xl:flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs">
              <span className="text-slate-400 font-medium">AMI:</span>
              <span className={`font-mono font-semibold ${connectionSettings.status === 'error' ? 'text-amber-400 animate-pulse' : 'text-emerald-400'}`}>
                :{connectionSettings.amiPort} {connectionSettings.status === 'error' ? 'RETRY' : 'OK'}
              </span>
              <span className="text-slate-700">|</span>
              <span className="text-slate-400 font-medium">ARI:</span>
              <span className="text-blue-400 font-mono font-semibold">:{connectionSettings.ariPort} OK</span>
              <span className="text-slate-700">|</span>
              <span className="text-slate-400 font-medium">Carrier:</span>
              <span className="text-emerald-400 font-mono font-semibold">[televox]</span>
            </div>

            {/* Quick Sync Button */}
            <button
              id="btn-quick-sync-asterisk"
              onClick={onQuickSync}
              disabled={isSyncing}
              className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-all cursor-pointer ${
                isSyncing
                  ? 'bg-emerald-500/30 text-emerald-300 border border-emerald-500/50 cursor-wait'
                  : 'bg-slate-900 hover:bg-slate-800 text-emerald-400 border border-slate-800 hover:border-emerald-500/40'
              }`}
              title="Disparar acción AMI pjsip reload & dialplan reload"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{isSyncing ? 'Sincronizando...' : 'Recarga AMI'}</span>
            </button>

            {/* Simulator Button */}
            <button
              id="btn-open-call-simulator"
              onClick={onOpenCallSimulator}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm shadow-emerald-500/20 transition-all cursor-pointer font-medium"
            >
              <PhoneCall className="w-3.5 h-3.5" />
              <span>Softphone</span>
            </button>

            {/* Quick Access to Reventa de Minutos */}
            <button
              id="btn-header-reseller"
              type="button"
              onClick={() => setActiveTab('reseller')}
              className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-all cursor-pointer ${
                activeTab === 'reseller'
                  ? 'bg-emerald-500 text-slate-950 font-black shadow-emerald-500/30'
                  : 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/40 hover:border-emerald-400'
              }`}
              title="Abrir módulo de Reventa de Minutos y MicroSIP por Nombre"
            >
              <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
              <span className="font-bold hidden sm:inline">Reventa Minutos</span>
              <span className="sm:hidden font-bold">Minutos</span>
              <span className="px-1.5 py-0.5 rounded text-[9px] bg-emerald-500 text-slate-950 font-black ml-1 animate-pulse">
                NUEVO
              </span>
            </button>

            {/* Theme Toggle Button */}
            {onToggleTheme && (
              <button
                id="btn-toggle-theme"
                onClick={onToggleTheme}
                className="inline-flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800/60 hover:bg-slate-700/80 border border-slate-700 text-slate-200 transition-all cursor-pointer shadow-sm"
                title={theme === 'light' ? 'Cambiar a Tema Oscuro' : 'Cambiar a Tema Claro'}
              >
                {theme === 'light' ? (
                  <>
                    <Sun className="w-3.5 h-3.5 text-emerald-500" />
                    <span className="hidden md:inline font-medium">Tema Claro</span>
                  </>
                ) : (
                  <>
                    <Moon className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="hidden md:inline font-medium">Tema Oscuro</span>
                  </>
                )}
              </button>
            )}

            {/* User Pill with Quick Logout */}
            {currentUser && (
              <div className="flex items-center pl-2 sm:border-l sm:border-slate-800">
                <button
                  onClick={() => setActiveTab('users')}
                  className="flex items-center space-x-2 p-1 sm:px-2.5 sm:py-1 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs transition-colors"
                  title="Ver perfil de usuario y permisos"
                >
                  <div
                    className={`w-6 h-6 rounded-full bg-gradient-to-tr ${currentUser.avatarColor} flex items-center justify-center text-white text-[10px] font-bold`}
                  >
                    {currentUser.name[0]}
                  </div>
                  <span className="text-white font-medium hidden md:inline truncate max-w-[100px]">
                    {currentUser.username || currentUser.name.split(' ')[0]}
                  </span>
                </button>

                {onLogout && (
                  <button
                    onClick={onLogout}
                    className="ml-1.5 p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 transition-colors"
                    title="Cerrar Sesión"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Quick Access Modules Navigation Bar - Always visible across all screen sizes */}
        <div className="flex items-center gap-1.5 overflow-x-auto py-2 border-t border-slate-900 scrollbar-none text-xs">
          <span className="text-[10px] uppercase font-bold text-slate-500 mr-1 shrink-0 font-mono hidden md:inline">
            Módulos:
          </span>
          <button
            onClick={() => setActiveTab('production')}
            className={`px-2.5 py-1 rounded-md text-xs shrink-0 flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'production'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Centro Producción</span>
          </button>
          <button
            id="quick-nav-reseller"
            onClick={() => setActiveTab('reseller')}
            className={`px-2.5 py-1 rounded-md text-xs shrink-0 flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'reseller'
                ? 'bg-emerald-500 text-slate-950 font-black shadow-sm shadow-emerald-500/30'
                : 'bg-emerald-950/40 text-emerald-300 border border-emerald-500/50 hover:bg-emerald-900/50 hover:border-emerald-400 font-bold'
            }`}
          >
            <DollarSign className="w-3.5 h-3.5" />
            <span>Reventa de Minutos</span>
            <span className={`text-[9px] px-1 py-0.2 rounded font-black ${activeTab === 'reseller' ? 'bg-slate-950 text-emerald-400' : 'bg-emerald-500 text-slate-950 animate-pulse'}`}>
              ★ NUEVO
            </span>
          </button>
          <button
            onClick={() => setActiveTab('extensions')}
            className={`px-2.5 py-1 rounded-md text-xs shrink-0 flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'extensions'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
            }`}
          >
            <PhoneCall className="w-3.5 h-3.5" />
            <span>Extensiones PJSIP</span>
          </button>
          <button
            onClick={() => setActiveTab('call-spy')}
            className={`px-2.5 py-1 rounded-md text-xs shrink-0 flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'call-spy'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
            }`}
          >
            <Headphones className="w-3.5 h-3.5" />
            <span>Escucha en Vivo (Espía)</span>
          </button>
          <button
            onClick={() => setActiveTab('live-calls')}
            className={`px-2.5 py-1 rounded-md text-xs shrink-0 flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'live-calls'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>Llamadas en Vivo</span>
          </button>
          <button
            onClick={() => setActiveTab('carriers')}
            className={`px-2.5 py-1 rounded-md text-xs shrink-0 flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'carriers'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
            }`}
          >
            <Server className="w-3.5 h-3.5" />
            <span>Troncales SIP</span>
          </button>
          <button
            onClick={() => setActiveTab('ivr')}
            className={`px-2.5 py-1 rounded-md text-xs shrink-0 flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'ivr'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>IVR Press-1</span>
          </button>
        </div>
      </div>
    </header>
  );
};
