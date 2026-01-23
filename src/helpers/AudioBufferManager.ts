import { AUDIO_CAPTURE_CONFIG } from "../config/Constants";

export class AudioBufferManager {
  private fullAudioHistory: Float32Array[] = [];
  private processedSampleCount = 0;
  private segmentCount = 0;
  private lastSegmentEndSample = 0;
  private chunkStartSample = 0;

  reset(): void {
    this.fullAudioHistory = [];
    this.processedSampleCount = 0;
    this.segmentCount = 0;
    this.lastSegmentEndSample = 0;
    this.chunkStartSample = 0;
  }

  addChunk(data: Float32Array): void {
    this.fullAudioHistory.push(data);
    this.processedSampleCount += data.length;
  }

  getProcessedSampleCount(): number {
    return this.processedSampleCount;
  }

  getSegmentCount(): number {
    return this.segmentCount;
  }

  incrementSegmentCount(): void {
    this.segmentCount++;
  }

  setLastSegmentEndSample(sample: number): void {
    this.lastSegmentEndSample = sample;
  }

  getLastSegmentEndSample(): number {
    return this.lastSegmentEndSample;
  }

  getChunkStartSample(): number {
    return this.chunkStartSample;
  }

  setChunkStartSample(sample: number): void {
    this.chunkStartSample = sample;
  }

  getSamplesInCurrentChunk(): number {
    return this.processedSampleCount - this.chunkStartSample;
  }

  isAtSoftLimit(): boolean {
    return (
      this.getSamplesInCurrentChunk() >=
      AUDIO_CAPTURE_CONFIG.CHUNK_SOFT_LIMIT_SAMPLES
    );
  }

  isAtHardLimit(): boolean {
    return (
      this.getSamplesInCurrentChunk() >=
      AUDIO_CAPTURE_CONFIG.CHUNK_HARD_LIMIT_SAMPLES
    );
  }

  getAudioSlice(start: number, end: number): Float32Array {
    if (start >= end) return new Float32Array(0);

    const totalNeeded = end - start;
    const result = new Float32Array(totalNeeded);
    let destOffset = 0;
    let currentPos = 0;

    for (const chunk of this.fullAudioHistory) {
      const chunkLen = chunk.length;

      if (currentPos + chunkLen <= start) {
        currentPos += chunkLen;
        continue;
      }
      if (currentPos >= end) {
        break;
      }

      const overlapStart = Math.max(0, start - currentPos);
      const overlapEnd = Math.min(chunkLen, end - currentPos);
      const count = overlapEnd - overlapStart;

      if (count > 0) {
        result.set(chunk.subarray(overlapStart, overlapEnd), destOffset);
        destOffset += count;
      }

      currentPos += chunkLen;
    }
    return result;
  }

  getFullAudioSinceLast(): Float32Array {
    return this.getAudioSlice(0, this.processedSampleCount);
  }

  getCurrentChunkAudio(): Float32Array {
    return this.getAudioSlice(this.chunkStartSample, this.processedSampleCount);
  }

  getTailAudio(): Float32Array | null {
    if (this.processedSampleCount <= this.lastSegmentEndSample) {
      return null;
    }
    return this.getAudioSlice(
      this.lastSegmentEndSample,
      this.processedSampleCount,
    );
  }

  trimHistory(): void {
    const keepFromSample = Math.max(
      0,
      this.processedSampleCount - AUDIO_CAPTURE_CONFIG.CHUNK_HARD_LIMIT_SAMPLES,
    );
    if (keepFromSample <= 0) return;

    let samplesToRemove = 0;
    let chunksToRemove = 0;

    for (const chunk of this.fullAudioHistory) {
      if (samplesToRemove + chunk.length <= keepFromSample) {
        samplesToRemove += chunk.length;
        chunksToRemove++;
      } else {
        break;
      }
    }

    if (chunksToRemove > 0) {
      this.fullAudioHistory.splice(0, chunksToRemove);
      this.chunkStartSample = Math.max(
        0,
        this.chunkStartSample - samplesToRemove,
      );
      this.lastSegmentEndSample = Math.max(
        0,
        this.lastSegmentEndSample - samplesToRemove,
      );
    }
  }

  advanceChunk(): void {
    this.chunkStartSample = this.processedSampleCount;
    this.trimHistory();
  }

  hasAudioData(): boolean {
    return this.processedSampleCount > 0;
  }

  hasNoSegments(): boolean {
    return this.segmentCount === 0;
  }
}
