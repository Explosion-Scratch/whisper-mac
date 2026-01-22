/**
 * Audio Speed Processor
 * Implements WSOLA (Waveform Similarity Overlap-Add) algorithm for
 * time-stretching audio without changing pitch.
 */
export class AudioSpeedProcessor {
  // WSOLA parameters optimized for speech at 16kHz
  private static readonly SAMPLE_RATE = 16000;
  private static readonly FRAME_SIZE = 256; // ~16ms frame
  private static readonly OVERLAP_SIZE = 128; // 50% overlap
  private static readonly SEARCH_RANGE = 64; // Search window for best match

  /**
   * Speed up audio by a given factor using WSOLA algorithm.
   * Preserves pitch while changing tempo.
   *
   * @param audioData - Input Float32Array audio samples (16kHz mono)
   * @param speedFactor - Speed multiplier (1.0 = no change, 2.0 = 2x speed)
   * @returns Float32Array with time-stretched audio
   */
  static speedUp(audioData: Float32Array, speedFactor: number): Float32Array {
    // If speed is 1.0 (or very close), return original audio unchanged
    if (speedFactor <= 1.0 || Math.abs(speedFactor - 1.0) < 0.001) {
      return audioData;
    }

    console.log(`Speeding up audio by ${speedFactor}x`);

    // Clamp speed factor to reasonable range
    const clampedSpeed = Math.min(Math.max(speedFactor, 1.0), 3.0);

    // For very short audio, use simple approach
    if (audioData.length < this.FRAME_SIZE * 2) {
      return this.simpleSpeedUp(audioData, clampedSpeed);
    }

    return this.wsolaSpeedUp(audioData, clampedSpeed);
  }

  /**
   * WSOLA implementation for time-stretching
   */
  private static wsolaSpeedUp(
    audioData: Float32Array,
    speedFactor: number,
  ): Float32Array {
    const frameSize = this.FRAME_SIZE;
    const overlapSize = this.OVERLAP_SIZE;
    const hopSizeInput = Math.round(frameSize - overlapSize); // Input hop
    const hopSizeOutput = Math.round(hopSizeInput / speedFactor); // Output hop (smaller = faster)
    const searchRange = this.SEARCH_RANGE;

    // Estimate output length
    const numFrames = Math.floor((audioData.length - frameSize) / hopSizeInput);
    const estimatedOutputLength = numFrames * hopSizeOutput + frameSize;
    const output = new Float32Array(estimatedOutputLength);

    // Create Hann window for smooth overlap-add
    const window = this.createHannWindow(frameSize);

    let inputPos = 0;
    let outputPos = 0;
    let prevFrameEnd = new Float32Array(overlapSize);

    for (let frameIdx = 0; frameIdx < numFrames; frameIdx++) {
      // Calculate ideal input position for this frame
      const idealInputPos = Math.round(frameIdx * hopSizeInput);

      // Search for best matching position within search range
      const searchStart = Math.max(0, idealInputPos - searchRange);
      const searchEnd = Math.min(
        audioData.length - frameSize,
        idealInputPos + searchRange,
      );

      let bestPos = idealInputPos;
      let bestCorrelation = -Infinity;

      // Only search if we have a previous frame to match against
      if (frameIdx > 0 && outputPos >= overlapSize) {
        for (let pos = searchStart; pos <= searchEnd; pos++) {
          const correlation = this.calculateCorrelation(
            audioData,
            pos,
            output,
            outputPos - overlapSize,
            overlapSize,
          );
          if (correlation > bestCorrelation) {
            bestCorrelation = correlation;
            bestPos = pos;
          }
        }
      }

      // Ensure bestPos is within bounds
      bestPos = Math.max(0, Math.min(audioData.length - frameSize, bestPos));

      // Extract frame and apply window
      const frame = new Float32Array(frameSize);
      for (let i = 0; i < frameSize; i++) {
        if (bestPos + i < audioData.length) {
          frame[i] = audioData[bestPos + i] * window[i];
        }
      }

      // Overlap-add to output
      for (let i = 0; i < frameSize; i++) {
        if (outputPos + i < output.length) {
          output[outputPos + i] += frame[i];
        }
      }

      // Move to next frame
      inputPos = bestPos + hopSizeInput;
      outputPos += hopSizeOutput;

      // Early exit if we've processed all input
      if (inputPos >= audioData.length - frameSize) {
        break;
      }
    }

    // Trim output to actual used length and normalize
    const actualLength = Math.min(outputPos + frameSize, output.length);
    const trimmedOutput = output.slice(0, actualLength);

    // Normalize to prevent clipping
    this.normalizeAudio(trimmedOutput);

    return trimmedOutput;
  }

  /**
   * Create a Hann window for smooth overlap-add
   */
  private static createHannWindow(size: number): Float32Array {
    const window = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
    }
    return window;
  }

  /**
   * Calculate normalized cross-correlation between two segments
   */
  private static calculateCorrelation(
    arr1: Float32Array,
    offset1: number,
    arr2: Float32Array,
    offset2: number,
    length: number,
  ): number {
    let sum = 0;
    let energy1 = 0;
    let energy2 = 0;

    for (let i = 0; i < length; i++) {
      const idx1 = offset1 + i;
      const idx2 = offset2 + i;

      if (idx1 >= arr1.length || idx2 >= arr2.length) {
        break;
      }

      const val1 = arr1[idx1];
      const val2 = arr2[idx2];

      sum += val1 * val2;
      energy1 += val1 * val1;
      energy2 += val2 * val2;
    }

    const denominator = Math.sqrt(energy1 * energy2);
    if (denominator < 1e-10) {
      return 0;
    }

    return sum / denominator;
  }

  /**
   * Normalize audio to prevent clipping
   */
  private static normalizeAudio(audio: Float32Array): void {
    let maxAbs = 0;
    for (let i = 0; i < audio.length; i++) {
      const abs = Math.abs(audio[i]);
      if (abs > maxAbs) {
        maxAbs = abs;
      }
    }

    if (maxAbs > 0.95) {
      const scale = 0.95 / maxAbs;
      for (let i = 0; i < audio.length; i++) {
        audio[i] *= scale;
      }
    }
  }

  /**
   * Simple speed-up for very short audio segments
   * Uses basic overlap-add without similarity search
   */
  private static simpleSpeedUp(
    audioData: Float32Array,
    speedFactor: number,
  ): Float32Array {
    const outputLength = Math.floor(audioData.length / speedFactor);
    if (outputLength === 0) {
      return new Float32Array(0);
    }

    const output = new Float32Array(outputLength);
    const windowSize = 64;
    const hopInput = windowSize;
    const hopOutput = Math.round(windowSize / speedFactor);

    // Create small Hann window
    const window = this.createHannWindow(windowSize);

    let outputPos = 0;

    for (
      let inputPos = 0;
      inputPos < audioData.length - windowSize &&
      outputPos < outputLength - windowSize;
      inputPos += hopInput
    ) {
      for (let i = 0; i < windowSize && outputPos + i < outputLength; i++) {
        output[outputPos + i] += audioData[inputPos + i] * window[i];
      }
      outputPos += hopOutput;
    }

    this.normalizeAudio(output);
    return output;
  }

  /**
   * Check if speed processing is needed
   */
  static shouldProcess(speedFactor: number): boolean {
    return speedFactor > 1.0 && Math.abs(speedFactor - 1.0) >= 0.001;
  }

  /**
   * Calculate the expected output length for a given input length and speed factor
   */
  static calculateOutputLength(
    inputLength: number,
    speedFactor: number,
  ): number {
    if (speedFactor <= 1.0) {
      return inputLength;
    }
    return Math.floor(inputLength / speedFactor);
  }

  /**
   * Validate speed factor is within acceptable range
   */
  static validateSpeedFactor(speedFactor: number): number {
    if (typeof speedFactor !== "number" || isNaN(speedFactor)) {
      return 1.0;
    }
    return Math.min(Math.max(speedFactor, 1.0), 3.0);
  }
}
