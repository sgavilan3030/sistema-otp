import React, { useState } from 'react';
import { AsteriskConnectionSettings, SyncLogEntry } from '../types';
import { Terminal, Send, Trash2, RefreshCw, CheckCircle2, ShieldAlert, Cpu, Settings2, Play } from 'lucide-react';

interface SyncTelemetryTabProps {
  settings: AsteriskConnectionSettings;
  onUpdateSettings: (settings: AsteriskConnectionSettings) => void;
  logs: SyncLogEntry[];
  onClearLogs: () => void;
  onExecuteAmiCommand: (command: string) => void;
  onForceFullSync: () => void;
  isSyncing: boolean;
}

export const SyncTelemetryTab: React.FC<SyncTelemetryTabProps> = ({
  settings,
  onUpdateSettings,
  logs,
  onClearLogs,
  onExecuteAmiCommand,
  onForceFullSync,
  isSyncing,
}) => {
  const [customCommand, setCustomCommand] = useState('pjsip show endpoints');
  const [filterType, setFilterType] = useState<string>('ALL');

  const filteredLogs = logs.filter((l) => {
    if (filterType === 'ALL') return true;
    return l.type === filterType;
  });

  const handleCommandSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customCommand.trim()) return;
    onExecuteAmiCommand(customCommand.trim());
  };

  const quickCommands = [
    'pjsip show endpoints',
    'pjsip show registrations',
    'pjsip reload',
    'dialplan reload',
    'core show channels',
    'ari show apps',
  ];

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Terminal className="w-5 h-5 text-emerald-400" />
            <span>Consola de Sincronización AMI &amp; ARI</span>
          </h2>
          <p className="text-sm text-slate-400">
            Monitoreo en tiempo real de los protocolos de conexión, eventos de registro SIP y comandos de recarga en caliente.
          </p>
        </div>

        <button
          id="btn-force-full-sync"
          onClick={onForceFullSync}
          disabled={isSyncing}
          className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-lg text-sm font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20 transition-all"
        >
          <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
          <span>{isSyncing ? 'Sincronizando...' : 'Forzar Sincronización Total'}</span>
        </button>
      </div>

      {/* Grid: Credentials & Live Settings */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Settings */}
        <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
          <div className="flex items-center space-x-2 pb-3 border-b border-slate-800">
            <Settings2 className="w-4 h-4 text-amber-400" />
            <h3 className="font-bold text-white text-sm">Credenciales Asterisk 20</h3>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-slate-400 font-medium">Host Asterisk (IP o FQDN)</label>
                <button
                  type="button"
                  onClick={() =>
                    onUpdateSettings({
                      ...settings,
                      amiHost: 'anonymousotp.online',
                      ariHost: 'anonymousotp.online',
                    })
                  }
                  className="text-[10px] text-blue-400 hover:text-blue-300 font-mono underline"
                >
                  Usar anonymousotp.online
                </button>
              </div>
              <input
                type="text"
                value={settings.amiHost}
                onChange={(e) => onUpdateSettings({ ...settings, amiHost: e.target.value, ariHost: e.target.value })}
                className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-white font-mono focus:border-amber-500 focus:outline-none"
              />
            </div>

            <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-2.5">
              <div className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                <span>Asterisk Manager Interface (AMI)</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-500 text-[10px] mb-0.5">Puerto AMI</label>
                  <input
                    type="number"
                    value={settings.amiPort}
                    onChange={(e) => onUpdateSettings({ ...settings, amiPort: Number(e.target.value) })}
                    className="w-full px-2.5 py-1.5 rounded bg-slate-900 border border-slate-800 text-white font-mono focus:border-amber-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 text-[10px] mb-0.5">Usuario AMI</label>
                  <input
                    type="text"
                    value={settings.amiUser}
                    onChange={(e) => onUpdateSettings({ ...settings, amiUser: e.target.value })}
                    className="w-full px-2.5 py-1.5 rounded bg-slate-900 border border-slate-800 text-white font-mono focus:border-amber-500 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-slate-500 text-[10px] mb-0.5">Secret AMI</label>
                <input
                  type="password"
                  value={settings.amiSecret}
                  onChange={(e) => onUpdateSettings({ ...settings, amiSecret: e.target.value })}
                  className="w-full px-2.5 py-1.5 rounded bg-slate-900 border border-slate-800 text-white font-mono focus:border-amber-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-2.5">
              <div className="text-[11px] font-bold text-blue-400 uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-blue-400"></span>
                <span>Asterisk REST Interface (ARI)</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-500 text-[10px] mb-0.5">Puerto HTTP ARI</label>
                  <input
                    type="number"
                    value={settings.ariPort}
                    onChange={(e) => onUpdateSettings({ ...settings, ariPort: Number(e.target.value) })}
                    className="w-full px-2.5 py-1.5 rounded bg-slate-900 border border-slate-800 text-white font-mono focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 text-[10px] mb-0.5">Stasis App Name</label>
                  <input
                    type="text"
                    value={settings.ariAppName}
                    onChange={(e) => onUpdateSettings({ ...settings, ariAppName: e.target.value })}
                    className="w-full px-2.5 py-1.5 rounded bg-slate-900 border border-slate-800 text-white font-mono focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="pt-2">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.autoSyncOnChange}
                  onChange={(e) => onUpdateSettings({ ...settings, autoSyncOnChange: e.target.checked })}
                  className="rounded bg-slate-950 border-slate-800 text-amber-500 focus:ring-0"
                />
                <span className="text-slate-300 font-medium">
                  Auto-sincronizar inmediatamente al crear o editar
                </span>
              </label>
            </div>
          </div>
        </div>

        {/* Right Columns: Telemetry Terminal Console */}
        <div className="lg:col-span-2 rounded-xl bg-slate-950 border border-slate-800 flex flex-col justify-between overflow-hidden shadow-2xl">
          {/* Terminal Header */}
          <div className="px-4 py-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse"></div>
              <span className="font-mono text-xs font-bold text-slate-300">
                Asterisk 20 Socket Terminal (AMI :5038 &bull; ARI :8088)
              </span>
            </div>

            <div className="flex items-center space-x-2 text-xs">
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="px-2 py-1 rounded bg-slate-950 border border-slate-800 text-slate-300 text-[11px] focus:outline-none"
              >
                <option value="ALL">Todos los logs</option>
                <option value="AMI">Solo AMI</option>
                <option value="ARI">Solo ARI</option>
                <option value="PJSIP">Solo PJSIP</option>
              </select>

              <button
                onClick={onClearLogs}
                className="p-1 text-slate-400 hover:text-rose-400 transition-colors"
                title="Limpiar consola"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Quick Command Pills */}
          <div className="px-4 py-2 bg-slate-900/50 border-b border-slate-800/80 flex flex-wrap gap-1.5">
            <span className="text-[10px] text-slate-500 font-mono self-center mr-1">Comandos Rápidos:</span>
            {quickCommands.map((cmd) => (
              <button
                key={cmd}
                onClick={() => {
                  setCustomCommand(cmd);
                  onExecuteAmiCommand(cmd);
                }}
                className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-amber-300/90 font-mono text-[10px] transition-colors"
              >
                {cmd}
              </button>
            ))}
          </div>

          {/* Logs Output Box */}
          <div className="p-4 font-mono text-xs overflow-y-auto max-h-[380px] min-h-[320px] space-y-2 scrollbar-thin">
            {filteredLogs.length === 0 ? (
              <div className="text-slate-600 italic">No hay logs registrados aún.</div>
            ) : (
              filteredLogs.map((log) => (
                <div key={log.id} className="leading-tight">
                  <span className="text-slate-600 mr-2 text-[10px]">{log.timestamp}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold mr-2 ${
                      log.type === 'AMI'
                        ? 'bg-emerald-500/10 text-emerald-400'
                        : log.type === 'ARI'
                        ? 'bg-blue-500/10 text-blue-400'
                        : log.type === 'PJSIP'
                        ? 'bg-purple-500/10 text-purple-400'
                        : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    {log.type}
                  </span>
                  <span className="text-slate-200">{log.message}</span>
                  {log.payload && (
                    <pre className="mt-1 pl-4 py-1 text-[11px] text-amber-300/80 border-l-2 border-slate-800 whitespace-pre-wrap">
                      {log.payload}
                    </pre>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Interactive Command Input */}
          <form onSubmit={handleCommandSubmit} className="p-3 bg-slate-900 border-t border-slate-800 flex gap-2">
            <span className="text-emerald-400 font-mono text-sm self-center">&gt;</span>
            <input
              type="text"
              value={customCommand}
              onChange={(e) => setCustomCommand(e.target.value)}
              placeholder="Ej: pjsip reload, core show channels, pjsip show endpoints..."
              className="flex-1 px-3 py-1.5 rounded bg-slate-950 border border-slate-800 font-mono text-xs text-white focus:border-emerald-500 focus:outline-none"
            />
            <button
              type="submit"
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-xs font-semibold"
            >
              <Send className="w-3 h-3" />
              <span>Ejecutar</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
