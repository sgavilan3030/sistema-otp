import React, { useState } from 'react';
import { PjsipExtension, CarrierTrunk, Press1Config, OtpCaptureConfig, AsteriskConnectionSettings } from '../types';
import {
  generatePjsipConf,
  generateSipConf,
  generateExtensionsConf,
  generateManagerConf,
  generateAriConf,
  generateAriNodeDaemon,
  generateSetupScript,
  generateResConfigSqliteConf,
  generateExtconfigConf,
  generateCdrSqliteConf,
  generateSqliteSchema,
  generateNginxDomainConf,
} from '../data/configFilesGenerator';
import { Copy, Check, Download, FileCode, Server, Terminal, Cpu, Database, Globe, Shield } from 'lucide-react';

interface ConfigExporterTabProps {
  extensions: PjsipExtension[];
  carriers: CarrierTrunk[];
  press1: Press1Config;
  otp: OtpCaptureConfig;
  settings: AsteriskConnectionSettings;
}

export const ConfigExporterTab: React.FC<ConfigExporterTabProps> = ({
  extensions,
  carriers,
  press1,
  otp,
  settings,
}) => {
  const [activeFile, setActiveFile] = useState<
    | 'sip'
    | 'pjsip'
    | 'extensions'
    | 'manager'
    | 'ari'
    | 'daemon'
    | 'nginx'
    | 'sqlite_res'
    | 'sqlite_ext'
    | 'sqlite_cdr'
    | 'sqlite_sql'
    | 'script'
  >('sip');
  const [copied, setCopied] = useState(false);

  const files = {
    sip: {
      name: 'sip.conf (Carriers)',
      path: '/etc/asterisk/sip.conf',
      icon: Globe,
      content: generateSipConf(carriers),
      lang: 'ini',
    },
    pjsip: {
      name: 'pjsip.conf',
      path: '/etc/asterisk/pjsip.conf',
      icon: Server,
      content: generatePjsipConf(extensions, carriers),
      lang: 'ini',
    },
    extensions: {
      name: 'extensions.conf',
      path: '/etc/asterisk/extensions.conf',
      icon: FileCode,
      content: generateExtensionsConf(press1, otp, extensions, carriers),
      lang: 'ini',
    },
    manager: {
      name: 'manager.conf',
      path: '/etc/asterisk/manager.conf',
      icon: Terminal,
      content: generateManagerConf(settings),
      lang: 'ini',
    },
    ari: {
      name: 'ari.conf & http.conf',
      path: '/etc/asterisk/ari.conf',
      icon: Terminal,
      content: generateAriConf(settings),
      lang: 'ini',
    },
    daemon: {
      name: 'otp_ari_service.js',
      path: '/opt/asterisk-governor/otp_ari_service.js',
      icon: Cpu,
      content: generateAriNodeDaemon(settings, otp, press1),
      lang: 'javascript',
    },
    nginx: {
      name: 'anonymousotp.online.conf (NGINX)',
      path: '/etc/nginx/sites-available/anonymousotp.online.conf',
      icon: Shield,
      content: generateNginxDomainConf(settings),
      lang: 'nginx',
    },
    sqlite_res: {
      name: 'res_config_sqlite3.conf',
      path: '/etc/asterisk/res_config_sqlite3.conf',
      icon: Database,
      content: generateResConfigSqliteConf(settings),
      lang: 'ini',
    },
    sqlite_ext: {
      name: 'extconfig.conf',
      path: '/etc/asterisk/extconfig.conf',
      icon: Database,
      content: generateExtconfigConf(),
      lang: 'ini',
    },
    sqlite_cdr: {
      name: 'cdr_sqlite3_custom.conf',
      path: '/etc/asterisk/cdr_sqlite3_custom.conf',
      icon: Database,
      content: generateCdrSqliteConf(settings),
      lang: 'ini',
    },
    sqlite_sql: {
      name: 'schema_sqlite3.sql',
      path: '/etc/asterisk/schema_sqlite3.sql',
      icon: Database,
      content: generateSqliteSchema(extensions),
      lang: 'sql',
    },
    script: {
      name: 'setup_asterisk20.sh',
      path: './setup_asterisk20.sh',
      icon: Terminal,
      content: generateSetupScript(),
      lang: 'bash',
    },
  };

  const currentFile = files[activeFile];

  const handleCopy = () => {
    navigator.clipboard.writeText(currentFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([currentFile.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = currentFile.name;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <FileCode className="w-5 h-5 text-amber-400" />
            <span>Archivos de Configuración Listos para Despliegue</span>
          </h2>
          <p className="text-sm text-slate-400">
            Generados en base a tus extensiones, carriers y flujos configurados. Puedes copiarlos o descargarlos directamente a tu servidor Asterisk 20.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={handleCopy}
            className={`inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all ${
              copied
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
            }`}
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            <span>{copied ? '¡Copiado!' : 'Copiar Archivo'}</span>
          </button>

          <button
            onClick={handleDownload}
            className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-md shadow-amber-500/20 transition-all"
          >
            <Download className="w-4 h-4" />
            <span>Descargar {currentFile.name}</span>
          </button>
        </div>
      </div>

      {/* File Selector Tabs */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(files).map(([key, file]) => {
          const Icon = file.icon;
          const isActive = activeFile === key;
          return (
            <button
              key={key}
              onClick={() => setActiveFile(key as any)}
              className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-all ${
                isActive
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50 shadow-sm'
                  : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{file.name}</span>
            </button>
          );
        })}
      </div>

      {/* Code Editor Frame */}
      <div className="rounded-xl bg-slate-950 border border-slate-800 overflow-hidden shadow-2xl">
        <div className="px-4 py-2.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="text-slate-500 text-xs font-mono">Destino en Servidor:</span>
            <span className="text-amber-400 text-xs font-mono font-semibold">
              {currentFile.path}
            </span>
          </div>
          <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400">
            {currentFile.lang}
          </span>
        </div>

        <div className="p-4 sm:p-6 overflow-x-auto max-h-[550px] scrollbar-thin">
          <pre className="text-xs font-mono text-slate-200 leading-relaxed whitespace-pre selection:bg-amber-500/30">
            {currentFile.content}
          </pre>
        </div>
      </div>
    </div>
  );
};
