import React, { useState, useEffect, useRef } from 'react';
import { AsteriskConnectionSettings, SyncLogEntry } from '../types';
import {
  Terminal,
  Send,
  Trash2,
  RefreshCw,
  CheckCircle2,
  ShieldAlert,
  ShieldCheck,
  Cpu,
  Settings2,
  Activity,
  AlertTriangle,
  RotateCcw,
  Clock,
  Zap,
} from 'lucide-react';

interface SyncTelemetryTabProps {
  settings: AsteriskConnectionSettings;
  onUpdateSettings: (settings: AsteriskConnectionSettings) => void;
  logs: SyncLogEntry[];
  onClearLogs: () => void;
  onExecuteAmiCommand: (command: string) => void;
  onForceFullSync: () => void;
  isSyncing: boolean;
}

interface ServerTelemetryPayload {
  id: string;
  timestamp: string;
  type: 'AMI' | 'ARI' | 'CLI' | 'SYSTEM' | 'PJSIP';
  message: string;
  payload?: string;
  status: 'success' | 'warning' | 'error';
}

interface AmiHealthInfo {
  consecutiveFailures: number;
  lastFailureTime: number;
  lastSuccessTime: number;
  nextAllowedAttemptTime: number;
  currentDelayMs: number;
  lastError: string;
  isCircuitOpen: boolean;
  remainingCooldownSec: number;
  totalAttempts: number;
  successfulAttempts: number;
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
  const [serverLogs, setServerLogs] = useState<ServerTelemetryPayload[]>([]);
  const [amiHealth, setAmiHealth] = useState<AmiHealthInfo | null>(null);
  const [cliStats, setCliStats] = useState<{ cachedKeys: number; isLocalCliRunning: boolean } | null>(null);
  const [isResettingBackoff, setIsResettingBackoff] = useState(false);
  const [resetFeedback, setResetFeedback] = useState<string | null>(null);

  // Poll real server-side telemetry and AMI health every 3.5 seconds
  useEffect(() => {
    let isMounted = true;

    const fetchServerTelemetry = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const res = await fetch('/api/asterisk/telemetry/logs');
        if (res.ok) {
          const data = await res.json();
          if (isMounted && data.success) {
            if (Array.isArray(data.logs)) {
              setServerLogs(data.logs);
            }
            if (data.amiHealth) {
              setAmiHealth(data.amiHealth);
            }
            if (data.cliStats) {
              setCliStats(data.cliStats);
            }
          }
        }
      } catch (_) {}
    };

    fetchServerTelemetry();
    const interval = setInterval(fetchServerTelemetry, 3500);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  // Merge client-side logs with live backend telemetry logs
  const combinedLogs: SyncLogEntry[] = React.useMemo(() => {
    const formattedServerLogs: SyncLogEntry[] = serverLogs.map((s) => ({
      id: s.id,
      timestamp: s.timestamp,
      type: s.type as any,
      message: s.message,
      payload: s.payload,
      status: s.status === 'error' ? 'failed' : (s.status === 'warning' ? 'pending' : 'success'),
    }));

    // Combine and deduplicate
    const map = new Map<string, SyncLogEntry>();
    for (const l of [...logs, ...formattedServerLogs]) {
      if (!map.has(l.id)) {
        map.set(l.id, l);
      }
    }

    return Array.from(map.values()).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [logs, serverLogs]);

  const filteredLogs = combinedLogs.filter((l) => {
    if (filterType === 'ALL') return true;
    return l.type === filterType;
  });

  const handleCommandSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customCommand.trim()) return;
    onExecuteAmiCommand(customCommand.trim());
  };

  const handleResetAmiCircuit = async () => {
    setIsResettingBackoff(true);
    setResetFeedback(null);
    try {
      const res = await fetch('/api/asterisk/ami/reset-backoff', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setResetFeedback('✓ Circuito AMI restablecido a estado CERRADO (operativo)');
        if (data.amiHealth) {
          setAmiHealth(data.amiHealth);
        }
      }
    } catch (e: any) {
      setResetFeedback(`Error al resetear: ${e.message}`);
    } finally {
      setIsResettingBackoff(false);
      setTimeout(() => setResetFeedback(null), 4000);
    }
  };

  const handleClearServerAndClientLogs = async () => {
    onClearLogs();
    setServerLogs([]);
    try {
      await fetch('/api/asterisk/telemetry/clear', { method: 'POST' });
    } catch (_) {}
  };

  const quickCommands = [
    'pjsip show endpoints',
    'core show channels',
    'database show ivr_vars',
    'pjsip show registrations',
    'pjsip reload',
    'dialplan reload',
    'ari show apps',
  ];

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Terminal className="w-5 h-5 text-emerald-400" />
            <span>Consola de Sincronización AMI &amp; ARI y Telemetría</span>
          </h2>
          <p className="text-sm text-slate-400">
            Monitoreo en tiempo real de sockets TCP :5038, mitigación de bucles CLI y control de reconexión exponencial.
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            onClick={handleResetAmiCircuit}
            disabled={isResettingBackoff}
            className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 transition-all shadow-sm"
            title="Desbloquear inmediatamente cualquier cooldown de reconexión AMI"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${isResettingBackoff ? 'animate-spin' : ''}`} />
            <span>Restablecer Backoff AMI</span>
          </button>

          <button
            id="btn-force-full-sync"
            onClick={onForceFullSync}
            disabled={isSyncing}
            className="inline-flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20 transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? 'Sincronizando...' : 'Forzar Sincronización'}</span>
          </button>
        </div>
      </div>

      {resetFeedback && (
        <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 text-xs font-mono flex items-center gap-2 animate-fadeIn">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <span>{resetFeedback}</span>
        </div>
      )}

      {/* DIAGNOSTIC CARD: ANÁLISIS DEL BUCLE "REMOTE UNIX CONNECTION" Y BACKOFF EXPONENCIAL */}
      <div className="p-4 sm:p-5 rounded-xl bg-slate-900/90 border border-slate-800 shadow-xl space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-indigo-400">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white text-sm flex items-center gap-2">
                <span>Diagnóstico de Sistema: Neutralización de Bucle Asterisk</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  PROTECCIÓN ACTIVA
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Análisis en profundidad del bucle repetitivo de conexiones UNIX y arquitectura de Backoff Exponencial en sockets AMI.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start md:self-auto">
            <div className={`px-2.5 py-1 rounded-md text-xs font-mono font-bold flex items-center gap-1.5 ${
              amiHealth?.isCircuitOpen
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse'
                : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
            }`}>
              <span className={`w-2 h-2 rounded-full ${amiHealth?.isCircuitOpen ? 'bg-amber-400' : 'bg-emerald-400'}`}></span>
              <span>
                {amiHealth?.isCircuitOpen
                  ? `CIRCUITO AMI ABIERTO (Pausa: ${amiHealth.remainingCooldownSec}s)`
                  : 'CIRCUITO AMI CERRADO (Operativo)'}
              </span>
            </div>
          </div>
        </div>

        {/* Diagnostic breakdown grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
          <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800/80 space-y-1">
            <span className="text-slate-500 text-[10px] uppercase tracking-wider font-semibold block">Causa del Bucle CLI</span>
            <p className="text-slate-300 text-[11px] leading-relaxed">
              Consultas repetitivas sin caché que abrían y cerraban sockets UNIX (<code className="text-sky-300 font-mono">/var/run/asterisk/asterisk.ctl</code>) en cada tick HTTP.
            </p>
          </div>

          <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800/80 space-y-1">
            <span className="text-slate-500 text-[10px] uppercase tracking-wider font-semibold block">Estrategia Backoff AMI</span>
            <p className="text-slate-300 text-[11px] leading-relaxed">
              Progresión exponencial escalonada: <b className="text-emerald-300 font-mono">1s &rarr; 2s &rarr; 4s &rarr; 8s &rarr; 16s &rarr; 32s</b> con jitter para evitar saturar el puerto <b className="text-slate-200 font-mono">:5038</b>.
            </p>
          </div>

          <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800/80 space-y-1">
            <span className="text-slate-500 text-[10px] uppercase tracking-wider font-semibold block">Caché en Memoria CLI</span>
            <div className="flex items-baseline justify-between">
              <span className="text-lg font-bold text-white font-mono">{cliStats?.cachedKeys || 0}</span>
              <span className="text-[10px] text-emerald-400 font-mono">keys activas</span>
            </div>
            <p className="text-[10px] text-slate-400">
              Respuestas en memoria evitan llamadas de shell directas.
            </p>
          </div>

          <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800/80 space-y-1">
            <span className="text-slate-500 text-[10px] uppercase tracking-wider font-semibold block">Reintentos Fallidos Consecutivos</span>
            <div className="flex items-baseline justify-between">
              <span className={`text-lg font-bold font-mono ${amiHealth?.consecutiveFailures ? 'text-amber-400' : 'text-slate-400'}`}>
                {amiHealth?.consecutiveFailures || 0}
              </span>
              <span className="text-[10px] text-slate-500 font-mono">
                Demora: {amiHealth?.currentDelayMs ? `${Math.round(amiHealth.currentDelayMs / 1000)}s` : '1s'}
              </span>
            </div>
            <p className="text-[10px] text-slate-400 truncate" title={amiHealth?.lastError || 'Sin errores'}>
              {amiHealth?.lastError ? `Aviso: ${amiHealth.lastError}` : 'Sin errores activos'}
            </p>
          </div>
        </div>
      </div>

      {/* Grid: Credentials & Live Settings */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Settings */}
        <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
          <div className="flex items-center space-x-2 pb-3 border-b border-slate-800">
            <Settings2 className="w-4 h-4 text-emerald-400" />
            <h3 className="font-bold text-white text-sm">Credenciales Black Hat Core</h3>
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
                      amiHost: '127.0.0.1',
                      ariHost: '127.0.0.1',
                    })
                  }
                  className="text-[10px] text-emerald-400 hover:text-emerald-300 font-mono underline"
                >
                  Usar 127.0.0.1 (Localhost)
                </button>
              </div>
              <input
                type="text"
                value={settings.amiHost}
                onChange={(e) => onUpdateSettings({ ...settings, amiHost: e.target.value, ariHost: e.target.value })}
                className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-white font-mono focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-2.5">
              <div className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${amiHealth?.isCircuitOpen ? 'bg-amber-400' : 'bg-emerald-400'}`}></span>
                  <span>Asterisk Manager Interface (AMI)</span>
                </div>
                {amiHealth?.isCircuitOpen && (
                  <span className="text-[10px] text-amber-300 font-mono bg-amber-500/20 px-1.5 py-0.5 rounded">
                    Backoff: {amiHealth.remainingCooldownSec}s
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-500 text-[10px] mb-0.5">Puerto AMI</label>
                  <input
                    type="number"
                    value={settings.amiPort}
                    onChange={(e) => onUpdateSettings({ ...settings, amiPort: Number(e.target.value) })}
                    className="w-full px-2.5 py-1.5 rounded bg-slate-900 border border-slate-800 text-white font-mono focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 text-[10px] mb-0.5">Usuario AMI</label>
                  <input
                    type="text"
                    value={settings.amiUser}
                    onChange={(e) => onUpdateSettings({ ...settings, amiUser: e.target.value })}
                    className="w-full px-2.5 py-1.5 rounded bg-slate-900 border border-slate-800 text-white font-mono focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-slate-500 text-[10px] mb-0.5">Secret AMI</label>
                <input
                  type="password"
                  value={settings.amiSecret}
                  onChange={(e) => onUpdateSettings({ ...settings, amiSecret: e.target.value })}
                  className="w-full px-2.5 py-1.5 rounded bg-slate-900 border border-slate-800 text-white font-mono focus:border-emerald-500 focus:outline-none"
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
                  className="rounded bg-slate-950 border-slate-800 text-emerald-500 focus:ring-0"
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
          <div className="px-4 py-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center space-x-2">
              <div className={`w-3 h-3 rounded-full ${amiHealth?.isCircuitOpen ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500 animate-pulse'}`}></div>
              <span className="font-mono text-xs font-bold text-slate-300">
                Black Hat Dialer Telemetry Stream (AMI :5038 &bull; CLI Asterisk &bull; ARI :8088)
              </span>
            </div>

            <div className="flex items-center space-x-2 text-xs">
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="px-2 py-1 rounded bg-slate-950 border border-slate-800 text-slate-300 text-[11px] focus:outline-none font-mono"
              >
                <option value="ALL">Todos los logs</option>
                <option value="AMI">Solo AMI</option>
                <option value="CLI">Solo CLI</option>
                <option value="ARI">Solo ARI</option>
                <option value="PJSIP">Solo PJSIP</option>
                <option value="SYSTEM">Solo SYSTEM</option>
              </select>

              <button
                onClick={handleClearServerAndClientLogs}
                className="p-1 text-slate-400 hover:text-rose-400 transition-colors"
                title="Limpiar consola de telemetría"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Quick Command Pills */}
          <div className="px-4 py-2 bg-slate-900/50 border-b border-slate-800/80 flex flex-wrap gap-1.5 items-center">
            <span className="text-[10px] text-slate-500 font-mono self-center mr-1">Comandos AMI / CLI:</span>
            {quickCommands.map((cmd) => (
              <button
                key={cmd}
                onClick={() => {
                  setCustomCommand(cmd);
                  onExecuteAmiCommand(cmd);
                }}
                className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-emerald-300/90 font-mono text-[10px] transition-colors"
              >
                {cmd}
              </button>
            ))}
          </div>

          {/* Logs Output Box */}
          <div className="p-4 font-mono text-xs overflow-y-auto max-h-[420px] min-h-[340px] space-y-2 scrollbar-thin">
            {filteredLogs.length === 0 ? (
              <div className="text-slate-600 italic">No hay logs registrados aún. Ejecuta un comando para probar.</div>
            ) : (
              filteredLogs.map((log) => (
                <div key={log.id} className="leading-tight">
                  <span className="text-slate-600 mr-2 text-[10px]">{log.timestamp}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold mr-2 ${
                      log.type === 'AMI'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : log.type === 'CLI'
                        ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                        : log.type === 'ARI'
                        ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                        : log.type === 'PJSIP'
                        ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                        : 'bg-slate-800 text-slate-300 border border-slate-700/50'
                    }`}
                  >
                    {log.type}
                  </span>
                  <span className={`text-slate-200 ${log.status === 'failed' ? 'text-rose-300' : ''}`}>
                    {log.message}
                  </span>
                  {log.payload && (
                    <pre className="mt-1 pl-4 py-1 text-[11px] text-emerald-300/80 border-l-2 border-slate-800 whitespace-pre-wrap max-h-48 overflow-y-auto">
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
              placeholder="Ej: pjsip reload, core show channels, pjsip show endpoints, database show..."
              className="flex-1 px-3 py-1.5 rounded bg-slate-950 border border-slate-800 font-mono text-xs text-white focus:border-emerald-500 focus:outline-none"
            />
            <button
              type="submit"
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-xs font-semibold shadow-sm"
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
