import { VoiceChangerProfile, VoiceChangerState } from '../types';

export const VOICE_PROFILES: VoiceChangerProfile[] = [
  {
    id: 'es-female-executive',
    name: 'Mujer Ejecutiva Bancaria (Español)',
    gender: 'female',
    language: 'es',
    pitchShiftSemi: 3.8,
    formantShift: 1.25,
    eqTrebleGain: 5.5,
    eqBassCut: 190,
    reverbAmount: 15,
    description: 'Tono seguro, profesional y corporativo. Ideal para confirmación de transacciones y banca en línea.',
    sampleText: 'Buenas tardes, le contacto del departamento de seguridad y prevención de fraudes.',
    asteriskPitchValue: '1.32',
  },
  {
    id: 'es-female-support',
    name: 'Mujer Agente de Soporte (Español)',
    gender: 'female',
    language: 'es',
    pitchShiftSemi: 4.5,
    formantShift: 1.32,
    eqTrebleGain: 6.5,
    eqBassCut: 210,
    reverbAmount: 20,
    description: 'Tono cálido, juvenil y empático. Perfecto para atención al cliente y asistencia telefónica.',
    sampleText: 'Con gusto le asisto para verificar el estado de su servicio en nuestro sistema.',
    asteriskPitchValue: '1.38',
  },
  {
    id: 'es-female-security',
    name: 'Mujer Oficial de Seguridad OTP (Español)',
    gender: 'female',
    language: 'es',
    pitchShiftSemi: 3.0,
    formantShift: 1.20,
    eqTrebleGain: 4.0,
    eqBassCut: 175,
    reverbAmount: 10,
    description: 'Tono institucional, firme y protocolar. Diseñado para captura de códigos OTP y tokens bancarios.',
    sampleText: 'Por protocolo de seguridad, por favor ingrese su código de verificación de 6 dígitos.',
    asteriskPitchValue: '1.26',
  },
  {
    id: 'en-female-executive',
    name: 'Corporate Executive (English)',
    gender: 'female',
    language: 'en',
    pitchShiftSemi: 3.6,
    formantShift: 1.24,
    eqTrebleGain: 5.0,
    eqBassCut: 185,
    reverbAmount: 15,
    description: 'Crisp, articulate corporate tone. Perfect for outbound compliance and high-value verification.',
    sampleText: 'Good afternoon, this is the automated fraud detection and security division.',
    asteriskPitchValue: '1.30',
  },
  {
    id: 'en-female-support',
    name: 'Customer Support Representative (English)',
    gender: 'female',
    language: 'en',
    pitchShiftSemi: 4.4,
    formantShift: 1.30,
    eqTrebleGain: 6.0,
    eqBassCut: 205,
    reverbAmount: 20,
    description: 'Warm, friendly and engaging tone. Designed for day-to-day customer service.',
    sampleText: 'I would be happy to assist you with your account inquiry right now.',
    asteriskPitchValue: '1.36',
  },
  {
    id: 'en-female-security',
    name: 'Security & Risk Officer (English)',
    gender: 'female',
    language: 'en',
    pitchShiftSemi: 2.8,
    formantShift: 1.18,
    eqTrebleGain: 4.5,
    eqBassCut: 170,
    reverbAmount: 10,
    description: 'Direct, clear and authoritative. Ideal for real-time one-time passcode confirmation.',
    sampleText: 'Please enter your temporary security verification passcode on your dialpad.',
    asteriskPitchValue: '1.24',
  },
  {
    id: 'bilingual-female-young',
    name: 'Voz Femenina Joven y Clara (Bilingüe)',
    gender: 'female',
    language: 'es',
    pitchShiftSemi: 5.0,
    formantShift: 1.35,
    eqTrebleGain: 7.0,
    eqBassCut: 220,
    reverbAmount: 22,
    description: 'Elevación de tono pronunciada que transforma completamente cualquier voz masculina en femenina joven.',
    sampleText: 'Bienvenido a nuestro centro de atención telefónica, ¿en qué podemos servirle hoy?',
    asteriskPitchValue: '1.42',
  },
  {
    id: 'bilingual-female-mature',
    name: 'Voz Femenina Madura y Suave (Bilingüe)',
    gender: 'female',
    language: 'es',
    pitchShiftSemi: 2.5,
    formantShift: 1.15,
    eqTrebleGain: 3.5,
    eqBassCut: 160,
    reverbAmount: 12,
    description: 'Modulación sutil y natural. Mantiene gran inteligibilidad telefónica sin sonar artificial.',
    sampleText: 'Gracias por comunicarse con nuestro departamento de verificación de identidad.',
    asteriskPitchValue: '1.22',
  },
];

export const INITIAL_VOICE_CHANGER_STATE: VoiceChangerState = {
  enabled: false,
  activeProfileId: 'es-female-executive',
  language: 'es',
  customPitch: 3.8,
  customClarity: 70,
  customBassCut: 190,
  customReverb: 15,
  micActive: false,
  micVolume: 100,
  asteriskPjsipModulation: true,
  ttsRate: 1.0,
  ttsPitch: 1.35,
  selectedTtsVoice: '',
};

export interface QuickPhrase {
  id: string;
  category: 'Bancario' | 'Seguridad OTP' | 'Espera' | 'Éxito' | 'General';
  language: 'es' | 'en';
  text: string;
  label: string;
}

export const QUICK_SOUNDBOARD_PHRASES: QuickPhrase[] = [
  // ESPAÑOL
  {
    id: 'es-1',
    category: 'Bancario',
    language: 'es',
    label: 'Saludo Seguridad Bancaria',
    text: 'Buenas tardes, le contacto del departamento de prevención y seguridad bancaria para validar una transacción reciente.',
  },
  {
    id: 'es-2',
    category: 'Seguridad OTP',
    language: 'es',
    label: 'Solicitud Código OTP SMS',
    text: 'Por su seguridad, por favor digite en su teclado o dicte el código de verificación temporal de 6 dígitos que acaba de recibir por mensaje de texto.',
  },
  {
    id: 'es-3',
    category: 'Seguridad OTP',
    language: 'es',
    label: 'Aviso No Compartir Código',
    text: 'Recuerde que este código es estrictamente personal y confidencial. Por favor márquelo directamente en su teléfono para proteger sus fondos.',
  },
  {
    id: 'es-4',
    category: 'Espera',
    language: 'es',
    label: 'Validando en Sistema',
    text: 'Permítame un momento en línea por favor mientras nuestro sistema central valida los datos de seguridad de su cuenta.',
  },
  {
    id: 'es-5',
    category: 'Éxito',
    language: 'es',
    label: 'Operación Protegida con Éxito',
    text: 'Excelente, su código ha sido validado correctamente. La transacción no reconocida ha sido cancelada y sus fondos están totalmente asegurados.',
  },
  {
    id: 'es-6',
    category: 'Bancario',
    language: 'es',
    label: 'Pregunta Cargo Desconocido',
    text: '¿Podría confirmarme si usted reconoce o autorizó una compra con su tarjeta de crédito o débito realizada hace unos minutos?',
  },
  {
    id: 'es-7',
    category: 'General',
    language: 'es',
    label: 'Despedida Institucional',
    text: 'Ha sido un placer asistirle. Su cuenta se encuentra en estado seguro. Que tenga un excelente resto del día.',
  },

  // ENGLISH
  {
    id: 'en-1',
    category: 'Bancario',
    language: 'en',
    label: 'Bank Fraud Alert Greeting',
    text: 'Good afternoon, I am calling from the bank fraud detection and prevention department regarding a suspicious transaction on your account.',
  },
  {
    id: 'en-2',
    category: 'Seguridad OTP',
    language: 'en',
    label: 'Request One-Time Passcode (OTP)',
    text: 'For your security and verification, please enter or state the six-digit one-time passcode recently sent to your registered mobile device.',
  },
  {
    id: 'en-3',
    category: 'Seguridad OTP',
    language: 'en',
    label: 'Confidentiality Warning',
    text: 'Please note that your security passcode should never be shared with third parties. Enter it directly onto your telephone keypad.',
  },
  {
    id: 'en-4',
    category: 'Espera',
    language: 'en',
    label: 'Verifying on Database',
    text: 'Please hold the line for just a few moments while I confirm your security credentials on our secure banking gateway.',
  },
  {
    id: 'en-5',
    category: 'Éxito',
    language: 'en',
    label: 'Account Fully Secured',
    text: 'Thank you. Your passcode has been verified successfully. The unauthorized transaction has been cancelled and your card is completely protected.',
  },
  {
    id: 'en-6',
    category: 'Bancario',
    language: 'en',
    label: 'Confirm Recent Transaction',
    text: 'Could you please confirm if you authorized any transaction or online charge on your credit card within the last fifteen minutes?',
  },
  {
    id: 'en-7',
    category: 'General',
    language: 'en',
    label: 'Professional Farewell',
    text: 'Thank you for your cooperation and vigilance. Your account is now fully secured. Have a wonderful rest of your day.',
  },
];

/**
 * Real-time Audio DSP Pipeline for Operator Microphone using Web Audio API
 */
class RealtimeVoiceChangerAudioEngine {
  private audioCtx: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private highpassFilter: BiquadFilterNode | null = null;
  private formantFilter: BiquadFilterNode | null = null;
  private trebleFilter: BiquadFilterNode | null = null;
  private delayNode1: DelayNode | null = null;
  private delayNode2: DelayNode | null = null;
  private pitchLfo1: OscillatorNode | null = null;
  private pitchLfo2: OscillatorNode | null = null;
  private pitchDepth1: GainNode | null = null;
  private pitchDepth2: GainNode | null = null;
  private pitchGain1: GainNode | null = null;
  private pitchGain2: GainNode | null = null;
  private masterGain: GainNode | null = null;
  private monitorGain: GainNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private isRunning = false;
  private isMonitorOn = false;
  private animFrameId: number | null = null;

  public async start(
    state: VoiceChangerState,
    onLevelUpdate: (level: number) => void
  ): Promise<boolean> {
    try {
      this.stop();

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = new AudioContextClass();
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }

      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      this.sourceNode = this.audioCtx.createMediaStreamSource(this.mediaStream);

      // 1. Highpass filter to eliminate deep male chest resonance (typically 180Hz - 220Hz)
      this.highpassFilter = this.audioCtx.createBiquadFilter();
      this.highpassFilter.type = 'highpass';
      this.highpassFilter.frequency.value = state.customBassCut || 190;
      this.highpassFilter.Q.value = 0.8;

      // 2. Formant peaking filter (Female speech formant boost at 3000Hz - 3400Hz)
      this.formantFilter = this.audioCtx.createBiquadFilter();
      this.formantFilter.type = 'peaking';
      this.formantFilter.frequency.value = 3200;
      this.formantFilter.Q.value = 1.6;
      this.formantFilter.gain.value = (state.customClarity / 100) * 8; // +0dB to +8dB

      // 3. Treble brilliance highshelf filter
      this.trebleFilter = this.audioCtx.createBiquadFilter();
      this.trebleFilter.type = 'highshelf';
      this.trebleFilter.frequency.value = 5500;
      this.trebleFilter.gain.value = 4.0;

      // 4. Overlapping Granular / Dual-Delay Pitch Shifter
      // Pitch ratio for upward semitones: ratio = 2^(semitones / 12)
      // Modulation frequency controls the pitch shift amount
      const semi = state.customPitch;
      const pitchRatio = Math.pow(2, semi / 12);
      // Dual delay lines modulated with sawtooth/triangle waves 180 degrees out of phase
      const bufferTime = 0.045; // 45ms window
      const modFreq = Math.abs((pitchRatio - 1) / bufferTime);

      this.delayNode1 = this.audioCtx.createDelay(1.0);
      this.delayNode2 = this.audioCtx.createDelay(1.0);
      this.delayNode1.delayTime.value = bufferTime / 2;
      this.delayNode2.delayTime.value = bufferTime / 2;

      this.pitchGain1 = this.audioCtx.createGain();
      this.pitchGain2 = this.audioCtx.createGain();
      this.pitchGain1.gain.value = 0.5;
      this.pitchGain2.gain.value = 0.5;

      if (modFreq > 0.05 && semi !== 0) {
        this.pitchLfo1 = this.audioCtx.createOscillator();
        this.pitchLfo2 = this.audioCtx.createOscillator();
        this.pitchDepth1 = this.audioCtx.createGain();
        this.pitchDepth2 = this.audioCtx.createGain();

        this.pitchLfo1.type = 'sawtooth';
        this.pitchLfo2.type = 'sawtooth';
        this.pitchLfo1.frequency.value = semi > 0 ? modFreq : -modFreq;
        this.pitchLfo2.frequency.value = semi > 0 ? modFreq : -modFreq;

        this.pitchDepth1.gain.value = bufferTime / 2;
        this.pitchDepth2.gain.value = bufferTime / 2;

        this.pitchLfo1.connect(this.pitchDepth1);
        this.pitchDepth1.connect(this.delayNode1.delayTime);

        this.pitchLfo2.connect(this.pitchDepth2);
        this.pitchDepth2.connect(this.delayNode2.delayTime);

        this.pitchLfo1.start();
        this.pitchLfo2.start();
      }

      // Master output & Analyser for VU Meter
      this.masterGain = this.audioCtx.createGain();
      this.masterGain.gain.value = (state.micVolume / 100) * 1.2;

      this.monitorGain = this.audioCtx.createGain();
      this.monitorGain.gain.value = this.isMonitorOn ? 1.0 : 0.0;

      this.analyserNode = this.audioCtx.createAnalyser();
      this.analyserNode.fftSize = 64;
      this.analyserNode.smoothingTimeConstant = 0.6;

      // DSP Routing:
      // Source -> Highpass -> Formant -> Treble -> (Delay1 & Delay2) -> MasterGain -> Analyser -> MonitorGain -> Speakers
      this.sourceNode.connect(this.highpassFilter);
      this.highpassFilter.connect(this.formantFilter);
      this.formantFilter.connect(this.trebleFilter);

      this.trebleFilter.connect(this.delayNode1);
      this.trebleFilter.connect(this.delayNode2);

      this.delayNode1.connect(this.pitchGain1);
      this.delayNode2.connect(this.pitchGain2);

      this.pitchGain1.connect(this.masterGain);
      this.pitchGain2.connect(this.masterGain);

      this.masterGain.connect(this.analyserNode);
      this.analyserNode.connect(this.monitorGain);
      this.monitorGain.connect(this.audioCtx.destination);

      this.isRunning = true;

      // Start level meter loop
      const bufferLength = this.analyserNode.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const checkLevel = () => {
        if (!this.isRunning || !this.analyserNode) return;
        this.analyserNode.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avg = sum / bufferLength;
        const normalized = Math.min(100, Math.round((avg / 128) * 100));
        onLevelUpdate(normalized);
        this.animFrameId = requestAnimationFrame(checkLevel);
      };
      this.animFrameId = requestAnimationFrame(checkLevel);

      return true;
    } catch (err) {
      console.error('Error starting Voice Changer audio engine:', err);
      this.stop();
      return false;
    }
  }

  public updateParameters(state: VoiceChangerState) {
    if (!this.audioCtx || !this.isRunning) return;

    if (this.highpassFilter) {
      this.highpassFilter.frequency.setTargetAtTime(
        state.customBassCut || 190,
        this.audioCtx.currentTime,
        0.05
      );
    }

    if (this.formantFilter) {
      this.formantFilter.gain.setTargetAtTime(
        (state.customClarity / 100) * 8,
        this.audioCtx.currentTime,
        0.05
      );
    }

    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(
        (state.micVolume / 100) * 1.2,
        this.audioCtx.currentTime,
        0.05
      );
    }

    // Update Pitch LFO rate if pitch changed
    const semi = state.customPitch;
    const pitchRatio = Math.pow(2, semi / 12);
    const bufferTime = 0.045;
    const modFreq = Math.abs((pitchRatio - 1) / bufferTime);

    if (this.pitchLfo1 && this.pitchLfo2 && modFreq > 0.05) {
      this.pitchLfo1.frequency.setTargetAtTime(
        semi > 0 ? modFreq : -modFreq,
        this.audioCtx.currentTime,
        0.05
      );
      this.pitchLfo2.frequency.setTargetAtTime(
        semi > 0 ? modFreq : -modFreq,
        this.audioCtx.currentTime,
        0.05
      );
    }
  }

  public setMonitor(enabled: boolean) {
    this.isMonitorOn = enabled;
    if (this.monitorGain && this.audioCtx) {
      this.monitorGain.gain.setTargetAtTime(
        enabled ? 1.0 : 0.0,
        this.audioCtx.currentTime,
        0.05
      );
    }
  }

  public getIsMonitorOn(): boolean {
    return this.isMonitorOn;
  }

  public stop() {
    this.isRunning = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.pitchLfo1) {
      try { this.pitchLfo1.stop(); } catch (_) {}
      this.pitchLfo1 = null;
    }
    if (this.pitchLfo2) {
      try { this.pitchLfo2.stop(); } catch (_) {}
      this.pitchLfo2 = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      try { this.audioCtx.close(); } catch (_) {}
      this.audioCtx = null;
    }
  }
}

export const realtimeVoiceChanger = new RealtimeVoiceChangerAudioEngine();

/**
 * Text-to-Speech Engine with Natural Female Voices in Spanish and English
 */
export function getAvailableVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      return resolve([]);
    }
    let voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      return resolve(voices);
    }
    window.speechSynthesis.onvoiceschanged = () => {
      voices = window.speechSynthesis.getVoices();
      resolve(voices);
    };
    // Fallback timeout in case onvoiceschanged does not fire
    setTimeout(() => {
      resolve(window.speechSynthesis.getVoices());
    }, 400);
  });
}

export function speakFemaleVoice(
  text: string,
  language: 'es' | 'en' = 'es',
  options?: {
    voiceName?: string;
    rate?: number;
    pitch?: number;
    volume?: number;
    onStart?: () => void;
    onEnd?: () => void;
    onError?: (err: any) => void;
  }
) {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    if (options?.onError) options.onError('SpeechSynthesis API no soportada en este navegador');
    return;
  }

  window.speechSynthesis.cancel(); // Stop any pending speech

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = language === 'en' ? 'en-US' : 'es-ES';
  utterance.rate = options?.rate ?? 1.0;
  // Natural female speech pitch elevation (typically 1.25 to 1.45)
  utterance.pitch = options?.pitch ?? 1.35;
  utterance.volume = options?.volume ?? 1.0;

  const voices = window.speechSynthesis.getVoices();

  // 1. Try to find user requested voice name
  let targetVoice: SpeechSynthesisVoice | undefined;
  if (options?.voiceName) {
    targetVoice = voices.find((v) => v.name.toLowerCase().includes(options.voiceName!.toLowerCase()));
  }

  // 2. If not found, look for female voice in target language
  if (!targetVoice) {
    const langPrefix = language === 'en' ? 'en' : 'es';
    const femaleKeywords = ['female', 'mujer', 'monica', 'paulina', 'luciana', 'helena', 'samantha', 'victoria', 'karen', 'zira', 'sabina', 'laura', 'maria', 'rosa', 'carmen', 'natural'];
    targetVoice = voices.find((v) => {
      const matchLang = v.lang.toLowerCase().startsWith(langPrefix);
      const matchName = femaleKeywords.some((k) => v.name.toLowerCase().includes(k));
      return matchLang && matchName;
    });
  }

  // 3. Fallback to any voice matching target language
  if (!targetVoice) {
    const langPrefix = language === 'en' ? 'en' : 'es';
    targetVoice = voices.find((v) => v.lang.toLowerCase().startsWith(langPrefix));
  }

  if (targetVoice) {
    utterance.voice = targetVoice;
  }

  if (options?.onStart) utterance.onstart = options.onStart;
  if (options?.onEnd) utterance.onend = options.onEnd;
  if (options?.onError) utterance.onerror = options.onError;

  window.speechSynthesis.speak(utterance);
}
