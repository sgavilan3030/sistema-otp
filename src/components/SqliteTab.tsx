import React, { useState } from 'react';
import {
  Database,
  Search,
  Plus,
  Trash2,
  Terminal,
  FileCode,
  CheckCircle2,
  Copy,
  Clock,
  UserCheck,
  ShieldCheck,
  Play,
  RotateCcw,
  Sparkles,
  Layers,
  ArrowRight,
} from 'lucide-react';
import { AstDbEntry, SqliteCdrRecord, PjsipExtension, CarrierTrunk, AsteriskConnectionSettings } from '../types';

interface SqliteTabProps {
  astDbEntries: AstDbEntry[];
  onAddAstDbEntry: (entry: AstDbEntry) => void;
  onDeleteAstDbEntry: (id: string) => void;
  cdrRecords: SqliteCdrRecord[];
  extensions: PjsipExtension[];
  carriers: CarrierTrunk[];
  settings: AsteriskConnectionSettings;
  onExecuteCommand: (cmd: string) => void;
}

export const SqliteTab: React.FC<SqliteTabProps> = ({
  astDbEntries,
  onAddAstDbEntry,
  onDeleteAstDbEntry,
  cdrRecords,
  extensions,
  carriers,
  settings,
  onExecuteCommand,
}) => {
  const [activeSection, setActiveSection] = useState<'astdb' | 'realtime' | 'cdr' | 'cli'>('astdb');
  const [familyFilter, setFamilyFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [copied, setCopied] = useState(false);

  // New AstDB entry form state
  const [isAddingEntry, setIsAddingEntry] = useState(false);
  const [newFamily, setNewFamily] = useState('originating_agent');
  const [newKey, setNewKey] = useState('+18005550999');
  const [newValue, setNewValue] = useState('1001');
  const [newDesc, setNewDesc] = useState('Asociación de llamada saliente a agente');

  // AstDB Dialplan simulation state
  const [simFamily, setSimFamily] = useState('originating_agent');
  const [simKey, setSimKey] = useState('+18005550199');
  const [simResult, setSimResult] = useState<string | null>(null);

  // CLI execution state
  const [customCommand, setCustomCommand] = useState('database show originating_agent');
  const [cliOutput, setCliOutput] = useState<string>(
    '/originating_agent/+18005550199: 1001\n/originating_agent/+541140001234: 1002\n2 results found.'
  );

  const filteredAstDb = astDbEntries.filter((item) => {
    const matchesFamily = familyFilter === 'all' || item.family === familyFilter;
    const matchesSearch =
      item.key.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.value.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.family.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesFamily && matchesSearch;
  });

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSimulateDbLookup = () => {
    const found = astDbEntries.find((e) => e.family === simFamily && e.key === simKey);
    if (found) {
      setSimResult(
        `SUCCESS: \${DB(${simFamily}/${simKey})} -> "${found.value}" (Actualizado: ${found.updatedAt})`
      );
    } else {
      setSimResult(`NULL: No se encontró la clave "${simKey}" en la familia "${simFamily}".`);
    }
  };

  const handleSaveNewEntry = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFamily || !newKey || !newValue) return;

    const entry: AstDbEntry = {
      id: `astdb-${Date.now()}`,
      family: newFamily.trim(),
      key: newKey.trim(),
      value: newValue.trim(),
      updatedAt: 'Recién agregado',
      description: newDesc.trim() || undefined,
    };

    onAddAstDbEntry(entry);
    onExecuteCommand(`database put ${entry.family} ${entry.key} ${entry.value}`);
    setIsAddingEntry(false);
    setNewKey('');
    setNewValue('');
    setNewDesc('');
  };

  const handleRunCli = (cmdToRun?: string) => {
    const cmd = cmdToRun || customCommand;
    if (!cmd) return;

    if (cmd.startsWith('database show')) {
      const parts = cmd.split(' ');
      const fam = parts[2];
      const items = fam ? astDbEntries.filter((e) => e.family === fam) : astDbEntries;
      const formatted = items.map((i) => `/${i.family}/${i.key}: ${i.value}`).join('\n');
      setCliOutput(formatted ? `${formatted}\n\n${items.length} results found.` : '0 results found.');
    } else if (cmd.startsWith('sqlite3') && cmd.includes('astdb')) {
      setCliOutput(
        `SQLite3 AstDB Engine (/var/lib/asterisk/astdb.sqlite3):\n` +
          astDbEntries.map((i) => `INSERT OR REPLACE INTO astdb VALUES ('/${i.family}/${i.key}', '${i.value}');`).join('\n')
      );
    } else if (cmd.startsWith('sqlite3') && cmd.includes('cdr')) {
      setCliOutput(
        `SQLite3 CDR Query (/var/log/asterisk/master.db):\n` +
          `id | calldate            | src          | dst | agent | duration | disp     | otp\n` +
          `------------------------------------------------------------------------------------\n` +
          cdrRecords
            .map(
              (c) =>
                `${c.id} | ${c.calldate} | ${c.src.padEnd(12)} | ${c.dst} | ${c.originatingAgent || 'N/A'}  | ${String(c.duration).padStart(4)}s   | ${c.disposition.padEnd(8)} | ${c.otpStatus || 'N/A'}`
            )
            .join('\n')
      );
    } else {
      setCliOutput(`Asterisk 20 CLI: Comando "${cmd}" ejecutado exitosamente vía AMI.`);
    }

    onExecuteCommand(cmd);
  };

  // SQLite3 Realtime DDL generator
  const realtimeSql = `-- ==============================================================================
-- SCHEMA REALTIME SQLITE3 PARA ASTERISK 20 (PJSIP + AstDB)
-- Archivo: /var/lib/asterisk/realtime.sqlite3
-- ==============================================================================

-- 1. Tabla de Endpoints PJSIP
CREATE TABLE IF NOT EXISTS ps_endpoints (
    id TEXT PRIMARY KEY,
    transport TEXT,
    aors TEXT,
    auth TEXT,
    context TEXT,
    disallow TEXT,
    allow TEXT,
    direct_media TEXT DEFAULT 'no',
    callerid TEXT
);

-- 2. Tabla de Autenticaciones SIP
CREATE TABLE IF NOT EXISTS ps_auths (
    id TEXT PRIMARY KEY,
    auth_type TEXT DEFAULT 'userpass',
    password TEXT,
    username TEXT
);

-- 3. Tabla de Address of Record (AORs)
CREATE TABLE IF NOT EXISTS ps_aors (
    id TEXT PRIMARY KEY,
    max_contacts INTEGER DEFAULT 2,
    remove_existing TEXT DEFAULT 'yes',
    qualify_frequency INTEGER DEFAULT 60
);

-- 4. Inserción de Extensiones Configuradas en el Sistema (>= 1001)
${extensions
  .map(
    (e) => `INSERT OR REPLACE INTO ps_endpoints (id, transport, aors, auth, context, disallow, allow, direct_media, callerid)
VALUES ('${e.extension}', '${e.transport}', '${e.extension}-aor', '${e.extension}-auth', '${e.context}', 'all', '${e.codecs.join(',')}', 'no', '${e.callerId}');

INSERT OR REPLACE INTO ps_auths (id, auth_type, password, username)
VALUES ('${e.extension}-auth', 'userpass', '${e.secret}', '${e.extension}');

INSERT OR REPLACE INTO ps_aors (id, max_contacts, remove_existing, qualify_frequency)
VALUES ('${e.extension}-aor', ${e.maxContacts}, 'yes', 60);`
  )
  .join('\n\n')}
`;

  return (
    <div className="space-y-6">
      {/* Top Banner: Native SQLite3 Architecture */}
      <div className="rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900 to-indigo-950/40 border border-indigo-500/30 p-5 shadow-xl relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start space-x-3.5">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 shrink-0">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold text-white">
                  Motor de Base de Datos Nativo SQLite3 en Asterisk 20
                </h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-bold">
                  AstDB &bull; Realtime PJSIP &bull; CDR SQLite3
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-1 max-w-2xl leading-relaxed">
                Asterisk 20 almacena de forma nativa en SQLite3 su base interna de claves y valores (
                <code className="text-amber-300 font-mono">/var/lib/asterisk/astdb.sqlite3</code>). Esta persistencia
                local es la base sobre la cual opera el retorno de llamadas Press 1 al agente originador y el registro seguro de transacciones OTP.
              </p>
            </div>
          </div>

          {/* Quick Database Paths Pill */}
          <div className="flex flex-col gap-1.5 text-[11px] font-mono bg-slate-950/70 p-3 rounded-xl border border-slate-800">
            <div className="flex items-center justify-between gap-3 text-slate-300">
              <span className="text-slate-400">AstDB Nativa:</span>
              <span className="text-amber-400 font-semibold">{settings.sqliteAstDbPath}</span>
            </div>
            <div className="flex items-center justify-between gap-3 text-slate-300">
              <span className="text-slate-400">PJSIP Realtime:</span>
              <span className="text-blue-400 font-semibold">{settings.sqliteRealtimeDbPath}</span>
            </div>
            <div className="flex items-center justify-between gap-3 text-slate-300">
              <span className="text-slate-400">CDR Historial:</span>
              <span className="text-emerald-400 font-semibold">{settings.sqliteCdrDbPath}</span>
            </div>
          </div>
        </div>

        {/* Section Navigation Tabs */}
        <div className="flex flex-wrap gap-2 mt-5 pt-4 border-t border-slate-800/80">
          <button
            onClick={() => setActiveSection('astdb')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-2 transition-all ${
              activeSection === 'astdb'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
            }`}
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span>1. AstDB Clave-Valor (Retorno de Agente &amp; OTP)</span>
          </button>

          <button
            onClick={() => setActiveSection('realtime')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-2 transition-all ${
              activeSection === 'realtime'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>2. PJSIP Realtime SQLite3 (DDL &amp; Tablas)</span>
          </button>

          <button
            onClick={() => setActiveSection('cdr')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-2 transition-all ${
              activeSection === 'cdr'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>3. CDR Nativo SQLite3 (Registro de Llamadas)</span>
          </button>

          <button
            onClick={() => setActiveSection('cli')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-2 transition-all ${
              activeSection === 'cli'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>4. Consola CLI SQLite3 / AMI</span>
          </button>
        </div>
      </div>

      {/* SECTION 1: AstDB KEY-VALUE MANAGEMENT */}
      {activeSection === 'astdb' && (
        <div className="space-y-5">
          {/* Dialplan DB() Simulator Card */}
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span>Simulador de Evaluación Dialplan: Función {'${DB(family/key)}'}</span>
              </span>
              <span className="text-[11px] text-slate-400 font-mono">
                Consulta directa en astdb.sqlite3
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800 text-xs">
                <span className="text-slate-400 mr-1 font-mono">${'{'}DB(</span>
                <select
                  value={simFamily}
                  onChange={(e) => setSimFamily(e.target.value)}
                  className="bg-transparent text-amber-300 font-mono font-bold focus:outline-none"
                >
                  <option value="originating_agent" className="bg-slate-900">originating_agent</option>
                  <option value="otp_session" className="bg-slate-900">otp_session</option>
                  <option value="otp_verified" className="bg-slate-900">otp_verified</option>
                  <option value="agent_status" className="bg-slate-900">agent_status</option>
                  <option value="blacklist" className="bg-slate-900">blacklist</option>
                </select>
                <span className="text-slate-400 mx-1 font-mono">/</span>
                <input
                  type="text"
                  value={simKey}
                  onChange={(e) => setSimKey(e.target.value)}
                  className="bg-transparent text-white font-mono w-32 focus:outline-none"
                  placeholder="número/id"
                />
                <span className="text-slate-400 font-mono">){'}'}</span>
              </div>

              <button
                onClick={handleSimulateDbLookup}
                className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-all shadow-sm"
              >
                Consultar AstDB
              </button>
            </div>

            {simResult && (
              <div
                className={`p-2.5 rounded-lg text-xs font-mono ${
                  simResult.startsWith('SUCCESS')
                    ? 'bg-emerald-950/40 border border-emerald-500/30 text-emerald-300'
                    : 'bg-rose-950/40 border border-rose-500/30 text-rose-300'
                }`}
              >
                {simResult}
              </div>
            )}
          </div>

          {/* AstDB Entries Table & Controls */}
          <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden shadow-lg">
            <div className="p-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-slate-950/40">
              <div className="flex items-center space-x-2">
                <Database className="w-4 h-4 text-indigo-400" />
                <h3 className="font-bold text-white text-sm">
                  Registros AstDB ({filteredAstDb.length} llaves activas)
                </h3>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Family Filter */}
                <select
                  value={familyFilter}
                  onChange={(e) => setFamilyFilter(e.target.value)}
                  className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-slate-200 focus:outline-none"
                >
                  <option value="all">Todas las Familias</option>
                  <option value="originating_agent">originating_agent (Retorno Press 1)</option>
                  <option value="otp_session">otp_session (Códigos en curso)</option>
                  <option value="otp_verified">otp_verified (Estados OTP)</option>
                  <option value="agent_status">agent_status (Disponibilidad)</option>
                  <option value="blacklist">blacklist (Bloqueos)</option>
                </select>

                {/* Search Bar */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Buscar clave o valor..."
                    className="bg-slate-900 border border-slate-800 rounded-lg pl-8 pr-3 py-1 text-xs text-white placeholder-slate-500 focus:outline-none"
                  />
                </div>

                <button
                  onClick={() => setIsAddingEntry(!isAddingEntry)}
                  className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Nueva Llave (database put)</span>
                </button>
              </div>
            </div>

            {/* Add Entry Form Modal/Dropdown */}
            {isAddingEntry && (
              <form
                onSubmit={handleSaveNewEntry}
                className="p-4 bg-slate-950 border-b border-slate-800 space-y-3"
              >
                <div className="text-xs font-bold text-white flex items-center gap-2">
                  <Terminal className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Insertar Registro en AstDB SQLite3: <code>database put &lt;family&gt; &lt;key&gt; &lt;value&gt;</code></span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Familia (Family)</label>
                    <input
                      type="text"
                      value={newFamily}
                      onChange={(e) => setNewFamily(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-amber-300 font-mono"
                      placeholder="ej. originating_agent"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Clave (Key)</label>
                    <input
                      type="text"
                      value={newKey}
                      onChange={(e) => setNewKey(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono"
                      placeholder="ej. +18005550199"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Valor (Value)</label>
                    <input
                      type="text"
                      value={newValue}
                      onChange={(e) => setNewValue(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-emerald-400 font-mono"
                      placeholder="ej. 1001"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Descripción / Propósito</label>
                  <input
                    type="text"
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-slate-300"
                    placeholder="ej. Extensión asignada para retorno"
                  />
                </div>

                <div className="flex justify-end space-x-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setIsAddingEntry(false)}
                    className="px-3 py-1 rounded-lg bg-slate-800 text-slate-400 hover:text-white text-xs"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-sm"
                  >
                    Ejecutar "database put"
                  </button>
                </div>
              </form>
            )}

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/70 border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="py-2.5 px-4 font-semibold">Familia / Subárbol</th>
                    <th className="py-2.5 px-4 font-semibold">Clave (Key)</th>
                    <th className="py-2.5 px-4 font-semibold">Valor Almacenado</th>
                    <th className="py-2.5 px-4 font-semibold">Propósito / Descripción</th>
                    <th className="py-2.5 px-4 font-semibold">Actualizado</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredAstDb.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500">
                        No se encontraron registros en AstDB con los filtros seleccionados.
                      </td>
                    </tr>
                  ) : (
                    filteredAstDb.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-amber-400">
                          /{item.family}
                        </td>
                        <td className="py-3 px-4 font-mono font-medium text-white">
                          {item.key}
                        </td>
                        <td className="py-3 px-4 font-mono font-bold text-emerald-400">
                          {item.value}
                        </td>
                        <td className="py-3 px-4 text-slate-400 max-w-xs truncate">
                          {item.description || '—'}
                        </td>
                        <td className="py-3 px-4 text-slate-500 font-mono text-[11px]">
                          {item.updatedAt}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => {
                              onDeleteAstDbEntry(item.id);
                              onExecuteCommand(`database del ${item.family} ${item.key}`);
                            }}
                            className="p-1.5 rounded bg-slate-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-colors"
                            title={`Eliminar database del ${item.family} ${item.key}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 2: REALTIME PJSIP SQLITE3 */}
      {activeSection === 'realtime' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-white text-sm flex items-center gap-2">
                  <Layers className="w-4 h-4 text-blue-400" />
                  <span>Tablas Realtime en SQLite3 (/var/lib/asterisk/realtime.sqlite3)</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Esquema DDL completo compatible con <code className="text-blue-300">res_config_sqlite3</code> y <code className="text-blue-300">extconfig.conf</code>.
                </p>
              </div>

              <button
                onClick={() => handleCopy(realtimeSql)}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-all shadow-sm"
              >
                {copied ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copiado' : 'Copiar DDL SQL'}</span>
              </button>
            </div>

            <pre className="p-3.5 rounded-lg bg-slate-950 border border-slate-800 text-[11px] font-mono text-slate-300 overflow-x-auto max-h-96 leading-relaxed">
              {realtimeSql}
            </pre>
          </div>
        </div>
      )}

      {/* SECTION 3: CDR SQLITE3 */}
      {activeSection === 'cdr' && (
        <div className="space-y-4">
          <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden shadow-lg">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/40">
              <div className="flex items-center space-x-2">
                <Clock className="w-4 h-4 text-emerald-400" />
                <h3 className="font-bold text-white text-sm">
                  Call Detail Records (CDR) en SQLite3 (/var/log/asterisk/master.db)
                </h3>
              </div>
              <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 rounded-full">
                Módulo cdr_sqlite3_custom activo
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/70 border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="py-2.5 px-4 font-semibold">Fecha / Hora</th>
                    <th className="py-2.5 px-4 font-semibold">Origen (CallerID)</th>
                    <th className="py-2.5 px-4 font-semibold">Destino</th>
                    <th className="py-2.5 px-4 font-semibold">Agente Originador</th>
                    <th className="py-2.5 px-4 font-semibold">Duración</th>
                    <th className="py-2.5 px-4 font-semibold">Disposición</th>
                    <th className="py-2.5 px-4 font-semibold">Código OTP</th>
                    <th className="py-2.5 px-4 font-semibold">Estado OTP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {cdrRecords.map((cdr) => (
                    <tr key={cdr.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3 px-4 text-slate-300">{cdr.calldate}</td>
                      <td className="py-3 px-4 font-bold text-white">{cdr.src}</td>
                      <td className="py-3 px-4 text-blue-400">{cdr.dst}</td>
                      <td className="py-3 px-4">
                        {cdr.originatingAgent ? (
                          <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[11px] font-bold">
                            Ext {cdr.originatingAgent}
                          </span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-300">
                        {cdr.duration}s ({cdr.billsec}s facturable)
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            cdr.disposition === 'ANSWERED'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                          }`}
                        >
                          {cdr.disposition}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-300">{cdr.otpCode || '—'}</td>
                      <td className="py-3 px-4">
                        {cdr.otpStatus === 'VERIFIED' && (
                          <span className="text-emerald-400 font-bold flex items-center gap-1 text-[11px]">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            VERIFICADO
                          </span>
                        )}
                        {cdr.otpStatus === 'FAILED' && (
                          <span className="text-rose-400 font-bold text-[11px]">RECHAZADO</span>
                        )}
                        {cdr.otpStatus === 'SKIPPED' && (
                          <span className="text-slate-500 text-[11px]">NO APLICA</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 4: CLI CONSOLE SQLITE3 & AMI */}
      {activeSection === 'cli' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                <Terminal className="w-4 h-4 text-indigo-400" />
                <span>Consola Interactiva AstDB &amp; SQLite3 (Asterisk 20 CLI / AMI)</span>
              </span>
              <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                AMI Port {settings.amiPort} Connected
              </span>
            </div>

            {/* Quick Command Presets */}
            <div className="flex flex-wrap gap-1.5 text-xs font-mono">
              <button
                onClick={() => {
                  setCustomCommand('database show originating_agent');
                  handleRunCli('database show originating_agent');
                }}
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700"
              >
                database show originating_agent
              </button>
              <button
                onClick={() => {
                  setCustomCommand('database show otp_session');
                  handleRunCli('database show otp_session');
                }}
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-blue-300 border border-slate-700"
              >
                database show otp_session
              </button>
              <button
                onClick={() => {
                  setCustomCommand('database show');
                  handleRunCli('database show');
                }}
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
              >
                database show (Todo AstDB)
              </button>
              <button
                onClick={() => {
                  setCustomCommand('sqlite3 /var/lib/asterisk/astdb.sqlite3 "SELECT * FROM astdb;"');
                  handleRunCli('sqlite3 /var/lib/asterisk/astdb.sqlite3 "SELECT * FROM astdb;"');
                }}
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700"
              >
                sqlite3 astdb.sqlite3 query
              </button>
              <button
                onClick={() => {
                  setCustomCommand('sqlite3 /var/log/asterisk/master.db "SELECT * FROM cdr;"');
                  handleRunCli('sqlite3 /var/log/asterisk/master.db "SELECT * FROM cdr;"');
                }}
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-purple-300 border border-slate-700"
              >
                sqlite3 cdr query
              </button>
            </div>

            {/* Input Bar */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={customCommand}
                onChange={(e) => setCustomCommand(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRunCli();
                }}
                placeholder="Escribe comando Asterisk CLI o sqlite3..."
                className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
              />
              <button
                onClick={() => handleRunCli()}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition-all shadow-sm flex items-center gap-1.5"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Ejecutar</span>
              </button>
            </div>

            {/* Output Display */}
            <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800 font-mono text-xs text-slate-300 max-h-72 overflow-y-auto whitespace-pre-wrap leading-relaxed">
              {cliOutput}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
