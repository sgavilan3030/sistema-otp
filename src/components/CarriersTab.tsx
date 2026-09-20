import React, { useState } from 'react';
import { CarrierTrunk } from '../types';
import { Plus, Trash2, Edit2, Globe, Eye, Activity, Copy, Check, FileCode, CheckCircle2, Sliders, RefreshCw, Power, PowerOff } from 'lucide-react';

interface CarriersTabProps {
  carriers: CarrierTrunk[];
  onAddCarrier: (carrier: CarrierTrunk) => void;
  onUpdateCarrier: (carrier: CarrierTrunk) => void;
  onDeleteCarrier: (id: string) => void;
  onPingCarrier: (id: string) => void;
  onToggleCarrier?: (id: string) => void;
  onSyncAsterisk?: () => void;
  isSyncing?: boolean;
}

export const CarriersTab: React.FC<CarriersTabProps> = ({
  carriers,
  onAddCarrier,
  onUpdateCarrier,
  onDeleteCarrier,
  onPingCarrier,
  onToggleCarrier,
  onSyncAsterisk,
  isSyncing,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCarrier, setEditingCarrier] = useState<CarrierTrunk | null>(null);
  const [previewCarrier, setPreviewCarrier] = useState<CarrierTrunk | null>(null);

  // Selected carrier for quick config view
  const [selectedCarrierId, setSelectedCarrierId] = useState<string>(
    carriers[0]?.id || 'trunk-televox'
  );
  const [copiedSip, setCopiedSip] = useState(false);
  const [copiedDialplan, setCopiedDialplan] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [authType, setAuthType] = useState<CarrierTrunk['authType']>('registration');
  const [isEnabled, setIsEnabled] = useState(true);
  const [host, setHost] = useState('');
  const [port, setPort] = useState(5060);
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [inboundContext, setInboundContext] = useState('trunkinbound');
  const [outboundCallerId, setOutboundCallerId] = useState('');
  const [selectedCodecs, setSelectedCodecs] = useState<string[]>(['ulaw', 'alaw']);
  const [qualifyFreq, setQualifyFreq] = useState(60);
  const [fromuser, setFromuser] = useState('');
  const [sendrpid, setSendrpid] = useState<'yes' | 'no'>('yes');
  const [trustrpid, setTrustrpid] = useState<'yes' | 'no'>('yes');
  const [insecure, setInsecure] = useState('port,invite');
  const [dialplanPattern, setDialplanPattern] = useState('_1XXXXXXXXXX');
  const [dialFlags, setDialFlags] = useState('Tor');

  const availableCodecs = ['ulaw', 'alaw', 'g729', 'g722', 'opus'];

  const activeCarrier =
    carriers.find((c) => c.id === selectedCarrierId) || carriers[0];

  const handleToggle = (id: string) => {
    if (onToggleCarrier) {
      onToggleCarrier(id);
    } else {
      const c = carriers.find((item) => item.id === id);
      if (!c) return;
      const currentActive = c.enabled !== false && c.status !== 'disabled';
      onUpdateCarrier({
        ...c,
        enabled: !currentActive,
        status: currentActive ? 'disabled' : 'reachable',
      });
    }
  };

  const handleOpenCreateModal = () => {
    setEditingCarrier(null);
    setName('nuevo_carrier');
    setAuthType('registration');
    setIsEnabled(true);
    setHost('52.144.46.192');
    setPort(5060);
    setUsername('sgavilan30');
    setSecret('Robert2026');
    setInboundContext('trunkinbound');
    setOutboundCallerId('+18005550199');
    setSelectedCodecs(['ulaw', 'alaw']);
    setQualifyFreq(60);
    setFromuser('sgavilan30');
    setSendrpid('yes');
    setTrustrpid('yes');
    setInsecure('port,invite');
    setDialplanPattern('_1XXXXXXXXXX');
    setDialFlags('Tor');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (c: CarrierTrunk) => {
    setEditingCarrier(c);
    setName(c.name);
    setAuthType(c.authType);
    setIsEnabled(c.enabled !== false && c.status !== 'disabled');
    setHost(c.host);
    setPort(c.port);
    setUsername(c.username || '');
    setSecret(c.secret || '');
    setInboundContext(c.inboundContext || 'trunkinbound');
    setOutboundCallerId(c.outboundCallerId || '');
    setSelectedCodecs(c.codecs);
    setQualifyFreq(c.qualifyFreq);
    setFromuser(c.fromuser || c.username || '');
    setSendrpid(c.sendrpid || 'yes');
    setTrustrpid(c.trustrpid || 'yes');
    setInsecure(c.insecure || 'port,invite');
    setDialplanPattern(c.dialplanPattern || '_1XXXXXXXXXX');
    setDialFlags(c.dialFlags || 'Tor');
    setIsModalOpen(true);
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
    if (!name || !host) return;

    if (editingCarrier) {
      onUpdateCarrier({
        ...editingCarrier,
        name,
        authType,
        enabled: isEnabled,
        status: isEnabled ? (editingCarrier.status === 'disabled' ? 'reachable' : editingCarrier.status) : 'disabled',
        host,
        port,
        username,
        secret,
        inboundContext,
        outboundCallerId,
        codecs: selectedCodecs,
        qualifyFreq,
        fromuser,
        sendrpid,
        trustrpid,
        insecure,
        dialplanPattern,
        dialFlags,
      });
    } else {
      const newCarrier: CarrierTrunk = {
        id: `trunk-${Date.now()}`,
        name,
        authType,
        enabled: isEnabled,
        host,
        port,
        username,
        secret,
        inboundContext,
        outboundCallerId,
        codecs: selectedCodecs,
        qualifyFreq,
        status: isEnabled ? 'reachable' : 'disabled',
        latencyMs: Math.floor(Math.random() * 25) + 10,
        fromuser,
        sendrpid,
        trustrpid,
        insecure,
        dialplanPattern,
        dialFlags,
      };
      onAddCarrier(newCarrier);
      setSelectedCarrierId(newCarrier.id);
    }
    setIsModalOpen(false);
  };

  // Helper generators for current active carrier
  const getSipConfSnippet = (c?: CarrierTrunk) => {
    if (!c) return '';
    const carrierName = c.name;
    const carrierHost = c.host;
    const carrierUser = c.username || c.name;
    const carrierSecret = c.secret || '';
    const carrierContext = c.inboundContext || 'trunkinbound';
    const carrierFromUser = c.fromuser || c.username || c.name;
    const carrierSendRpid = c.sendrpid || 'yes';
    const carrierTrustRpid = c.trustrpid || 'yes';
    const carrierInsecure = c.insecure || 'port,invite';

    return `[${carrierName}]
host=${carrierHost}
username=${carrierUser}
secret=${carrierSecret}
type=peer
context=${carrierContext}
fromuser=${carrierFromUser}
sendrpid=${carrierSendRpid}
trustrpid=${carrierTrustRpid}
insecure=${carrierInsecure}`;
  };

  const getDialplanSnippet = (c?: CarrierTrunk) => {
    if (!c) return '';
    const pattern = c.dialplanPattern || '_1XXXXXXXXXX';
    const carrierName = c.name;
    const flags = c.dialFlags || 'Tor';

    return `exten => ${pattern},1,NoOp(--- Llamada Saliente PJSIP ---)
 same => n,Dial(PJSIP/\${EXTEN}@${carrierName},,${flags})
 same => n,Hangup()`;
  };

  const handleCopySip = () => {
    if (!activeCarrier) return;
    navigator.clipboard.writeText(getSipConfSnippet(activeCarrier));
    setCopiedSip(true);
    setTimeout(() => setCopiedSip(false), 2000);
  };

  const handleCopyDialplan = () => {
    if (!activeCarrier) return;
    navigator.clipboard.writeText(getDialplanSnippet(activeCarrier));
    setCopiedDialplan(true);
    setTimeout(() => setCopiedDialplan(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Globe className="w-5 h-5 text-emerald-400" />
            <span>Gestión de Carriers SIP &amp; Dialplan</span>
            <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
              {carriers.length} troncales
            </span>
          </h2>
          <p className="text-sm text-slate-400">
            Configuración simplificada para troncales de salida y entrada con formato estándar Asterisk / Vicidial.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          {onSyncAsterisk && (
            <button
              id="btn-sync-carriers-now"
              onClick={onSyncAsterisk}
              disabled={isSyncing}
              className="inline-flex items-center space-x-2 px-3.5 py-2.5 rounded-lg text-sm font-semibold bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-emerald-500/30 shadow-md transition-all disabled:opacity-50 cursor-pointer"
              title="Aplica inmediatamente los Carriers y Registrations a Asterisk y recarga PJSIP"
            >
              <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Sincronizando...' : 'Aplicar a Asterisk'}</span>
            </button>
          )}

          <button
            id="btn-add-carrier-trunk"
            onClick={handleOpenCreateModal}
            className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-lg text-sm font-semibold bg-emerald-500 hover:bg-emerald-400 text-black shadow-md shadow-emerald-500/20 transition-all cursor-pointer font-bold"
          >
            <Plus className="w-4 h-4" />
            <span>Agregar Carrier</span>
          </button>
        </div>
      </div>

      {/* Featured Box: Carrier Account Entry & Dialplan Entry exactly as requested */}
      {activeCarrier && (
        <div className="rounded-xl bg-slate-900 border border-emerald-500/30 overflow-hidden shadow-xl">
          {/* Header with carrier tabs */}
          <div className="p-4 bg-slate-950/80 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center space-x-2">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Carrier Seleccionado:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {carriers.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedCarrierId(c.id)}
                    className={`px-3 py-1 rounded text-xs font-mono font-medium transition-all ${
                      selectedCarrierId === c.id
                        ? 'bg-emerald-500 text-black font-bold shadow'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    [{c.name}]
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <button
                id={`btn-toggle-carrier-featured-${activeCarrier.id}`}
                type="button"
                onClick={() => handleToggle(activeCarrier.id)}
                className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm cursor-pointer ${
                  activeCarrier.enabled !== false && activeCarrier.status !== 'disabled'
                    ? 'bg-rose-500/20 hover:bg-rose-500 text-rose-300 hover:text-white border border-rose-500/40'
                    : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold shadow-emerald-500/20'
                }`}
                title={
                  activeCarrier.enabled !== false && activeCarrier.status !== 'disabled'
                    ? 'Deshabilitar Troncal: Asterisk dejará de intentar registrarse y no enviará llamadas por aquí'
                    : 'Habilitar Troncal: Activa el registro saliente y llamadas en Asterisk'
                }
              >
                {activeCarrier.enabled !== false && activeCarrier.status !== 'disabled' ? (
                  <>
                    <PowerOff className="w-3.5 h-3.5 text-rose-400" />
                    <span>Deshabilitar Troncal</span>
                  </>
                ) : (
                  <>
                    <Power className="w-3.5 h-3.5" />
                    <span>Habilitar Troncal</span>
                  </>
                )}
              </button>

              <button
                onClick={() => handleOpenEditModal(activeCarrier)}
                className="inline-flex items-center space-x-1.5 px-2.5 py-1.5 rounded text-xs font-medium bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 transition-colors cursor-pointer"
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Editar Parámetros</span>
              </button>
            </div>
          </div>

          {/* Banner de Troncal Deshabilitada */}
          {(activeCarrier.enabled === false || activeCarrier.status === 'disabled') && (
            <div className="mx-5 mt-4 p-3 rounded-lg bg-rose-950/40 border border-rose-500/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-rose-200">
              <div className="flex items-center gap-2">
                <PowerOff className="w-4 h-4 text-rose-400 shrink-0" />
                <span>
                  <b>Troncal Deshabilitada:</b> Asterisk no enviará paquetes <code>REGISTER</code> ni intentará conectarse a <code className="font-mono text-white bg-slate-950 px-1.5 py-0.5 rounded">{activeCarrier.host}:{activeCarrier.port}</code>. Los reintentos de conexión están pausados.
                </span>
              </div>
              <button
                onClick={() => handleToggle(activeCarrier.id)}
                className="px-3 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-[11px] shrink-0 transition-colors cursor-pointer"
              >
                Habilitar con 1 Clic
              </button>
            </div>
          )}

          <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Box 1: Carrier Account Entry (sip.conf) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-white font-mono">
                    Carrier Account Entry (
                    <span className="text-emerald-400">sip.conf</span>
                    )
                  </h4>
                </div>
                <button
                  id="btn-copy-sip-entry"
                  onClick={handleCopySip}
                  className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-all ${
                    copiedSip
                      ? 'bg-emerald-600 text-white'
                      : 'bg-emerald-500 hover:bg-emerald-400 text-black font-bold shadow-sm'
                  }`}
                >
                  {copiedSip ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedSip ? '¡Copiado!' : 'Copiar'}</span>
                </button>
              </div>

              <div className="relative group">
                <pre className="p-4 rounded-lg bg-slate-950 border border-slate-800 font-mono text-xs text-emerald-400 leading-relaxed overflow-x-auto shadow-inner select-all">
{getSipConfSnippet(activeCarrier)}
                </pre>
              </div>
              <p className="text-[11px] text-slate-500">
                Pega este bloque en <span className="font-mono text-slate-400">/etc/asterisk/sip.conf</span> o en el campo Carrier Account de tu marcador.
              </p>
            </div>

            {/* Box 2: Dialplan Entry (extensions.conf) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-white font-mono">
                    Dialplan Entry (
                    <span className="text-emerald-400">extensions.conf</span>
                    )
                  </h4>
                </div>
                <button
                  id="btn-copy-dialplan-entry"
                  onClick={handleCopyDialplan}
                  className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-all ${
                    copiedDialplan
                      ? 'bg-emerald-600 text-white'
                      : 'bg-emerald-500 hover:bg-emerald-400 text-black font-bold shadow-sm'
                  }`}
                >
                  {copiedDialplan ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedDialplan ? '¡Copiado!' : 'Copiar'}</span>
                </button>
              </div>

              <div className="relative group">
                <pre className="p-4 rounded-lg bg-slate-950 border border-slate-800 font-mono text-xs text-emerald-300 leading-relaxed overflow-x-auto shadow-inner select-all">
{getDialplanSnippet(activeCarrier)}
                </pre>
              </div>
              <p className="text-[11px] text-slate-500">
                Pega este bloque en tu contexto saliente de <span className="font-mono text-slate-400">/etc/asterisk/extensions.conf</span>.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Carriers Table / Cards Summary */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
          Listado de Troncales Registradas
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {carriers.map((c) => {
            const isSelected = c.id === selectedCarrierId;
            const isEnabled = c.enabled !== false && c.status !== 'disabled';
            return (
              <div
                key={c.id}
                onClick={() => setSelectedCarrierId(c.id)}
                className={`p-4 rounded-xl cursor-pointer transition-all border ${
                  isSelected
                    ? 'bg-slate-900 border-emerald-500/60 shadow-lg ring-1 ring-emerald-500/30'
                    : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                } ${!isEnabled ? 'opacity-85 bg-slate-950/40 border-dashed border-rose-900/40' : ''}`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center space-x-2.5">
                    <div className={`w-8 h-8 rounded border flex items-center justify-center font-mono font-bold text-xs ${
                      isEnabled ? 'bg-blue-950/60 border-blue-800/60 text-blue-400' : 'bg-slate-900 border-slate-700 text-slate-500'
                    }`}>
                      SIP
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <h4 className="font-bold text-white text-sm">[{c.name}]</h4>
                        {!isEnabled && (
                          <span className="text-[9px] px-1 py-0.2 rounded bg-rose-500/20 text-rose-300 font-mono font-bold border border-rose-500/30">
                            PAUSADO
                          </span>
                        )}
                      </div>
                      <p className="font-mono text-[11px] text-slate-400">
                        {c.host}:{c.port}
                      </p>
                    </div>
                  </div>

                  {/* 1-Click Toggle Button */}
                  <button
                    type="button"
                    id={`btn-toggle-${c.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggle(c.id);
                    }}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold transition-all cursor-pointer border ${
                      isEnabled
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40 hover:bg-rose-500/20 hover:text-rose-300 hover:border-rose-500/40'
                        : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-emerald-500/20 hover:text-emerald-300 hover:border-emerald-500/40'
                    }`}
                    title={isEnabled ? "Clic para Deshabilitar Carrier (apaga registros en Asterisk)" : "Clic para Habilitar Carrier (conecta en Asterisk)"}
                  >
                    {isEnabled ? (
                      <>
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                        <span>HABILITADO</span>
                      </>
                    ) : (
                      <>
                        <PowerOff className="w-3 h-3 text-rose-400" />
                        <span>DESHABILITADO</span>
                      </>
                    )}
                  </button>
                </div>

                {!isEnabled && (
                  <div className="my-1.5 px-2 py-1 rounded bg-rose-950/30 border border-rose-800/30 text-[10px] text-rose-300/90 flex items-center justify-between font-sans">
                    <span className="flex items-center gap-1">
                      <PowerOff className="w-3 h-3 text-rose-400 shrink-0" />
                      <span>Conexión pausada en Asterisk</span>
                    </span>
                    <span
                      className="text-[10px] underline font-bold hover:text-white cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggle(c.id);
                      }}
                    >
                      Activar con 1 Clic
                    </span>
                  </div>
                )}

                <div className="my-2.5 p-2 rounded bg-slate-950 text-[11px] font-mono text-slate-300 space-y-0.5 border border-slate-800/60">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Username:</span>
                    <span>{c.username || c.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Context:</span>
                    <span>{c.inboundContext || 'trunkinbound'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Insecure:</span>
                    <span>{c.insecure || 'port,invite'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Dial Pattern:</span>
                    <span className="text-emerald-400">{c.dialplanPattern || '_1XXXXXXXXXX'}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-xs">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPingCarrier(c.id);
                    }}
                    className="inline-flex items-center space-x-1 text-slate-400 hover:text-emerald-400 transition-colors"
                  >
                    <Activity className="w-3.5 h-3.5" />
                    <span>Test Latencia</span>
                  </button>

                  <div className="flex items-center space-x-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPreviewCarrier(c);
                      }}
                      className="p-1 rounded text-slate-400 hover:text-emerald-400 hover:bg-slate-800"
                      title="Ver PJSIP equivalente"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenEditModal(c);
                      }}
                      className="p-1 rounded text-slate-400 hover:text-blue-400 hover:bg-slate-800"
                      title="Editar"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteCarrier(c.id);
                      }}
                      className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-slate-800"
                      title="Eliminar"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Modal: Crear / Editar Carrier */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Globe className="w-5 h-5 text-emerald-400" />
                <span>{editingCarrier ? 'Editar Carrier SIP' : 'Nuevo Carrier SIP'}</span>
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-white text-lg font-mono"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4 text-xs">
              {/* Estado Activo / Deshabilitado */}
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between">
                <div>
                  <span className="block font-semibold text-white">Estado de la Troncal</span>
                  <span className="text-[11px] text-slate-400">
                    {isEnabled ? 'Habilitado: Asterisk se registrará y enviará llamadas' : 'Deshabilitado: Asterisk no enviará tráfico ni paquetes SIP'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsEnabled(!isEnabled)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer border ${
                    isEnabled
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30'
                      : 'bg-rose-500/20 text-rose-300 border-rose-500/40 hover:bg-rose-500/30'
                  }`}
                >
                  {isEnabled ? <Power className="w-3.5 h-3.5 text-emerald-400" /> : <PowerOff className="w-3.5 h-3.5 text-rose-400" />}
                  <span>{isEnabled ? 'HABILITADO' : 'DESHABILITADO'}</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Nombre Carrier [slug] *</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                    placeholder="televox"
                    className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-white font-mono focus:border-emerald-500 focus:outline-none"
                  />
                  <span className="text-[10px] text-slate-500">Usado como identificador en [{name}]</span>
                </div>
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Contexto Inbound</label>
                  <input
                    type="text"
                    required
                    value={inboundContext}
                    onChange={(e) => setInboundContext(e.target.value)}
                    placeholder="trunkinbound"
                    className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-white font-mono focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-slate-300 font-medium mb-1">
                    Host SIP / IP del Carrier *
                  </label>
                  <input
                    type="text"
                    required
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    placeholder="52.144.46.192"
                    className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-white font-mono focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Puerto SIP</label>
                  <input
                    type="number"
                    value={port}
                    onChange={(e) => setPort(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-white font-mono focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Credenciales y FromUser */}
              <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-slate-950/60 border border-slate-800">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Username</label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="sgavilan30"
                    className="w-full px-3 py-2 rounded-md bg-slate-900 border border-slate-800 text-white font-mono focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Secret (Contraseña)</label>
                  <input
                    type="text"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    placeholder="Robert2026"
                    className="w-full px-3 py-2 rounded-md bg-slate-900 border border-slate-800 text-white font-mono focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Fromuser</label>
                  <input
                    type="text"
                    value={fromuser}
                    onChange={(e) => setFromuser(e.target.value)}
                    placeholder="sgavilan30"
                    className="w-full px-3 py-2 rounded-md bg-slate-900 border border-slate-800 text-white font-mono focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Insecure</label>
                  <input
                    type="text"
                    value={insecure}
                    onChange={(e) => setInsecure(e.target.value)}
                    placeholder="port,invite"
                    className="w-full px-3 py-2 rounded-md bg-slate-900 border border-slate-800 text-white font-mono focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* RPID settings */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">sendrpid</label>
                  <select
                    value={sendrpid}
                    onChange={(e) => setSendrpid(e.target.value as 'yes' | 'no')}
                    className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-white font-mono focus:border-emerald-500 focus:outline-none"
                  >
                    <option value="yes">yes</option>
                    <option value="no">no</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-300 font-medium mb-1">trustrpid</label>
                  <select
                    value={trustrpid}
                    onChange={(e) => setTrustrpid(e.target.value as 'yes' | 'no')}
                    className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-white font-mono focus:border-emerald-500 focus:outline-none"
                  >
                    <option value="yes">yes</option>
                    <option value="no">no</option>
                  </select>
                </div>
              </div>

              {/* Dialplan pattern & flags */}
              <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-slate-950/60 border border-slate-800">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Dialplan Pattern</label>
                  <input
                    type="text"
                    value={dialplanPattern}
                    onChange={(e) => setDialplanPattern(e.target.value)}
                    placeholder="_1XXXXXXXXXX"
                    className="w-full px-3 py-2 rounded-md bg-slate-900 border border-slate-800 text-white font-mono focus:border-emerald-500 focus:outline-none"
                  />
                  <span className="text-[10px] text-slate-500">Ej: _1XXXXXXXXXX o _9X.</span>
                </div>
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Dial Flags</label>
                  <input
                    type="text"
                    value={dialFlags}
                    onChange={(e) => setDialFlags(e.target.value)}
                    placeholder="Tor"
                    className="w-full px-3 py-2 rounded-md bg-slate-900 border border-slate-800 text-white font-mono focus:border-emerald-500 focus:outline-none"
                  />
                  <span className="text-[10px] text-slate-500">Ej: Tor o tTkK</span>
                </div>
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

              <div className="pt-3 border-t border-slate-800 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-md text-slate-300 hover:bg-slate-800 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-md bg-emerald-500 hover:bg-emerald-400 text-black font-bold shadow-md shadow-emerald-500/20 cursor-pointer"
                >
                  {editingCarrier ? 'Guardar Cambios' : 'Crear Carrier'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Preview Modal for PJSIP equivalent */}
      {previewCarrier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white font-mono flex items-center gap-2">
                <Globe className="w-4 h-4 text-blue-400" />
                <span>PJSIP Equivalente: {previewCarrier.name}</span>
              </h3>
              <button
                onClick={() => setPreviewCarrier(null)}
                className="text-slate-400 hover:text-white font-mono"
              >
                &times;
              </button>
            </div>

            <pre className="p-4 rounded-lg bg-slate-950 border border-slate-800 font-mono text-xs text-emerald-300/90 overflow-x-auto">
{`[${previewCarrier.name}_reg]
type=registration
transport=transport-udp
outbound_auth=${previewCarrier.name}_auth
server_uri=sip:${previewCarrier.host}:${previewCarrier.port}
client_uri=sip:${previewCarrier.username || previewCarrier.name}@${previewCarrier.host}:${previewCarrier.port}
retry_interval=30

[${previewCarrier.name}]
type=endpoint
context=${previewCarrier.inboundContext || 'trunkinbound'}
disallow=all
allow=${previewCarrier.codecs.join(',')}
outbound_auth=${previewCarrier.name}_auth
aors=${previewCarrier.name}_aor

[${previewCarrier.name}_auth]
type=auth
auth_type=userpass
username=${previewCarrier.username || previewCarrier.name}
password=${previewCarrier.secret || ''}`}
            </pre>

            <div className="flex justify-end">
              <button
                onClick={() => setPreviewCarrier(null)}
                className="px-4 py-2 rounded-md bg-slate-800 text-white text-xs font-semibold hover:bg-slate-700 cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
