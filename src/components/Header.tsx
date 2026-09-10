import React from 'react';
import {
  PhoneCall,
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
  theme = 'light',
  onToggleTheme,
}) => {
  const tabTitles: Record<string, { title: string; subtitle: string; icon: React.ElementType }> = {
    prompt: {
      title: 'Prompt Maestro AI',
      subtitle: 'Instrucciones maestras para Asterisk 20 y reglas de telefonía',
      icon: Zap,
    },
    extensions: {
      title: 'Extensiones PJSIP',
      subtitle: 'Troncales internas ≥ 1001, transporte UDP/TLS/WSS y códecs',
      icon: PhoneCall,
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
                    Asterisk 20 /
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
            {/* Live Services Pill */}
            <div className="hidden xl:flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs">
              <span className="text-slate-400 font-medium">AMI:</span>
              <span className="text-emerald-400 font-mono font-semibold">:{connectionSettings.amiPort} OK</span>
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
      </div>
    </header>
  );
};
