import React, { useState } from 'react';
import { PjsipExtension } from '../types';
import { Plus, Trash2, Edit2, Key, Check, Wifi, AlertCircle, Phone, Eye, ShieldCheck, RefreshCw } from 'lucide-react';

interface ExtensionsTabProps {
  extensions: PjsipExtension[];
  onAddExtension: (extension: PjsipExtension) => void;
  onUpdateExtension: (extension: PjsipExtension) => void;
  onDeleteExtension: (id: string) => void;
  onSimulateQualify: (extNumber: string) => void;
  onSyncAsterisk?: () => void;
  isSyncing?: boolean;
}

export const ExtensionsTab: React.FC<ExtensionsTabProps> = ({
  extensions,
  onAddExtension,
  onUpdateExtension,
  onDeleteExtension,
  onSimulateQualify,
  onSyncAsterisk,
  isSyncing,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingExt, setEditingExt] = useState<PjsipExtension | null>(null);
  const [previewExt, setPreviewExt] = useState<PjsipExtension | null>(null);

  // Form State
  const [extNumber, setExtNumber] = useState('');
  const [extName, setExtName] = useState('');
  const [extSecret, setExtSecret] = useState('');
  const [extContext, setExtContext] = useState('from-internal');
  const [extTransport, setExtTransport] = useState<PjsipExtension['transport']>('transport-udp');
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
    setExtContext('from-internal');
    setExtTransport('transport-udp');
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
    setExtContext(ext.context);
    setExtTransport(ext.transport);
    setExtMaxContacts(ext.maxContacts);
    setSelectedCodecs(ext.codecs);
    setIsModalOpen(true);
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

    const callerId = `"${extName || extNumber}" <${extNumber}>`;

    if (editingExt) {
      onUpdateExtension({
        ...editingExt,
        extension: extNumber.trim(),
        name: extName || `Ext ${extNumber}`,
        secret: extSecret,
        context: extContext,
        transport: extTransport,
        maxContacts: extMaxContacts,
        codecs: selectedCodecs,
        callerId,
      });
    } else {
      onAddExtension({
        id: `ext-${extNumber}-${Date.now()}`,
        extension: extNumber.trim(),
        name: extName || `Ext ${extNumber}`,
        secret: extSecret,
        context: extContext,
        transport: extTransport,
        maxContacts: extMaxContacts,
        codecs: selectedCodecs,
        callerId,
        status: 'registered',
        ipAddress: `192.168.1.${Math.floor(Math.random() * 150) + 50}:5060`,
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

        <div className="flex items-center space-x-3">
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
                    Nombre Mostrado (CallerID)
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
                    <option value="transport-udp">UDP (5060)</option>
                    <option value="transport-tcp">TCP (5060)</option>
                    <option value="transport-tls">TLS Seguro (5061)</option>
                    <option value="transport-wss">WSS WebRTC (8089)</option>
                  </select>
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
{`[${previewExt.extension}]
type=endpoint
context=${previewExt.context}
disallow=all
allow=${previewExt.codecs.join(',')}
auth=${previewExt.extension}-auth
aors=${previewExt.extension}-aor
callerid=${previewExt.callerId}
transport=${previewExt.transport}
direct_media=no

[${previewExt.extension}-auth]
type=auth
auth_type=userpass
username=${previewExt.extension}
password=${previewExt.secret}

[${previewExt.extension}-aor]
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
    </div>
  );
};
