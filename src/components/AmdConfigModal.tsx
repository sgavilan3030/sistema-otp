import React, { useEffect } from 'react';
import { Mic, Sliders, RefreshCw, CheckCircle2, ShieldAlert, X } from 'lucide-react';

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
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-3 bg-slate-950/60">
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
                Configuración de Detección AMD
              </h3>
              <p className="text-[11px] text-slate-400 truncate">
                Filtro de grabadora, buzón de voz y límite de reintentos
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
        <div className="p-5 space-y-4">
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
                    : 'La detección está desactivada: al contestar el cliente, esperará 2 segundos antes de iniciar el IVR sin filtrar contestadores.'}
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
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/60 flex justify-end">
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
