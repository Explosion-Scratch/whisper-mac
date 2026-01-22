/**
 * Audio Speed Processor
 * Handles time-stretching of audio data for speed-up/slow-down without pitch change.
 * Uses linear interpolation for efficient resampling.
 */
export class AudioSpeedProcessor {
  /**
   * Speed up audio by a given factor using linear interpolation.
   * A factor of 2.0 means the audio plays twice as fast (half the duration).
   *
   * @param audioData - Input Float32Array audio samples
   * @param speedFactor - Speed multiplier (1.0 = no change, 2.0 = 2x speed, etc.)
   * @returns Float32Array with time-stretched audio
   */
  static speedUp(audioData: Float32Array, speedFactor: number): Float32Array {
    // If speed is 1.0 (or very close), return original audio unchanged
    if (speedFactor <= 1.0 || Math.abs(speedFactor - 1.0) < 0.001) {
      return audioData;
    }

    // Clamp speed factor to reasonable range (1.0 - 3.0)
    const clampedSpeed = Math.min(Math.max(speedFactor, 1.0), 3.0);

    // Calculate output length - fewer samples means faster playback
    const outputLength = Math.floor(audioData.length / clampedSpeed);

    if (outputLength === 0) {
      return new Float32Array(0);
    }

    const output = new Float32Array(outputLength);

    // Use linear interpolation for smooth resampling
    for (let i = 0; i < outputLength; i++) {
      const srcIndex = i * clampedSpeed;
      const srcFloor = Math.floor(srcIndex);
      const srcCeil = Math.min(srcFloor + 1, audioData.length - 1);
      const fraction = srcIndex - srcFloor;

      // Linear interpolation between adjacent samples
      output[i] = audioData[srcFloor] * (1 - fraction) + audioData[srcCeil] * fraction;
    }

    return output;
  }

  /**
   * Check if speed processing is needed
   * @param speedFactor - Speed multiplier to check
   * @returns true if speed processing should be applied
   */
  static shouldProcess(speedFactor: number): boolean {
    return speedFactor > 1.0 && Math.abs(speedFactor - 1.0) >= 0.001;
  }

  /**
   * Calculate the expected output length for a given input length and speed factor
   * @param inputLength - Number of input samples
   * @param speedFactor - Speed multiplier
   * @returns Expected output length in samples
   */
  static calculateOutputLength(inputLength: number, speedFactor: number): number {
    if (speedFactor <= 1.0) {
      return inputLength;
    }
    return Math.floor(inputLength / speedFactor);
  }

  /**
   * Validate speed factor is within acceptable range
   * @param speedFactor - Speed factor to validate
   * @returns Clamped speed factor between 1.0 and 3.0
   */
  static validateSpeedFactor(speedFactor: number): number {
    if (typeof speedFactor !== 'number' || isNaN(speedFactor)) {
      return 1.0;
    }
    return Math.min(Math.max(speedFactor, 1.0), 3.0);
  }
}
