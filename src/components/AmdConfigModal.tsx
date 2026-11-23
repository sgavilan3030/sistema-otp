import React, { useEffect, useState, useCallback } from 'react';
import { Mic, Sliders, RefreshCw, CheckCircle2, ShieldAlert, X, Activity, Wrench, AlertTriangle } from 'lucide-react';

interface AmdDiagnosticData {
  success: boolean;
  source?: string;
  hasLocalAsterisk?: boolean;
  enabled?: boolean;
  astDbValue?: string;
  moduleLoaded?: boolean;
  moduleRaw?: string;
  appRegistered?: boolean;
  amdConfExists?: boolean;
  amdParams?: Record<string, string>;
  dialplanContexts?: Array<{ context: string; present: boolean; hasAmd: boolean; hasRetry: boolean }>;
  recentLogs?: string[];
  recentDetections?: Array<{ number: string; status: string; cause: string; timestamp: number }>;
  ready?: boolean;
  message?: string;
}

interface AmdConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  amdEnabled: boolean;
  isToggling: boolean;
  feedback: string | null;
  onToggleAmd: () => void;
}

export const AmdConfigModal: React.FC<AmdConfigModalProps> = ({
  isOpen,
  onClose,
  amdEnabled,
  isToggling,
  feedback,
  onToggleAmd,
}) => {
  const [diag, setDiag] = useState<AmdDiagnosticData | null>(null);
  const [isCheckingDiag, setIsCheckingDiag] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [diagError, setDiagError] = useState<string | null>(null);
  const [verifyFeedback, setVerifyFeedback] = useState<string | null>(null);

  const loadDiagnostic = useCallback(async () => {
    setIsCheckingDiag(true);
    setDiagError(null);
    try {
      const res = await fetch('/api/asterisk/amd/diagnostic');
      const data = await res.json();
      if (!res.ok || !data.success) {
        setDiagError(data.error || `Error HTTP ${res.status}`);
      } else {
        setDiag(data);
      }
    } catch (e: any) {
      setDiagError(e.message || 'No se pudo consultar el diagnóstico AMD');
    } finally {
      setIsCheckingDiag(false);
    }
  }, []);

  const handleVerifyAndRepair = async () => {
    setIsVerifying(true);
    setDiagError(null);
    setVerifyFeedback(null);
    try {
      const res = await fetch('/api/asterisk/amd/verify', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setDiagError(data.error || `Error HTTP ${res.status}`);
      } else {
        setDiag(data);
        setVerifyFeedback(data.message || 'AMD verificado en Asterisk.');
      }
    } catch (e: any) {
      setDiagError(e.message || 'Error al verificar/reparar AMD en Asterisk');
    } finally {
      setIsVerifying(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    loadDiagnostic();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose, loadDiagnostic]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] flex flex-col bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-3 bg-slate-950/60 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center border shrink-0 ${
              amdEnabled
                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                : 'bg-rose-500/15 border-rose-500/30 text-rose-400'
            }`}>
              <Mic className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-white truncate">
                Configuración y Verificación AMD
              </h3>
              <p className="text-[11px] text-slate-400 truncate">
                Filtro de grabadora, buzón de voz, módulo app_amd.so y diagnóstico en vivo
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
            title="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Mic className={`w-4 h-4 shrink-0 ${amdEnabled ? 'text-emerald-400' : 'text-rose-400'}`} />
                  <span className="text-xs font-bold text-white uppercase tracking-wider">
                    Sistema de Detección de Grabadora / Contestador (AMD)
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                    amdEnabled
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                  }`}>
                    {amdEnabled ? '✓ ACTIVA' : '✕ DESACTIVADA'}
                  </span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  {amdEnabled
                    ? 'Al contestar, el IVR entra inmediatamente desde que el cliente hable. Si detecta correo de voz o contestador, colgará y reintentará.'
                    : 'La detección está desactivada: al contestar el cliente, esperará 1.2 segundos antes de iniciar el IVR sin filtrar contestadores.'}
                </p>
              </div>

              <button
                id="btn-toggle-amd-modal"
                type="button"
                onClick={onToggleAmd}
                disabled={isToggling}
                className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer shadow-md shrink-0 whitespace-nowrap ${
                  amdEnabled
                    ? 'bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 hover:border-rose-400'
                    : 'bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 hover:border-emerald-400'
                }`}
              >
                {isToggling ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sliders className="w-3.5 h-3.5" />
                )}
                <span>{amdEnabled ? 'Desactivar Detección AMD' : 'Activar Detección AMD'}</span>
              </button>
            </div>

            {feedback && (
              <div className="p-2.5 rounded-lg bg-slate-900 border border-emerald-500/30 text-emerald-300 text-[11px] font-mono flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>{feedback}</span>
              </div>
            )}

            {/* Límite estricto de 2 marcaciones */}
            <div className="p-3 rounded-lg bg-slate-900/90 border border-sky-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 text-sky-300">
                <ShieldAlert className="w-4 h-4 text-sky-400 shrink-0" />
                <span>
                  <strong>Límite de Marcación Si No Contesta:</strong> Máximo <strong>2 llamadas</strong> en total (1 llamada inicial + 1 reintento automático).
                </span>
              </div>
              <span className="text-[10px] font-mono text-slate-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800 whitespace-nowrap shrink-0">
                Estricto: No más de 2 marcaciones
              </span>
            </div>
          </div>

          {/* Diagnóstico en Vivo en Asterisk */}
          <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-indigo-400 shrink-0" />
                <span className="text-xs font-bold text-white uppercase tracking-wider">
                  Diagnóstico Real en Asterisk
                </span>
                {diag && (
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                    diag.ready
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  }`}>
                    {diag.ready ? 'OPERATIVO' : diag.hasLocalAsterisk ? 'REQUIERE REVISIÓN' : 'SIN ASTERISK LOCAL'}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={loadDiagnostic}
                  disabled={isCheckingDiag || isVerifying}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-200 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${isCheckingDiag ? 'animate-spin' : ''}`} />
                  <span>Actualizar</span>
                </button>
                <button
                  type="button"
                  onClick={handleVerifyAndRepair}
                  disabled={isVerifying || isCheckingDiag}
                  className="px-2.5 py-1.5 rounded-lg bg-indigo-600/25 hover:bg-indigo-600/40 border border-indigo-500/40 text-[11px] font-semibold text-indigo-200 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {isVerifying ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Wrench className="w-3 h-3" />}
                  <span>Verificar y Recargar AMD</span>
                </button>
              </div>
            </div>

            {verifyFeedback && (
              <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-[11px] font-mono">
                {verifyFeedback}
              </div>
            )}
            {diagError && (
              <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-[11px] font-mono flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>{diagError}</span>
              </div>
            )}

            {diag && (
              <div className="space-y-2.5 text-[11px]">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                    <div className="text-slate-400">Módulo app_amd.so</div>
                    <div className={`font-bold mt-0.5 ${diag.moduleLoaded ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {diag.moduleLoaded ? 'Cargado (Running)' : 'No cargado'}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                    <div className="text-slate-400">Aplicación AMD()</div>
                    <div className={`font-bold mt-0.5 ${diag.appRegistered ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {diag.appRegistered ? 'Registrada' : 'No registrada'}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                    <div className="text-slate-400">Archivo amd.conf</div>
                    <div className={`font-bold mt-0.5 ${diag.amdConfExists ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {diag.amdConfExists ? 'Sincronizado' : 'Faltante'}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                    <div className="text-slate-400">AstDB amd_enabled</div>
                    <div className="font-bold mt-0.5 text-sky-300 font-mono">
                      {diag.astDbValue || (diag.enabled ? '1' : '0')}
                    </div>
                  </div>
                </div>

                {diag.amdParams && (
                  <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 font-mono text-[10px] text-slate-300">
                    Parámetros activos: initial_silence={diag.amdParams.initial_silence}ms | greeting={diag.amdParams.greeting}ms | after_silence={diag.amdParams.after_greeting_silence}ms | total={diag.amdParams.total_analysis_time}ms | max_words={diag.amdParams.maximum_number_of_words} | silence_threshold={diag.amdParams.silence_threshold}
                  </div>
                )}

                {Array.isArray(diag.dialplanContexts) && diag.dialplanContexts.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {diag.dialplanContexts.map((ctx) => (
                      <span
                        key={ctx.context}
                        className={`px-2 py-0.5 rounded border font-mono text-[10px] ${
                          ctx.present && ctx.hasAmd
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                            : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                        }`}
                      >
                        [{ctx.context}] {ctx.hasAmd ? 'AMD ✓' : 'Sin AMD'} {ctx.hasRetry ? '• Retry ✓' : ''}
                      </span>
                    ))}
                  </div>
                )}

                {Array.isArray(diag.recentLogs) && diag.recentLogs.length > 0 && (
                  <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
                    <div className="text-[10px] font-bold text-slate-400 uppercase">Últimos eventos AMD en logs</div>
                    <div className="max-h-28 overflow-y-auto font-mono text-[10px] text-slate-300 space-y-0.5">
                      {diag.recentLogs.map((line, i) => (
                        <div key={i} className="truncate" title={line}>{line}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/60 flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition-colors cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
