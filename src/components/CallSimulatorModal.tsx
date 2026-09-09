import React, { useState, useEffect, useRef } from 'react';
import { Press1Config, OtpCaptureConfig, PjsipExtension, AudioPrompt, SystemUser, AstDbEntry, SqliteCdrRecord } from '../types';
import {
  Phone,
  PhoneOff,
  Volume2,
  Mic,
  CheckCircle,
  AlertTriangle,
  ShieldCheck,
  Play,
  RotateCcw,
  Music,
  UserCheck,
  Monitor,
  Eye,
  EyeOff,
  KeyRound,
  ArrowRight,
  Sparkles,
  Radio,
  Clock,
  ArrowLeftRight,
  Database,
} from 'lucide-react';

interface CallSimulatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  press1Config: Press1Config;
  otpConfig: OtpCaptureConfig;
  extensions: PjsipExtension[];
  audios: AudioPrompt[];
  currentUser?: SystemUser;
  onLogEvent: (type: 'AMI' | 'ARI' | 'PJSIP' | 'SQLITE' | 'SYSTEM', message: string, payload?: string) => void;
  onSaveAstDbEntry?: (entry: AstDbEntry) => void;
  onSaveCdrRecord?: (cdr: SqliteCdrRecord) => void;
}

export const CallSimulatorModal: React.FC<CallSimulatorModalProps> = ({
  isOpen,
  onClose,
  press1Config,
  otpConfig,
  extensions,
  audios,
  currentUser,
  onLogEvent,
  onSaveAstDbEntry,
  onSaveCdrRecord,
}) => {
  // Call mode: 'outbound_campaign' (Agent calls client -> Press 1 returns to agent) or 'inbound_test'
  const [callMode, setCallMode] = useState<'outbound_campaign' | 'inbound_test'>('outbound_campaign');
  const [originatingExten, setOriginatingExten] = useState<string>(
    currentUser?.assignedExtensions[0] || '1001'
  );
  const [dialedNumber, setDialedNumber] = useState('500');
  const [callState, setCallState] = useState<
    'idle' | 'calling' | 'ivr_connected' | 'agent_connected' | 'ended'
  >('idle');
  const [callDuration, setCallDuration] = useState(0);
  const [systemMessage, setSystemMessage] = useState('');
  const [activeIvrType, setActiveIvrType] = useState<'press1' | 'otp' | null>('press1');
  const [activeAudioPlaying, setActiveAudioPlaying] = useState<string | null>(null);

  // Agent Real-time OTP HUD state
  const [isAgentOtpModalActive, setIsAgentOtpModalActive] = useState(false);
  const [agentOtpRequestedLength, setAgentOtpRequestedLength] = useState<4 | 6>(
    otpConfig.digitLength === 4 ? 4 : 6
  );
  const [agentLiveDigits, setAgentLiveDigits] = useState<string[]>([]);
  const [isMaskedOnScreen, setIsMaskedOnScreen] = useState(otpConfig.maskDigitsOnAgentScreen ?? false);
  const [otpVerificationState, setOtpVerificationState] = useState<
    'idle' | 'capturing' | 'awaiting_agent_decision' | 'verifying' | 'valid' | 'invalid'
  >('idle');
  const [lastDtmfTimestamp, setLastDtmfTimestamp] = useState<string | null>(null);

  const timerRef = useRef<any>(null);
  const activeAudioElementRef = useRef<HTMLAudioElement | null>(null);
  const waitAudioIntervalRef = useRef<any>(null);

  // Sync originating agent if currentUser changes
  useEffect(() => {
    if (currentUser?.assignedExtensions && currentUser.assignedExtensions.length > 0) {
      setOriginatingExten(currentUser.assignedExtensions[0]);
    }
  }, [currentUser]);

  useEffect(() => {
    if (callState === 'ivr_connected' || callState === 'agent_connected') {
      timerRef.current = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [callState]);

  // Audio tone generator for authentic DTMF
  const playDtmfTone = (digit: string) => {
    const dtmfFreqs: Record<string, [number, number]> = {
      '1': [697, 1209],
      '2': [697, 1336],
      '3': [697, 1477],
      '4': [770, 1209],
      '5': [770, 1336],
      '6': [770, 1477],
      '7': [852, 1209],
      '8': [852, 1336],
      '9': [852, 1477],
      '*': [941, 1209],
      '0': [941, 1336],
      '#': [941, 1477],
    };
    const freqs = dtmfFreqs[digit];
    if (!freqs) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0.08;
      osc1.frequency.value = freqs[0];
      osc2.frequency.value = freqs[1];
      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);
      osc1.start();
      osc2.start();
      setTimeout(() => {
        osc1.stop();
        osc2.stop();
        ctx.close();
      }, 120);
    } catch (e) {
      // AudioContext might be restricted until user interaction
    }
  };

  const stopActiveAudio = () => {
    if (waitAudioIntervalRef.current) {
      clearInterval(waitAudioIntervalRef.current);
      waitAudioIntervalRef.current = null;
    }
    if (activeAudioElementRef.current) {
      activeAudioElementRef.current.pause();
      activeAudioElementRef.current = null;
    }
    setActiveAudioPlaying(null);
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  };

  const playValidatingWaitPrompt = () => {
    stopActiveAudio();
    const waitText =
      otpConfig.validatingWaitPromptText || 'Un momento por favor, estamos validando su información...';
    const waitAudioId = otpConfig.validatingWaitAudioId;

    // Play immediately
    playPromptOrTTS(waitAudioId, waitText, 'custom/un_momento_validando_informacion');

    // Keep repeating softly to simulate authentic customer hold audio while agent reviews code
    waitAudioIntervalRef.current = setInterval(() => {
      playPromptOrTTS(waitAudioId, waitText, 'custom/un_momento_validando_informacion');
    }, 8500);
  };

  const playPromptOrTTS = (audioId?: string, fallbackText: string = '', asteriskPathDesc: string = '') => {
    stopActiveAudio();
    const audioObj = audios.find((a) => a.id === audioId);

    if (audioObj && audioObj.dataUrl) {
      setSystemMessage(`[Audio Pregrabado] ${audioObj.name}`);
      setActiveAudioPlaying(audioObj.name);
      onLogEvent(
        'ARI',
        `Playback(custom/${audioObj.fileName.replace(/\.[^/.]+$/, '')})`,
        `Playback: ${audioObj.name}\nFile: /var/lib/asterisk/sounds/custom/${audioObj.fileName}\nFormat: PCM 16-bit 8000Hz`
      );

      const player = new Audio(audioObj.dataUrl);
      activeAudioElementRef.current = player;
      player.play().catch((err) => {
        console.warn('Audio play failed, falling back to TTS', err);
        fallbackToTTS(fallbackText);
      });
      player.onended = () => {
        setActiveAudioPlaying(null);
      };
    } else {
      fallbackToTTS(fallbackText);
    }
  };

  const fallbackToTTS = (text: string) => {
    setSystemMessage(text);
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'es-ES';
      utterance.rate = 0.95;
      window.speechSynthesis.speak(utterance);
    }
  };

  const handleStartCall = () => {
    if (!dialedNumber) return;
    setCallState('calling');
    setCallDuration(0);
    setAgentLiveDigits([]);
    setOtpVerificationState('idle');
    setIsAgentOtpModalActive(false);

    if (callMode === 'outbound_campaign') {
      setSystemMessage(
        `[Marcador Saliente] Agente ${currentUser?.name || 'Operador'} (Ext ${originatingExten}) contactando al cliente...`
      );
      onLogEvent(
        'AMI',
        `[ORIGINATE] Contacto saliente iniciado por Agente Ext ${originatingExten}`,
        `Action: Originate\nChannel: PJSIP/carrier_trunk/sip:+15550199@carrier.com\nContext: from-trunk\nExten: ${dialedNumber}\nVariable: __ORIGINATING_EXTEN=${originatingExten},__AGENT_ID=${currentUser?.id || 'agent-1'}`
      );

      // Persist in native Asterisk SQLite3 AstDB
      if (onSaveAstDbEntry) {
        onSaveAstDbEntry({
          id: `astdb-orig-${Date.now()}`,
          family: 'originating_agent',
          key: '+18005550199',
          value: originatingExten,
          updatedAt: new Date().toLocaleTimeString(),
          description: `Persistido en SQLite3 AstDB para retorno automático al agente Ext ${originatingExten}`,
        });
      }
      onLogEvent(
        'SQLITE',
        `AstDB Nativo: Set(DB(originating_agent/+18005550199)=${originatingExten})`,
        `Query: INSERT OR REPLACE INTO astdb VALUES ('/originating_agent/+18005550199', '${originatingExten}');\nArchivo: /var/lib/asterisk/astdb.sqlite3\nPropósito: Garantizar persistencia del agente originador.`
      );
    } else {
      setSystemMessage('Llamada entrante directa hacia IVR Asterisk...');
      onLogEvent(
        'PJSIP',
        `[INVITE] Canal PJSIP entrante hacia ${dialedNumber}`,
        `Endpoint: carrier_inbound\nContext: from-trunk\nExten: ${dialedNumber}`
      );
    }

    setTimeout(() => {
      setCallState('ivr_connected');

      if (dialedNumber === press1Config.extension) {
        setActiveIvrType('press1');
        onLogEvent(
          'ARI',
          `Canal capturado por Stasis(press1_ivr_app) en extensión ${press1Config.extension}`,
          `Channel: PJSIP/carrier-0000001a\nInherited Var: ORIGINATING_EXTEN=${originatingExten}`
        );
        playPromptOrTTS(
          press1Config.welcomeAudioId,
          press1Config.welcomeAudioText,
          'custom/bienvenida_corporativa'
        );
      } else if (dialedNumber === otpConfig.extension) {
        setActiveIvrType('otp');
        onLogEvent(
          'ARI',
          `Canal capturado por Stasis(${otpConfig.stasisAppName}) en extensión ${otpConfig.extension}`,
          `Event: StasisStart\nPlayback: prompt_otp_digits (${otpConfig.digitLength} dígitos)`
        );
        playPromptOrTTS(
          otpConfig.welcomeAudioId,
          otpConfig.welcomePromptText,
          'custom/solicitud_otp'
        );
      } else {
        const foundExt = extensions.find((e) => e.extension === dialedNumber);
        if (foundExt) {
          setCallState('agent_connected');
          onLogEvent(
            'AMI',
            `Llamada conectada directamente con extensión ${foundExt.extension} (${foundExt.name})`,
            `Event: BridgeEnter\nBridgeType: basic\nChannels: PJSIP/caller, PJSIP/${foundExt.extension}`
          );
          fallbackToTTS(`Llamada conectada con ${foundExt.name}.`);
        } else {
          fallbackToTTS('Número no asignado. Verifique su configuración.');
          setTimeout(handleEndCall, 3500);
        }
      }
    }, 1200);
  };

  // Handle DTMF input
  const handleDtmfPress = (digit: string) => {
    playDtmfTone(digit);

    if (callState === 'idle' || callState === 'ended') {
      setDialedNumber((prev) => prev + digit);
      return;
    }

    const timestamp = new Date().toLocaleTimeString();
    setLastDtmfTimestamp(timestamp);

    onLogEvent(
      'ARI',
      `[DTMF REAL-TIME] Evento ChannelDtmfReceived: Dígito '${digit}'`,
      `Channel: PJSIP/call-0001a\nDigit: ${digit}\nDurationMs: 120\nTimestamp: ${timestamp}\nWebSocket Broadcast -> Agent HUD`
    );

    // 1. PRESS 1 BEHAVIOR: Returns to originating agent if configured!
    if (activeIvrType === 'press1' && callState === 'ivr_connected') {
      if (digit === '1') {
        stopActiveAudio();

        const returnToAgent = press1Config.returnToOriginatingAgent ?? true;
        const targetExten = returnToAgent && originatingExten ? originatingExten : press1Config.digit1Target;

        setCallState('agent_connected');

        if (returnToAgent && originatingExten) {
          setSystemMessage(
            `🔔 ¡El cliente presionó 1! Asterisk devolvió la llamada al AGENTE ORIGINADOR (Extensión ${originatingExten}).`
          );
          onLogEvent(
            'AMI',
            `[RETORNO AL AGENTE ORIGINADOR] Cliente presionó 1. Asterisk transfiere canal a PJSIP/${originatingExten}`,
            `Variable Evaluada: __ORIGINATING_EXTEN=${originatingExten}\nAction: Redirect\nExten: ${originatingExten}\nContext: from-internal\nPriority: 1\nResult: Retornado exitosamente al agente que originó el contacto.`
          );
          onLogEvent(
            'SQLITE',
            `AstDB Consulta: \${DB(originating_agent/+18005550199)} -> Extensión ${originatingExten}`,
            `Key: /originating_agent/+18005550199\nValor: ${originatingExten}\nResultado: Retorno exitoso garantizado por SQLite3 AstDB.`
          );
          fallbackToTTS(
            `Ha presionado 1. Reconectando la llamada con su asesor que originó el contacto en la extensión ${originatingExten}.`
          );
        } else {
          setSystemMessage(
            `Cliente presionó 1. Transfiriendo llamada a destino de respaldo: Ext ${targetExten}.`
          );
          onLogEvent(
            'AMI',
            `[TRANSFER] IVR Press 1 redirige a Ext ${targetExten}`,
            `Action: Redirect\nExten: ${targetExten}\nContext: from-internal`
          );
          fallbackToTTS(`Transfiriendo a extensión ${targetExten}.`);
        }
      } else {
        playPromptOrTTS(
          press1Config.invalidAudioId,
          press1Config.invalidPromptText,
          'custom/opcion_invalida'
        );
      }
      return;
    }

    // 2. LIVE OTP AGENT SCREEN STREAMING: Stream DTMF live to agent HUD!
    if (isAgentOtpModalActive || activeIvrType === 'otp') {
      if (digit === '#') {
        if (agentLiveDigits.length > 0 && otpVerificationState === 'capturing') {
          // Client finishes code by pressing #
          const fullCode = agentLiveDigits.join('');
          setOtpVerificationState('awaiting_agent_decision');
          setSystemMessage(
            '🎧 Cliente en espera telefónica: "Un momento por favor, estamos validando su información...". Asesor debe seleccionar si es Válido o Inválido.'
          );
          onLogEvent(
            'ARI',
            `[CLIENTE DIGITÓ CÓDIGO (#)] Código recibido: '${fullCode}'. Cliente puesto en espera telefónica.`,
            `Audio al cliente: "${otpConfig.validatingWaitPromptText || 'Un momento por favor, estamos validando su información...'}"\nEstado ARI: Hold activo. Esperando decisión del Asesor en pantalla.`
          );
          playValidatingWaitPrompt();
        }
        return;
      }

      if (['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(digit)) {
        const requiredLen = isAgentOtpModalActive ? agentOtpRequestedLength : otpConfig.digitLength;
        if (agentLiveDigits.length < requiredLen && otpVerificationState === 'capturing') {
          const nextDigits = [...agentLiveDigits, digit];
          setAgentLiveDigits(nextDigits);

          onLogEvent(
            'ARI',
            `[AGENT HUD] Dígito '${digit}' proyectado en tiempo real en la pantalla del Agente (${nextDigits.length}/${requiredLen})`,
            `WebSocket Msg: { event: "DTMF_CAPTURED", digit: "${digit}", currentBuffer: "${nextDigits.join('')}", targetAgentExt: "${originatingExten}" }`
          );

          if (nextDigits.length === requiredLen) {
            // All digits entered: immediately tell the customer to wait while agent decides in their screen
            const fullCode = nextDigits.join('');
            setOtpVerificationState('awaiting_agent_decision');
            setSystemMessage(
              '🎧 Cliente en espera telefónica: "Un momento por favor, estamos validando su información...". Asesor debe seleccionar si es Válido o Inválido en pantalla.'
            );
            onLogEvent(
              'ARI',
              `[CLIENTE INGRESÓ ${requiredLen} DÍGITOS] Código recibido: '${fullCode}'. Cliente puesto en espera.`,
              `Audio en reproducción al cliente: "${otpConfig.validatingWaitPromptText || 'Un momento por favor, estamos validando su información...'}"\nEstado Asterisk: Canal en espera telefónica. Pantalla del agente lista para marcar VÁLIDO o INVÁLIDO.`
            );
            playValidatingWaitPrompt();
          }
        }
      }
    }
  };

  // Agent triggers OTP collection from client
  const handleAgentRequestsOtpFromClient = (length: 4 | 6) => {
    stopActiveAudio();
    setAgentOtpRequestedLength(length);
    setAgentLiveDigits([]);
    setOtpVerificationState('capturing');
    setIsAgentOtpModalActive(true);

    setSystemMessage(
      `[Modo Captura OTP] Agente solicitó código de ${length} dígitos. Esperando que el cliente digite en su teléfono...`
    );

    onLogEvent(
      'ARI',
      `[ARI SNOOP / DTMF TAP] Agente ${currentUser?.name} activó captura de OTP de ${length} dígitos`,
      `ChannelSnoop: PJSIP/customer-001\nARI WebSocket Stream Active\nTarget HUD: Operador Ext ${originatingExten}\nPrompt: "Por favor digite su código de ${length} dígitos..."`
    );

    // Play prompt to customer asking for code
    playPromptOrTTS(
      otpConfig.welcomeAudioId,
      `Por favor digite en su teclado su código de verificación de ${length} dígitos seguido de la tecla numeral.`
    );
  };

  // AGENT MANUAL DECISION: Agent marks code as VALID or INVALID on their screen
  const handleAgentDecision = (isValid: boolean) => {
    stopActiveAudio(); // Stop customer hold/waiting message
    const fullCode = agentLiveDigits.join('');

    if (isValid) {
      setOtpVerificationState('valid');
      setSystemMessage(
        '✅ Código marcado como VÁLIDO por el asesor. Transmitiendo confirmación al cliente y continuando llamada.'
      );
      playPromptOrTTS(
        otpConfig.successAudioId,
        otpConfig.successPromptText || 'Su código ha sido validado correctamente. Continuamos con su atención.'
      );

      onLogEvent(
        'ARI',
        `[DECISIÓN ASESOR: VÁLIDO] Asesor Ext ${originatingExten} marcó código '${fullCode}' como VÁLIDO`,
        `Agente: ${currentUser?.name || 'Operador'} (Ext ${originatingExten})\nCódigo verificado: ${fullCode}\nCanal reactivado -> Conversación directa restaurada.`
      );

      // Persist in SQLite3 AstDB and CDR
      if (onSaveAstDbEntry) {
        onSaveAstDbEntry({
          id: `astdb-otp-${Date.now()}`,
          family: 'otp_session',
          key: `call-${Date.now().toString(36)}`,
          value: `${fullCode}:VALIDO_ASESOR`,
          updatedAt: new Date().toLocaleTimeString(),
          description: `Código OTP validado manualmente por el Asesor Ext ${originatingExten}`,
        });
        onSaveAstDbEntry({
          id: `astdb-val-${Date.now()}`,
          family: 'otp_verified',
          key: '+18005550199',
          value: `APROBADO_EXT_${originatingExten}`,
          updatedAt: new Date().toLocaleTimeString(),
          description: `Autorización manual por operador en Asterisk 20`,
        });
      }

      if (onSaveCdrRecord) {
        onSaveCdrRecord({
          id: `cdr-${Date.now()}`,
          calldate: new Date().toISOString().replace('T', ' ').substring(0, 19),
          src: '+18005550199',
          dst: dialedNumber,
          originatingAgent: originatingExten,
          duration: callDuration || 48,
          billsec: Math.max(1, (callDuration || 48) - 5),
          disposition: 'ANSWERED',
          otpCode: fullCode,
          otpStatus: 'VERIFIED',
          uniqueid: `ast-${Date.now()}.21`,
        });
      }

      onLogEvent(
        'SQLITE',
        `CDR & AstDB: Transacción VÁLIDA registrada en SQLite3 (/var/lib/asterisk/astdb.sqlite3)`,
        `AstDB: Set(DB(otp_verified/+18005550199)=APROBADO_EXT_${originatingExten})\nCDR: INSERT INTO cdr (calldate, src, dst, userfield) VALUES (datetime('now'), '+18005550199', '${dialedNumber}', 'AGENT:${originatingExten}:OTP:${fullCode}:APPROVED_MANUAL')`
      );
    } else {
      setOtpVerificationState('invalid');
      const invalidAudioPrompt = audios.find((a) => a.id === otpConfig.failureAudioId);
      const invalidMessage =
        otpConfig.failurePromptText ||
        'El código ingresado es inválido. Por favor, vuelva a ingresarlo a continuación.';

      setSystemMessage(
        `❌ Código marcado como INVÁLIDO. Reproduciendo al cliente: "${invalidMessage}" ${
          invalidAudioPrompt ? `(Audio pregrabado: ${invalidAudioPrompt.fileName})` : ''
        }`
      );

      // Reproduce el audio pregrabado cargado o el sintetizador si aún no ha subido archivo
      playPromptOrTTS(otpConfig.failureAudioId, invalidMessage);

      onLogEvent(
        'ARI',
        `[DECISIÓN ASESOR: INVÁLIDO] Asesor Ext ${originatingExten} marcó código '${fullCode}' como INVÁLIDO`,
        `Agente: ${currentUser?.name || 'Operador'} (Ext ${originatingExten})\nCódigo rechazado: ${fullCode}\nAudio reproducido al cliente: ${
          invalidAudioPrompt ? `${invalidAudioPrompt.name} (${invalidAudioPrompt.asteriskPath}.wav)` : invalidMessage
        }\nAcción: Cliente notificado de que debe volver a ingresar el código.`
      );

      if (onSaveAstDbEntry) {
        onSaveAstDbEntry({
          id: `astdb-otp-${Date.now()}`,
          family: 'otp_session',
          key: `call-${Date.now().toString(36)}`,
          value: `${fullCode}:RECHAZADO_ASESOR`,
          updatedAt: new Date().toLocaleTimeString(),
          description: `Código OTP rechazado por el Asesor Ext ${originatingExten}`,
        });
      }

      if (onSaveCdrRecord) {
        onSaveCdrRecord({
          id: `cdr-${Date.now()}`,
          calldate: new Date().toISOString().replace('T', ' ').substring(0, 19),
          src: '+18005550199',
          dst: dialedNumber,
          originatingAgent: originatingExten,
          duration: callDuration || 48,
          billsec: Math.max(1, (callDuration || 48) - 5),
          disposition: 'ANSWERED',
          otpCode: fullCode,
          otpStatus: 'FAILED',
          uniqueid: `ast-${Date.now()}.21`,
        });
      }

      onLogEvent(
        'SQLITE',
        `CDR & AstDB: Transacción INVÁLIDA registrada en SQLite3`,
        `AstDB: Set(DB(otp_verified/+18005550199)=RECHAZADO_EXT_${originatingExten})\nCDR: UPDATE cdr SET userfield='AGENT:${originatingExten}:OTP:${fullCode}:REJECTED_MANUAL'`
      );
    }
  };

  const handleVerifyAgentOtp = () => {
    if (agentLiveDigits.length > 0) {
      setOtpVerificationState('awaiting_agent_decision');
      setSystemMessage(
        '🎧 Cliente en espera telefónica: "Un momento por favor, estamos validando su información...". Asesor debe seleccionar si es Válido o Inválido.'
      );
      playValidatingWaitPrompt();
    }
  };

  const handleResetOtpCapture = () => {
    stopActiveAudio();
    setAgentLiveDigits([]);
    setOtpVerificationState('capturing');
    setSystemMessage('Captura reiniciada. Esperando que el cliente ingrese su código...');
  };

  const handleEndCall = () => {
    stopActiveAudio();
    setCallState('ended');
    setIsAgentOtpModalActive(false);
    setSystemMessage('Llamada finalizada (Hangup). Canales liberados.');
    onLogEvent('PJSIP', '[BYE] Canal colgado (Hangup)', 'SIP/2.0 200 OK\nCause: Normal Clearing');

    setTimeout(() => {
      setCallState('idle');
      setAgentLiveDigits([]);
      setOtpVerificationState('idle');
      setSystemMessage('');
    }, 1800);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-md overflow-y-auto">
      <div className="w-full max-w-4xl rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden flex flex-col my-auto">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-slate-950 border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-amber-500 to-orange-600 flex items-center justify-center text-slate-950 font-black text-sm">
              *20
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-bold text-white text-sm">
                  Simulador de Llamadas Asterisk 20 &bull; WebRTC &amp; Agent HUD
                </h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                  <Radio className="w-3 h-3 animate-pulse" />
                  AMI + ARI Stasis Live
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 flex items-center gap-1">
                  <Database className="w-3 h-3" />
                  AstDB SQLite3
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Prueba el retorno de llamada al agente originador (Press 1) y el streaming de OTP en vivo.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center text-lg font-bold transition-colors"
          >
            &times;
          </button>
        </div>

        {/* Top Scenario Selector Bar */}
        <div className="px-5 py-2.5 bg-slate-950/60 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center space-x-2">
            <span className="text-slate-400 font-medium">Modo de Prueba:</span>
            <div className="inline-flex rounded-lg bg-slate-900 p-0.5 border border-slate-800">
              <button
                onClick={() => {
                  setCallMode('outbound_campaign');
                  setDialedNumber('500');
                }}
                className={`px-3 py-1 rounded-md font-medium transition-all ${
                  callMode === 'outbound_campaign'
                    ? 'bg-amber-500 text-slate-950 font-bold shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                1. Contacto del Agente (Regresa con Press 1)
              </button>
              <button
                onClick={() => {
                  setCallMode('inbound_test');
                  setDialedNumber('600');
                }}
                className={`px-3 py-1 rounded-md font-medium transition-all ${
                  callMode === 'inbound_test'
                    ? 'bg-blue-600 text-white font-bold shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                2. Llamada Entrante Directa
              </button>
            </div>
          </div>

          {/* Originating Agent Indicator */}
          <div className="flex items-center space-x-2 bg-slate-900 px-3 py-1 rounded-md border border-slate-800 text-[11px]">
            <UserCheck className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-slate-400">Agente Originador:</span>
            <select
              value={originatingExten}
              onChange={(e) => setOriginatingExten(e.target.value)}
              className="bg-transparent text-amber-300 font-mono font-bold focus:outline-none cursor-pointer"
            >
              {extensions.map((e) => (
                <option key={e.id} value={e.extension} className="bg-slate-900 text-white">
                  Ext {e.extension} - {e.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Main Body: 2 Columns on Desktop */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 p-4 sm:p-5 flex-1 bg-slate-900/50">
          {/* Left Column: Softphone Keypad / Customer Telephone (5 cols) */}
          <div className="lg:col-span-5 flex flex-col space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-amber-400" />
                <span>Teléfono / Interacción del Cliente</span>
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                PJSIP Dialing &bull; DTMF In-Band
              </span>
            </div>

            {/* LCD Display */}
            <div className="rounded-xl bg-slate-950 border border-slate-800 p-3 space-y-2">
              <div className="flex justify-between items-center text-[10px] text-slate-400 font-mono">
                <span
                  className={`uppercase px-2 py-0.5 rounded font-bold ${
                    callState === 'ivr_connected'
                      ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                      : callState === 'agent_connected'
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {callState === 'ivr_connected'
                    ? 'EN IVR PRESS 1'
                    : callState === 'agent_connected'
                    ? 'EN LLAMADA CON AGENTE'
                    : callState}
                </span>
                <span className="flex items-center gap-1 text-slate-300 font-semibold">
                  <Clock className="w-3 h-3 text-slate-500" />
                  {String(Math.floor(callDuration / 60)).padStart(2, '0')}:
                  {String(callDuration % 60).padStart(2, '0')}
                </span>
              </div>

              <div className="text-center py-1">
                <div className="text-2xl font-mono font-bold text-white tracking-widest">
                  {dialedNumber || '---'}
                </div>
                {activeAudioPlaying && (
                  <div className="mt-1 inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20 animate-pulse">
                    <Music className="w-3 h-3" />
                    <span className="truncate max-w-[220px]">{activeAudioPlaying}</span>
                  </div>
                )}
              </div>

              {otpVerificationState === 'awaiting_agent_decision' && (
                <div className="p-2.5 rounded-lg bg-indigo-950/70 border border-indigo-500/40 text-center space-y-1 animate-pulse">
                  <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-indigo-300">
                    <Volume2 className="w-4 h-4 text-indigo-400" />
                    <span>Locución al Cliente en su Teléfono:</span>
                  </div>
                  <p className="text-[12px] text-white font-medium italic">
                    "{otpConfig.validatingWaitPromptText || 'Un momento por favor, estamos validando su información...'}"
                  </p>
                  <div className="text-[10px] text-indigo-300/90 font-mono">
                    🎧 En espera hasta que el asesor seleccione si es Válido o Inválido
                  </div>
                </div>
              )}

              {systemMessage && (
                <div className="text-[11px] text-amber-300 bg-amber-950/30 p-2 rounded-lg border border-amber-500/20 text-center leading-snug">
                  {systemMessage}
                </div>
              )}
            </div>

            {/* Quick Dial Presets */}
            <div className="flex gap-1.5 justify-center text-[10px] font-mono">
              <button
                onClick={() => setDialedNumber(press1Config.extension)}
                className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-amber-400 border border-slate-700 font-medium"
              >
                IVR Press 1 ({press1Config.extension})
              </button>
              <button
                onClick={() => setDialedNumber(otpConfig.extension)}
                className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-blue-400 border border-slate-700 font-medium"
              >
                Stasis OTP ({otpConfig.extension})
              </button>
            </div>

            {/* Keypad Grid */}
            <div className="grid grid-cols-3 gap-2">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map((key) => (
                <button
                  key={key}
                  onClick={() => handleDtmfPress(key)}
                  className={`py-2.5 rounded-lg font-mono font-bold text-lg active:scale-95 transition-all shadow-sm ${
                    key === '1' && callState === 'ivr_connected'
                      ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 ring-2 ring-amber-400 animate-pulse font-black'
                      : 'bg-slate-800 hover:bg-slate-700 text-white'
                  }`}
                  title={key === '1' && callState === 'ivr_connected' ? 'Presione 1 para regresar al agente' : undefined}
                >
                  {key}
                  {key === '1' && callState === 'ivr_connected' && (
                    <span className="block text-[9px] font-sans font-normal uppercase text-slate-950 leading-none">
                      Press 1
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Call Action Buttons */}
            <div className="flex gap-2 pt-1">
              {callState === 'idle' || callState === 'ended' ? (
                <button
                  onClick={handleStartCall}
                  className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center justify-center space-x-2 shadow-lg shadow-emerald-600/30 active:scale-98 transition-all text-xs"
                >
                  <Phone className="w-4 h-4" />
                  <span>
                    {callMode === 'outbound_campaign'
                      ? `Llamar al Cliente (desde Ext ${originatingExten})`
                      : 'Llamar por PJSIP'}
                  </span>
                </button>
              ) : (
                <button
                  onClick={handleEndCall}
                  className="w-full py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold flex items-center justify-center space-x-2 shadow-lg shadow-rose-600/30 active:scale-98 transition-all text-xs"
                >
                  <PhoneOff className="w-4 h-4" />
                  <span>Colgar Llamada</span>
                </button>
              )}

              <button
                onClick={() => {
                  setDialedNumber('');
                  setAgentLiveDigits([]);
                }}
                className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white"
                title="Borrar entrada"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Right Column: AGENT REAL-TIME SCREEN (HUD) (7 cols) */}
          <div className="lg:col-span-7 flex flex-col space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                <Monitor className="w-3.5 h-3.5 text-blue-400" />
                <span>Pantalla del Agente en Tiempo Real (Live HUD)</span>
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse"></span>
                ARI WebSocket Stream
              </span>
            </div>

            {/* Agent Active Call Context Box */}
            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2.5">
                  <div
                    className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-sm ${
                      callState === 'agent_connected'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {originatingExten}
                  </div>
                  <div>
                    <div className="text-xs font-bold text-white flex items-center gap-2">
                      <span>Extensión {originatingExten}</span>
                      <span className="text-[10px] font-normal text-slate-400">
                        ({currentUser?.name || 'Operador en turno'})
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          callState === 'agent_connected' ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'
                        }`}
                      ></span>
                      <span>
                        {callState === 'agent_connected'
                          ? 'En conversación activa con cliente'
                          : callState === 'ivr_connected'
                          ? 'Esperando que cliente presione 1...'
                          : 'En espera de llamada'}
                      </span>
                    </div>
                  </div>
                </div>

                {callState === 'agent_connected' && (
                  <div className="text-right">
                    <span className="text-[10px] font-mono uppercase text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full font-bold">
                      Canal Enlazado
                    </span>
                  </div>
                )}
              </div>

              {/* Call Return Explanation Banner */}
              {callState === 'agent_connected' && (
                <div className="p-2.5 rounded-lg bg-emerald-950/30 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
                  <ArrowLeftRight className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>
                    ¡Retorno exitoso! La llamada regresó a tu extensión ({originatingExten}) tras presionar 1 el cliente.
                  </span>
                </div>
              )}

              {/* Action Buttons to Request OTP */}
              <div className="pt-2 border-t border-slate-900 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                    <span>Pedir al Cliente que Digite su Código:</span>
                  </span>
                  <div className="flex items-center space-x-1">
                    <button
                      disabled={callState !== 'agent_connected'}
                      onClick={() => handleAgentRequestsOtpFromClient(4)}
                      className="px-2.5 py-1 rounded-md text-xs font-bold bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white shadow-sm transition-all"
                    >
                      Pedir Código de 4 Dígitos
                    </button>
                    <button
                      disabled={callState !== 'agent_connected'}
                      onClick={() => handleAgentRequestsOtpFromClient(6)}
                      className="px-2.5 py-1 rounded-md text-xs font-bold bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white shadow-sm transition-all"
                    >
                      Pedir Código de 6 Dígitos
                    </button>
                  </div>
                </div>

                {callState !== 'agent_connected' && (
                  <p className="text-[11px] text-slate-500 italic">
                    * Inicia la llamada y presiona "1" en el teclado del cliente para conectar con el agente y activar la captura de OTP en vivo.
                  </p>
                )}
              </div>
            </div>

            {/* LIVE OTP AGENT SCREEN CARD */}
            <div className="flex-1 p-4 rounded-xl bg-slate-950 border border-blue-500/30 flex flex-col justify-between space-y-3 shadow-inner">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
                <div className="flex items-center space-x-2">
                  <ShieldCheck className="w-4 h-4 text-blue-400" />
                  <span className="text-xs font-bold text-white uppercase tracking-wider">
                    Captura en Vivo: Código de {agentOtpRequestedLength} Dígitos
                  </span>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => setIsMaskedOnScreen(!isMaskedOnScreen)}
                    className="flex items-center space-x-1 text-[11px] text-slate-400 hover:text-white px-2 py-0.5 rounded bg-slate-900 border border-slate-800"
                  >
                    {isMaskedOnScreen ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    <span>{isMaskedOnScreen ? 'Oculto' : 'Visible'}</span>
                  </button>

                  <button
                    onClick={handleResetOtpCapture}
                    className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-900"
                    title="Limpiar captura"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Big Real-time Digit Slots */}
              <div className="py-4">
                <div className="flex items-center justify-center gap-2 sm:gap-3">
                  {Array.from({ length: agentOtpRequestedLength }).map((_, index) => {
                    const digit = agentLiveDigits[index];
                    const isFilled = digit !== undefined;
                    return (
                      <div
                        key={index}
                        className={`w-12 h-14 sm:w-14 sm:h-16 rounded-xl flex items-center justify-center text-2xl sm:text-3xl font-mono font-black border transition-all duration-200 ${
                          isFilled
                            ? 'bg-blue-600/20 border-blue-500 text-amber-400 scale-105 shadow-lg shadow-blue-500/20'
                            : 'bg-slate-900 border-slate-800 text-slate-600'
                        }`}
                      >
                        {isFilled ? (isMaskedOnScreen ? '•' : digit) : ''}
                      </div>
                    );
                  })}
                </div>

                <div className="text-center mt-3 text-xs">
                  {agentLiveDigits.length === 0 ? (
                    <span className="text-slate-400 flex items-center justify-center gap-1.5 animate-pulse">
                      <Radio className="w-3.5 h-3.5 text-blue-400" />
                      Esperando que el cliente digite en su teléfono...
                    </span>
                  ) : agentLiveDigits.length < agentOtpRequestedLength ? (
                    <span className="text-amber-400 font-mono">
                      Capturando en tiempo real... ({agentLiveDigits.length} de {agentOtpRequestedLength} dígitos)
                    </span>
                  ) : (
                    <span className="text-emerald-400 font-semibold flex items-center justify-center gap-1">
                      <CheckCircle className="w-4 h-4" />
                      Todos los {agentOtpRequestedLength} dígitos capturados del cliente
                    </span>
                  )}
                </div>
              </div>

              {/* AGENT DECISION PANEL: VÁLIDO vs INVÁLIDO */}
              {otpVerificationState === 'awaiting_agent_decision' && (
                <div className="p-4 rounded-xl bg-amber-950/40 border-2 border-amber-500/60 space-y-3 shadow-xl">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center space-x-2 text-amber-400 font-bold text-xs uppercase tracking-wider">
                        <AlertTriangle className="w-4 h-4 animate-pulse" />
                        <span>Acción Requerida: Decisión del Asesor</span>
                      </div>
                      <p className="text-xs text-slate-300 mt-1">
                        El cliente ya digitó su código (<span className="font-mono font-bold text-amber-300 text-sm px-1.5 py-0.5 rounded bg-slate-900 border border-amber-500/30">{agentLiveDigits.join('')}</span>) y está en espera telefónica escuchando:
                      </p>
                      <p className="text-[11px] text-indigo-300 italic mt-1 font-medium bg-slate-900/60 p-1.5 rounded border border-indigo-500/30">
                        "{otpConfig.validatingWaitPromptText || 'Un momento por favor, estamos validando su información...'}"
                      </p>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 whitespace-nowrap">
                      Cliente en Espera
                    </span>
                  </div>

                  <div className="pt-1">
                    <div className="text-[11px] font-semibold text-slate-200 mb-2">
                      Selecciona si el código es válido o inválido para continuar la llamada:
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        onClick={() => handleAgentDecision(true)}
                        className="py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:scale-95 text-white font-bold text-xs sm:text-sm shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2 transition-all border border-emerald-400/40 cursor-pointer"
                      >
                        <CheckCircle className="w-4 h-4 text-emerald-100" />
                        <span>Marcar como VÁLIDO (Aprobar)</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleAgentDecision(false)}
                        className="py-3 px-4 rounded-xl bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 active:scale-95 text-white font-bold text-xs sm:text-sm shadow-lg shadow-rose-600/30 flex items-center justify-center gap-2 transition-all border border-rose-400/40 cursor-pointer"
                      >
                        <AlertTriangle className="w-4 h-4 text-rose-100" />
                        <span>Marcar como INVÁLIDO (Rechazar)</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {otpVerificationState === 'valid' && (
                <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-500/40 flex flex-col sm:flex-row items-center justify-between gap-3">
                  <div className="flex items-center space-x-2.5">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                      <CheckCircle className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-emerald-300">
                        Código VÁLIDO &bull; Aprobado por Asesor (Ext {originatingExten})
                      </div>
                      <div className="text-[11px] text-slate-300">
                        El cliente escuchó confirmación. Canal activo en conversación.
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleAgentRequestsOtpFromClient(agentOtpRequestedLength)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 whitespace-nowrap"
                  >
                    Solicitar Otro Código
                  </button>
                </div>
              )}

              {otpVerificationState === 'invalid' && (
                <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-500/40 flex flex-col sm:flex-row items-center justify-between gap-3">
                  <div className="flex items-center space-x-2.5">
                    <div className="w-8 h-8 rounded-lg bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0">
                      <AlertTriangle className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-rose-300">
                        Código INVÁLIDO &bull; Rechazado por Asesor
                      </div>
                      <div className="text-[11px] text-slate-300">
                        El cliente escuchó la locución pregrabada indicándole que el código es inválido y que debe volver a ingresarlo.
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleAgentRequestsOtpFromClient(agentOtpRequestedLength)}
                    className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-sm whitespace-nowrap flex items-center gap-1.5 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Solicitar Nuevo Intento al Cliente</span>
                  </button>
                </div>
              )}

              {/* Status and Verification Badge */}
              <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs">
                <div className="flex items-center space-x-2">
                  <span className="text-slate-400">Estado Verificación:</span>
                  {otpVerificationState === 'idle' && (
                    <span className="text-slate-400 font-mono">Listo para captura</span>
                  )}
                  {otpVerificationState === 'capturing' && (
                    <span className="text-blue-400 font-mono font-medium animate-pulse">
                      Escuchando canal DTMF en vivo...
                    </span>
                  )}
                  {otpVerificationState === 'awaiting_agent_decision' && (
                    <span className="text-amber-400 font-mono font-bold flex items-center gap-1 animate-pulse">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                      ESPERANDO DECISIÓN DEL ASESOR (Cliente en Hold)
                    </span>
                  )}
                  {otpVerificationState === 'verifying' && (
                    <span className="text-amber-400 font-mono font-semibold animate-spin">
                      Validando con servidor...
                    </span>
                  )}
                  {otpVerificationState === 'valid' && (
                    <span className="text-emerald-400 font-mono font-bold flex items-center gap-1">
                      <CheckCircle className="w-3.5 h-3.5" />
                      AUTORIZADO POR ASESOR
                    </span>
                  )}
                  {otpVerificationState === 'invalid' && (
                    <span className="text-rose-400 font-mono font-bold flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      RECHAZADO POR ASESOR
                    </span>
                  )}
                </div>

                {lastDtmfTimestamp && (
                  <div className="text-[10px] text-slate-500 font-mono">
                    Último DTMF recibido: {lastDtmfTimestamp}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
