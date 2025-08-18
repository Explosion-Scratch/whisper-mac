import { writeFileSync } from "fs";
import { join } from "path";

/**
 * Consolidated WAV file processing utility
 * Handles conversion of Float32Array audio data to WAV files
 */
export class WavProcessor {
  /**
   * Convert Float32Array audio data to WAV file
   */
  static async saveAudioAsWav(
    audioData: Float32Array,
    tempDir: string,
    options: {
      sampleRate?: number;
      numChannels?: number;
      bitsPerSample?: number;
    } = {}
  ): Promise<string> {
    const { sampleRate = 16000, numChannels = 1, bitsPerSample = 16 } = options;

    const tempPath = join(tempDir, `audio_${Date.now()}.wav`);

    // Convert Float32Array to 16-bit PCM
    const pcmData = new Int16Array(audioData.length);
    for (let i = 0; i < audioData.length; i++) {
      // Clamp to [-1, 1] and convert to 16-bit
      const clamped = Math.max(-1, Math.min(1, audioData[i]));
      pcmData[i] = Math.round(clamped * 32767);
    }

    // Create WAV header
    const wavHeader = this.createWavHeader(
      pcmData.length * 2,
      sampleRate,
      numChannels,
      bitsPerSample
    );

    // Combine header and data
    const wavBuffer = new ArrayBuffer(
      wavHeader.byteLength + pcmData.byteLength
    );
    const wavView = new Uint8Array(wavBuffer);
    wavView.set(new Uint8Array(wavHeader), 0);
    wavView.set(new Uint8Array(pcmData.buffer), wavHeader.byteLength);

    // Write to file
    writeFileSync(tempPath, Buffer.from(wavBuffer));

    return tempPath;
  }

  /**
   * Create WAV file header
   */
  static createWavHeader(
    dataLength: number,
    sampleRate: number,
    numChannels: number,
    bitsPerSample: number
  ): ArrayBuffer {
    const buffer = new ArrayBuffer(44);
    const view = new DataView(buffer);

    // RIFF header
    view.setUint32(0, 0x52494646, false); // "RIFF"
    view.setUint32(4, 36 + dataLength, true); // File size - 8
    view.setUint32(8, 0x57415645, false); // "WAVE"

    // Format chunk
    view.setUint32(12, 0x666d7420, false); // "fmt "
    view.setUint32(16, 16, true); // Subchunk1Size
    view.setUint16(20, 1, true); // AudioFormat (PCM)
    view.setUint16(22, numChannels, true); // NumChannels
    view.setUint32(24, sampleRate, true); // SampleRate
    view.setUint32(28, (sampleRate * numChannels * bitsPerSample) / 8, true); // ByteRate
    view.setUint16(32, (numChannels * bitsPerSample) / 8, true); // BlockAlign
    view.setUint16(34, bitsPerSample, true); // BitsPerSample

    // Data chunk
    view.setUint32(36, 0x64617461, false); // "data"
    view.setUint32(40, dataLength, true); // Subchunk2Size

    return buffer;
  }
}
