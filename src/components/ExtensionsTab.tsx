import React, { useState, useEffect } from 'react';
import { PjsipExtension } from '../types';
import { Plus, Trash2, Edit2, Key, Check, Wifi, AlertCircle, Phone, Eye, EyeOff, Shield, ShieldCheck, RefreshCw, CheckCircle2, Zap, Copy, Server, HelpCircle, Wrench, ShieldAlert } from 'lucide-react';

interface ExtensionsTabProps {
  extensions: PjsipExtension[];
  onAddExtension: (extension: PjsipExtension) => void;
  onUpdateExtension: (extension: PjsipExtension) => void;
  onDeleteExtension: (id: string) => void;
  onSimulateQualify: (extNumber: string) => void;
  onSyncAsterisk?: () => void;
  onResetDefaultExtensions?: () => void;
  isSyncing?: boolean;
}

export const ExtensionsTab: React.FC<ExtensionsTabProps> = ({
  extensions,
  onAddExtension,
  onUpdateExtension,
  onDeleteExtension,
  onSimulateQualify,
  onSyncAsterisk,
  onResetDefaultExtensions,
  isSyncing,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingExt, setEditingExt] = useState<PjsipExtension | null>(null);
  const [previewExt, setPreviewExt] = useState<PjsipExtension | null>(null);

  // Quick Direct CallerID Modal state for agent
  const [quickCidExt, setQuickCidExt] = useState<PjsipExtension | null>(null);
  const [quickCidNum, setQuickCidNum] = useState('+18005550199');
  const [quickCidName, setQuickCidName] = useState('Seguridad Bancaria');
  const [quickCidSaving, setQuickCidSaving] = useState(false);
  const [quickCidFeedback, setQuickCidFeedback] = useState<string | null>(null);

  // Diagnostic and Repair states
  const [diagnosticLoading, setDiagnosticLoading] = useState(false);
  const [repairLoading, setRepairLoading] = useState(false);
  const [diagnosticInfo, setDiagnosticInfo] = useState<{
    success?: boolean;
    hasSyntaxError?: boolean;
    endpoints?: any[];
    rawOutput?: string;
    credentials?: any[];
  } | null>(null);
  const [repairFeedback, setRepairFeedback] = useState<string | null>(null);
  const [visibleSecrets, setVisibleSecrets] = useState<Record<string, boolean>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [softphoneModalExt, setSoftphoneModalExt] = useState<PjsipExtension | null>(null);

  const toggleSecret = (id: string) => {
    setVisibleSecrets(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  const handleRunDiagnostic = async () => {
    setDiagnosticLoading(true);
    setRepairFeedback(null);
    try {
      const res = await fetch('/api/asterisk/extensions/diagnostic');
      const data = await res.json();
      setDiagnosticInfo(data);
    } catch (e: any) {
      console.error('Error running diagnostic:', e);
    } finally {
      setDiagnosticLoading(false);
    }
  };

  const handleRepairAndReconnect = async () => {
    setRepairLoading(true);
    setRepairFeedback(null);
    try {
      const res = await fetch('/api/asterisk/extensions/repair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extensions }),
      });
      const data = await res.json();
      if (data.success) {
        setRepairFeedback('✓ ¡Reparación completada! Se limpiaron los encabezados duplicados y Asterisk PJSIP fue recargado en caliente.');
        await handleRunDiagnostic();
        if (onSyncAsterisk) onSyncAsterisk();
      } else {
        setRepairFeedback(`Error en reparación: ${data.error || 'Desconocido'}`);
      }
    } catch (e: any) {
      setRepairFeedback(`Fallo en conexión: ${e.message}`);
    } finally {
      setRepairLoading(false);
    }
  };

  useEffect(() => {
    handleRunDiagnostic();
  }, []);

  // Form State
  const [extNumber, setExtNumber] = useState('');
  const [extName, setExtName] = useState('');
  const [extSecret, setExtSecret] = useState('');
  const [extCallerIdNum, setExtCallerIdNum] = useState('+18005550199');
  const [extCallerIdName, setExtCallerIdName] = useState('Seguridad Bancaria');
  const [extContext, setExtContext] = useState('from-internal');
  const [extTransport, setExtTransport] = useState<PjsipExtension['transport']>('transport-udp');
  const [extPort, setExtPort] = useState<number>(47923);
  const [extMaxContacts, setExtMaxContacts] = useState(2);
  const [selectedCodecs, setSelectedCodecs] = useState<string[]>(['ulaw', 'alaw', 'g722']);

  const availableCodecs = ['ulaw', 'alaw', 'g722', 'opus', 'g729'];

  const [validationError, setValidationError] = useState<string | null>(null);

  const handleOpenCreateModal = () => {
    setEditingExt(null);
    setValidationError(null);
    const validNums = extensions
      .map((e) => parseInt(e.extension, 10))
      .filter((n) => !isNaN(n) && n >= 1001);
    const nextExt = validNums.length > 0 ? (Math.max(...validNums) + 1).toString() : '1001';
    setExtNumber(nextExt);
    setExtName(`Usuario ${nextExt}`);
    setExtSecret(`Pass!${Math.random().toString(36).slice(-8)}#2026`);
    setExtCallerIdNum('+18005550199');
    setExtCallerIdName('Seguridad Bancaria');
    setExtContext('from-internal');
    setExtTransport('transport-udp');
    setExtPort(47923);
    setExtMaxContacts(2);
    setSelectedCodecs(['ulaw', 'alaw', 'g722']);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (ext: PjsipExtension) => {
    setEditingExt(ext);
    setValidationError(null);
    setExtNumber(ext.extension);
    setExtName(ext.name);
    setExtSecret(ext.secret);
    setExtCallerIdNum(ext.callerIdNum || '+18005550199');
    setExtCallerIdName(ext.callerIdName || ext.name || 'Seguridad Bancaria');
    setExtContext(ext.context);
    setExtTransport(ext.transport);
    setExtPort(ext.port || 47923);
    setExtMaxContacts(ext.maxContacts);
    setSelectedCodecs(ext.codecs);
    setIsModalOpen(true);
  };

  const handleOpenQuickCid = (ext: PjsipExtension) => {
    setQuickCidExt(ext);
    setQuickCidNum(ext.callerIdNum || '+18005550199');
    setQuickCidName(ext.callerIdName || ext.name || 'Seguridad Bancaria');
    setQuickCidFeedback(null);
  };

  const handleSaveQuickCid = async () => {
    if (!quickCidExt) return;
    setQuickCidSaving(true);
    setQuickCidFeedback(null);

    const cleanNum = (quickCidNum || quickCidExt.extension).trim();
    const cleanName = (quickCidName || 'Seguridad Bancaria').trim();

    try {
      // 1. Guardar en Asterisk DB al instante
      await fetch('/api/asterisk/extension/callerid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          extension: quickCidExt.extension,
          callerIdNum: cleanNum,
          callerIdName: cleanName,
        }),
      });

      // 2. Actualizar estado en frontend
      onUpdateExtension({
        ...quickCidExt,
        callerIdNum: cleanNum,
        callerIdName: cleanName,
        callerId: `"${cleanName}" <${cleanNum}>`,
      });

      setQuickCidFeedback('¡CallerID aplicado en Asterisk AstDB!');
      setTimeout(() => {
        setQuickCidExt(null);
        setQuickCidFeedback(null);
      }, 1200);
    } catch (e: any) {
      setQuickCidFeedback('Error al sincronizar con Asterisk: ' + e.message);
    } finally {
      setQuickCidSaving(false);
    }
  };

  const handleGeneratePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
    let pass = '';
    for (let i = 0; i < 14; i++) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setExtSecret(pass);
  };

  const toggleCodec = (codec: string) => {
    if (selectedCodecs.includes(codec)) {
      if (selectedCodecs.length > 1) {
        setSelectedCodecs(selectedCodecs.filter((c) => c !== codec));
      }
    } else {
      setSelectedCodecs([...selectedCodecs, codec]);
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    if (!extNumber || !extSecret) return;

    const num = parseInt(extNumber.trim(), 10);
    if (isNaN(num) || num < 1001) {
      setValidationError('Las extensiones en Asterisk 20 deben ser a partir de 1001 (rango permitido: 1001 en adelante).');
      return;
    }

    // Check duplicate
    const duplicate = extensions.find(
      (e) => e.extension === extNumber.trim() && (!editingExt || e.id !== editingExt.id)
    );
    if (duplicate) {
      setValidationError(`La extensión ${extNumber} ya existe para "${duplicate.name}". Elija otro número.`);
      return;
    }

    const effectiveCidNum = (extCallerIdNum || extNumber).trim();
    const effectiveCidName = (extCallerIdName || extName || `Ext ${extNumber}`).trim();
    const callerId = `"${effectiveCidName}" <${effectiveCidNum}>`;
    const portNum = parseInt(String(extPort), 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      setValidationError('El puerto de transporte PJSIP debe ser un número válido entre 1 y 65535 (ejemplo: 47923 o 5060).');
      return;
    }

    if (editingExt) {
      onUpdateExtension({
        ...editingExt,
        extension: extNumber.trim(),
        name: extName || `Ext ${extNumber}`,
        secret: extSecret,
        context: extContext,
        transport: extTransport,
        port: portNum,
        maxContacts: extMaxContacts,
        codecs: selectedCodecs,
        callerId,
        callerIdNum: effectiveCidNum,
        callerIdName: effectiveCidName,
        ipAddress: editingExt.ipAddress?.includes(':')
          ? `${editingExt.ipAddress.split(':')[0]}:${portNum}`
          : `192.168.1.145:${portNum}`,
      });
    } else {
      onAddExtension({
        id: `ext-${extNumber}-${Date.now()}`,
        extension: extNumber.trim(),
        name: extName || `Ext ${extNumber}`,
        secret: extSecret,
        context: extContext,
        transport: extTransport,
        port: portNum,
        maxContacts: extMaxContacts,
        codecs: selectedCodecs,
        callerId,
        callerIdNum: effectiveCidNum,
        callerIdName: effectiveCidName,
        status: 'registered',
        ipAddress: `192.168.1.${Math.floor(Math.random() * 150) + 50}:${portNum}`,
        lastSeen: 'Recién creada (Sincronizada vía AMI)',
      });
    }
    setIsModalOpen(false);
  };

  const getStatusBadge = (status: PjsipExtension['status']) => {
    switch (status) {
      case 'registered':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            Registrado
          </span>
        );
      case 'in-use':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse"></span>
            En Llamada
          </span>
        );
      case 'ringing':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
            Timbrando
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-400 border border-slate-700">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-500"></span>
            Desconectado
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header and stats */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2 flex-wrap">
            <span>Gestor de Extensiones PJSIP</span>
            <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
              {extensions.length} totales
            </span>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-semibold font-mono">
              Rango: 1001 en adelante
            </span>
          </h2>
          <p className="text-sm text-slate-400">
            Cada cambio inyecta los objetos <code className="text-emerald-300 font-mono text-xs">endpoint</code>, <code className="text-emerald-300 font-mono text-xs">auth</code> y <code className="text-emerald-300 font-mono text-xs">aor</code> en Asterisk 20 con recarga AMI automática.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {onResetDefaultExtensions && (
            <button
              id="btn-restore-default-extensions"
              onClick={onResetDefaultExtensions}
              className="inline-flex items-center space-x-2 px-3.5 py-2.5 rounded-lg text-sm font-semibold bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 shadow-md transition-all"
              title="Restaura en la web y en Asterisk las extensiones oficiales 1001, 1002, 1003 y 1004"
            >
              <Zap className="w-4 h-4 text-amber-400" />
              <span>Cargar 1001, 1002, 1003</span>
            </button>
          )}

          {onSyncAsterisk && (
            <button
              id="btn-sync-asterisk-now"
              onClick={onSyncAsterisk}
              disabled={isSyncing}
              className="inline-flex items-center space-x-2 px-3.5 py-2.5 rounded-lg text-sm font-semibold bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-emerald-500/30 shadow-md transition-all disabled:opacity-50"
              title="Aplica inmediatamente la lista actual de extensiones en Asterisk y recarga PJSIP sin caídas de llamada"
            >
              <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Sincronizando...' : 'Aplicar a Asterisk'}</span>
            </button>
          )}

          <button
            id="btn-add-pjsip-extension"
            onClick={handleOpenCreateModal}
            className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-lg text-sm font-semibold bg-emerald-500 hover:bg-emerald-400 text-black shadow-md shadow-emerald-500/20 transition-all font-bold"
          >
            <Plus className="w-4 h-4" />
            <span>Nueva Extensión PJSIP</span>
          </button>
        </div>
      </div>

      {/* Asterisk 20 PJSIP Live Diagnostic & Repair Banner */}
      <div className="p-4 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900 to-slate-950 border border-slate-800 shadow-xl space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-white text-base">Estado de Enlace Asterisk 20 (Extensiones 1001 y 1002)</h3>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  PJSIP Engine
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Verificación en tiempo real de registro de softphones y objetos PJSIP (<code className="text-slate-300">endpoint/auth/aor</code>).
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleRunDiagnostic}
              disabled={diagnosticLoading}
              className="px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition-all disabled:opacity-50"
              title="Consultar estado de endpoints PJSIP en Asterisk 20"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${diagnosticLoading ? 'animate-spin' : ''}`} />
              <span>{diagnosticLoading ? 'Verificando...' : 'Comprobar Estado'}</span>
            </button>

            <button
              onClick={handleRepairAndReconnect}
              disabled={repairLoading}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 flex items-center gap-1.5 shadow-lg shadow-emerald-500/20 transition-all disabled:opacity-50"
              title="Limpia duplicados en pjsip.conf, reasigna endpoints limpios y recarga Asterisk"
            >
              <Wrench className={`w-3.5 h-3.5 ${repairLoading ? 'animate-spin' : ''}`} />
              <span>{repairLoading ? 'Reparando...' : 'Reparar y Reconectar PJSIP'}</span>
            </button>
          </div>
        </div>

        {/* Live status chips for 1001, 1002, 1003 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-slate-800/80">
          {['1001', '1002', '1003', '1004'].map((num) => {
            const epData = diagnosticInfo?.endpoints?.find((e: any) => e.extension === num);
            const isReg = epData?.status === 'registered';
            const stateText = epData?.state || (isReg ? 'Registrado' : 'No Conectado');
            const contactIp = epData?.contact || 'Esperando softphone...';

            return (
              <div key={num} className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-white text-sm">Ext {num}</span>
                    <span className="text-[10px] text-slate-500 font-mono">PJSIP</span>
                  </div>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${
                    isReg
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                      : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${isReg ? 'bg-emerald-400' : 'bg-amber-400'}`}></span>
                    {isReg ? 'Online' : 'Disponible'}
                  </span>
                </div>
                <div className="mt-2 text-[11px] font-mono space-y-0.5 text-slate-400">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Estado:</span>
                    <span className="text-slate-300 font-sans text-[10px]">{stateText}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Contacto:</span>
                    <span className="text-slate-400 truncate max-w-[110px] text-[10px]" title={contactIp}>{contactIp}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Feedback message banner if any */}
        {repairFeedback && (
          <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span>{repairFeedback}</span>
            </div>
            <button onClick={() => setRepairFeedback(null)} className="text-slate-400 hover:text-white font-bold ml-2">×</button>
          </div>
        )}

        {/* Guía de Solución: Registration Error 401 */}
        <div className="p-3.5 rounded-xl bg-slate-950/90 border border-amber-500/40 text-xs space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-amber-300 font-bold">
              <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span>¿Tu Softphone muestra "Registration Error 401 Unauthorized"?</span>
            </div>
            <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 text-[10px] font-mono">
              SIP / Digest Auth
            </span>
          </div>

          <p className="text-slate-300 text-[11px] leading-relaxed">
            El error <b>401</b> en SIP significa que el softphone envió una contraseña distinta a la registrada en <code className="text-emerald-300 font-mono">/etc/asterisk/pjsip.conf</code>, o que Asterisk 20 aún tiene cargada en memoria una versión anterior sin recargar.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-1 text-[11px]">
            <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
              <div className="font-bold text-emerald-400">1. Verifica Usuario y Auth ID</div>
              <p className="text-slate-400 text-[10px]">
                En Zoiper / MicroSIP coloca <b className="text-white">1001</b> tanto en <i>User / Extension</i> como en <i>Authorization Name</i> (Auth ID).
              </p>
            </div>

            <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
              <div className="font-bold text-sky-400">2. Copia la Contraseña Exacta</div>
              <p className="text-slate-400 text-[10px]">
                Ext 1001: <code className="text-emerald-300 bg-black/40 px-1 py-0.5 rounded font-mono select-all">Secr3tP@ssw0rd!1001</code><br />
                Ext 1002: <code className="text-emerald-300 bg-black/40 px-1 py-0.5 rounded font-mono select-all">S0p0rte#2026@1002</code><br />
                Ext 1003: <code className="text-emerald-300 bg-black/40 px-1 py-0.5 rounded font-mono select-all">S0p0rte#2026@1003</code>
              </p>
            </div>

            <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
              <div className="font-bold text-purple-400">3. Ejecuta en tu CLI Linux</div>
              <div className="flex items-center justify-between gap-1 bg-black/60 p-1.5 rounded font-mono text-[10px] text-slate-200">
                <span className="truncate">asterisk -rx "pjsip reload"</span>
                <button
                  onClick={() => handleCopy('asterisk -rx "pjsip reload"', 'cli-pjsip-reload')}
                  className="text-slate-400 hover:text-emerald-400"
                  title="Copiar comando"
                >
                  {copiedKey === 'cli-pjsip-reload' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
            </div>
          </div>
        </div>

        {diagnosticInfo?.hasSyntaxError && (
          <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/40 text-amber-300 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span>Aviso: Asterisk detectó secciones idénticas de transporte/endpoint. Haz clic en "Reparar y Reconectar PJSIP" para generar la sintaxis limpia de Asterisk 20.</span>
            </div>
            <button
              onClick={handleRepairAndReconnect}
              disabled={repairLoading}
              className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-black font-bold text-[10px] transition-all"
            >
              Reparar Ahora
            </button>
          </div>
        )}
      </div>

      {/* Extensions Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {extensions.map((ext) => (
          <div
            key={ext.id}
            className="p-4 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition-all relative flex flex-col justify-between"
          >
            <div>
              {/* Card top */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center font-mono font-bold text-emerald-400 text-lg border border-slate-700">
                    {ext.extension}
                  </div>
                  <div>
                    <h3 className="font-semibold text-white text-sm leading-tight">
                      {ext.name}
                    </h3>
                    <p className="text-xs text-slate-400 font-mono">{ext.callerId}</p>
                  </div>
                </div>
                {getStatusBadge(ext.status)}
              </div>

              {/* Attributes list */}
              <div className="space-y-1.5 py-2 border-t border-b border-slate-800/80 text-xs text-slate-400">
                <div className="flex justify-between">
                  <span>Contexto:</span>
                  <span className="text-slate-200 font-mono">{ext.context}</span>
                </div>
                <div className="flex justify-between">
                  <span>Transporte:</span>
                  <span className="text-slate-200 font-mono">{ext.transport}</span>
                </div>
                <div className="flex justify-between">
                  <span>Códecs SIP:</span>
                  <div className="flex gap-1">
                    {ext.codecs.map((c) => (
                      <span
                        key={c}
                        className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 font-mono text-[10px]"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <span>IP Contacto:</span>
                  <span className="text-slate-300 font-mono truncate max-w-[140px]">
                    {ext.ipAddress || 'Sin registrar'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span>Último Estado:</span>
                  <span className="text-xs text-emerald-400/90 truncate max-w-[170px]">
                    {ext.lastSeen || 'Listo'}
                  </span>
                </div>
              </div>

              {/* Credenciales Softphone PJSIP (X-Lite / Zoiper / MicroSIP) */}
              <div className="mt-2.5 p-3 rounded-xl bg-slate-950/80 border border-emerald-500/30 text-xs space-y-2">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-400">
                    <Key className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Credenciales Softphone SIP</span>
                  </span>
                  <button
                    onClick={() => setSoftphoneModalExt(ext)}
                    className="px-2 py-0.5 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-semibold flex items-center gap-1 transition-all"
                    title="Ver guía paso a paso para Zoiper / MicroSIP / X-Lite"
                  >
                    <HelpCircle className="w-3 h-3" />
                    <span>Guía Softphone</span>
                  </button>
                </div>

                <div className="space-y-1.5 font-mono text-[11px]">
                  <div className="flex items-center justify-between bg-slate-900/90 px-2 py-1 rounded border border-slate-800">
                    <span className="text-slate-400 font-sans text-[10px]">Usuario / Ext:</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-white font-bold">{ext.extension}</span>
                      <button
                        onClick={() => handleCopy(ext.extension, `user-${ext.id}`)}
                        className="text-slate-400 hover:text-emerald-400 transition-colors p-0.5"
                        title="Copiar Usuario"
                      >
                        {copiedKey === `user-${ext.id}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between bg-slate-900/90 px-2 py-1 rounded border border-slate-800">
                    <span className="text-slate-400 font-sans text-[10px]">Contraseña SIP:</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-emerald-300 font-bold">
                        {visibleSecrets[ext.id] ? ext.secret : '••••••••••••'}
                      </span>
                      <button
                        onClick={() => toggleSecret(ext.id)}
                        className="text-slate-400 hover:text-slate-200 p-0.5"
                        title={visibleSecrets[ext.id] ? "Ocultar" : "Mostrar"}
                      >
                        {visibleSecrets[ext.id] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      </button>
                      <button
                        onClick={() => handleCopy(ext.secret, `pass-${ext.id}`)}
                        className="text-slate-400 hover:text-emerald-400 transition-colors p-0.5"
                        title="Copiar Contraseña"
                      >
                        {copiedKey === `pass-${ext.id}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between bg-slate-900/90 px-2 py-1 rounded border border-slate-800">
                    <span className="text-slate-400 font-sans text-[10px]">Puerto / Red:</span>
                    <span className="text-slate-300 text-[10px] font-mono flex items-center gap-1">
                      <span className="text-sky-400 font-bold">{ext.port || 5060}</span>
                      <span>({ext.transport === 'transport-tcp' ? 'TCP' : ext.transport === 'transport-tls' ? 'TLS' : ext.transport === 'transport-wss' ? 'WSS' : 'UDP'} - PJSIP)</span>
                    </span>
                  </div>
                </div>
              </div>

              {/* CallerID Saliente configurado para esta extensión (Directo y Visible para el Agente) */}
              <div className="mt-2.5 p-3 rounded-xl bg-gradient-to-br from-sky-950/40 via-slate-950 to-slate-900 border-2 border-sky-500/50 shadow-md shadow-sky-500/10 text-xs space-y-2">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-black text-sky-300 uppercase tracking-wide">
                    <Phone className="w-3.5 h-3.5 text-sky-400 animate-pulse" />
                    <span>CallerID Saliente Asterisk</span>
                  </span>
                  <button
                    onClick={() => handleOpenQuickCid(ext)}
                    className="px-2.5 py-1 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-[11px] flex items-center gap-1 transition-all shadow-sm hover:shadow-sky-500/30"
                    title="Editar CallerID num y name de inmediato sin recargar toda la extensión"
                  >
                    <Zap className="w-3 h-3 fill-current" />
                    <span>Cambiar Ya</span>
                  </button>
                </div>
                <div className="p-2 rounded-lg bg-slate-950/90 border border-slate-800 space-y-1 font-mono text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 font-sans text-[11px]">Número (num):</span>
                    <span className="text-white font-bold tracking-wider">{ext.callerIdNum || '+18005550199'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 font-sans text-[11px]">Nombre (name):</span>
                    <span className="text-emerald-400 font-bold truncate max-w-[150px]">{ext.callerIdName || ext.name || 'Seguridad Bancaria'}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Card Actions */}
            <div className="flex items-center justify-between mt-4 pt-2">
              <button
                onClick={() => onSimulateQualify(ext.extension)}
                className="inline-flex items-center space-x-1 text-xs text-slate-400 hover:text-emerald-400 transition-colors"
                title="PJSIP Qualify check vía AMI"
              >
                <Wifi className="w-3.5 h-3.5" />
                <span>SIP Ping</span>
              </button>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleOpenQuickCid(ext)}
                  className="px-2.5 py-1 rounded bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/50 text-[11px] font-bold flex items-center gap-1.5 transition-all"
                  title="Cambiar CALLERID(num) y CALLERID(name) de esta extensión en tiempo real"
                >
                  <Phone className="w-3.5 h-3.5 text-sky-400" />
                  <span>CallerID</span>
                </button>
                <button
                  onClick={() => setPreviewExt(ext)}
                  className="p-1.5 rounded text-slate-400 hover:text-emerald-400 hover:bg-slate-800 transition-colors"
                  title="Ver configuración PJSIP generada"
                >
                  <Eye className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleOpenEditModal(ext)}
                  className="p-1.5 rounded text-slate-400 hover:text-blue-400 hover:bg-slate-800 transition-colors"
                  title="Editar extensión"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => onDeleteExtension(ext.id)}
                  className="p-1.5 rounded text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors"
                  title="Eliminar extensión"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Modal: Crear / Editar Extensión */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Phone className="w-5 h-5 text-emerald-400" />
                <span>{editingExt ? 'Editar Extensión PJSIP' : 'Nueva Extensión PJSIP'}</span>
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-white text-lg font-mono"
              >
                &times;
              </button>
            </div>

            {validationError && (
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                <span>{validationError}</span>
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Número de Extensión * <span className="text-emerald-400 font-mono">(≥ 1001)</span>
                  </label>
                  <input
                    type="number"
                    min="1001"
                    required
                    value={extNumber}
                    onChange={(e) => setExtNumber(e.target.value)}
                    placeholder="1005"
                    className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-white font-mono focus:border-emerald-500 focus:outline-none"
                  />
                  <span className="text-[10px] text-slate-400 mt-0.5 block">
                    Admitido: 1001 en adelante
                  </span>
                </div>
                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Nombre Mostrado (Etiqueta Agente)
                  </label>
                  <input
                    type="text"
                    value={extName}
                    onChange={(e) => setExtName(e.target.value)}
                    placeholder="Juan Perez"
                    className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* SECCIÓN DESTACADA: IDENTIFICADOR DE LLAMADA SALIENTE (CALLERID) */}
              <div className="p-4 rounded-xl bg-slate-900 border-2 border-sky-500/50 shadow-lg shadow-sky-950/40 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4 text-sky-400" />
                    <span className="text-xs font-bold text-white uppercase tracking-wider">Identidad de Llamada Saliente (CallerID)</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30">CALLERID(num) & (name)</span>
                </div>
                <p className="text-[11px] text-slate-300">
                  Configura qué número y qué nombre verá la persona o cliente en la pantalla de su móvil cuando este agente realice llamadas.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-sky-300 mb-1">
                      CALLERID(num) - Número Saliente *
                    </label>
                    <input
                      type="text"
                      required
                      value={extCallerIdNum}
                      onChange={(e) => setExtCallerIdNum(e.target.value)}
                      placeholder="+18005550199"
                      className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-700 text-white font-mono text-sm focus:border-sky-500 focus:outline-none"
                    />
                    <span className="text-[10px] text-slate-400">Reemplaza el "+18005550199" en Asterisk</span>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-sky-300 mb-1">
                      CALLERID(name) - Nombre Saliente *
                    </label>
                    <input
                      type="text"
                      required
                      value={extCallerIdName}
                      onChange={(e) => setExtCallerIdName(e.target.value)}
                      placeholder="Seguridad Bancaria"
                      className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-700 text-white font-mono text-sm focus:border-sky-500 focus:outline-none"
                    />
                    <span className="text-[10px] text-slate-400">Nombre público que se transmitirá al cliente en pantalla</span>
                  </div>
                </div>
                {/* Plantillas rápidas */}
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-[10px] text-slate-400 font-semibold">Presets rápidos:</span>
                  <button
                    type="button"
                    onClick={() => { setExtCallerIdName('Banco Central Antifraude'); setExtCallerIdNum('+18005550199'); }}
                    className="text-[10px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 transition-colors"
                  >
                    Banco Antifraude
                  </button>
                  <button
                    type="button"
                    onClick={() => { setExtCallerIdName('Verificación Seguridad'); setExtCallerIdNum('+18884561234'); }}
                    className="text-[10px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 transition-colors"
                  >
                    Seguridad OTP
                  </button>
                  <button
                    type="button"
                    onClick={() => { setExtCallerIdName('Servicio al Cliente'); setExtCallerIdNum('+18005550199'); }}
                    className="text-[10px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
                  >
                    Servicio Cliente
                  </button>
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="block text-slate-300 font-medium">Contraseña SIP (Secret) *</label>
                  <button
                    type="button"
                    onClick={handleGeneratePassword}
                    className="text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1 text-[11px]"
                  >
                    <Key className="w-3 h-3" />
                    <span>Generar Segura</span>
                  </button>
                </div>
                <input
                  type="text"
                  required
                  value={extSecret}
                  onChange={(e) => setExtSecret(e.target.value)}
                  className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-white font-mono focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Contexto Dialplan</label>
                  <input
                    type="text"
                    value={extContext}
                    onChange={(e) => setExtContext(e.target.value)}
                    className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-white font-mono focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Transporte PJSIP</label>
                  <select
                    value={extTransport}
                    onChange={(e) => setExtTransport(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-white focus:border-emerald-500 focus:outline-none"
                  >
                    <option value="transport-udp">UDP (VoIP Estándar)</option>
                    <option value="transport-tcp">TCP</option>
                    <option value="transport-tls">TLS Seguro</option>
                    <option value="transport-wss">WSS WebRTC (8089)</option>
                  </select>
                </div>
              </div>

              {/* Puerto de Transporte SIP / PJSIP Personalizable a Voluntad */}
              <div className="p-3 rounded-xl bg-slate-950 border border-sky-500/40 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-sky-300 font-bold text-xs flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-sky-400" />
                    <span>Puerto de Transporte PJSIP / SIP *</span>
                  </label>
                  <span className="text-[10px] font-mono text-slate-400">Rango: 1 - 65535</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    required
                    value={extPort}
                    onChange={(e) => setExtPort(parseInt(e.target.value, 10) || 5060)}
                    placeholder="47923"
                    className="w-full px-3 py-2 rounded-md bg-slate-900 border border-slate-700 text-white font-mono font-bold text-sm focus:border-sky-500 focus:outline-none"
                  />
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setExtPort(47923)}
                      className={`px-2.5 py-1.5 rounded text-[11px] font-mono font-bold transition-all ${
                        extPort === 47923
                          ? 'bg-sky-500 text-slate-950 border border-sky-400 shadow-sm'
                          : 'bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30'
                      }`}
                      title="Asignar puerto seguro 47923"
                    >
                      47923 (Seguro)
                    </button>
                    <button
                      type="button"
                      onClick={() => setExtPort(5060)}
                      className={`px-2.5 py-1.5 rounded text-[11px] font-mono transition-all ${
                        extPort === 5060
                          ? 'bg-slate-700 text-white border border-slate-600 font-bold'
                          : 'bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-800'
                      }`}
                      title="Puerto SIP estándar 5060"
                    >
                      5060
                    </button>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Asterisk vinculará el transporte de esta extensión a este puerto (<code className="text-sky-300 font-mono">0.0.0.0:{extPort}</code>). Usar un puerto alternativo como <b className="text-sky-300 font-mono">47923</b> previene ataques de escaneo automatizado contra el puerto estándar 5060.
                </p>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1.5">Códecs Permitidos</label>
                <div className="flex flex-wrap gap-2">
                  {availableCodecs.map((codec) => {
                    const isSelected = selectedCodecs.includes(codec);
                    return (
                      <button
                        type="button"
                        key={codec}
                        onClick={() => toggleCodec(codec)}
                        className={`px-2.5 py-1 rounded text-xs font-mono font-medium transition-all ${
                          isSelected
                            ? 'bg-emerald-500 text-black font-bold'
                            : 'bg-slate-950 text-slate-400 border border-slate-800'
                        }`}
                      >
                        {codec}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Máximo de Dispositivos Simultáneos (max_contacts)
                </label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={extMaxContacts}
                  onChange={(e) => setExtMaxContacts(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-white font-mono focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-md text-slate-300 hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-md bg-emerald-500 hover:bg-emerald-400 text-black font-bold shadow-md shadow-emerald-500/20"
                >
                  {editingExt ? 'Guardar y Sincronizar' : 'Crear y Sincronizar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: PJSIP Conf Preview */}
      {previewExt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white font-mono flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>PJSIP Object Block: {previewExt.extension}</span>
              </h3>
              <button
                onClick={() => setPreviewExt(null)}
                className="text-slate-400 hover:text-white font-mono"
              >
                &times;
              </button>
            </div>

            <pre className="p-4 rounded-lg bg-slate-950 border border-slate-800 font-mono text-xs text-emerald-300/90 overflow-x-auto">
{`[transport-udp${(previewExt.port || 5060) === 5060 ? '' : `-${previewExt.port}`}]
type=transport
protocol=udp
bind=0.0.0.0:${previewExt.port || 5060}

[${previewExt.extension}]
type=endpoint
context=${previewExt.context}
disallow=all
allow=${previewExt.codecs.join(',')}
auth=${previewExt.extension}-auth
aors=${previewExt.extension}
callerid=${previewExt.callerId}
transport=${previewExt.transport === 'transport-wss' ? 'transport-wss' : (previewExt.transport === 'transport-tcp' ? `transport-tcp${(previewExt.port || 5060) === 5060 ? '' : `-${previewExt.port}`}` : `transport-udp${(previewExt.port || 5060) === 5060 ? '' : `-${previewExt.port}`}`)}
direct_media=no

[${previewExt.extension}-auth]
type=auth
auth_type=userpass
username=${previewExt.extension}
password=${previewExt.secret}

[${previewExt.extension}]
type=aor
max_contacts=${previewExt.maxContacts}
remove_existing=yes
qualify_frequency=60`}
            </pre>

            <div className="flex justify-end">
              <button
                onClick={() => setPreviewExt(null)}
                className="px-4 py-2 rounded-md bg-slate-800 text-white text-xs font-semibold hover:bg-slate-700"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Cambio Rápido y Visible de CallerID para la Extensión del Agente */}
      {quickCidExt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border-2 border-sky-500/60 p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-sky-500/20 border border-sky-500/40 flex items-center justify-center">
                  <Phone className="w-4 h-4 text-sky-400" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <span>Cambiar CallerID de Extensión</span>
                    <span className="font-mono text-xs px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30">
                      {quickCidExt.extension}
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Se inyecta al instante en Asterisk AstDB y cabeceras P-Asserted-Identity
                  </p>
                </div>
              </div>
              <button
                onClick={() => setQuickCidExt(null)}
                className="text-slate-400 hover:text-white text-xl font-mono leading-none"
              >
                &times;
              </button>
            </div>

            {quickCidFeedback && (
              <div className={`p-3 rounded-xl text-xs font-semibold flex items-center gap-2 ${
                quickCidFeedback.includes('¡')
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
              }`}>
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{quickCidFeedback}</span>
              </div>
            )}

            <div className="space-y-3.5">
              {/* CallerID Num */}
              <div>
                <label className="block text-xs font-bold text-sky-300 uppercase tracking-wide mb-1">
                  CALLERID(num) - Número que verá el receptor *
                </label>
                <input
                  type="text"
                  value={quickCidNum}
                  onChange={(e) => setQuickCidNum(e.target.value)}
                  placeholder="+18005550199"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono text-base font-bold focus:border-sky-500 focus:ring-1 focus:ring-sky-500 focus:outline-none"
                />
                <span className="text-[10px] text-slate-400">
                  Formato E.164 (ej. +18005550199, 16104803845)
                </span>
              </div>

              {/* CallerID Name */}
              <div>
                <label className="block text-xs font-bold text-sky-300 uppercase tracking-wide mb-1">
                  CALLERID(name) - Nombre de pantalla *
                </label>
                <input
                  type="text"
                  value={quickCidName}
                  onChange={(e) => setQuickCidName(e.target.value)}
                  placeholder="Seguridad Bancaria"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono text-sm font-bold focus:border-sky-500 focus:ring-1 focus:ring-sky-500 focus:outline-none"
                />
                <span className="text-[10px] text-slate-400">
                  Nombre que emite la PBX (ej. Banco Antifraude, Soporte Técnico)
                </span>
              </div>

              {/* Presets Rápidos */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                  Presets Rápidos de Identidad
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setQuickCidName('Banco Central Antifraude');
                      setQuickCidNum('+18005550199');
                    }}
                    className="p-2 rounded-lg bg-slate-950 hover:bg-slate-800 text-left border border-slate-800 hover:border-sky-500/50 transition-all text-[11px]"
                  >
                    <div className="font-bold text-sky-300 truncate">Banco Antifraude</div>
                    <div className="font-mono text-slate-500 text-[10px]">+18005550199</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setQuickCidName('Verificación Seguridad');
                      setQuickCidNum('+18884561234');
                    }}
                    className="p-2 rounded-lg bg-slate-950 hover:bg-slate-800 text-left border border-slate-800 hover:border-sky-500/50 transition-all text-[11px]"
                  >
                    <div className="font-bold text-sky-300 truncate">Seguridad OTP</div>
                    <div className="font-mono text-slate-500 text-[10px]">+18884561234</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setQuickCidName('Soporte WhatsApp');
                      setQuickCidNum('+18002345678');
                    }}
                    className="p-2 rounded-lg bg-slate-950 hover:bg-slate-800 text-left border border-slate-800 hover:border-sky-500/50 transition-all text-[11px]"
                  >
                    <div className="font-bold text-emerald-300 truncate">WhatsApp Alerta</div>
                    <div className="font-mono text-slate-500 text-[10px]">+18002345678</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setQuickCidName('Servicio al Cliente');
                      setQuickCidNum('+18005550199');
                    }}
                    className="p-2 rounded-lg bg-slate-950 hover:bg-slate-800 text-left border border-slate-800 hover:border-slate-700 transition-all text-[11px]"
                  >
                    <div className="font-bold text-slate-300 truncate">Servicio Cliente</div>
                    <div className="font-mono text-slate-500 text-[10px]">+18005550199</div>
                  </button>
                </div>
              </div>

              {/* Vista previa en pantalla */}
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs">
                <span className="text-slate-400">Vista previa pantalla cliente:</span>
                <span className="font-mono font-bold text-emerald-400 truncate max-w-[200px]">
                  "{quickCidName}" &lt;{quickCidNum}&gt;
                </span>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setQuickCidExt(null)}
                className="px-4 py-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 text-xs font-semibold transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveQuickCid}
                disabled={quickCidSaving}
                className="px-5 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-sky-500/25 transition-all disabled:opacity-50"
              >
                {quickCidSaving ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Guardando en Asterisk...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Aplicar CallerID Ahora</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Guía y Credenciales Softphone (Zoiper / MicroSIP / X-Lite) */}
      {softphoneModalExt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-xl p-6 rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                  <Phone className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">
                    Configuración Softphone Extensión {softphoneModalExt.extension}
                  </h3>
                  <p className="text-xs text-slate-400">
                    Copia estos parámetros exactos en tu aplicación de telefonía SIP (Zoiper, MicroSIP, X-Lite, Grandstream Wave).
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSoftphoneModalExt(null)}
                className="text-slate-400 hover:text-white font-bold text-lg p-1"
              >
                ✕
              </button>
            </div>

            {/* Quick copy fields */}
            <div className="space-y-2.5 bg-slate-950 p-4 rounded-xl border border-slate-800 text-xs font-mono">
              <div className="flex items-center justify-between py-1 border-b border-slate-800/80">
                <span className="text-slate-400 font-sans">Nombre de Cuenta / Display:</span>
                <div className="flex items-center gap-2">
                  <span className="text-white font-bold">{softphoneModalExt.name || `Agente ${softphoneModalExt.extension}`}</span>
                  <button
                    onClick={() => handleCopy(softphoneModalExt.name || softphoneModalExt.extension, 'm-name')}
                    className="text-slate-400 hover:text-emerald-400"
                    title="Copiar"
                  >
                    {copiedKey === 'm-name' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-slate-800/80">
                <span className="text-slate-400 font-sans">Extensión / Usuario SIP:</span>
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400 font-bold text-sm">{softphoneModalExt.extension}</span>
                  <button
                    onClick={() => handleCopy(softphoneModalExt.extension, 'm-user')}
                    className="text-slate-400 hover:text-emerald-400"
                    title="Copiar"
                  >
                    {copiedKey === 'm-user' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-slate-800/80">
                <span className="text-slate-400 font-sans">ID de Autorización / Auth User:</span>
                <div className="flex items-center gap-2">
                  <span className="text-white font-bold">{softphoneModalExt.extension}</span>
                  <button
                    onClick={() => handleCopy(softphoneModalExt.extension, 'm-auth')}
                    className="text-slate-400 hover:text-emerald-400"
                    title="Copiar"
                  >
                    {copiedKey === 'm-auth' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-slate-800/80">
                <span className="text-slate-400 font-sans">Contraseña / Password:</span>
                <div className="flex items-center gap-2">
                  <span className="text-emerald-300 font-bold">{softphoneModalExt.secret}</span>
                  <button
                    onClick={() => handleCopy(softphoneModalExt.secret, 'm-pass')}
                    className="text-slate-400 hover:text-emerald-400"
                    title="Copiar"
                  >
                    {copiedKey === 'm-pass' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-slate-800/80">
                <span className="text-slate-400 font-sans">Dominio / Servidor SIP:</span>
                <div className="flex items-center gap-2">
                  <span className="text-sky-300 font-bold font-mono">IP_DE_TU_VPS:{softphoneModalExt.port || 5060}</span>
                  <span className="text-[10px] text-slate-500 font-sans">(Tu servidor Asterisk)</span>
                </div>
              </div>

              <div className="flex items-center justify-between py-1">
                <span className="text-slate-400 font-sans">Puerto y Protocolo:</span>
                <span className="text-sky-300 font-mono font-bold">
                  {softphoneModalExt.port || 5060} ({softphoneModalExt.transport.replace('transport-', '').toUpperCase()})
                </span>
              </div>
            </div>

            {/* Banner de Puerto Personalizado */}
            <div className="p-3 rounded-xl bg-sky-950/40 border border-sky-500/30 text-xs text-sky-200 flex items-start gap-2.5">
              <Shield className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-bold text-white flex items-center gap-2">
                  <span>Puerto PJSIP de esta extensión:</span>
                  <span className="px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 font-mono font-bold border border-sky-500/40">
                    {softphoneModalExt.port || 5060}
                  </span>
                </div>
                <p className="text-[11px] text-slate-300 leading-normal">
                  Al registrar tu Softphone (MicroSIP / Zoiper / GS Wave), debes especificar el puerto <b className="text-sky-300 font-mono">:{softphoneModalExt.port || 5060}</b> en el campo de Dominio o Proxy saliente para conectar con éxito y evadir escaneos en el puerto 5060.
                </p>
              </div>
            </div>

            {/* Quick Softphone setup tips */}
            <div className="space-y-2 text-xs text-slate-300">
              <h4 className="font-bold text-white uppercase tracking-wider text-[11px]">Pasos para registrar en tu Softphone:</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
                <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800 space-y-1">
                  <div className="font-bold text-emerald-400 flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    <span>Zoiper / MicroSIP</span>
                  </div>
                  <ul className="text-slate-400 list-disc list-inside space-y-0.5 font-mono">
                    <li>Username: <b className="text-white">{softphoneModalExt.extension}</b></li>
                    <li>Password: <b className="text-white">{softphoneModalExt.secret}</b></li>
                    <li>Domain/Host: <b className="text-sky-300">IP_VPS:{softphoneModalExt.port || 5060}</b></li>
                    <li>Transport: <b className="text-white">{softphoneModalExt.transport.replace('transport-', '').toUpperCase()}</b></li>
                  </ul>
                </div>

                <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800 space-y-1">
                  <div className="font-bold text-sky-400 flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    <span>X-Lite / Bria / GS Wave</span>
                  </div>
                  <ul className="text-slate-400 list-disc list-inside space-y-0.5 font-mono">
                    <li>User ID: <b className="text-white">{softphoneModalExt.extension}</b></li>
                    <li>Auth Name: <b className="text-white">{softphoneModalExt.extension}</b></li>
                    <li>Proxy: <b className="text-sky-300">IP_VPS:{softphoneModalExt.port || 5060}</b></li>
                    <li>STUN: <b className="text-white">Desactivado</b></li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
              <button
                onClick={() => {
                  onSimulateQualify(softphoneModalExt.extension);
                  handleRunDiagnostic();
                }}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5 transition-all"
              >
                <Wifi className="w-3.5 h-3.5" />
                <span>Comprobar Ping SIP (AMI)</span>
              </button>

              <button
                onClick={() => setSoftphoneModalExt(null)}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-all"
              >
                Entendido, Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
