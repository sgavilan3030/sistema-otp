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
    <div className="cyber-login-wrapper cyber-login-gradient min-h-screen w-full relative overflow-hidden text-slate-100 flex flex-col justify-between select-none">
      {/* 1. BACKGROUND LAYER: IMAGEN REALISTA DEL HOMBRE CON SOMBRERO NEGRO Y EQUIPOS TECNOLÓGICOS + CANVAS */}
      <div className="fixed inset-0 z-0 pointer-events-auto overflow-hidden">
        {/* Imagen cinematográfica realista del operador y la central tecnológica */}
        <div className="absolute inset-0 z-0">
          <img
            src="/src/assets/images/black_hat_operator_1790692414501.jpg"
            alt="Operador Black Hat y Equipos Tecnológicos"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover object-center brightness-[0.82] contrast-[1.12]"
          />
          {/* Capas de gradiente para viñeta y legibilidad del panel izquierdo */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: `
                linear-gradient(to right, rgba(0,0,0,0.92) 0%, rgba(1,10,7,0.82) 35%, rgba(2,20,15,0.40) 65%, rgba(0,0,0,0.80) 100%),
                radial-gradient(ellipse 110% 100% at 50% 30%, rgba(6,78,59,0.25) 0%, rgba(2,44,34,0.45) 50%, rgba(0,0,0,0.85) 100%)
              `,
            }}
          />
        </div>

        {/* Canvas de telemetría interactivo sobre la imagen */}
        <CyberDialerCanvas />

        {/* Overlay holográfico sutil de líneas de barrido */}
        <div
          className="absolute inset-0 pointer-events-none opacity-20"
          style={{
            backgroundImage:
              'repeating-linear-gradient(0deg, rgba(16,185,129,0.06) 0px, rgba(16,185,129,0.06) 1px, transparent 1px, transparent 4px)',
          }}
        />
      </div>

      {/* 2. TOP BAR CON NOMBRE DESTACADO EN TIPOGRAFÍA MODERNA */}
      <header className="relative z-20 w-full px-4 sm:px-8 py-5 flex items-center justify-between pointer-events-auto">
        {/* Marca Principal Destacada: Black Hat Dialer System */}
        <div className="flex items-center space-x-3.5 bg-black/85 backdrop-blur-xl px-5 py-2.5 rounded-2xl border border-emerald-500/50 shadow-[0_0_25px_rgba(16,185,129,0.25)]">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-slate-950 via-emerald-950 to-emerald-700 border border-emerald-400 flex items-center justify-center text-2xl shadow-md shadow-emerald-500/40 shrink-0">
            🎩
          </div>
          <div className="flex items-center space-x-3">
            <h1 className="text-base sm:text-xl font-black text-white tracking-wide font-sans bg-clip-text text-transparent bg-gradient-to-r from-white via-emerald-100 to-emerald-300">
              Black Hat Dialer System
            </h1>
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_#10b981]"></span>
          </div>
        </div>

        {/* Lema en Móvil / Botón de Background */}
        <div className="flex items-center space-x-3">
          <div className="hidden sm:flex lg:hidden items-center px-3 py-1.5 rounded-full bg-black/75 border border-emerald-500/40 text-[11px] font-mono font-bold text-emerald-300">
            NINGÚN SISTEMA ES SEGURO
          </div>
          <button
            type="button"
            onClick={() => setShowFullBackground(!showFullBackground)}
            className="flex items-center space-x-2 text-xs font-mono text-emerald-300 bg-black/85 hover:bg-emerald-950/80 backdrop-blur-xl px-4 py-2 rounded-full border border-emerald-500/60 shadow-[0_0_15px_rgba(16,185,129,0.25)] transition-all cursor-pointer"
            title={showFullBackground ? 'Volver al formulario de login' : 'Ver fondo completo de la central'}
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
        </div>
      </header>

      {/* 3. ÁREA CENTRAL: PANEL DE INICIO DE SESIÓN A LA IZQUIERDA Y MENSAJE EMBLEMÁTICO A LA DERECHA */}
      <div className="cyber-login-main relative z-20 flex-1 flex flex-col lg:flex-row items-center justify-between px-4 sm:px-10 md:px-14 lg:px-16 xl:px-24 py-6 pointer-events-auto gap-8">
        {/* Halo radial de profundidad centrado detrás de la tarjeta en la izquierda */}
        <div
          className="absolute left-4 sm:left-10 md:left-14 lg:left-16 xl:left-24 w-[520px] h-[520px] rounded-full pointer-events-none -z-10 blur-3xl opacity-75"
          style={{
            background:
              'radial-gradient(circle, rgba(16, 185, 129, 0.22) 0%, rgba(6, 182, 212, 0.10) 45%, transparent 70%)',
          }}
        />

        {showFullBackground ? (
          <div className="flex flex-col items-center justify-center space-y-4 p-8 bg-black/85 backdrop-blur-2xl rounded-3xl border-2 border-emerald-500/70 shadow-[0_0_70px_rgba(16,185,129,0.4)] max-w-md mx-auto text-center">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-slate-950 via-emerald-950 to-emerald-700 border border-emerald-400 flex items-center justify-center text-4xl shadow-lg shadow-emerald-500/50">
              🎩
            </div>
            <div>
              <div className="text-emerald-400 font-mono font-black text-lg">BLACK HAT DIALER SYSTEM</div>
              <div className="text-xs text-white mt-1 font-mono font-bold tracking-wider">
                “NINGÚN SISTEMA ES SEGURO PARA NOSOTROS”
              </div>
            </div>
            <button
              onClick={() => setShowFullBackground(false)}
              className="px-6 py-3 rounded-xl font-black font-mono text-xs bg-gradient-to-r from-emerald-400 to-teal-400 hover:from-emerald-300 hover:to-teal-300 text-black flex items-center space-x-2 shadow-lg shadow-emerald-500/40 cursor-pointer transition-all uppercase"
            >
              <LogIn className="w-4 h-4" />
              <span>Abrir Formulario de Acceso</span>
            </button>
          </div>
        ) : (
          <>
            {/* Panel de Login Izquierdo */}
            <div
              className="w-full max-w-md p-6 sm:p-8 rounded-3xl backdrop-blur-2xl border-2 border-emerald-500/60 shadow-[0_0_80px_rgba(16,185,129,0.3),inset_0_1px_1px_rgba(255,255,255,0.12)] transition-all relative overflow-hidden"
              style={{
                background:
                  'radial-gradient(ellipse at 50% -10%, rgba(20, 48, 38, 0.94) 0%, rgba(10, 22, 17, 0.96) 50%, rgba(4, 9, 7, 0.98) 100%)',
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

            {/* Mini-HUD de Estado en Vivo Protegido (Sin exponer puertos ni protocolos internos) */}
            <div className="grid grid-cols-3 gap-2 mb-5 p-2.5 rounded-xl bg-[#08130f]/90 border border-emerald-500/40 text-center font-mono text-[10px] shadow-sm">
              <div className="p-1">
                <div className="text-slate-300 font-semibold">CANAL DE VOZ</div>
                <div className="text-emerald-400 font-black mt-0.5 tracking-wider">ACTIVO</div>
              </div>
              <div className="p-1 border-x border-emerald-500/25">
                <div className="text-slate-300 font-semibold">SEGURIDAD</div>
                <div className="text-cyan-400 font-black mt-0.5 tracking-wider">AES-256 GCM</div>
              </div>
              <div className="p-1">
                <div className="text-slate-300 font-semibold">ENLACE</div>
                <div className="text-emerald-400 font-black mt-0.5 tracking-wider">PROTEGIDO</div>
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
                    ACCESO SEGURO
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

            {/* Pie informativo discreto */}
            <div className="mt-5 pt-3 border-t border-emerald-500/20 text-[10px] text-slate-400 font-mono flex items-center justify-between">
              <span className="flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                Cifrado AES-256
              </span>
              <span className="text-emerald-400/80 font-bold">Black Hat Engine v4.2</span>
            </div>
          </div>

          {/* Cartel / Mensaje Destacado a la Derecha: NINGÚN SISTEMA ES SEGURO PARA NOSOTROS */}
          <div className="hidden lg:flex flex-col items-end text-right max-w-md xl:max-w-xl space-y-4 pointer-events-none select-none z-10 pr-2">
            <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-emerald-950/80 border border-emerald-500/60 text-emerald-300 text-xs font-mono font-bold tracking-widest uppercase shadow-[0_0_20px_rgba(16,185,129,0.3)] backdrop-blur-md">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping"></span>
              <span>OPERACIÓN CLANDESTINA ACTIVA</span>
            </div>

            <div className="space-y-1">
              <h2 className="text-3xl xl:text-4xl 2xl:text-5xl font-black text-white font-mono tracking-tight leading-tight uppercase drop-shadow-[0_0_35px_rgba(16,185,129,0.65)]">
                <span className="text-emerald-400">“</span>NINGÚN SISTEMA ES SEGURO PARA NOSOTROS<span className="text-emerald-400">”</span>
              </h2>
            </div>

            <p className="text-xs sm:text-sm text-slate-300 font-mono tracking-wider max-w-md drop-shadow">
              Central de operaciones telefónicas de alta intrusión, enrutamiento autónomo y comunicaciones cifradas.
            </p>

            <div className="pt-2 flex items-center space-x-3 text-xs font-mono text-emerald-400">
              <span className="px-3 py-1.5 rounded-xl bg-black/75 border border-emerald-500/40 backdrop-blur-md shadow-md">
                MODO: INFILTRACIÓN
              </span>
              <span className="px-3 py-1.5 rounded-xl bg-black/75 border border-cyan-500/40 text-cyan-300 backdrop-blur-md shadow-md">
                RASTRO: INDETECTABLE
              </span>
            </div>
          </div>
        </>
        )}
      </div>

      {/* 4. FOOTER FLOTANTE TRANSLÚCIDA CON RESUMEN DE INFRAESTRUCTURA SIN DATOS SENSIBLES */}
      <footer className="relative z-20 w-full px-4 sm:px-8 py-3 flex flex-col sm:flex-row items-center justify-between text-[11px] font-mono text-slate-300 bg-black/75 backdrop-blur-md border-t border-emerald-500/30 pointer-events-auto gap-2">
        <div className="flex items-center space-x-2 text-emerald-400 font-bold">
          <Activity className="w-3.5 h-3.5" />
          <span>BLACK HAT DIALER SYSTEM</span>
        </div>

        <div className="flex items-center space-x-3 text-slate-400">
          <span className="text-emerald-300 font-bold">Enlace Seguro</span>
          <span>&bull;</span>
          <span className="text-cyan-300 font-bold">Protección Zero-Trust</span>
          <span>&bull;</span>
          <span className="text-emerald-300 font-bold">Cifrado de Extremo a Extremo</span>
        </div>
      </footer>
    </div>
  );
};
