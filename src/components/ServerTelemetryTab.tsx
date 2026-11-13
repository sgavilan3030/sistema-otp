import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import {
  Cpu,
  HardDrive,
  Activity,
  Server,
  RefreshCw,
  Pause,
  Play,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  WifiOff,
  Clock,
  PhoneCall,
} from 'lucide-react';

interface TelemetryResponse {
  success: boolean;
  timestamp: number;
  source: 'vps-local' | 'remote-vps' | 'app-host';
  proxyRoundTripMs?: number;
  host: {
    hostname: string;
    platform: string;
    arch: string;
    nodeVersion: string;
    uptimeSec: number;
    processUptimeSec: number;
    pid: number;
  };
  cpu: {
    percent: number;
    cores: number;
    model: string;
    load1m: number;
    load5m: number;
    load15m: number;
  };
  memory: {
    totalMb: number;
    usedMb: number;
    freeMb: number;
    availableMb: number;
    cachedMb: number;
    usedPercent: number;
    swapTotalMb: number;
    swapUsedMb: number;
    processRssMb: number;
    processHeapUsedMb: number;
  };
  ami: {
    connected: boolean;
    latencyMs: number | null;
    error: string | null;
    asteriskHost: string;
    isCircuitOpen: boolean;
    consecutiveFailures: number;
    totalAttempts: number;
    successfulAttempts: number;
    lastError: string | null;
  };
  asteriskRuntime: {
    hasLocalAsterisk: boolean;
    asteriskCtlExists: boolean;
    activeCalls: number;
    capturedOtps: number;
    cliCacheKeys: number;
  };
}

interface TelemetrySample {
  id: number;
  timeLabel: string;
  timestamp: number;
  cpuPercent: number;
  load1m: number;
  load5m: number;
  load15m: number;
  ramUsedMb: number;
  ramTotalMb: number;
  ramPercent: number;
  nodeRssMb: number;
  amiLatencyMs: number | null;
  amiConnected: boolean;
  activeCalls: number;
}

const MAX_SAMPLES = 45;

function formatUptime(totalSec: number): string {
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m ${totalSec % 60}s`;
}

function getSeverityMeta(value: number, warnThreshold: number, critThreshold: number) {
  if (value >= critThreshold) {
    return {
      label: 'Crítico',
      textClass: 'text-rose-400',
      badgeClass: 'bg-rose-500/15 text-rose-400 border border-rose-500/30',
    };
  }
  if (value >= warnThreshold) {
    return {
      label: 'Elevado',
      textClass: 'text-yellow-400',
      badgeClass: 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30',
    };
  }
  return {
    label: 'Óptimo',
    textClass: 'text-emerald-400',
    badgeClass: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
  };
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | null; color?: string; unit?: string }>;
  label?: string;
}

const TelemetryTooltip: React.FC<ChartTooltipProps> = ({ active, payload, label }) => {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs shadow-xl">
      <div className="font-mono text-[11px] text-slate-400 mb-1.5 border-b border-slate-800 pb-1">
        {label}
      </div>
      <div className="space-y-1">
        {payload.map((entry, idx) => (
          <div key={idx} className="flex items-center justify-between gap-4 font-mono tabular-nums">
            <span className="flex items-center gap-1.5 text-slate-300">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: entry.color || '#10b981' }}
              />
              <span>{entry.name}</span>
            </span>
            <span className="font-semibold text-white">
              {entry.value === null || entry.value === undefined
                ? 'Sin respuesta'
                : `${entry.value}${entry.unit || ''}`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export const ServerTelemetryTab: React.FC = () => {
  const [samples, setSamples] = useState<TelemetrySample[]>([]);
  const [latest, setLatest] = useState<TelemetryResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [intervalMs, setIntervalMs] = useState<number>(3000);

  const sampleCounterRef = useRef<number>(1);
  const isMountedRef = useRef<boolean>(true);

  const fetchTelemetry = useCallback(async (manual = false) => {
    if (!manual && typeof document !== 'undefined' && document.hidden) return;
    if (manual) setIsRefreshing(true);

    try {
      const response = await fetch('/api/system/telemetry', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} al consultar telemetría`);
      }
      const data = (await response.json()) as TelemetryResponse;
      if (!data || !data.success) {
        throw new Error('Respuesta inválida del servidor de telemetría');
      }
      if (!isMountedRef.current) return;

      const timeLabel = new Date(data.timestamp || Date.now()).toLocaleTimeString('es-ES', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

      const nextSample: TelemetrySample = {
        id: sampleCounterRef.current++,
        timeLabel,
        timestamp: data.timestamp || Date.now(),
        cpuPercent: data.cpu.percent,
        load1m: data.cpu.load1m,
        load5m: data.cpu.load5m,
        load15m: data.cpu.load15m,
        ramUsedMb: data.memory.usedMb,
        ramTotalMb: data.memory.totalMb,
        ramPercent: data.memory.usedPercent,
        nodeRssMb: data.memory.processRssMb,
        amiLatencyMs: data.ami.connected ? data.ami.latencyMs : null,
        amiConnected: data.ami.connected,
        activeCalls: data.asteriskRuntime.activeCalls,
      };

      setLatest(data);
      setSamples((prev) => [...prev.slice(-(MAX_SAMPLES - 1)), nextSample]);
      setErrorMsg(null);
    } catch (err: any) {
      if (isMountedRef.current) {
        setErrorMsg(err?.message || 'Error de red al obtener métricas del servidor');
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    fetchTelemetry(false);
    return () => {
      isMountedRef.current = false;
    };
  }, [fetchTelemetry]);

  useEffect(() => {
    if (isPaused) return;
    const timer = setInterval(() => {
      fetchTelemetry(false);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [isPaused, intervalMs, fetchTelemetry]);

  const amiStats = useMemo(() => {
    const valid = samples.map((s) => s.amiLatencyMs).filter((v): v is number => v !== null);
    if (valid.length === 0) return { avg: null, max: null, min: null };
    const sum = valid.reduce((a, b) => a + b, 0);
    return {
      avg: Number((sum / valid.length).toFixed(1)),
      max: Number(Math.max(...valid).toFixed(1)),
      min: Number(Math.min(...valid).toFixed(1)),
    };
  }, [samples]);

  const cpuMeta = getSeverityMeta(latest?.cpu.percent ?? 0, 70, 90);
  const ramMeta = getSeverityMeta(latest?.memory.usedPercent ?? 0, 75, 90);

  const amiStatusMeta = useMemo(() => {
    if (!latest?.ami.connected) {
      return {
        label: 'Desconectado',
        textClass: 'text-rose-400',
        badgeClass: 'bg-rose-500/15 text-rose-400 border border-rose-500/30',
      };
    }
    const ms = latest.ami.latencyMs ?? 0;
    if (ms >= 150) {
      return {
        label: 'Lento',
        textClass: 'text-rose-400',
        badgeClass: 'bg-rose-500/15 text-rose-400 border border-rose-500/30',
      };
    }
    if (ms >= 60) {
      return {
        label: 'Moderado',
        textClass: 'text-yellow-400',
        badgeClass: 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30',
      };
    }
    return {
      label: 'Nominal',
      textClass: 'text-emerald-400',
      badgeClass: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
    };
  }, [latest]);

  const sourceLabel =
    latest?.source === 'remote-vps'
      ? 'VPS Remoto (Proxy HTTP)'
      : latest?.source === 'vps-local'
      ? 'VPS Local (Asterisk Activo)'
      : 'Host de Aplicación';

  return (
    <div className="space-y-6">
      {/* Top Control & Host Summary Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <Server className="w-5 h-5 text-emerald-400 shrink-0" />
            <h2 className="text-lg font-bold text-white tracking-tight truncate">
              Telemetría de Servidor en Tiempo Real
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1 font-mono tabular-nums truncate">
            {latest
              ? `${latest.host.hostname} · ${latest.cpu.cores} vCPU · ${latest.host.platform} · Node ${latest.host.nodeVersion} · ${sourceLabel}`
              : 'Conectando con el monitor del sistema...'}
          </p>
        </div>

        {/* Single-line Control Toolbar */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="inline-flex items-center rounded-lg border border-slate-800 bg-slate-950 p-0.5 text-xs font-mono">
            {[
              { label: '2s', ms: 2000 },
              { label: '3s', ms: 3000 },
              { label: '5s', ms: 5000 },
              { label: '10s', ms: 10000 },
            ].map((opt) => (
              <button
                key={opt.ms}
                type="button"
                onClick={() => setIntervalMs(opt.ms)}
                className={`px-2.5 py-1 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  intervalMs === opt.ms
                    ? 'bg-emerald-500/20 text-emerald-400 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setIsPaused((p) => !p)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-950 hover:bg-slate-800 text-xs font-medium text-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isPaused ? (
              <>
                <Play className="w-3.5 h-3.5 text-emerald-400" />
                <span>Reanudar</span>
              </>
            ) : (
              <>
                <Pause className="w-3.5 h-3.5 text-slate-400" />
                <span>Pausar</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => setSamples([])}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-950 hover:bg-slate-800 text-xs font-medium text-slate-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5 text-slate-400" />
            <span>Limpiar</span>
          </button>

          <button
            type="button"
            onClick={() => fetchTelemetry(true)}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Muestrear</span>
          </button>
        </div>
      </div>

      {/* Error / Warning Banners */}
      {errorMsg && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-xs text-rose-400">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => fetchTelemetry(true)}
            className="px-2.5 py-1 rounded-md bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
          >
            Reintentar
          </button>
        </div>
      )}

      {latest && !latest.ami.connected && (
        <div className="bg-slate-900 border border-rose-500/40 rounded-xl p-4 flex items-center gap-3 text-xs">
          <WifiOff className="w-4 h-4 text-rose-400 shrink-0" />
          <div className="text-slate-300">
            <span className="font-semibold text-rose-400">AMI sin respuesta en {latest.ami.asteriskHost}:5038: </span>
            <span className="font-mono">{latest.ami.error || 'Conexión no disponible'}</span>
          </div>
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* KPI 1: CPU */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
              <Cpu className="w-4 h-4 text-emerald-400" />
              <span>Carga de CPU</span>
            </span>
            <span className={`text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md ${cpuMeta.badgeClass}`}>
              {cpuMeta.label}
            </span>
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-white">
            {isLoading ? '—' : `${latest?.cpu.percent.toFixed(1)}%`}
          </div>
          <div className="mt-2 text-[11px] text-slate-400 font-mono tabular-nums">
            Load: {latest ? `${latest.cpu.load1m} / ${latest.cpu.load5m} / ${latest.cpu.load15m}` : '—'} · {latest?.cpu.cores ?? '—'} cores
          </div>
        </div>

        {/* KPI 2: RAM */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
              <HardDrive className="w-4 h-4 text-blue-400" />
              <span>Memoria RAM</span>
            </span>
            <span className={`text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md ${ramMeta.badgeClass}`}>
              {ramMeta.label}
            </span>
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-white">
            {isLoading ? '—' : `${latest?.memory.usedPercent.toFixed(1)}%`}
          </div>
          <div className="mt-2 text-[11px] text-slate-400 font-mono tabular-nums">
            {latest
              ? `${latest.memory.usedMb} / ${latest.memory.totalMb} MB · Node RSS ${latest.memory.processRssMb} MB`
              : '—'}
          </div>
        </div>

        {/* KPI 3: AMI Latency */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-cyan-400" />
              <span>Latencia AMI (:5038)</span>
            </span>
            <span className={`text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md ${amiStatusMeta.badgeClass}`}>
              {amiStatusMeta.label}
            </span>
          </div>
          <div className={`text-2xl font-bold font-mono tabular-nums ${amiStatusMeta.textClass}`}>
            {isLoading
              ? '—'
              : latest?.ami.connected && latest.ami.latencyMs !== null
              ? `${latest.ami.latencyMs} ms`
              : 'Offline'}
          </div>
          <div className="mt-2 text-[11px] text-slate-400 font-mono tabular-nums">
            {amiStats.avg !== null
              ? `Prom ${amiStats.avg} ms · Máx ${amiStats.max} ms · Mín ${amiStats.min} ms`
              : `Host ${latest?.ami.asteriskHost || '127.0.0.1'}:5038`}
          </div>
        </div>

        {/* KPI 4: Runtime & Uptime */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-purple-400" />
              <span>Uptime & Tráfico</span>
            </span>
            <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 border border-slate-700">
              PID {latest?.host.pid ?? '—'}
            </span>
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-white">
            {latest ? formatUptime(latest.host.uptimeSec) : '—'}
          </div>
          <div className="mt-2 text-[11px] text-slate-400 font-mono tabular-nums flex items-center gap-2">
            <PhoneCall className="w-3 h-3 text-emerald-400 shrink-0" />
            <span>
              {latest
                ? `${latest.asteriskRuntime.activeCalls} activas · ${latest.asteriskRuntime.capturedOtps} OTPs · Swap ${latest.memory.swapUsedMb} MB`
                : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Chart 1: CPU Load % */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between gap-2 mb-4">
            <div>
              <h3 className="text-sm font-bold text-white">Carga de CPU en Tiempo Real (%)</h3>
              <p className="text-xs text-slate-400 font-mono tabular-nums">
                {latest ? `${latest.cpu.model} · Umbral alerta 80%` : 'Esperando muestras...'}
              </p>
            </div>
            <span className="text-xs font-mono tabular-nums text-emerald-400 font-semibold">
              {samples.length}/{MAX_SAMPLES} pts
            </span>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={samples} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="cpuAreaGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(148, 163, 184, 0.14)" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="timeLabel"
                  tick={{ fill: '#64748b', fontSize: 11 }}
                  axisLine={{ stroke: 'rgba(148, 163, 184, 0.2)' }}
                  tickLine={false}
                  minTickGap={24}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fill: '#64748b', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  unit="%"
                />
                <Tooltip content={<TelemetryTooltip />} />
                <ReferenceLine y={80} stroke="#f59e0b" strokeDasharray="4 4" strokeOpacity={0.7} />
                <Area
                  type="monotone"
                  dataKey="cpuPercent"
                  name="CPU"
                  unit="%"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#cpuAreaGradient)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 2: RAM Usage */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between gap-2 mb-4">
            <div>
              <h3 className="text-sm font-bold text-white">Uso de Memoria RAM (MB)</h3>
              <p className="text-xs text-slate-400 font-mono tabular-nums">
                {latest
                  ? `RAM Sistema (Total ${latest.memory.totalMb} MB) vs Node RSS (${latest.memory.processRssMb} MB)`
                  : 'Esperando muestras...'}
              </p>
            </div>
            <span className="text-xs font-mono tabular-nums text-blue-400 font-semibold">
              {latest ? `${latest.memory.availableMb} MB libres` : '—'}
            </span>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={samples} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="ramAreaGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="nodeRssGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#a855f7" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(148, 163, 184, 0.14)" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="timeLabel"
                  tick={{ fill: '#64748b', fontSize: 11 }}
                  axisLine={{ stroke: 'rgba(148, 163, 184, 0.2)' }}
                  tickLine={false}
                  minTickGap={24}
                />
                <YAxis
                  domain={[0, latest?.memory.totalMb || 'auto']}
                  tick={{ fill: '#64748b', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<TelemetryTooltip />} />
                <Area
                  type="monotone"
                  dataKey="ramUsedMb"
                  name="RAM Usada"
                  unit=" MB"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  fill="url(#ramAreaGradient)"
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="nodeRssMb"
                  name="Node RSS"
                  unit=" MB"
                  stroke="#a855f7"
                  strokeWidth={2}
                  fill="url(#nodeRssGradient)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Chart 3: AMI Latency Full Width */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
          <div>
            <h3 className="text-sm font-bold text-white">Latencia Asterisk Manager Interface (AMI Ping RTT)</h3>
            <p className="text-xs text-slate-400 font-mono tabular-nums">
              {latest
                ? `Destino ${latest.ami.asteriskHost}:5038 · Intentos exitosos ${latest.ami.successfulAttempts}/${latest.ami.totalAttempts} · Umbral 100 ms`
                : 'Midiendo latencia TCP + Login + Action Ping...'}
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs font-mono tabular-nums">
            <span className="text-slate-400">
              Promedio: <strong className="text-cyan-400">{amiStats.avg !== null ? `${amiStats.avg} ms` : '—'}</strong>
            </span>
            <span className="text-slate-400">
              Pico: <strong className="text-white">{amiStats.max !== null ? `${amiStats.max} ms` : '—'}</strong>
            </span>
          </div>
        </div>
        <div className="h-60 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={samples} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
              <CartesianGrid stroke="rgba(148, 163, 184, 0.14)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="timeLabel"
                tick={{ fill: '#64748b', fontSize: 11 }}
                axisLine={{ stroke: 'rgba(148, 163, 184, 0.2)' }}
                tickLine={false}
                minTickGap={24}
              />
              <YAxis
                tick={{ fill: '#64748b', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                unit=" ms"
              />
              <Tooltip content={<TelemetryTooltip />} />
              <ReferenceLine y={100} stroke="#f59e0b" strokeDasharray="4 4" strokeOpacity={0.7} />
              <Line
                type="monotone"
                dataKey="amiLatencyMs"
                name="Latencia AMI"
                unit=" ms"
                stroke="#06b6d4"
                strokeWidth={2.2}
                dot={{ r: 2.5, fill: '#06b6d4' }}
                activeDot={{ r: 5 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent Telemetry Samples Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">Registro Reciente de Muestras</h3>
          <span className="text-xs font-mono text-slate-400 tabular-nums">
            Últimas {Math.min(10, samples.length)} lecturas (cada {intervalMs / 1000}s)
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 font-mono uppercase text-[11px]">
                <th className="py-2.5 px-4">Hora</th>
                <th className="py-2.5 px-4">CPU %</th>
                <th className="py-2.5 px-4">Load Avg (1m / 5m / 15m)</th>
                <th className="py-2.5 px-4">RAM Usada</th>
                <th className="py-2.5 px-4">Node RSS</th>
                <th className="py-2.5 px-4">Latencia AMI</th>
                <th className="py-2.5 px-4">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 font-mono tabular-nums">
              {samples.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-slate-400">
                    {isLoading ? 'Cargando primeras muestras...' : 'Sin muestras en memoria.'}
                  </td>
                </tr>
              ) : (
                [...samples]
                  .reverse()
                  .slice(0, 10)
                  .map((row) => (
                    <tr key={row.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-2 px-4 text-slate-300">{row.timeLabel}</td>
                      <td className="py-2 px-4 font-semibold text-white">{row.cpuPercent.toFixed(1)}%</td>
                      <td className="py-2 px-4 text-slate-300">
                        {row.load1m} / {row.load5m} / {row.load15m}
                      </td>
                      <td className="py-2 px-4 text-slate-300">
                        {row.ramUsedMb} MB ({row.ramPercent.toFixed(1)}%)
                      </td>
                      <td className="py-2 px-4 text-slate-300">{row.nodeRssMb} MB</td>
                      <td className="py-2 px-4 text-cyan-400 font-semibold">
                        {row.amiConnected && row.amiLatencyMs !== null ? `${row.amiLatencyMs} ms` : '—'}
                      </td>
                      <td className="py-2 px-4">
                        {row.amiConnected ? (
                          <span className="inline-flex items-center gap-1 text-emerald-400">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>AMI OK</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-rose-400">
                            <WifiOff className="w-3.5 h-3.5" />
                            <span>Offline</span>
                          </span>
                        )}
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
