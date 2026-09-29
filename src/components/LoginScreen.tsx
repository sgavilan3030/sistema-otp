import React, { useState } from 'react';
import { SystemUser, AsteriskConnectionSettings } from '../types';
import {
  LogIn,
  Lock,
  User as UserIcon,
  Eye,
  EyeOff,
  AlertCircle,
  Radio,
  Volume2,
  ShieldCheck,
  Activity,
  Server,
  Zap,
  Maximize2,
  Minimize2,
  Sparkles,
} from 'lucide-react';
import { CyberDialerCanvas } from './CyberDialerCanvas';

interface LoginScreenProps {
  users: SystemUser[];
  onLogin: (user: SystemUser) => void;
  connectionSettings: AsteriskConnectionSettings;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  users,
  onLogin,
}) => {
  const [showFullBackground, setShowFullBackground] = useState(false);
  const [identifier, setIdentifier] = useState(() => {
    try {
      return localStorage.getItem('ast20_remembered_username') || '';
    } catch {
      return '';
    }
  });
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [rememberMe, setRememberMe] = useState(() => {
    try {
      return Boolean(localStorage.getItem('ast20_remembered_username'));
    } catch {
      return false;
    }
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsSubmitting(true);

    const cleanId = identifier.trim().toLowerCase();
    const cleanPass = password.trim();

    if (!cleanId || !cleanPass) {
      setErrorMsg('Por favor introduce tu usuario y contraseña.');
      setIsSubmitting(false);
      return;
    }

    // Búsqueda en la lista de usuarios
    let foundUser = users.find(
      (u) =>
        u.email.toLowerCase() === cleanId ||
        (u.username && u.username.toLowerCase() === cleanId) ||
        u.name.toLowerCase() === cleanId
    );

    // Respaldo de credenciales administrativas estándar
    if (!foundUser) {
      if (cleanId === 'admin' || cleanId === 'admin.asterisk@empresa.com') {
        foundUser = {
          id: 'user-admin',
          name: 'Administrador Telecom',
          username: 'admin',
          password: 'admin',
          role: 'admin',
          assignedExtensions: ['1001', '1002', '1003', '1004'],
          status: 'active',
          avatarColor: 'from-emerald-500 to-green-600',
          createdAt: '2026-09-01',
          permissions: {
            canManageExtensions: true,
            canManageCarriers: true,
            canManageIVR: true,
            canUploadAudio: true,
            canSyncAsterisk: true,
            canUseSoftphone: true,
            canManageUsers: true,
            canExportConfigs: true,
          },
        };
      } else if (cleanId === 'sgavilan30' || cleanId === 'sgavilan30@televox.net') {
        foundUser = {
          id: 'user-televox',
          name: 'Operador Televox',
          username: 'sgavilan30',
          email: 'sgavilan30@televox.net',
          password: 'Robert2026',
          role: 'admin',
          assignedExtensions: ['1001', '1002'],
          status: 'active',
          avatarColor: 'from-green-500 to-emerald-600',
          createdAt: '2026-09-02',
          permissions: {
            canManageExtensions: true,
            canManageCarriers: true,
            canManageIVR: true,
            canUploadAudio: true,
            canSyncAsterisk: true,
            canUseSoftphone: true,
            canManageUsers: true,
            canExportConfigs: true,
          },
        };
      }
    }

    const expectedPassword =
      foundUser?.password ||
      (foundUser?.username === 'admin' ? 'admin' : undefined) ||
      (foundUser?.username === 'sgavilan30' ? 'Robert2026' : undefined) ||
      (foundUser?.role === 'admin' ? 'admin' : 'password123');

    if (!foundUser || expectedPassword !== cleanPass) {
      setTimeout(() => {
        setErrorMsg('Credenciales inválidas. Acceso denegado.');
        setIsSubmitting(false);
      }, 200);
      return;
    }

    if (foundUser.status === 'inactive') {
      setTimeout(() => {
        setErrorMsg('Esta cuenta se encuentra deshabilitada.');
        setIsSubmitting(false);
      }, 200);
      return;
    }

    setTimeout(() => {
      setIsSubmitting(false);
      try {
        if (rememberMe) {
          localStorage.setItem('ast20_remembered_username', identifier.trim());
        } else {
          localStorage.removeItem('ast20_remembered_username');
        }
        localStorage.removeItem('ast_session_user_token');
      } catch (e) {}
      onLogin(foundUser);
    }, 200);
  };

  return (
    <div className="cyber-login-wrapper relative min-h-screen w-full overflow-hidden bg-[#010604] text-slate-100 flex flex-col justify-between select-none">
      {/* 1. BACKGROUND LAYER: CANVAS ANIMADO + GRADIENTES RADIALES SUTILES */}
      <div className="fixed inset-0 z-0 pointer-events-auto overflow-hidden">
        {/* Subtle Radial Gradient Ambient Lighting */}
        <div
          className="absolute inset-0 pointer-events-none opacity-90"
          style={{
            background: `
              radial-gradient(circle 900px at 50% 12%, rgba(16, 185, 129, 0.16) 0%, rgba(5, 36, 24, 0.08) 55%, transparent 75%),
              radial-gradient(circle 750px at 85% 80%, rgba(6, 182, 212, 0.12) 0%, rgba(4, 25, 30, 0.04) 50%, transparent 70%),
              radial-gradient(circle 800px at 15% 85%, rgba(16, 185, 129, 0.10) 0%, transparent 65%),
              radial-gradient(ellipse 95% 85% at 50% 50%, rgba(3, 18, 12, 0.6) 0%, rgba(1, 6, 4, 0.98) 100%)
            `,
          }}
        />

        <CyberDialerCanvas />

        {/* Subtle holographic scanline layer */}
        <div
          className="absolute inset-0 pointer-events-none opacity-20"
          style={{
            backgroundImage:
              'repeating-linear-gradient(0deg, rgba(16,185,129,0.06) 0px, rgba(16,185,129,0.06) 1px, transparent 1px, transparent 4px)',
          }}
        />
      </div>

      {/* 2. TOP BAR FLOTANTE TRANSLÚCIDA CON ESTADO DEL SISTEMA */}
      <header className="relative z-20 w-full px-4 sm:px-8 py-4 flex items-center justify-between pointer-events-auto">
        {/* Emblema Black Hat Dialer */}
        <div className="flex items-center space-x-3 bg-black/75 backdrop-blur-md px-4 py-2 rounded-2xl border border-emerald-500/50 shadow-[0_0_20px_rgba(16,185,129,0.2)]">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-slate-950 via-emerald-950 to-emerald-800 border border-emerald-400/70 flex items-center justify-center text-xl shadow-md shadow-emerald-500/40 shrink-0">
            🎩
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-sm font-black text-white font-mono tracking-wider">
                BLACK HAT DIALER SYSTEM
              </span>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
            </div>
            <div className="text-[10px] text-emerald-400 font-mono tracking-widest uppercase font-bold">
              SYSTEM CORE v20.4 • PJSIP REALTIME
            </div>
          </div>
        </div>

        {/* Badges de Conectividad en Vivo y Botón de Background */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          <button
            type="button"
            onClick={() => setShowFullBackground(!showFullBackground)}
            className="flex items-center space-x-1.5 text-xs font-mono text-emerald-300 bg-black/85 hover:bg-emerald-950/60 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-emerald-500/60 shadow-[0_0_15px_rgba(16,185,129,0.25)] transition-all cursor-pointer"
            title={showFullBackground ? 'Volver al formulario de login' : 'Ver background animado a pantalla completa'}
          >
            {showFullBackground ? (
              <>
                <Minimize2 className="w-3.5 h-3.5 text-emerald-400" />
                <span className="font-bold">MOSTRAR LOGIN</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5 text-emerald-400 animate-spin" />
                <span className="font-bold">DESTACAR BACKGROUND</span>
              </>
            )}
          </button>
          <div className="flex items-center space-x-2 text-xs font-mono text-emerald-300 bg-black/75 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-emerald-500/50 shadow-md">
            <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
            <span className="hidden sm:inline">TRUNK TELEVOX:</span>
            <span className="font-bold text-emerald-400">UP (14ms)</span>
          </div>
          <div className="hidden md:flex items-center space-x-1.5 text-xs font-mono text-cyan-300 bg-black/75 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-cyan-500/50 shadow-md">
            <Volume2 className="w-3.5 h-3.5 text-cyan-400" />
            <span>OPUS 48kHz HD AUDIO</span>
          </div>
        </div>
      </header>

      {/* 3. ÁREA CENTRAL: TERMINAL DE ACCESO GLASSMORPHIC VIBRANTE */}
      <div className="cyber-login-main relative z-20 flex-1 flex items-center justify-center p-4 sm:p-6 pointer-events-auto">
        {/* Halo radial de profundidad centrado detrás de la tarjeta */}
        <div
          className="absolute w-[580px] h-[580px] rounded-full pointer-events-none -z-10 blur-3xl opacity-75"
          style={{
            background:
              'radial-gradient(circle, rgba(16, 185, 129, 0.22) 0%, rgba(6, 182, 212, 0.10) 45%, transparent 70%)',
          }}
        />

        {showFullBackground ? (
          <div className="flex flex-col items-center justify-center space-y-4 p-6 bg-black/80 backdrop-blur-2xl rounded-3xl border-2 border-emerald-500/70 shadow-[0_0_60px_rgba(16,185,129,0.35)] max-w-sm text-center">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-slate-950 via-emerald-950 to-emerald-700 border border-emerald-400 flex items-center justify-center text-3xl shadow-lg shadow-emerald-500/50">
              🎩
            </div>
            <div>
              <div className="text-emerald-400 font-mono font-black text-base">BLACK HAT DIALER SYSTEM</div>
              <div className="text-[11px] text-slate-300 mt-1 font-mono">Modo de Visualización de Background Activo</div>
            </div>
            <button
              onClick={() => setShowFullBackground(false)}
              className="px-5 py-2.5 rounded-xl font-black font-mono text-xs bg-gradient-to-r from-emerald-400 to-teal-400 hover:from-emerald-300 hover:to-teal-300 text-black flex items-center space-x-2 shadow-lg shadow-emerald-500/40 cursor-pointer transition-all uppercase"
            >
              <LogIn className="w-4 h-4" />
              <span>Abrir Formulario de Acceso</span>
            </button>
          </div>
        ) : (
          <div
            className="w-full max-w-md p-6 sm:p-8 rounded-3xl backdrop-blur-2xl border-2 border-emerald-500/60 shadow-[0_0_80px_rgba(16,185,129,0.3),inset_0_1px_1px_rgba(255,255,255,0.12)] transition-all relative overflow-hidden"
            style={{
              background:
                'radial-gradient(ellipse at 50% -10%, rgba(20, 48, 38, 0.92) 0%, rgba(10, 22, 17, 0.95) 50%, rgba(4, 9, 7, 0.98) 100%)',
            }}
          >
          {/* Resplandores neón internos */}
          <div className="absolute -top-14 -right-14 w-36 h-36 rounded-full bg-emerald-500/25 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-14 -left-14 w-36 h-36 rounded-full bg-cyan-500/25 blur-3xl pointer-events-none" />

          {/* Header del Terminal */}
          <div className="mb-6 relative z-10">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[10px] font-mono font-bold tracking-widest uppercase mb-2.5 shadow-sm">
              <Zap className="w-3 h-3 text-emerald-400" />
              <span>TERMINAL DE AUTENTICACIÓN</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-white font-mono tracking-tight leading-tight">
              Iniciar Sesión
            </h2>
            <p className="text-xs text-slate-300 mt-1 font-medium">
              Acceso seguro a las operaciones de voz de <strong className="text-emerald-400 font-mono">Black Hat Dialer System</strong>.
            </p>
          </div>

          {/* Mini-HUD de Estado en Vivo con Alto Contraste */}
          <div className="grid grid-cols-3 gap-2 mb-5 p-2.5 rounded-xl bg-[#08130f]/90 border border-emerald-500/40 text-center font-mono text-[10px] shadow-sm">
            <div className="p-1">
              <div className="text-slate-300 font-semibold">TELEFONÍA</div>
              <div className="text-emerald-400 font-black mt-0.5 tracking-wider">ACTIVA</div>
            </div>
            <div className="p-1 border-x border-emerald-500/25">
              <div className="text-slate-300 font-semibold">PUERTO SIP</div>
              <div className="text-cyan-400 font-black mt-0.5 tracking-wider">5060 UDP</div>
            </div>
            <div className="p-1">
              <div className="text-slate-300 font-semibold">AUDIO HD</div>
              <div className="text-emerald-400 font-black mt-0.5 tracking-wider">BIDIRECCIONAL</div>
            </div>
          </div>

          {/* Alerta de Error */}
          {errorMsg && (
            <div className="mb-4 p-3 rounded-xl bg-rose-950/90 border border-rose-500/70 text-rose-100 text-xs flex items-start space-x-2.5 shadow-lg">
              <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
              <span className="font-mono">{errorMsg}</span>
            </div>
          )}

          {/* Formulario de Login */}
          <form onSubmit={handleSubmit} className="space-y-4 relative z-10">
            {/* Campo Usuario / Extensión */}
            <div>
              <label className="block text-xs font-bold text-emerald-300 mb-2 font-mono flex items-center justify-between">
                <span className="flex items-center space-x-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                  <span className="tracking-wide">USUARIO / EXTENSIÓN</span>
                </span>
                <span className="text-[10px] text-emerald-300 bg-emerald-950/90 border border-emerald-500/50 px-2 py-0.5 rounded-md font-semibold tracking-wider shadow-sm">
                  PJSIP AUTH
                </span>
              </label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none z-10">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-400/50 flex items-center justify-center text-emerald-300 shadow-sm shadow-emerald-500/20 group-focus-within:bg-emerald-500/30 group-focus-within:border-emerald-300 transition-colors">
                    <UserIcon className="w-4 h-4" />
                  </div>
                </div>
                <input
                  id="input-login-username"
                  type="text"
                  required
                  autoComplete="username"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="Introduce tu usuario o extensión"
                  className="cyber-login-input w-full pl-12 pr-4 py-3.5 rounded-xl border-2 border-emerald-500/60 bg-[#0c1713] text-white placeholder-slate-400 text-xs sm:text-sm font-mono font-medium tracking-wide focus:outline-none focus:border-emerald-300 focus:bg-[#152922] focus:ring-4 focus:ring-emerald-500/30 transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.7),0_2px_6px_rgba(0,0,0,0.4)]"
                />
              </div>
            </div>

            {/* Campo Contraseña */}
            <div>
              <label className="block text-xs font-bold text-cyan-300 mb-2 font-mono flex items-center justify-between">
                <span className="flex items-center space-x-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
                  <span className="tracking-wide">CONTRASEÑA</span>
                </span>
                <span className="text-[10px] text-cyan-300 bg-cyan-950/90 border border-cyan-500/50 px-2 py-0.5 rounded-md font-semibold tracking-wider shadow-sm">
                  ENCRYPTED
                </span>
              </label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none z-10">
                  <div className="w-8 h-8 rounded-lg bg-cyan-500/20 border border-cyan-400/50 flex items-center justify-center text-cyan-300 shadow-sm shadow-cyan-500/20 group-focus-within:bg-cyan-500/30 group-focus-within:border-cyan-300 transition-colors">
                    <Lock className="w-4 h-4" />
                  </div>
                </div>
                <input
                  id="input-login-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="cyber-login-input w-full pl-12 pr-12 py-3.5 rounded-xl border-2 border-emerald-500/60 bg-[#0c1713] text-white placeholder-slate-400 text-xs sm:text-sm font-mono font-medium tracking-wide focus:outline-none focus:border-emerald-300 focus:bg-[#152922] focus:ring-4 focus:ring-emerald-500/30 transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.7),0_2px_6px_rgba(0,0,0,0.4)]"
                />
                <div className="absolute inset-y-0 right-0 pr-2 flex items-center z-10">
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="p-2 rounded-lg bg-[#07110e] hover:bg-emerald-950/80 border border-emerald-500/40 hover:border-emerald-300 text-slate-300 hover:text-emerald-300 transition-all cursor-pointer shadow-sm"
                    aria-label={showPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Recordar Sesión */}
            <div className="flex items-center justify-between text-xs pt-1">
              <label className="flex items-center space-x-2.5 cursor-pointer text-slate-200 hover:text-white group select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded bg-[#0c1713] border-2 border-emerald-500/70 text-emerald-500 focus:ring-emerald-400/40 focus:ring-offset-0 focus:ring-2 transition-all cursor-pointer accent-emerald-500"
                />
                <span className="font-mono text-xs text-slate-300 group-hover:text-emerald-300 transition-colors">
                  Recordar credenciales en este equipo
                </span>
              </label>
            </div>

            {/* Botón de Submit de Alto Contraste */}
            <button
              id="btn-login-submit"
              type="submit"
              disabled={isSubmitting}
              className="w-full mt-3 py-3.5 px-4 rounded-xl font-black text-xs sm:text-sm shadow-[0_0_25px_rgba(16,185,129,0.35)] bg-gradient-to-r from-emerald-400 via-teal-300 to-emerald-400 hover:from-emerald-300 hover:to-teal-200 active:scale-[0.99] text-slate-950 flex items-center justify-center space-x-2.5 transition-all cursor-pointer disabled:opacity-50 font-mono tracking-wider uppercase border border-emerald-200/90"
            >
              <LogIn className="w-4 h-4 text-slate-950 stroke-[2.5]" />
              <span>{isSubmitting ? 'VERIFICANDO CREDENCIALES...' : 'AUTORIZAR ACCESO AL DIALER'}</span>
            </button>
          </form>

          {/* Pie informativo discreto sin botones de acceso rápido */}
          <div className="mt-5 pt-3 border-t border-emerald-500/20 text-[10px] text-slate-400 font-mono flex items-center justify-between">
            <span className="flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              Cifrado AES-256
            </span>
            <span className="text-emerald-400/80 font-bold">Black Hat Engine</span>
          </div>
        </div>
        )}
      </div>

      {/* 4. FOOTER FLOTANTE TRANSLÚCIDA CON RESUMEN DE INFRAESTRUCTURA */}
      <footer className="relative z-20 w-full px-4 sm:px-8 py-3 flex flex-col sm:flex-row items-center justify-between text-[11px] font-mono text-slate-300 bg-black/75 backdrop-blur-md border-t border-emerald-500/30 pointer-events-auto gap-2">
        <div className="flex items-center space-x-2 text-emerald-400 font-bold">
          <Activity className="w-3.5 h-3.5" />
          <span>BLACK HAT DIALER SYSTEM</span>
        </div>

        <div className="flex items-center space-x-3 text-slate-400">
          <span className="text-emerald-300 font-bold">Black Hat Core</span>
          <span>&bull;</span>
          <span className="text-cyan-300 font-bold">AMI/ARI Sockets</span>
          <span>&bull;</span>
          <span className="text-emerald-300 font-bold">Denoise Rx/Tx</span>
        </div>
      </footer>
    </div>
  );
};
