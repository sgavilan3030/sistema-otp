import React, { useState } from 'react';
import { Copy, Check, Sparkles, Sliders, Shield, Zap, RefreshCw, Cpu, Layers } from 'lucide-react';
import { generateMasterPrompt } from '../data/masterPrompt';

interface PromptMaestroTabProps {
  amiPort: number;
  ariPort: number;
  otpDigits: number;
  webhookUrl: string;
}

export const PromptMaestroTab: React.FC<PromptMaestroTabProps> = ({
  amiPort: initialAmiPort,
  ariPort: initialAriPort,
  otpDigits: initialOtpDigits,
  webhookUrl: initialWebhookUrl,
}) => {
  const [amiPort, setAmiPort] = useState(initialAmiPort);
  const [ariPort, setAriPort] = useState(initialAriPort);
  const [otpDigits, setOtpDigits] = useState<number>(initialOtpDigits);
  const [webhookUrl, setWebhookUrl] = useState(initialWebhookUrl);
  const [syncStrategy, setSyncStrategy] = useState('Híbrida (AMI Reload + ARI Stasis)');
  const [copied, setCopied] = useState(false);

  const promptText = generateMasterPrompt({
    amiPort,
    ariPort,
    otpDigits,
    webhookUrl,
    syncStrategy,
  });

  const handleCopy = () => {
    navigator.clipboard.writeText(promptText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner explaining the architecture decision */}
      <div className="p-5 rounded-xl bg-gradient-to-r from-slate-900 via-slate-900 to-emerald-950/40 border border-emerald-500/30">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center space-x-2">
              <span className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400">
                <Sparkles className="w-5 h-5" />
              </span>
              <h2 className="text-xl font-bold text-white tracking-tight">
                Prompt Maestro para Gobernar Asterisk 20
              </h2>
            </div>
            <p className="text-sm text-slate-300 max-w-3xl">
              Diseñado para ser utilizado como <span className="text-emerald-400 font-semibold">System Prompt</span> en
              modelos de IA (ChatGPT, Claude, Cursor o tu propio Agente autónomo). Implementa el protocolo
              óptimo de conexión a Asterisk 20 combinando <span className="text-emerald-400 font-semibold">AMI</span> para
              recargas en caliente (0 caídas) y <span className="text-blue-400 font-semibold">ARI (Stasis)</span> para
              captura en tiempo real de DTMF y verificación de OTP.
            </p>
          </div>

          <button
            id="btn-copy-master-prompt"
            onClick={handleCopy}
            className={`flex items-center justify-center space-x-2 px-5 py-3 rounded-lg font-bold text-sm shadow-lg transition-all ${
              copied
                ? 'bg-emerald-600 text-white shadow-emerald-500/20'
                : 'bg-emerald-500 hover:bg-emerald-400 text-black shadow-emerald-500/20'
            }`}
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            <span>{copied ? '¡Copiado al Portapapeles!' : 'Copiar Prompt Maestro'}</span>
          </button>
        </div>

        {/* 3 Architecture Pillar Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-5 pt-4 border-t border-slate-800/80">
          <div className="p-3.5 rounded-lg bg-slate-950/70 border border-slate-800">
            <div className="flex items-center space-x-2 text-emerald-400 font-semibold text-xs mb-1">
              <Zap className="w-4 h-4" />
              <span>AMI (Puerto {amiPort}) - Sincronismo Inmediato</span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Ejecuta <code className="text-emerald-300">Action: Command</code> con <code className="text-emerald-300">pjsip reload</code> cada vez que creas o editas extensiones y carriers. No reinicia Asterisk y sincroniza en &lt;50ms.
            </p>
          </div>

          <div className="p-3.5 rounded-lg bg-slate-950/70 border border-slate-800">
            <div className="flex items-center space-x-2 text-blue-400 font-semibold text-xs mb-1">
              <Cpu className="w-4 h-4" />
              <span>ARI (Puerto {ariPort}) - IVR Press 1 &amp; OTP</span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Escucha eventos <code className="text-blue-300">ChannelDtmfReceived</code> en streaming, almacena los {otpDigits} dígitos y valida contra tu API/Webhook sin scripts de dialplan frágiles.
            </p>
          </div>

          <div className="p-3.5 rounded-lg bg-slate-950/70 border border-slate-800">
            <div className="flex items-center space-x-2 text-purple-400 font-semibold text-xs mb-1">
              <Layers className="w-4 h-4" />
              <span>PJSIP Modular (res_pjsip)</span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Separa endpoint, auth, aor e identify. Compatible con WebRTC (WSS), UDP y troncales IP directas o con autenticación por credenciales.
            </p>
          </div>
        </div>
      </div>

      {/* Prompt Customization Controls */}
      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
        <div className="flex items-center space-x-2 mb-3">
          <Sliders className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-semibold text-white">Personalizar Parámetros del Prompt</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div>
            <label className="block text-slate-400 mb-1 font-medium">Puerto AMI (Manager)</label>
            <input
              type="number"
              value={amiPort}
              onChange={(e) => setAmiPort(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-white font-mono focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1 font-medium">Puerto ARI (REST/WS)</label>
            <input
              type="number"
              value={ariPort}
              onChange={(e) => setAriPort(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-white font-mono focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1 font-medium">Dígitos OTP a Capturar</label>
            <select
              value={otpDigits}
              onChange={(e) => setOtpDigits(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-white focus:border-emerald-500 focus:outline-none"
            >
              <option value={4}>4 Dígitos (Básico)</option>
              <option value={6}>6 Dígitos (Estándar Bancario)</option>
              <option value={8}>8 Dígitos (Alta Seguridad)</option>
            </select>
          </div>

          <div>
            <label className="block text-slate-400 mb-1 font-medium">Estrategia de Sincronismo</label>
            <select
              value={syncStrategy}
              onChange={(e) => setSyncStrategy(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-white focus:border-emerald-500 focus:outline-none"
            >
              <option value="Híbrida (AMI Reload + ARI Stasis)">Híbrida: AMI Reload + ARI (Óptima)</option>
              <option value="Pura AMI con Dialplan Read()">Pura AMI con Dialplan nativo</option>
              <option value="Pura ARI Stasis Full-Stack">Pura ARI Stasis Full-Stack</option>
            </select>
          </div>

          <div className="sm:col-span-2 lg:col-span-4">
            <label className="block text-slate-400 mb-1 font-medium">Webhook URL para Validar OTP</label>
            <input
              type="url"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-white font-mono focus:border-emerald-500 focus:outline-none"
              placeholder="https://api.tuempresa.com/v1/telephony/verify-otp"
            />
          </div>
        </div>
      </div>

      {/* Code / Markdown View of the Master Prompt */}
      <div className="rounded-xl bg-slate-950 border border-slate-800 overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900 border-b border-slate-800">
          <div className="flex items-center space-x-2">
            <div className="flex space-x-1.5">
              <div className="w-3 h-3 rounded-full bg-slate-700"></div>
              <div className="w-3 h-3 rounded-full bg-slate-600"></div>
              <div className="w-3 h-3 rounded-full bg-emerald-500/80"></div>
            </div>
            <span className="text-xs font-mono text-slate-400 pl-2">
              asterisk20_master_governor_prompt.md
            </span>
          </div>

          <button
            onClick={handleCopy}
            className="flex items-center space-x-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copiado' : 'Copiar'}</span>
          </button>
        </div>

        <div className="p-4 sm:p-6 overflow-x-auto max-h-[600px] scrollbar-thin">
          <pre className="text-xs font-mono text-slate-200 leading-relaxed whitespace-pre-wrap selection:bg-emerald-500/30">
            {promptText}
          </pre>
        </div>
      </div>
    </div>
  );
};
