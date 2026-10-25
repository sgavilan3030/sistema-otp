import React, { useState, useEffect } from 'react';
import {
  PhoneForwarded,
  X,
  Check,
  ShieldCheck,
  Phone,
  Building2,
  CreditCard,
  MessageSquare,
  Lock,
  ShoppingBag,
  Sparkles,
  RefreshCw,
  Sliders,
} from 'lucide-react';

interface CallerIdModalProps {
  isOpen: boolean;
  onClose: () => void;
  callerIdNum: string;
  callerIdName: string;
  onSaveCallerId: (num: string, name: string) => Promise<void> | void;
}

export const CallerIdModal: React.FC<CallerIdModalProps> = ({
  isOpen,
  onClose,
  callerIdNum,
  callerIdName,
  onSaveCallerId,
}) => {
  const [numVal, setNumVal] = useState(callerIdNum);
  const [nameVal, setNameVal] = useState(callerIdName);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setNumVal(callerIdNum || '+18005550199');
      setNameVal(callerIdName || 'Seguridad Bancaria');
      setSaveSuccess(false);
    }
  }, [isOpen, callerIdNum, callerIdName]);

  if (!isOpen) return null;

  const presets = [
    {
      label: 'Banreservas Antifraude',
      name: 'BANRESERVAS',
      num: '8099602110',
      icon: Building2,
      color: 'emerald',
    },
    {
      label: 'Visa Seguridad Internacional',
      name: 'VISA SEGURIDAD',
      num: '18005550199',
      icon: CreditCard,
      color: 'sky',
    },
    {
      label: 'Banco Popular Dominicano',
      name: 'BANCO POPULAR',
      num: '8095445555',
      icon: Building2,
      color: 'blue',
    },
    {
      label: 'WhatsApp / Telegram Verif.',
      name: 'WHATSAPP VERIF',
      num: '18004567890',
      icon: MessageSquare,
      color: 'emerald',
    },
    {
      label: 'Google / Apple ID Alerta',
      name: 'SECURITY ALERT',
      num: '18005550122',
      icon: Lock,
      color: 'amber',
    },
    {
      label: 'Amazon Fraude / Entregas',
      name: 'AMAZON FRAUD',
      num: '18005550133',
      icon: ShoppingBag,
      color: 'orange',
    },
    {
      label: 'Banco BHD León',
      name: 'BANCO BHD',
      num: '8092435000',
      icon: Building2,
      color: 'emerald',
    },
    {
      label: 'Scotiabank República Dominicana',
      name: 'SCOTIABANK',
      num: '8095677268',
      icon: Building2,
      color: 'rose',
    },
    {
      label: 'Número Privado / Desconocido',
      name: 'DESCONOCIDO',
      num: '0000000000',
      icon: Sliders,
      color: 'slate',
    },
  ];

  const handleApplyPreset = (p: typeof presets[0]) => {
    setNameVal(p.name);
    setNumVal(p.num);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!numVal.trim()) return;
    setIsSaving(true);
    try {
      await onSaveCallerId(numVal.trim(), nameVal.trim());
      setSaveSuccess(true);
      setTimeout(() => {
        onClose();
      }, 900);
    } catch (_) {
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto animate-fadeIn">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl space-y-4 my-8">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              <PhoneForwarded className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>Cambiar ID de Llamada Saliente (Caller ID)</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Global
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Define el número y nombre que verá la persona receptora en la pantalla de su teléfono
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-all cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-5 space-y-5">
          {/* Live Mobile Screen Preview */}
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Phone className="w-3 h-3 text-emerald-400" />
              <span>Simulación de Pantalla del Cliente Receptor:</span>
            </span>

            <div className="bg-gradient-to-b from-slate-900 to-black p-4 rounded-xl border border-slate-800/80 flex flex-col items-center justify-center text-center space-y-1 shadow-inner">
              <span className="text-[10px] text-emerald-400/90 font-mono tracking-widest uppercase animate-pulse">
                • LLAMADA ENTRANTE •
              </span>
              <div className="text-lg font-black text-white tracking-wide">
                {nameVal.trim() || 'DESCONOCIDO'}
              </div>
              <div className="text-sm font-mono text-emerald-300 font-bold">
                {numVal.trim() || '+1 800-000-0000'}
              </div>
              <span className="text-[9px] text-slate-500 font-mono pt-1">
                Visualizado como: "{nameVal.trim() || 'DESCONOCIDO'}" &lt;{numVal.trim() || '0000000000'}&gt;
              </span>
            </div>
          </div>

          {/* Input Fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center justify-between">
                <span>Número de Teléfono (CID Num)</span>
                <span className="text-[10px] text-slate-500 font-mono">Dígitos</span>
              </label>
              <input
                type="text"
                required
                value={numVal}
                onChange={(e) => setNumVal(e.target.value)}
                placeholder="ej. 8099602110 o 18005550199"
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm font-mono text-white focus:outline-none focus:border-emerald-500 font-bold"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center justify-between">
                <span>Nombre Visible (CID Name)</span>
                <span className="text-[10px] text-slate-500 font-mono">Texto</span>
              </label>
              <input
                type="text"
                required
                value={nameVal}
                onChange={(e) => setNameVal(e.target.value)}
                placeholder="ej. BANRESERVAS"
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm font-mono text-white focus:outline-none focus:border-emerald-500 font-bold uppercase"
              />
            </div>
          </div>

          {/* Quick Preset Buttons */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              <span>Plantillas Rápidas de Caller ID:</span>
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {presets.map((p, idx) => {
                const Icon = p.icon;
                const isSelected = nameVal === p.name && numVal === p.num;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleApplyPreset(p)}
                    className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex items-center gap-2 ${
                      isSelected
                        ? 'bg-emerald-950/60 border-emerald-500 text-white shadow-sm ring-1 ring-emerald-500/50'
                        : 'bg-slate-950/80 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                    }`}
                  >
                    <Icon className="w-4 h-4 text-emerald-400 shrink-0" />
                    <div className="truncate min-w-0">
                      <div className="text-xs font-bold truncate text-white">{p.name}</div>
                      <div className="text-[10px] font-mono text-slate-400 truncate">{p.num}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Feedback */}
          {saveSuccess && (
            <div className="p-3 bg-emerald-500/20 border border-emerald-500/40 rounded-xl text-emerald-300 text-xs font-bold flex items-center gap-2 animate-fadeIn">
              <Check className="w-4 h-4 text-emerald-400" />
              <span>✓ Caller ID saliente actualizado exitosamente en Asterisk.</span>
            </div>
          )}

          {/* Footer Actions */}
          <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSaving || !numVal.trim()}
              className="px-5 py-2.5 rounded-xl text-xs font-black bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 shadow-lg shadow-emerald-500/25 disabled:opacity-40 transition-all flex items-center gap-2 cursor-pointer"
            >
              {isSaving ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              <span>{isSaving ? 'Guardando en Asterisk...' : 'Aplicar Caller ID Saliente'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
