// Audio helper for generating audible telephony tones and formatting audio metadata for Asterisk 20

/**
 * Creates a clean PCM 16-bit Mono WAV Data URI with a telephony prompt chime.
 * This guarantees that even default mock audios can be played immediately by <audio> or Audio().
 */
export function createSyntheticTelephonyTone(frequency = 440, durationSeconds = 2.5, melody: number[] = [523.25, 659.25, 783.99]): string {
  const sampleRate = 8000; // Asterisk telephony standard 8kHz
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  // RIFF identifier 'RIFF'
  view.setUint32(0, 0x52494646, false);
  // file length minus 8
  view.setUint32(4, 36 + numSamples * 2, true);
  // 'WAVE'
  view.setUint32(8, 0x57415645, false);
  // 'fmt ' chunk
  view.setUint32(12, 0x666d7420, false);
  // Subchunk1Size (16 for PCM)
  view.setUint32(16, 16, true);
  // AudioFormat (1 = PCM)
  view.setUint16(20, 1, true);
  // NumChannels (1 = Mono)
  view.setUint16(22, 1, true);
  // SampleRate (8000 Hz)
  view.setUint32(24, sampleRate, true);
  // ByteRate (SampleRate * NumChannels * BitsPerSample/8) = 8000 * 1 * 2 = 16000
  view.setUint32(28, sampleRate * 2, true);
  // BlockAlign (NumChannels * BitsPerSample/8) = 2
  view.setUint16(32, 2, true);
  // BitsPerSample (16 bits)
  view.setUint16(34, 16, true);
  // 'data' chunk header
  view.setUint32(36, 0x64617461, false);
  view.setUint32(40, numSamples * 2, true);

  // Write sine wave samples with gentle envelope & melody notes
  const noteDuration = numSamples / melody.length;
  for (let i = 0; i < numSamples; i++) {
    const noteIndex = Math.min(Math.floor(i / noteDuration), melody.length - 1);
    const currentFreq = melody[noteIndex] || frequency;
    const t = i / sampleRate;

    // Decay envelope for each note
    const noteSamplePos = i % noteDuration;
    const envelope = Math.max(0, 1 - noteSamplePos / noteDuration);

    const sample = Math.sin(2 * Math.PI * currentFreq * t) * envelope * 0.4;
    // Scale to 16-bit signed integer (-32768 to 32767)
    const intSample = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
    view.setInt16(44 + i * 2, intSample, true);
  }

  // Convert ArrayBuffer to Base64
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
}

/**
 * Returns Asterisk Sox conversion command for any uploaded file
 */
export function getAsteriskSoxCommand(filename: string, outputName: string): string {
  const cleanOut = outputName.replace(/\.[^/.]+$/, '');
  return `sox "${filename}" -r 8000 -c 1 -b 16 "/var/lib/asterisk/sounds/custom/${cleanOut}.wav"`;
}
