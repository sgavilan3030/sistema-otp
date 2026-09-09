import React, { useState } from 'react';
import { SystemUser, AsteriskConnectionSettings } from '../types';
import {
  LogIn,
  Lock,
  User as UserIcon,
  Eye,
  EyeOff,
  AlertCircle,
} from 'lucide-react';

interface LoginScreenProps {
  users: SystemUser[];
  onLogin: (user: SystemUser) => void;
  connectionSettings: AsteriskConnectionSettings;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  users,
  onLogin,
}) => {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [rememberMe, setRememberMe] = useState(false);
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
          avatarColor: 'from-amber-500 to-red-600',
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
          avatarColor: 'from-orange-500 to-amber-600',
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
      if (rememberMe) {
        localStorage.setItem('ast_session_user_token', foundUser.id);
      } else {
        localStorage.removeItem('ast_session_user_token');
      }
      onLogin(foundUser);
    }, 200);
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col md:flex-row items-stretch text-slate-100 selection:bg-amber-500 selection:text-slate-950">
      {/* Panel de Login alineado al lado izquierdo */}
      <div className="w-full md:w-[380px] lg:w-[420px] bg-slate-900/90 border-r border-slate-800/80 p-6 sm:p-10 flex flex-col justify-center min-h-screen shadow-2xl backdrop-blur-md z-10 flex-shrink-0">
        <div className="w-full max-w-sm mx-auto">
          {/* Cabecera minimalista y discreta */}
          <div className="mb-6">
            <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700/80 flex items-center justify-center text-amber-400 mb-3 shadow-md">
              <Lock className="w-5 h-5" />
            </div>
            <h2 className="text-xl font-bold text-white tracking-tight">
              Acceso
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Ingresa tus credenciales para continuar
            </p>
          </div>

          {/* Alerta de Error */}
          {errorMsg && (
            <div className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start space-x-2">
              <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Formulario Reducido */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Usuario
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
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
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-slate-950/80 border border-slate-800 text-white placeholder-slate-500 text-xs sm:text-sm focus:border-amber-500 focus:ring-1 focus:ring-amber-500 focus:outline-none transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Contraseña
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
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
                  className="w-full pl-10 pr-10 py-2.5 rounded-lg bg-slate-950/80 border border-slate-800 text-white placeholder-slate-500 text-xs sm:text-sm focus:border-amber-500 focus:ring-1 focus:ring-amber-500 focus:outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-500 hover:text-slate-300 transition-colors"
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs pt-0.5">
              <label className="flex items-center space-x-2 text-slate-400 hover:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="rounded bg-slate-950 border-slate-800 text-amber-500 focus:ring-0"
                />
                <span>Recordar sesión</span>
              </label>
            </div>

            <button
              id="btn-login-submit"
              type="submit"
              disabled={isSubmitting}
              className="w-full mt-2 py-2.5 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-slate-950 font-bold text-sm shadow-md shadow-amber-500/20 flex items-center justify-center space-x-2 transition-all cursor-pointer disabled:opacity-50"
            >
              <LogIn className="w-4 h-4" />
              <span>{isSubmitting ? 'Ingresando...' : 'Entrar'}</span>
            </button>
          </form>
        </div>
      </div>

      {/* Espacio derecho vacío, limpio y sin texto ni información */}
      <div className="hidden md:flex flex-1 bg-slate-950" />
    </div>
  );
};
