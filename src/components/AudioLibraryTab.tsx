import React, { useState, useRef } from 'react';
import { AudioPrompt } from '../types';
import {
  UploadCloud,
  Play,
  Pause,
  Trash2,
  Music,
  CheckCircle,
  FileAudio,
  Volume2,
  Mic,
  Square,
  Sparkles,
  Info,
  Copy,
  FolderSync,
  Tag,
} from 'lucide-react';
import { getAsteriskSoxCommand } from '../utils/audioHelper';

interface AudioLibraryTabProps {
  audios: AudioPrompt[];
  onAddAudio: (audio: AudioPrompt) => void;
  onDeleteAudio: (id: string) => void;
  onAssignToPress1: (audioId: string) => void;
  onAssignToOtp: (audioId: string) => void;
}

export const AudioLibraryTab: React.FC<AudioLibraryTabProps> = ({
  audios,
  onAddAudio,
  onDeleteAudio,
  onAssignToPress1,
  onAssignToOtp,
}) => {
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  // Upload state
  const [isDragging, setIsDragging] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [newAudioName, setNewAudioName] = useState('');
  const [newAudioCategory, setNewAudioCategory] = useState<AudioPrompt['category']>('press1_welcome');
  const [stagedFileDataUrl, setStagedFileDataUrl] = useState<string | null>(null);
  const [stagedFileName, setStagedFileName] = useState('');
  const [stagedFileSize, setStagedFileSize] = useState('');
  const [stagedDuration, setStagedDuration] = useState(4.0);

  // Live Microphone Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<any>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const categoryLabels: Record<AudioPrompt['category'], { label: string; color: string }> = {
    press1_welcome: { label: 'IVR Bienvenida Press 1', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
    press1_invalid: { label: 'IVR Opción Inválida', color: 'text-rose-400 bg-rose-500/10 border-rose-500/20' },
    otp_welcome: { label: 'Captura OTP Instrucción', color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' },
    otp_success: { label: 'OTP Validación Exitosa', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
    otp_failure: { label: 'OTP Error o Expirado', color: 'text-purple-400 bg-purple-500/10 border-purple-500/20' },
    hold_music: { label: 'Música de Espera (MOH)', color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20' },
    custom: { label: 'Anuncio Personalizado', color: 'text-slate-300 bg-slate-800 border-slate-700' },
  };

  const handlePlayToggle = (audio: AudioPrompt) => {
    if (playingAudioId === audio.id) {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
      }
      setPlayingAudioId(null);
    } else {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
      }
      const player = new Audio(audio.dataUrl);
      audioPlayerRef.current = player;
      setPlayingAudioId(audio.id);
      player.play().catch((err) => console.error('Audio play error:', err));
      player.onended = () => {
        setPlayingAudioId(null);
      };
    }
  };

  const processFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setStagedFileDataUrl(dataUrl);
      setStagedFileName(file.name);
      setStagedFileSize(`${(file.size / 1024).toFixed(1)} KB`);

      // Detect duration using temporary Audio object
      const tempAudio = new Audio(dataUrl);
      tempAudio.onloadedmetadata = () => {
        const dur = Math.round(tempAudio.duration * 10) / 10 || 5.0;
        setStagedDuration(dur);
      };

      if (!newAudioName) {
        setNewAudioName(file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '));
      }
      setIsUploadModalOpen(true);
    };
    reader.readAsDataURL(file);
  };

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.type.includes('audio') || file.name.endsWith('.wav') || file.name.endsWith('.mp3')) {
        processFile(file);
      }
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFile(e.target.files[0]);
    }
  };

  // Live microphone recording
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = () => {
          setStagedFileDataUrl(reader.result as string);
          setStagedFileName(`grabacion_${Date.now()}.webm`);
          setStagedFileSize(`${(audioBlob.size / 1024).toFixed(1)} KB`);
          setStagedDuration(recordingTime || 4.0);
          setNewAudioName(`Grabación de Voz ${new Date().toLocaleTimeString()}`);
          setIsUploadModalOpen(true);
        };
        reader.readAsDataURL(audioBlob);
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      alert('No se pudo acceder al micrófono. Verifique los permisos del navegador.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    }
  };

  const handleSaveAudio = (e: React.FormEvent) => {
    e.preventDefault();
    if (!stagedFileDataUrl || !newAudioName) return;

    const cleanFilename = stagedFileName
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_.]/g, '');
    const asteriskSoundName = cleanFilename.replace(/\.[^/.]+$/, '');

    const newPrompt: AudioPrompt = {
      id: `audio-${Date.now()}-${Math.random().toString(36).slice(-4)}`,
      name: newAudioName,
      category: newAudioCategory,
      fileName: cleanFilename,
      fileSize: stagedFileSize || '250 KB',
      durationSec: stagedDuration,
      format: 'audio/wav',
      sampleRate: '8000 Hz, 16-bit Mono (Estándar Asterisk)',
      dataUrl: stagedFileDataUrl,
      asteriskPath: `custom/${asteriskSoundName}`,
      createdAt: new Date().toLocaleString(),
    };

    onAddAudio(newPrompt);
    setIsUploadModalOpen(false);
    setStagedFileDataUrl(null);
    setNewAudioName('');
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="space-y-6">
      {/* Header and overview */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Volume2 className="w-6 h-6 text-emerald-400" />
            <span>Audioteca de Mensajes Pregrabados</span>
            <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
              {audios.length} audios
            </span>
          </h2>
          <p className="text-sm text-slate-400">
            Sube locuciones profesionales para tus campañas de <strong>Press 1</strong> y <strong>Captura de OTP</strong>.
            Sincronización directa con el directorio <code className="text-emerald-400 font-mono text-xs">/var/lib/asterisk/sounds/custom/</code>.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isRecording ? (
            <button
              onClick={stopRecording}
              className="inline-flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-semibold bg-rose-600 hover:bg-rose-500 text-white shadow-md animate-pulse"
            >
              <Square className="w-4 h-4" />
              <span>Detener Grabación ({recordingTime}s)</span>
            </button>
          ) : (
            <button
              onClick={startRecording}
              className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
              title="Grabar locución directamente desde el micrófono"
            >
              <Mic className="w-4 h-4 text-rose-400" />
              <span>Grabar Micrófono</span>
            </button>
          )}

          <button
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-500 hover:bg-emerald-400 text-black shadow-md shadow-emerald-500/20 font-bold"
          >
            <UploadCloud className="w-4 h-4" />
            <span>Subir Audio Pregrabado</span>
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileInputChange}
            accept="audio/*,.wav,.mp3,.ogg,.gsm"
            className="hidden"
          />
        </div>
      </div>

      {/* Drag & Drop Upload Zone (Guideline compliant: supports both drag-and-drop and click) */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleFileDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
          isDragging
            ? 'border-emerald-500 bg-emerald-500/10 scale-[1.01]'
            : 'border-slate-800 bg-slate-900/50 hover:bg-slate-900 hover:border-slate-700'
        }`}
      >
        <div className="flex flex-col items-center justify-center space-y-2 max-w-md mx-auto">
          <div className="w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center text-emerald-400 border border-slate-700">
            <UploadCloud className="w-6 h-6" />
          </div>
          <div className="text-sm font-medium text-white">
            Arrastra y suelta tu archivo de audio aquí o <span className="text-emerald-400 underline">haz clic para explorar</span>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Formatos compatibles: <strong>WAV (16-bit 8000Hz PCM recomendado)</strong>, MP3, OGG, GSM. Asterisk reproducirá el archivo con máxima nitidez sin transcodificación.
          </p>
        </div>
      </div>

      {/* Asterisk Sound Standard & Deployment Box */}
      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 text-xs">
        <div className="flex items-start space-x-3">
          <Info className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-semibold text-slate-200">Recomendación de Audio para Asterisk 20:</span>
            <p className="text-slate-400 leading-relaxed">
              Asterisk opera de forma óptima con audio en <strong>PCM Mono a 8 kHz y 16 bits</strong> (<code className="text-emerald-400 font-mono">format=wav</code> o <code className="text-emerald-400 font-mono">sln16</code>). Puedes sincronizar todos los audios a tu servidor con el comando rsync.
            </p>
          </div>
        </div>
        <button
          onClick={() =>
            copyToClipboard(
              'rsync -avz /local/sounds/ root@asterisk-server:/var/lib/asterisk/sounds/custom/'
            )
          }
          className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 shrink-0 font-mono text-[11px]"
          title="Copiar comando rsync para transferir audios al servidor"
        >
          <Copy className="w-3.5 h-3.5" />
          <span>Copiar comando rsync</span>
        </button>
      </div>

      {/* Audio Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {audios.map((audio) => {
          const isPlaying = playingAudioId === audio.id;
          const cat = categoryLabels[audio.category] || categoryLabels.custom;

          return (
            <div
              key={audio.id}
              className="p-4 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition-all flex flex-col justify-between space-y-3"
            >
              <div>
                {/* Card Header & Category Badge */}
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cat.color}`}>
                    {cat.label}
                  </span>
                  <button
                    onClick={() => onDeleteAudio(audio.id)}
                    className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition-colors"
                    title="Eliminar audio"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <h3 className="font-semibold text-white text-sm leading-snug">{audio.name}</h3>
                <p className="text-xs text-slate-400 font-mono mt-0.5">{audio.fileName}</p>
              </div>

              {/* Audio Player & Waveform simulation */}
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => handlePlayToggle(audio)}
                    className={`p-2 rounded-full flex items-center justify-center transition-all ${
                      isPlaying
                        ? 'bg-emerald-500 text-black shadow-md shadow-emerald-500/30 animate-pulse'
                        : 'bg-slate-800 text-white hover:bg-slate-700'
                    }`}
                    title={isPlaying ? 'Pausar' : 'Reproducir locución'}
                  >
                    {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                  </button>

                  <div className="flex-1 px-3">
                    <div className="flex items-center gap-0.5 h-6">
                      {[40, 75, 50, 90, 60, 30, 85, 45, 95, 70, 50, 80, 65, 35, 75, 55, 90, 40].map(
                        (height, idx) => (
                          <div
                            key={idx}
                            className={`flex-1 rounded-full transition-all ${
                              isPlaying ? 'bg-emerald-400 animate-pulse' : 'bg-slate-700'
                            }`}
                            style={{ height: `${isPlaying ? height : Math.max(20, height * 0.5)}%` }}
                          ></div>
                        )
                      )}
                    </div>
                  </div>

                  <span className="text-xs font-mono font-medium text-slate-400">
                    {audio.durationSec}s
                  </span>
                </div>

                {/* File Specs */}
                <div className="flex justify-between text-[11px] text-slate-400 font-mono pt-1 border-t border-slate-800/80">
                  <span>{audio.fileSize}</span>
                  <span className="truncate max-w-[170px]">{audio.sampleRate}</span>
                </div>
              </div>

              {/* Dialplan / Asterisk Path Reference */}
              <div className="text-[11px] bg-slate-950/60 p-2 rounded border border-slate-800 flex items-center justify-between text-slate-300 font-mono">
                <span className="text-slate-400">Playback({audio.asteriskPath})</span>
                <button
                  onClick={() => copyToClipboard(`Playback(${audio.asteriskPath})`)}
                  className="text-slate-400 hover:text-emerald-400 p-0.5"
                  title="Copiar sintaxis para extensions.conf"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Action Assignment buttons */}
              <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-2">
                <button
                  onClick={() => onAssignToPress1(audio.id)}
                  className="text-xs px-2.5 py-1 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors flex items-center gap-1 font-medium"
                  title="Asignar este audio a la bienvenida de Press 1"
                >
                  <span>Asignar a Press 1</span>
                </button>
                <button
                  onClick={() => onAssignToOtp(audio.id)}
                  className="text-xs px-2.5 py-1 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20 hover:bg-blue-500/20 transition-colors flex items-center gap-1 font-medium"
                  title="Asignar este audio a la instrucción de OTP"
                >
                  <span>Asignar a OTP</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal: Confirmación de subida y metadatos del audio */}
      {isUploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Volume2 className="w-5 h-5 text-emerald-400" />
                <span>Registrar Audio en Audioteca</span>
              </h3>
              <button
                onClick={() => setIsUploadModalOpen(false)}
                className="text-slate-400 hover:text-white text-lg font-mono"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleSaveAudio} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Nombre descriptivo del audio *
                </label>
                <input
                  type="text"
                  required
                  value={newAudioName}
                  onChange={(e) => setNewAudioName(e.target.value)}
                  placeholder="Ej: Bienvenida Campaña Cobranzas"
                  className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-white focus:border-emerald-500 focus:outline-none text-xs"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Categoría o Rol en Asterisk
                </label>
                <select
                  value={newAudioCategory}
                  onChange={(e) => setNewAudioCategory(e.target.value as AudioPrompt['category'])}
                  className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-white focus:border-emerald-500 focus:outline-none text-xs"
                >
                  <option value="press1_welcome">Bienvenida IVR Press 1</option>
                  <option value="press1_invalid">Opción Inválida Press 1</option>
                  <option value="otp_welcome">Solicitud Dígitos OTP</option>
                  <option value="otp_success">Validación Correcta OTP</option>
                  <option value="otp_failure">Error / Bloqueo OTP</option>
                  <option value="hold_music">Música en Espera (MOH)</option>
                  <option value="custom">Anuncio / General</option>
                </select>
              </div>

              <div className="p-3 rounded bg-slate-950 border border-slate-800 text-slate-400 space-y-1">
                <div className="flex justify-between">
                  <span>Archivo:</span>
                  <span className="font-mono text-slate-200 truncate max-w-[200px]">{stagedFileName}</span>
                </div>
                <div className="flex justify-between">
                  <span>Tamaño:</span>
                  <span className="font-mono text-slate-200">{stagedFileSize}</span>
                </div>
                <div className="flex justify-between">
                  <span>Duración estimada:</span>
                  <span className="font-mono text-emerald-300">{stagedDuration} segundos</span>
                </div>
              </div>

              <div className="p-2.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[11px]">
                💡 Asterisk buscará este audio en <code className="font-mono">/var/lib/asterisk/sounds/custom/{stagedFileName.replace(/\.[^/.]+$/, '')}</code>.
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsUploadModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold"
                >
                  Guardar en Audioteca
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
