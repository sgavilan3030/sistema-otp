import React, { useState } from 'react';
import { SystemUser, AsteriskConnectionSettings } from '../types';
import {
  LogIn,
  Lock,
  User as UserIcon,
  Eye,
  EyeOff,
  AlertCircle,
  Sun,
  Moon,
} from 'lucide-react';

interface LoginScreenProps {
  users: SystemUser[];
  onLogin: (user: SystemUser) => void;
  connectionSettings: AsteriskConnectionSettings;
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  users,
  onLogin,
  theme = 'light',
  onToggleTheme,
}) => {
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

    // Búsqueda en la lista actual de usuarios
    let foundUser = users.find(
      (u) =>
        u.email.toLowerCase() === cleanId ||
        (u.username && u.username.toLowerCase() === cleanId) ||
        u.name.toLowerCase() === cleanId
    );

    // Respaldo de acceso administrativo directo
    if (!foundUser) {
      if (cleanId === 'admin' || cleanId === 'admin.asterisk@empresa.com') {
        foundUser = {
          id: 'user-admin',
          name: 'Administrador Telecom',
          username: 'admin',
          email: 'admin.asterisk@empresa.com',
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
    <div className={`min-h-screen flex flex-col md:flex-row items-stretch transition-colors ${
      theme === 'light' ? 'bg-slate-100/80 text-slate-900 selection:bg-blue-500/20' : 'bg-black text-slate-100 selection:bg-emerald-500 selection:text-black'
    }`}>
      {/* Panel de Login alineado al lado izquierdo */}
      <div className={`w-full md:w-[380px] lg:w-[420px] p-6 sm:p-10 flex flex-col justify-center min-h-screen shadow-xl backdrop-blur-md z-10 flex-shrink-0 border-r transition-colors ${
        theme === 'light' ? 'bg-white border-slate-200' : 'bg-neutral-950 border-neutral-800'
      }`}>
        <div className="w-full max-w-sm mx-auto">
          {/* Top row with theme toggle */}
          {onToggleTheme && (
            <div className="flex justify-end mb-4">
              <button
                type="button"
                onClick={onToggleTheme}
                className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                  theme === 'light'
                    ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'
                    : 'bg-neutral-900 hover:bg-neutral-800 text-slate-300 border-neutral-700'
                }`}
                title="Cambiar apariencia visual"
              >
                {theme === 'light' ? (
                  <>
                    <Sun className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Modo Claro</span>
                  </>
                ) : (
                  <>
                    <Moon className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Modo Oscuro</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* Cabecera minimalista y discreta */}
          <div className="mb-6">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 shadow-sm border ${
              theme === 'light' ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-neutral-900 border-neutral-800 text-emerald-400'
            }`}>
              <Lock className="w-5 h-5" />
            </div>
            <h2 className={`text-xl font-bold tracking-tight ${theme === 'light' ? 'text-slate-900' : 'text-white'}`}>
              Acceso al Sistema
            </h2>
            <p className={`text-xs mt-1 ${theme === 'light' ? 'text-slate-500' : 'text-slate-400'}`}>
              Ingresa tus credenciales para continuar
            </p>
          </div>

          {/* Alerta de Error */}
          {errorMsg && (
            <div className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-500 text-xs flex items-start space-x-2">
              <AlertCircle className="w-4 h-4 text-rose-500 flex-shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Formulario Reducido */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className={`block text-xs font-semibold mb-1.5 ${theme === 'light' ? 'text-slate-700' : 'text-slate-300'}`}>
                Usuario
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <UserIcon className="w-4 h-4" />
                </div>
                <input
                  id="input-login-username"
                  type="text"
                  required
                  autoComplete="username"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="Usuario"
                  className={`w-full pl-10 pr-4 py-2.5 rounded-lg border text-xs sm:text-sm focus:outline-none transition-all ${
                    theme === 'light'
                      ? 'bg-slate-50 border-slate-300 text-slate-900 placeholder-slate-400 focus:border-blue-600 focus:bg-white focus:ring-1 focus:ring-blue-600'
                      : 'bg-black border-neutral-800 text-white placeholder-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500'
                  }`}
                />
              </div>
            </div>

            <div>
              <label className={`block text-xs font-semibold mb-1.5 ${theme === 'light' ? 'text-slate-700' : 'text-slate-300'}`}>
                Contraseña
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  id="input-login-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className={`w-full pl-10 pr-10 py-2.5 rounded-lg border text-xs sm:text-sm focus:outline-none transition-all ${
                    theme === 'light'
                      ? 'bg-slate-50 border-slate-300 text-slate-900 placeholder-slate-400 focus:border-blue-600 focus:bg-white focus:ring-1 focus:ring-blue-600'
                      : 'bg-black border-neutral-800 text-white placeholder-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 transition-colors"
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs pt-0.5">
              <label className={`flex items-center space-x-2 cursor-pointer ${theme === 'light' ? 'text-slate-600 hover:text-slate-900' : 'text-slate-400 hover:text-slate-300'}`}>
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="rounded border-slate-300 text-emerald-600 focus:ring-0"
                />
                <span>Recordar usuario</span>
              </label>
            </div>

            <button
              id="btn-login-submit"
              type="submit"
              disabled={isSubmitting}
              className={`w-full mt-2 py-2.5 px-4 rounded-lg font-bold text-sm shadow-md flex items-center justify-center space-x-2 transition-all cursor-pointer disabled:opacity-50 ${
                theme === 'light'
                  ? 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-blue-600/20'
                  : 'bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-black shadow-emerald-500/20'
              }`}
            >
              <LogIn className="w-4 h-4" />
              <span>{isSubmitting ? 'Ingresando...' : 'Entrar'}</span>
            </button>
          </form>
        </div>
      </div>

      {/* Espacio derecho limpio y equilibrado */}
      <div className={`hidden md:flex flex-1 ${theme === 'light' ? 'bg-slate-50' : 'bg-black'}`} />
    </div>
  );
};
