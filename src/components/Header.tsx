import React from 'react';
import {
  PhoneCall,
  Headphones,
  RefreshCw,
  Menu,
  LogOut,
  ShieldCheck,
  Server,
  Volume2,
  Users,
  Cpu,
  Building2,
  PhoneForwarded,
} from 'lucide-react';
import { AsteriskConnectionSettings, SystemUser } from '../types';

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  connectionSettings: AsteriskConnectionSettings;
  currentUser?: SystemUser;
  onQuickSync: () => void;
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
  onOpenMobileMenu,
  onLogout,
  isSyncing,
  activeCallCount = 0,
}) => {
  const tabTitles: Record<string, { title: string; subtitle: string; icon: React.ElementType }> = {
    production: {
      title: 'Centro de Producción',
      subtitle: 'Lanzador telefónico, campañas y captura de OTP en tiempo real',
      icon: ShieldCheck,
    },
    'manual-dialer': {
      title: 'Marcación por Lista',
      subtitle: 'Discado 1-Clic para operadores y auditoría de contactos',
      icon: PhoneForwarded,
    },
    'live-calls': {
      title: 'Llamadas en Vivo & Supervisión',
      subtitle: 'Monitoreo en tiempo real de clientes, agentes, duración y control de Hold',
      icon: PhoneCall,
    },
    'call-spy': {
      title: 'Módulo de Escucha en Vivo (ChanSpy)',
      subtitle: 'Escucha en tiempo real de llamadas entre operadores y clientes, modo susurro y conferencia',
      icon: Headphones,
    },
    tenants: {
      title: 'Grupos Call Center & MagnusBilling',
      subtitle: 'Control multi-tenant de minutos, saldos y cuentas SIP externas',
      icon: Building2,
    },
    extensions: {
      title: 'Extensiones PJSIP',
      subtitle: 'Endpoints numéricos ≥ 1001, transporte UDP/TLS/WSS y códecs HD',
      icon: PhoneCall,
    },
    carriers: {
      title: 'Carriers / Troncales SIP',
      subtitle: 'Administración exclusiva Super Admin de troncales y ruteo saliente',
      icon: Server,
    },
    ivr: {
      title: 'IVR Press-1 & Captura OTP',
      subtitle: 'Flujo de locución, captura de dígitos y validación manual por asesor',
      icon: ShieldCheck,
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
    telemetry: {
      title: 'Telemetría & Consola AMI',
      subtitle: 'Gráficos en tiempo real de CPU, RAM, latencia AMI (:5038) y comandos',
      icon: Cpu,
    },
  };

  const currentTabInfo = tabTitles[activeTab] || tabTitles.production;
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
                  <span className="text-xs text-slate-500 font-medium hidden sm:inline tracking-tight">
                    Black Hat <span className="text-emerald-400/90">Dialer</span> /
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

            {/* Quick Sync Button: Only for Admin or Users with canSyncAsterisk */}
            {(currentUser?.role === 'admin' || currentUser?.permissions?.canSyncAsterisk) && (
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
            )}

            {/* Quick Logout Button */}
            {currentUser && onLogout && (
              <button
                onClick={onLogout}
                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 transition-colors cursor-pointer"
                title="Cerrar Sesión"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
