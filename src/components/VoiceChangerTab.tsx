import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Play,
  Square,
  CheckCircle2,
  Radio,
  Sliders,
  RefreshCw,
  PhoneCall,
  Languages,
  Headphones,
  Check,
  Copy,
  Zap,
  Info,
  Shield,
  Layers,
  ArrowRight,
  Send,
  MessageSquare,
  Activity,
  Award
} from 'lucide-react';
import { PjsipExtension, SystemUser, VoiceChangerProfile, VoiceChangerState } from '../types';
import {
  VOICE_PROFILES,
  INITIAL_VOICE_CHANGER_STATE,
  QUICK_SOUNDBOARD_PHRASES,
  QuickPhrase,
  realtimeVoiceChanger,
  speakFemaleVoice,
  getAvailableVoices
} from '../utils/voiceChangerEngine';

interface VoiceChangerTabProps {
  currentUser?: SystemUser;
  extensions?: PjsipExtension[];
  onTriggerSync?: () => void;
}

export const VoiceChangerTab: React.FC<VoiceChangerTabProps> = ({
  currentUser,
  extensions = [],
  onTriggerSync,
}) => {
  const [state, setState] = useState<VoiceChangerState>(() => {
    try {
      const saved = localStorage.getItem('ast20_voice_changer_state');
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return INITIAL_VOICE_CHANGER_STATE;
  });

  const [activeTabLang, setActiveTabLang] = useState<'es' | 'en'>(state.language || 'es');
  const [activeCategory, setActiveCategory] = useState<string>('Todos');
  const [customText, setCustomText] = useState<string>('');
  const [isSpeakingTts, setIsSpeakingTts] = useState<boolean>(false);
  const [micLevel, setMicLevel] = useState<number>(0);
  const [isMicRunning, setIsMicRunning] = useState<boolean>(false);
  const [isMonitorOn, setIsMonitorOn] = useState<boolean>(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [isSavingAsterisk, setIsSavingAsterisk] = useState<boolean>(false);
  const [diagLoading, setDiagLoading] = useState<boolean>(false);
  const [diagResult, setDiagResult] = useState<any>(null);

  const handleRunDiagnostic = async () => {
    setDiagLoading(true);
    try {
      const res = await fetch('/api/asterisk/voice-changer/diagnostic');
      const data = await res.json();
      setDiagResult(data);
    } catch (err: any) {
      setDiagResult({ success: false, message: 'Error consultando Asterisk: ' + err.message });
    } finally {
      setDiagLoading(false);
    }
  };

  // Selected extension for Asterisk AstDB pitch shift mapping
  const [selectedExt, setSelectedExt] = useState<string>(
    currentUser?.assignedExtensions?.[0] || '1001'
  );

  // Load voices from browser SpeechSynthesis
  useEffect(() => {
    getAvailableVoices().then((voices) => {
      setAvailableVoices(voices);
      if (!state.selectedTtsVoice && voices.length > 0) {
        // Find best female voice
        const femaleKeywords = ['female', 'monica', 'paulina', 'luciana', 'samantha', 'victoria', 'karen', 'zira', 'helena'];
        const found = voices.find((v) =>
          femaleKeywords.some((k) => v.name.toLowerCase().includes(k))
        );
        if (found) {
          setState((prev) => ({ ...prev, selectedTtsVoice: found.name }));
        }
      }
    });
  }, [state.selectedTtsVoice]);

  // Fetch backend Voice Changer state on mount
  useEffect(() => {
    fetch('/api/asterisk/voice-changer')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.settings) {
          setState((prev) => ({
            ...prev,
            enabled: data.settings.enabled ?? prev.enabled,
            activeProfileId: data.settings.activeProfileId || prev.activeProfileId,
            language: data.settings.language || prev.language,
          }));
        }
      })
      .catch(() => {});
  }, []);

  // Listen for voice-changer-updated custom event from Header or Manual Dialer
  useEffect(() => {
    const handleVoiceChangerUpdate = (e: any) => {
      if (e.detail && typeof e.detail.enabled === 'boolean') {
        setState((prev) => ({
          ...prev,
          enabled: e.detail.enabled,
          ...(e.detail.activeProfileId ? { activeProfileId: e.detail.activeProfileId } : {}),
        }));
      }
    };
    window.addEventListener('voice-changer-updated', handleVoiceChangerUpdate);
    return () => window.removeEventListener('voice-changer-updated', handleVoiceChangerUpdate);
  }, []);

  // Sync state to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('ast20_voice_changer_state', JSON.stringify(state));
    } catch (_) {}
  }, [state]);

  // Clean up mic DSP on unmount
  useEffect(() => {
    return () => {
      realtimeVoiceChanger.stop();
    };
  }, []);

  const currentProfile = VOICE_PROFILES.find((p) => p.id === state.activeProfileId) || VOICE_PROFILES[0];

  // Toggle master Voice Changer switch
  const handleToggleMaster = async (newVal?: boolean) => {
    const nextVal = newVal !== undefined ? newVal : !state.enabled;
    const nextState = { ...state, enabled: nextVal };
    setState(nextState);

    // Dispatch custom event to notify Header and Manual Dialer
    window.dispatchEvent(new CustomEvent('voice-changer-updated', { detail: nextState }));

    // If disabling, stop real-time mic DSP if running
    if (!nextVal && isMicRunning) {
      realtimeVoiceChanger.stop();
      setIsMicRunning(false);
      setIsMonitorOn(false);
      setMicLevel(0);
    }

    // Sync to backend & Asterisk AstDB
    try {
      setIsSavingAsterisk(true);
      const res = await fetch('/api/asterisk/voice-changer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: nextVal,
          activeProfileId: state.activeProfileId,
          language: state.language,
          pitchValue: currentProfile.asteriskPitchValue,
          extension: selectedExt,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSaveStatus(nextVal ? '✓ Modulador de voz activado en Asterisk' : '✓ Modulador desactivado en Asterisk');
        setTimeout(() => setSaveStatus(null), 3500);
      }
    } catch (err: any) {
      setSaveStatus('Error al sincronizar con Asterisk: ' + err.message);
      setTimeout(() => setSaveStatus(null), 4000);
    } finally {
      setIsSavingAsterisk(false);
    }
  };

  // Select a preset voice profile
  const handleSelectProfile = (profile: VoiceChangerProfile) => {
    const nextState: VoiceChangerState = {
      ...state,
      activeProfileId: profile.id,
      language: profile.language,
      customPitch: profile.pitchShiftSemi,
      customBassCut: profile.eqBassCut,
      customClarity: Math.round((profile.eqTrebleGain / 8) * 100),
      customReverb: profile.reverbAmount,
    };
    setState(nextState);
    setActiveTabLang(profile.language);

    // Update real-time audio engine if running
    if (isMicRunning) {
      realtimeVoiceChanger.updateParameters(nextState);
    }

    // Automatically sync to Asterisk if master is enabled
    if (state.enabled) {
      fetch('/api/asterisk/voice-changer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: true,
          activeProfileId: profile.id,
          language: profile.language,
          pitchValue: profile.asteriskPitchValue,
          extension: selectedExt,
        }),
      }).catch(() => {});
    }

    // Speak audio preview sample with natural female voice
    speakFemaleVoice(profile.sampleText, profile.language, {
      pitch: 1.35,
      rate: 1.0,
      onStart: () => setIsSpeakingTts(true),
      onEnd: () => setIsSpeakingTts(false),
    });
  };

  // Start / stop real-time microphone DSP test
  const handleToggleMic = async () => {
    setMicError(null);
    if (isMicRunning) {
      realtimeVoiceChanger.stop();
      setIsMicRunning(false);
      setIsMonitorOn(false);
      setMicLevel(0);
      return;
    }

    try {
      const ok = await realtimeVoiceChanger.start(state, (lvl) => {
        setMicLevel(lvl);
      });
      if (ok) {
        setIsMicRunning(true);
        // By default, turn monitor loopback on so operator can hear female voice
        realtimeVoiceChanger.setMonitor(true);
        setIsMonitorOn(true);
      } else {
        setMicError('No se pudo acceder al micrófono. Verifique los permisos del navegador.');
      }
    } catch (e: any) {
      setMicError('Error al iniciar micrófono: ' + e.message);
    }
  };

  // Toggle headphones loopback monitor
  const handleToggleMonitor = () => {
    const next = !isMonitorOn;
    realtimeVoiceChanger.setMonitor(next);
    setIsMonitorOn(next);
  };

  // Parameter sliders update
  const handlePitchChange = (newPitch: number) => {
    const next = { ...state, customPitch: newPitch };
    setState(next);
    if (isMicRunning) realtimeVoiceChanger.updateParameters(next);
  };

  const handleClarityChange = (newClarity: number) => {
    const next = { ...state, customClarity: newClarity };
    setState(next);
    if (isMicRunning) realtimeVoiceChanger.updateParameters(next);
  };

  const handleBassCutChange = (newCut: number) => {
    const next = { ...state, customBassCut: newCut };
    setState(next);
    if (isMicRunning) realtimeVoiceChanger.updateParameters(next);
  };

  const handleMicVolumeChange = (newVol: number) => {
    const next = { ...state, micVolume: newVol };
    setState(next);
    if (isMicRunning) realtimeVoiceChanger.updateParameters(next);
  };

  // Play a quick phrase via female TTS
  const handlePlayPhrase = (phrase: QuickPhrase) => {
    speakFemaleVoice(phrase.text, phrase.language, {
      pitch: state.ttsPitch,
      rate: state.ttsRate,
      voiceName: state.selectedTtsVoice,
      onStart: () => setIsSpeakingTts(true),
      onEnd: () => setIsSpeakingTts(false),
    });
  };

  // Speak custom typed text
  const handleSpeakCustom = () => {
    if (!customText.trim()) return;
    speakFemaleVoice(customText, activeTabLang, {
      pitch: state.ttsPitch,
      rate: state.ttsRate,
      voiceName: state.selectedTtsVoice,
      onStart: () => setIsSpeakingTts(true),
      onEnd: () => setIsSpeakingTts(false),
    });
  };

  const handleStopSpeech = () => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      setIsSpeakingTts(false);
    }
  };

  const handleCopyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Filter soundboard phrases
  const filteredPhrases = QUICK_SOUNDBOARD_PHRASES.filter((p) => {
    const matchLang = p.language === activeTabLang;
    const matchCat = activeCategory === 'Todos' || p.category === activeCategory;
    return matchLang && matchCat;
  });

  const categories = ['Todos', 'Bancario', 'Seguridad OTP', 'Espera', 'Éxito', 'General'];

  return (
    <div className="space-y-6 animate-fade-in text-slate-100">
      {/* HEADER BANNER */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-purple-950/60 via-slate-900 to-indigo-950/60 border border-purple-500/30 shadow-xl backdrop-blur-md flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-400 shadow-inner">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-white tracking-wide">
                  Cambiador de Voz en Tiempo Real (Voice Changer)
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-purple-500/20 text-purple-300 border border-purple-500/40">
                  Voz de Mujer • ES / EN
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                Modula la voz del operador a femenina natural en vivo tanto en micrófono web como en llamadas SIP/Asterisk 20.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-1 text-xs text-slate-400 flex-wrap">
            <span className="flex items-center gap-1.5 font-mono">
              <span className={`w-2 h-2 rounded-full ${state.enabled ? 'bg-emerald-400 animate-ping' : 'bg-slate-600'}`} />
              <span>Estado: <b className={state.enabled ? 'text-emerald-400' : 'text-slate-400'}>{state.enabled ? 'ACTIVO (Voz Modulada)' : 'INACTIVO (Voz Natural)'}</b></span>
            </span>
            <span>•</span>
            <span>Perfil: <b className="text-purple-300">{currentProfile.name}</b></span>
            <span>•</span>
            <span>Tono Asterisk: <b className="text-sky-300 font-mono">+{state.customPitch} st ({currentProfile.asteriskPitchValue}x)</b></span>
          </div>
        </div>

        {/* Master Switch Button */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => handleToggleMaster()}
            disabled={isSavingAsterisk}
            className={`px-5 py-3 rounded-xl font-bold text-sm flex items-center gap-2.5 transition-all shadow-lg cursor-pointer ${
              state.enabled
                ? 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 shadow-emerald-500/25 ring-2 ring-emerald-400/50'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 shadow-slate-950/50'
            }`}
          >
            {isSavingAsterisk ? (
              <RefreshCw className="w-5 h-5 animate-spin" />
            ) : state.enabled ? (
              <CheckCircle2 className="w-5 h-5 text-slate-950 fill-current" />
            ) : (
              <Radio className="w-5 h-5 text-slate-400" />
            )}
            <span>{state.enabled ? 'Voz de Mujer ACTIVADA' : 'Activar Modulador de Mujer'}</span>
          </button>
        </div>
      </div>

      {saveStatus && (
        <div className="p-3.5 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs font-semibold flex items-center gap-2 shadow-sm animate-fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{saveStatus}</span>
        </div>
      )}

      {/* LANGUAGE & QUICK CONTROLS BAR */}
      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Languages className="w-4 h-4 text-purple-400" />
            <span>Idioma de Voz:</span>
          </span>
          <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => {
                setActiveTabLang('es');
                setState((prev) => ({ ...prev, language: 'es' }));
              }}
              className={`px-3 py-1.5 rounded-md text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                activeTabLang === 'es'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>🇪🇸 Español (Latino / España)</span>
            </button>
            <button
              onClick={() => {
                setActiveTabLang('en');
                setState((prev) => ({ ...prev, language: 'en' }));
              }}
              className={`px-3 py-1.5 rounded-md text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                activeTabLang === 'en'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>🇺🇸 English (US / UK)</span>
            </button>
          </div>
        </div>

        {/* Selected Extension Binding for Asterisk AstDB */}
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-slate-400 flex items-center gap-1">
            <PhoneCall className="w-3.5 h-3.5 text-sky-400" />
            <span>Extensión del Operador:</span>
          </label>
          <select
            value={selectedExt}
            onChange={(e) => setSelectedExt(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-white font-mono text-xs font-bold focus:border-purple-500 focus:outline-none"
          >
            {extensions.length > 0 ? (
              extensions.map((ext) => (
                <option key={ext.id} value={ext.extension}>
                  {ext.extension} - {ext.name}
                </option>
              ))
            ) : (
              <>
                <option value="1001">1001 - Operador Principal</option>
                <option value="1002">1002 - Operador 2</option>
                <option value="1003">1003 - Operador 3</option>
                <option value="8888">8888 - Softphone X-Lite</option>
              </>
            )}
          </select>
        </div>
      </div>

      {/* BANNER DE PRUEBA EN VIVO POR EXTENSIÓN 8888 O *43 EN MICROSIP */}
      <div className="p-4 rounded-xl bg-gradient-to-r from-purple-950/60 via-slate-900 to-indigo-950/60 border border-purple-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-400 shrink-0">
            <Radio className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="text-xs font-bold text-white flex items-center gap-2">
              <span>Prueba de Voz en tu Softphone / MicroSIP:</span>
              <span className="px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-mono text-[10px] font-bold border border-purple-500/40">
                Marca 8888 o *43
              </span>
            </div>
            <p className="text-[11px] text-slate-300 mt-0.5">
              Al marcar <strong className="text-purple-300 font-mono">8888</strong> desde tu softphone escucharás un tono (beep): habla al micrófono y escucharás tu propia voz reflejada en tiempo real convertida en tono femenino. Si deseas probar el IVR bancario, presiona la tecla <strong className="text-white">2</strong>.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleRunDiagnostic}
            disabled={diagLoading}
            className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-purple-600 hover:bg-purple-500 text-white border border-purple-400/40 flex items-center gap-1.5 transition-all shadow-sm cursor-pointer disabled:opacity-50"
            title="Verificar si el módulo func_pitchshift está activo en Asterisk"
          >
            <RefreshCw className={`w-3 h-3 ${diagLoading ? 'animate-spin' : ''}`} />
            <span>{diagLoading ? 'Comprobando...' : 'Diagnóstico Asterisk'}</span>
          </button>
          <span className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border ${
            state.enabled
              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 animate-pulse'
              : 'bg-slate-800 text-slate-400 border-slate-700'
          }`}>
            {state.enabled ? '✓ Modulador ACTIVO en Asterisk' : 'Modulador OFF'}
          </span>
        </div>
      </div>

      {/* RESULTADO DE DIAGNÓSTICO EN TIEMPO REAL */}
      {diagResult && (
        <div className={`p-4 rounded-xl border text-xs space-y-2 animate-fadeIn ${
          diagResult.isFunctionRegistered
            ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
            : 'bg-amber-950/40 border-amber-500/40 text-amber-200'
        }`}>
          <div className="flex items-center justify-between">
            <div className="font-bold flex items-center gap-2">
              <span>{diagResult.isFunctionRegistered ? '✓ Módulo de Asterisk OK' : '⚠️ Atención Asterisk:'}</span>
              <span className="font-normal">{diagResult.message}</span>
            </div>
            <button
              onClick={() => setDiagResult(null)}
              className="text-slate-400 hover:text-white text-xs px-2 py-0.5"
            >
              Cerrar
            </button>
          </div>
          {diagResult.recommendedCommand && (
            <div className="p-2.5 rounded-lg bg-black/60 border border-amber-500/30 text-amber-300 font-mono text-[11px] select-all space-y-1">
              <div className="text-[10px] text-slate-400 uppercase font-bold">Comando para instalar módulo en VPS:</div>
              <code>{diagResult.recommendedCommand}</code>
            </div>
          )}
          <div className="flex flex-wrap gap-4 text-[11px] text-slate-300 font-mono pt-1">
            <span>Función PITCH_SHIFT: <strong className={diagResult.isFunctionRegistered ? 'text-emerald-400' : 'text-rose-400'}>{diagResult.isFunctionRegistered ? 'REGISTRADA' : 'NO REGISTRADA'}</strong></span>
            <span>Módulo cargado: <strong className={diagResult.isModuleLoaded ? 'text-emerald-400' : 'text-amber-400'}>{diagResult.isModuleLoaded ? 'SI (func_pitchshift.so)' : 'NO'}</strong></span>
            <span>Archivo en disco: <strong className={diagResult.moduleFileFound ? 'text-emerald-400' : 'text-slate-400'}>{diagResult.moduleFileFound ? 'ENCONTRADO' : 'NO LOCALIZADO'}</strong></span>
          </div>
        </div>
      )}

      {/* GRID: LEFT (PROFILES & LIVE MIC DSP) | RIGHT (SOUNDBOARD & TTS) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT COLUMN: FEMALE VOICE PRESETS & REAL-TIME MIC DSP (7 COLS) */}
        <div className="lg:col-span-7 space-y-6">
          {/* FEMALE PRESETS CARDS */}
          <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Award className="w-4 h-4 text-purple-400" />
                  <span>Perfiles de Voz Femenina Preconfigurados</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Selecciona el estilo de voz que mejor se adapte a tu llamada o campaña.
                </p>
              </div>
              <span className="text-[10px] font-mono text-purple-300 bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/20">
                {VOICE_PROFILES.length} Presets
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {VOICE_PROFILES.map((profile) => {
                const isSelected = state.activeProfileId === profile.id;
                return (
                  <div
                    key={profile.id}
                    onClick={() => handleSelectProfile(profile)}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer relative flex flex-col justify-between ${
                      isSelected
                        ? 'bg-purple-950/40 border-purple-500/80 shadow-lg shadow-purple-950/40 ring-1 ring-purple-500/50'
                        : 'bg-slate-950/60 border-slate-800 hover:border-slate-700 hover:bg-slate-950'
                    }`}
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm">{profile.language === 'en' ? '🇺🇸' : '🇪🇸'}</span>
                          <span className={`text-xs font-bold ${isSelected ? 'text-purple-300' : 'text-white'}`}>
                            {profile.name}
                          </span>
                        </div>
                        {isSelected && (
                          <span className="w-4 h-4 rounded-full bg-purple-500 text-black flex items-center justify-center shrink-0">
                            <Check className="w-3 h-3 stroke-[3]" />
                          </span>
                        )}
                      </div>

                      <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                        {profile.description}
                      </p>
                    </div>

                    <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] font-mono">
                      <span className="text-sky-300 bg-sky-500/10 px-1.5 py-0.5 rounded border border-sky-500/20">
                        Pitch: +{profile.pitchShiftSemi} st
                      </span>
                      <span className="text-emerald-300 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                        Formant: {profile.formantShift}x
                      </span>
                      <span className="text-purple-300 bg-purple-500/10 px-1.5 py-0.5 rounded border border-purple-500/20">
                        PJSIP: {profile.asteriskPitchValue}x
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* REAL-TIME MICROPHONE DSP ENGINE & HEADPHONES MONITOR */}
          <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Mic className="w-4 h-4 text-emerald-400" />
                  <span>Prueba de Micrófono en Vivo (Retorno en Auriculares)</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Habla por tu micrófono y escucha cómo suena tu voz transformada a mujer en tiempo real.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleToggleMic}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                    isMicRunning
                      ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/25 animate-pulse'
                      : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-md shadow-emerald-500/20'
                  }`}
                >
                  {isMicRunning ? <Square className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                  <span>{isMicRunning ? 'Detener Micrófono' : 'Iniciar Prueba de Micrófono'}</span>
                </button>
              </div>
            </div>

            {micError && (
              <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs">
                {micError}
              </div>
            )}

            {/* LIVE VU METER */}
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-purple-400" />
                  <span>Nivel de Voz en Vivo (DSP Realtime):</span>
                </span>
                <span className="font-mono text-purple-300 font-bold">{micLevel}%</span>
              </div>
              <div className="h-3 w-full bg-slate-900 rounded-full overflow-hidden p-0.5 flex items-center">
                <div
                  className="h-full rounded-full transition-all duration-75 bg-gradient-to-r from-emerald-500 via-teal-400 to-purple-500"
                  style={{ width: `${Math.min(100, Math.max(0, micLevel))}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[10px] text-slate-500">
                <span>Silencio (-60dB)</span>
                <span>Modulación Femenina</span>
                <span>Pico Óptimo (0dB)</span>
              </div>
            </div>

            {/* HEADPHONE MONITOR TOGGLE */}
            {isMicRunning && (
              <div className="p-3 rounded-xl bg-purple-950/30 border border-purple-500/30 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Headphones className="w-4 h-4 text-purple-400" />
                  <div>
                    <span className="text-xs font-bold text-white">Retorno en Auriculares (Audio Loopback)</span>
                    <p className="text-[10px] text-slate-400">Escúchate a ti mismo con la voz de mujer procesada</p>
                  </div>
                </div>
                <button
                  onClick={handleToggleMonitor}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer transition-all ${
                    isMonitorOn
                      ? 'bg-purple-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  {isMonitorOn ? '🎧 Retorno: ACTIVO' : '🎧 Retorno: SILENCIADO'}
                </button>
              </div>
            )}

            {/* SLIDERS: FINE-TUNE PARAMETERS */}
            <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-4 text-xs">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="font-bold text-slate-200 flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-purple-400" />
                  <span>Calibración Fina a Voluntad del Operador</span>
                </span>
                <span className="text-[10px] text-slate-400">Ajusta según tu tono natural</span>
              </div>

              {/* Pitch Slider */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-slate-300 font-medium">Elevación de Tono (Pitch Shift Femenino):</label>
                  <span className="font-mono font-bold text-sky-400">+{state.customPitch.toFixed(1)} semitonos</span>
                </div>
                <input
                  type="range"
                  min="1.0"
                  max="8.0"
                  step="0.2"
                  value={state.customPitch}
                  onChange={(e) => handlePitchChange(parseFloat(e.target.value))}
                  className="w-full accent-purple-500 cursor-pointer"
                />
                <div className="flex items-center justify-between text-[10px] text-slate-500">
                  <span>+1.0 (Madura / Grave)</span>
                  <span>+4.0 (Estándar Femenina)</span>
                  <span>+8.0 (Aguda / Juvenil)</span>
                </div>
              </div>

              {/* Clarity & Formants */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-slate-300 font-medium">Brillo y Formantes Femeninos (3.2 kHz):</label>
                  <span className="font-mono font-bold text-purple-400">{state.customClarity}%</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="100"
                  step="5"
                  value={state.customClarity}
                  onChange={(e) => handleClarityChange(parseInt(e.target.value, 10))}
                  className="w-full accent-purple-500 cursor-pointer"
                />
                <span className="text-[10px] text-slate-500">Realza las frecuencias vocales superiores típicas de la voz femenina</span>
              </div>

              {/* Bass Cut Filter */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-slate-300 font-medium">Corte de Graves Masculinos (High-Pass):</label>
                  <span className="font-mono font-bold text-emerald-400">{state.customBassCut} Hz</span>
                </div>
                <input
                  type="range"
                  min="120"
                  max="280"
                  step="10"
                  value={state.customBassCut}
                  onChange={(e) => handleBassCutChange(parseInt(e.target.value, 10))}
                  className="w-full accent-emerald-500 cursor-pointer"
                />
                <span className="text-[10px] text-slate-500">Elimina el retumbo grave pectoral de la voz del operador</span>
              </div>

              {/* Mic Volume */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-slate-300 font-medium">Ganancia de Micrófono:</label>
                  <span className="font-mono font-bold text-amber-400">{state.micVolume}%</span>
                </div>
                <input
                  type="range"
                  min="20"
                  max="150"
                  step="5"
                  value={state.micVolume}
                  onChange={(e) => handleMicVolumeChange(parseInt(e.target.value, 10))}
                  className="w-full accent-amber-500 cursor-pointer"
                />
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: SOUNDBOARD & TEXT-TO-SPEECH (5 COLS) */}
        <div className="lg:col-span-5 space-y-6">
          {/* SOUNDBOARD QUICK PHRASES */}
          <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Volume2 className="w-4 h-4 text-sky-400" />
                  <span>Soundboard de Frases con Voz de Mujer</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Haz 1-clic para decir frases bancarias en vivo durante la llamada.
                </p>
              </div>

              {isSpeakingTts && (
                <button
                  onClick={handleStopSpeech}
                  className="px-2.5 py-1 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[10px] font-bold flex items-center gap-1 animate-pulse"
                >
                  <Square className="w-3 h-3 fill-current" />
                  <span>Detener</span>
                </button>
              )}
            </div>

            {/* Categories filter */}
            <div className="flex flex-wrap gap-1.5">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-all cursor-pointer ${
                    activeCategory === cat
                      ? 'bg-purple-600 text-white font-bold'
                      : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Phrases list */}
            <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
              {filteredPhrases.map((phrase) => (
                <div
                  key={phrase.id}
                  className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 hover:border-purple-500/40 transition-all space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-purple-300">
                      {phrase.label}
                    </span>
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                      {phrase.category}
                    </span>
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed italic">
                    "{phrase.text}"
                  </p>

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      onClick={() => handleCopyText(phrase.text, phrase.id)}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] flex items-center gap-1 transition-all"
                      title="Copiar texto"
                    >
                      {copiedId === phrase.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedId === phrase.id ? 'Copiado' : 'Copiar'}</span>
                    </button>

                    <button
                      onClick={() => handlePlayPhrase(phrase)}
                      className="px-3 py-1 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-[11px] font-bold flex items-center gap-1.5 transition-all shadow-md shadow-purple-950/50 cursor-pointer"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      <span>Hablar con Voz de Mujer</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* CUSTOM TEXT-TO-SPEECH FREE BOX */}
          <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-emerald-400" />
                <span>Escribir Mensaje Libre (Voz de Mujer al Instante)</span>
              </h3>
              <span className="text-[10px] text-slate-400">Ctrl + Enter para hablar</span>
            </div>

            <textarea
              rows={3}
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  handleSpeakCustom();
                }
              }}
              placeholder={
                activeTabLang === 'en'
                  ? 'Type any sentence here to speak it immediately with female voice...'
                  : 'Escriba cualquier respuesta aquí para que la voz de mujer la diga de inmediato...'
              }
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs placeholder-slate-600 focus:border-purple-500 focus:outline-none resize-none"
            />

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {availableVoices.length > 0 && (
                  <select
                    value={state.selectedTtsVoice}
                    onChange={(e) => setState((prev) => ({ ...prev, selectedTtsVoice: e.target.value }))}
                    className="px-2 py-1 rounded-md bg-slate-950 border border-slate-800 text-[11px] text-slate-300 max-w-[160px] truncate focus:outline-none"
                    title="Voz femenina del sistema"
                  >
                    <option value="">Voz Femenina Automática</option>
                    {availableVoices
                      .filter((v) => v.lang.toLowerCase().startsWith(activeTabLang))
                      .map((v) => (
                        <option key={v.name} value={v.name}>
                          {v.name} ({v.lang})
                        </option>
                      ))}
                  </select>
                )}
              </div>

              <div className="flex items-center gap-2">
                {isSpeakingTts && (
                  <button
                    onClick={handleStopSpeech}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white text-xs font-semibold"
                  >
                    Detener
                  </button>
                )}
                <button
                  onClick={handleSpeakCustom}
                  disabled={!customText.trim()}
                  className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-md shadow-emerald-500/20 transition-all disabled:opacity-40 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Reproducir Ahora</span>
                </button>
              </div>
            </div>
          </div>

          {/* ASTERISK DIALPLAN PJSIP INSTRUCTIONS CARD */}
          <div className="p-4 rounded-xl bg-slate-950 border border-sky-500/30 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-bold text-sky-300 flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-sky-400" />
                <span>Integración Nativa Asterisk PJSIP (PITCH_SHIFT)</span>
              </span>
              <span className="text-[10px] font-mono text-emerald-400 font-bold">Asterisk 20</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Al activar el modulador, Asterisk inyecta la función nativa <code className="text-purple-300 font-mono">Set(PITCH_SHIFT(tx)={currentProfile.asteriskPitchValue})</code> en el canal del operador. Cualquier llamada realizada desde MicroSIP, Zoiper o WebRTC transmite automáticamente tu voz modulada a mujer al cliente.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
