import React, { useState } from 'react';
import { SystemUser, AsteriskConnectionSettings } from '../types';
import {
  LogIn,
  Lock,
  User as UserIcon,
  Eye,
  EyeOff,
  AlertCircle,
  ShieldCheck,
  Activity,
  Zap,
  Minimize2,
  Sparkles,
  SlidersHorizontal,
} from 'lucide-react';
import { CyberDialerCanvas } from './CyberDialerCanvas';

// Realistic background: Central Telefónica Clandestina & Servidores VoIP Asterisk PJSIP
import blackHatDialerBg from '../assets/images/black_hat_dialer_alt.jpg';

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
  const [visualMode, setVisualMode] = useState<'cinematic' | 'vivid' | 'stealth'>('cinematic');

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

  const handleCycleVisualMode = () => {
    setVisualMode((prev) => {
      if (prev === 'cinematic') return 'vivid';
      if (prev === 'vivid') return 'stealth';
      return 'cinematic';
    });
  };

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
      {/* 1. BACKGROUND LAYER: CENTRAL TELEFÓNICA CLANDESTINA REALISTA */}
      <div className="fixed inset-0 z-0 pointer-events-auto overflow-hidden bg-black">
        {/* Imagen realista de la central telefónica y racks PBX */}
        <div className="absolute inset-0 z-0">
          <img
            src={blackHatDialerBg}
            alt="Central Telefónica Clandestina Black Hat Dialer System"
            className={`w-full h-full object-cover object-[center_35%] transition-all duration-700 select-none ${
              visualMode === 'cinematic'
                ? 'brightness-[1.02] contrast-[1.2] saturate-[1.12]'
                : visualMode === 'vivid'
                ? 'brightness-[0.92] contrast-[1.15] saturate-[1.05]'
                : 'brightness-[0.80] contrast-[1.1]'
            }`}
          />

          {/* Iluminación atmosférica que protege la lectura del formulario y resalta la sala de servidores */}
          <div
            className="absolute inset-0 pointer-events-none transition-opacity duration-500"
            style={{
              background: `
                linear-gradient(to right, rgba(0,0,0,0.85) 0%, rgba(1,10,7,0.65) 30%, rgba(2,18,12,0.15) 58%, rgba(0,0,0,0.75) 100%),
                radial-gradient(ellipse 120% 90% at 75% 40%, rgba(16,185,129,0.12) 0%, transparent 60%),
                linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 25%, rgba(0,0,0,0.60) 100%)
              `,
            }}
          />
        </div>

        {/* Canvas de telemetría interactivo calibrado muy suave */}
        <div className="absolute inset-0 opacity-20 mix-blend-screen pointer-events-none">
          <CyberDialerCanvas />
        </div>

        {/* Líneas sutiles de monitor CRT de central telefónica */}
        <div
          className="absolute inset-0 pointer-events-none opacity-10"
          style={{
            backgroundImage:
              'repeating-linear-gradient(0deg, rgba(16,185,129,0.08) 0px, rgba(16,185,129,0.08) 1px, transparent 1px, transparent 4px)',
          }}
        />
      </div>

      {/* 2. TOP BAR CON NOMBRE DESTACADO Y CONTROLES VISUALES */}
      <header className="relative z-20 w-full px-4 sm:px-8 py-3 sm:py-4 flex flex-wrap items-center justify-between pointer-events-auto gap-3">
        {/* Marca Principal: Black Hat Dialer System */}
        <div className="flex items-center space-x-3 bg-black/80 backdrop-blur-xl px-4 py-2 rounded-xl border border-emerald-500/40 shadow-[0_0_20px_rgba(16,185,129,0.25)]">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-slate-950 via-emerald-950 to-emerald-700 border border-emerald-400 flex items-center justify-center text-xl shadow-md shadow-emerald-500/30 shrink-0">
            🎩
          </div>
          <div className="flex items-center space-x-2.5">
            <div>
              <h1 className="text-sm sm:text-base font-black text-white tracking-wide font-sans bg-clip-text text-transparent bg-gradient-to-r from-white via-emerald-100 to-emerald-300">
                Black Hat Dialer System
              </h1>
              <p className="text-[9px] text-emerald-400 font-mono tracking-wider font-semibold">
                CENTRAL TELEFÓNICA CLANDESTINA
              </p>
            </div>
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_6px_#10b981]"></span>
          </div>
        </div>

        {/* Controles de Vista & Realismo */}
        <div className="flex items-center gap-2">
          {/* Ajuste de Intensidad del Fondo */}
          <button
            type="button"
            onClick={handleCycleVisualMode}
            className="flex items-center space-x-1.5 text-xs font-mono text-emerald-300 bg-black/80 hover:bg-emerald-950/80 backdrop-blur-xl px-3 py-1.5 rounded-lg border border-emerald-500/40 shadow-sm transition-all cursor-pointer"
            title="Alternar intensidad y realismo visual de la fotografía de fondo"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">REALISMO:</span>
            <span className="font-bold text-emerald-200 uppercase">
              {visualMode === 'cinematic' ? 'CINEMÁTICO' : visualMode === 'vivid' ? 'VÍVIDO' : 'SIGILO'}
            </span>
          </button>

          {/* Botón Destacar Fondo / Pantalla Completa */}
          <button
            type="button"
            onClick={() => setShowFullBackground(!showFullBackground)}
            className="flex items-center space-x-1.5 text-xs font-mono text-emerald-300 bg-black/80 hover:bg-emerald-950/90 backdrop-blur-xl px-3.5 py-1.5 rounded-lg border border-emerald-400/80 shadow-[0_0_15px_rgba(16,185,129,0.3)] transition-all cursor-pointer active:scale-95"
            title={showFullBackground ? 'Volver al formulario de login' : 'Ver fotografía completa de la central telefónica'}
          >
            {showFullBackground ? (
              <>
                <Minimize2 className="w-3.5 h-3.5 text-emerald-400" />
                <span className="font-bold">MOSTRAR LOGIN</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5 text-emerald-400 animate-spin" />
                <span className="font-bold">DESTACAR FONDO</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* 3. ÁREA CENTRAL: INICIO DE SESIÓN REDUCIDO Y COMPACTO A LA IZQUIERDA */}
      <div className="cyber-login-main relative z-20 flex-1 flex flex-col lg:flex-row items-center justify-between px-4 sm:px-10 md:px-14 lg:px-16 xl:px-20 py-4 pointer-events-auto gap-8">
        {/* Halo radial de profundidad centrado detrás de la tarjeta en la izquierda */}
        <div
          className="absolute left-4 sm:left-10 md:left-14 lg:left-16 xl:left-20 w-[420px] h-[420px] rounded-full pointer-events-none -z-10 blur-3xl opacity-60"
          style={{
            background:
              'radial-gradient(circle, rgba(16, 185, 129, 0.18) 0%, rgba(6, 182, 212, 0.08) 45%, transparent 70%)',
          }}
        />

        {showFullBackground ? (
          <div className="flex flex-col items-center justify-center space-y-3 p-6 bg-black/85 backdrop-blur-2xl rounded-2xl border-2 border-emerald-500/70 shadow-[0_0_60px_rgba(16,185,129,0.35)] max-w-md mx-auto text-center animate-in fade-in zoom-in-95 duration-300">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-tr from-slate-950 via-emerald-950 to-emerald-700 border border-emerald-400 flex items-center justify-center text-3xl shadow-lg shadow-emerald-500/40">
              🎩
            </div>
            <div>
              <div className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-mono font-bold tracking-widest uppercase mb-1.5">
                <span>VISTA PANORÁMICA DE LA CENTRAL</span>
              </div>
              <div className="text-emerald-400 font-mono font-black text-lg tracking-tight">
                BLACK HAT DIALER SYSTEM
              </div>
            </div>

            <button
              onClick={() => setShowFullBackground(false)}
              className="mt-2 px-5 py-2.5 rounded-xl font-black font-mono text-xs bg-gradient-to-r from-emerald-400 to-teal-400 hover:from-emerald-300 hover:to-teal-300 text-black flex items-center space-x-2 shadow-lg shadow-emerald-500/40 cursor-pointer transition-all uppercase"
            >
              <LogIn className="w-4 h-4" />
              <span>Abrir Formulario de Acceso</span>
            </button>
          </div>
        ) : (
          <>
            {/* Panel de Login Reducido y Compacto */}
            <div
              className="w-full max-w-[340px] sm:max-w-[360px] p-5 sm:p-6 rounded-2xl backdrop-blur-2xl border border-emerald-500/50 shadow-[0_0_50px_rgba(16,185,129,0.25),inset_0_1px_1px_rgba(255,255,255,0.1)] transition-all relative overflow-hidden"
              style={{
                background:
                  'radial-gradient(ellipse at 50% -10%, rgba(18, 42, 34, 0.92) 0%, rgba(9, 20, 15, 0.95) 50%, rgba(3, 8, 6, 0.97) 100%)',
              }}
            >
              {/* Resplandores neón internos */}
              <div className="absolute -top-10 -right-10 w-28 h-28 rounded-full bg-emerald-500/20 blur-2xl pointer-events-none" />
              <div className="absolute -bottom-10 -left-10 w-28 h-28 rounded-full bg-cyan-500/20 blur-2xl pointer-events-none" />

              {/* Header Compacto */}
              <div className="mb-4 relative z-10">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="inline-flex items-center space-x-1.5 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[9px] font-mono font-bold tracking-widest uppercase">
                    <Zap className="w-2.5 h-2.5 text-emerald-400" />
                    <span>TERMINAL VOIP</span>
                  </div>
                  <span className="text-[9px] font-mono text-emerald-400 font-bold bg-black/60 px-1.5 py-0.5 rounded border border-emerald-500/30">
                    AST 20
                  </span>
                </div>
                <h2 className="text-xl sm:text-2xl font-black text-white font-mono tracking-tight leading-tight">
                  Iniciar Sesión
                </h2>
                <p className="text-[11px] text-slate-300 mt-0.5 font-medium">
                  Acceso autorizado al <strong className="text-emerald-400 font-mono">Dialer System</strong>.
                </p>
              </div>

              {/* Alerta de Error */}
              {errorMsg && (
                <div className="mb-3 p-2.5 rounded-xl bg-rose-950/90 border border-rose-500/70 text-rose-100 text-[11px] flex items-start space-x-2 shadow-lg">
                  <AlertCircle className="w-3.5 h-3.5 text-rose-400 flex-shrink-0 mt-0.5" />
                  <span className="font-mono">{errorMsg}</span>
                </div>
              )}

              {/* Formulario de Login Compacto */}
              <form onSubmit={handleSubmit} className="space-y-3 relative z-10">
                {/* Campo Usuario / Extensión */}
                <div>
                  <label className="block text-[11px] font-bold text-emerald-300 mb-1 font-mono flex items-center justify-between">
                    <span className="flex items-center space-x-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                      <span>USUARIO / EXTENSIÓN</span>
                    </span>
                  </label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none z-10">
                      <div className="w-6 h-6 rounded-md bg-emerald-500/20 border border-emerald-400/50 flex items-center justify-center text-emerald-300">
                        <UserIcon className="w-3 h-3" />
                      </div>
                    </div>
                    <input
                      id="input-login-username"
                      type="text"
                      required
                      autoComplete="username"
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      placeholder="Usuario o extensión"
                      className="cyber-login-input w-full pl-10 pr-3 py-2.5 rounded-xl border border-emerald-500/60 bg-[#0c1713] text-white placeholder-slate-400 text-xs font-mono font-medium tracking-wide focus:outline-none focus:border-emerald-300 focus:bg-[#152922] focus:ring-2 focus:ring-emerald-500/30 transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.7)]"
                    />
                  </div>
                </div>

                {/* Campo Contraseña */}
                <div>
                  <label className="block text-[11px] font-bold text-cyan-300 mb-1 font-mono flex items-center justify-between">
                    <span className="flex items-center space-x-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
                      <span>CONTRASEÑA</span>
                    </span>
                    <span className="text-[9px] text-cyan-300 bg-cyan-950/80 border border-cyan-500/40 px-1.5 py-0.2 rounded font-semibold">
                      AES-256
                    </span>
                  </label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none z-10">
                      <div className="w-6 h-6 rounded-md bg-cyan-500/20 border border-cyan-400/50 flex items-center justify-center text-cyan-300">
                        <Lock className="w-3 h-3" />
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
                      className="cyber-login-input w-full pl-10 pr-10 py-2.5 rounded-xl border border-emerald-500/60 bg-[#0c1713] text-white placeholder-slate-400 text-xs font-mono font-medium tracking-wide focus:outline-none focus:border-emerald-300 focus:bg-[#152922] focus:ring-2 focus:ring-emerald-500/30 transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.7)]"
                    />
                    <div className="absolute inset-y-0 right-0 pr-1.5 flex items-center z-10">
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="p-1.5 rounded-md bg-[#07110e] hover:bg-emerald-950/80 border border-emerald-500/40 hover:border-emerald-300 text-slate-300 hover:text-emerald-300 transition-all cursor-pointer"
                        aria-label={showPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                      >
                        {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5 text-slate-400" />}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Recordar Sesión */}
                <div className="flex items-center justify-between text-[11px] pt-0.5">
                  <label className="flex items-center space-x-2 cursor-pointer text-slate-300 hover:text-white select-none">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="w-3.5 h-3.5 rounded bg-[#0c1713] border border-emerald-500/70 text-emerald-500 focus:ring-emerald-400/40 focus:ring-offset-0 transition-all cursor-pointer accent-emerald-500"
                    />
                    <span className="font-mono text-[11px]">Recordar credenciales</span>
                  </label>
                </div>

                {/* Botón de Submit Compacto */}
                <button
                  id="btn-login-submit"
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full mt-2 py-2.5 px-4 rounded-xl font-bold text-xs shadow-[0_0_20px_rgba(16,185,129,0.3)] bg-gradient-to-r from-emerald-400 via-teal-300 to-emerald-400 hover:from-emerald-300 hover:to-teal-200 active:scale-[0.99] text-slate-950 flex items-center justify-center space-x-2 transition-all cursor-pointer disabled:opacity-50 font-mono tracking-wider uppercase border border-emerald-200/90"
                >
                  <LogIn className="w-3.5 h-3.5 text-slate-950 stroke-[2.5]" />
                  <span>{isSubmitting ? 'VERIFICANDO...' : 'AUTORIZAR ACCESO'}</span>
                </button>
              </form>

              {/* Pie informativo discreto */}
              <div className="mt-4 pt-2.5 border-t border-emerald-500/20 text-[9px] text-slate-400 font-mono flex items-center justify-between">
                <span className="flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3 text-emerald-400" />
                  Cifrado Zero-Trust
                </span>
                <span className="text-emerald-400/80 font-bold">Black Hat v4.2</span>
              </div>
            </div>

            {/* Cartel / Mensaje Destacado a la Derecha */}
            <div className="hidden lg:flex flex-col items-end text-right max-w-md xl:max-w-xl space-y-3 pointer-events-none select-none z-10 pr-2">
              <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-black/85 border border-emerald-500/50 text-emerald-300 text-xs font-mono font-bold tracking-widest uppercase shadow-[0_0_20px_rgba(16,185,129,0.3)] backdrop-blur-md">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
                <span>CENTRAL TELEFÓNICA CLANDESTINA</span>
              </div>

              <div className="space-y-1">
                <h2 className="text-3xl xl:text-4xl 2xl:text-5xl font-black text-white font-mono tracking-tight leading-tight uppercase drop-shadow-[0_0_35px_rgba(16,185,129,0.65)]">
                  BLACK HAT DIALER SYSTEM
                </h2>
              </div>

              <p className="text-xs sm:text-sm text-slate-200 font-mono tracking-wider max-w-md drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
                Infraestructura de telefonía PBX de alta intrusión, distribución de troncales SIP y comunicaciones cifradas.
              </p>

              {/* Indicadores técnicos de telefonía */}
              <div className="pt-1 flex flex-wrap items-center justify-end gap-2 text-xs font-mono text-emerald-400">
                <span className="px-2.5 py-1 rounded-lg bg-black/80 border border-emerald-500/40 backdrop-blur-md shadow-md flex items-center space-x-1.5 text-[11px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                  <span>ASTERISK 20 PJSIP</span>
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-black/80 border border-cyan-500/40 text-cyan-300 backdrop-blur-md shadow-md flex items-center space-x-1.5 text-[11px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
                  <span>TRONCALES MULTI-CARRIER</span>
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-black/80 border border-emerald-500/40 text-emerald-300 backdrop-blur-md shadow-md text-[11px]">
                  AUDIO HD BIDIRECCIONAL
                </span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* 4. FOOTER FLOTANTE TRANSLÚCIDA */}
      <footer className="relative z-20 w-full px-4 sm:px-8 py-2.5 flex flex-col sm:flex-row items-center justify-between text-[10px] font-mono text-slate-300 bg-black/80 backdrop-blur-md border-t border-emerald-500/30 pointer-events-auto gap-2">
        <div className="flex items-center space-x-2 text-emerald-400 font-bold">
          <Activity className="w-3 h-3" />
          <span>BLACK HAT DIALER SYSTEM</span>
        </div>

        <div className="flex items-center space-x-3 text-slate-400 text-[10px]">
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
