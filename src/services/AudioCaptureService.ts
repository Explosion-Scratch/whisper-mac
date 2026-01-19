import { EventEmitter } from "events";
import { AudioCaptureNative } from "../native/AudioCaptureBindings";
import { AppConfig } from "../config/AppConfig";
import * as fs from "fs/promises";
import * as path from "path";
import * as ort from "onnxruntime-node";

// Import internals from vad-node as they are not exposed in the main entry point
// We need to access dist/_common/models and dist/_common/frame-processor directly or via provided exports if possible.
// Upon inspection, Silero is in _common/models.js and FrameProcessor is exported in index.js
const { FrameProcessor, Message } = require("@ricky0123/vad-node");
const { Silero } = require("@ricky0123/vad-node/dist/_common/models");

export class AudioCaptureService extends EventEmitter {
  private nativeAudio: AudioCaptureNative;
  private vadModel: any = null;
  private frameProcessor: any = null;
  private isRecording: boolean = false;
  
  // VAD Config
  private vadOptions = {
    positiveSpeechThreshold: 0.5,
    negativeSpeechThreshold: 0.35,
    minSpeechFrames: 3,
    preSpeechPadFrames: 10,
    redemptionFrames: 10,
    sampleRate: 16000,
    frameSamples: 512, // Native module sends 512 samples
  };

  private audioBuffer: Float32Array[] = [];
  
  // Full session history tracking
  private fullAudioHistory: Float32Array[] = [];
  private processedSampleCount: number = 0;
  private segmentCount: number = 0;
  private lastSegmentEndSample: number = 0;

  constructor(private config: AppConfig) {
    super();
    this.nativeAudio = new AudioCaptureNative();
  }

  async initialize(): Promise<void> {
    console.log("Initializing AudioCaptureService...");
    try {
      // Logic to load Silero model
      // We need to resolve the path to silero_vad.onnx which is in the dist folder of the package
      const vadPackagePath = require.resolve("@ricky0123/vad-node/package.json");
      const modelPath = path.join(path.dirname(vadPackagePath), "dist", "silero_vad.onnx");
      
      const modelFetcher = async () => {
          const contents = await fs.readFile(modelPath);
          return contents.buffer;
      };

      this.vadModel = await Silero.new(ort, modelFetcher);
      this.frameProcessor = new FrameProcessor(
          this.vadModel.process,
          this.vadModel.reset_state,
          this.vadOptions
      );
      this.frameProcessor.resume();
      
      console.log("VAD Initialized with custom FrameProcessor");
      
      // Process any buffered audio
      if (this.audioBuffer.length > 0) {
          console.log(`Processing ${this.audioBuffer.length} buffered audio chunks...`);
          for (const chunk of this.audioBuffer) {
              await this.handleAudioData(chunk);
          }
          this.audioBuffer = [];
          console.log("Buffered audio processed");
      }
      
    } catch (e) {
      console.error("Failed to initialize VAD:", e);
    }
  }

  async startCapture(): Promise<boolean> {
    if (this.isRecording) return true;
    
    console.log("Starting native audio capture...");
    
    // START CHANGE: Clear buffer
    this.audioBuffer = []; 
    this.fullAudioHistory = [];
    this.processedSampleCount = 0;
    this.segmentCount = 0;
    this.lastSegmentEndSample = 0; 
    
    // Ensure VAD is ready
    if (!this.frameProcessor) {
      // Don't await here, let it run in background so we start capture immediately?
      // Actually, we want to start capturing so we don't miss packets, but handleAudioData handles the buffering.
      this.initialize();
    } else {
        // Reset VAD state on start if already exists
        this.frameProcessor.resume();
        this.frameProcessor.reset();
    }
    
    const success = this.nativeAudio.start(
      { sampleRate: 16000, bufferSize: 512 },
      (data: Float32Array) => this.handleAudioData(data)
    );

    if (success) {
      this.isRecording = true;
      this.emit("recording-started");
    } else {
      console.error("Failed to start native audio capture");
    }

    return success;
  }

  private lastProcessPromise: Promise<void> = Promise.resolve();

  async stopCapture(): Promise<Float32Array | null> {
    if (!this.isRecording) return null;
    
    console.log(`[AudioCaptureService] Stopping capture. State:`, {
      segmentCount: this.segmentCount,
      processedSampleCount: this.processedSampleCount,
      lastSegmentEndSample: this.lastSegmentEndSample,
    });
    
    // 1. Stop native capture immediately so no new chunks are queued to the native callback
    this.nativeAudio.stop();
    this.isRecording = false;
    this.emit("recording-stopped");
    
    // 2. Wait for any in-flight VAD processing to complete
    try {
        await this.lastProcessPromise;
    } catch (e) {
        console.error("Error waiting for VAD processing during stop:", e);
    }

    // 3. Pause VAD and check for final segment
    // Now we know all previous chunks have been processed.
    if (this.frameProcessor) {
        // Force end segment if speaking
        const res = this.frameProcessor.pause();
        if (res.msg === Message.SpeechEnd && res.audio) {
            console.log("VAD Capture: Retrieved final segment from pause() of length:", res.audio.length);
            
            this.segmentCount++;
            let audioToEmit = res.audio;
            
            // If this is the ONLY segment, we want the whole thing [0...End]
            if (this.segmentCount === 1) {
                 audioToEmit = this.getAudioSlice(0, this.processedSampleCount);
            }
            // If it's a later segment, we use the VAD audio (middle chunk)
            // But wait, pause() implies we Cut RIGHT NOW.
            // So subsequent Silence is 0.
            
            this.emit("vad-segment", audioToEmit);
            this.lastSegmentEndSample = this.processedSampleCount;
            // Return it? The original code returned it. 
            // In the new logic, we emitted it. 
            // The return value was used by caller? 
            // Looking at the codebase, stopCapture return value usage is unclear but likely handled via events usually.
            // But we should probably return it for consistency if any callers rely on it.
            // However, we just emitted it. If caller listens to event, they get it.
            
        } else {
             console.log("VAD Capture: pause() did not return SpeechEnd. Msg:", res.msg);
        }
    }
    
    // 4. Handle "No VAD" or "Tail" cases
    let fallbackAudio: Float32Array | null = null;

    if (this.segmentCount === 0) {
        // CASE: No segments detected. Send EVERYTHING.
        if (this.processedSampleCount > 0) {
            console.log(`[AudioCaptureService] No VAD segments detected. Emitting full recording buffer (${this.processedSampleCount} samples)`);
            const fullAudio = this.getAudioSlice(0, this.processedSampleCount);
            this.emit("vad-segment", fullAudio);
            fallbackAudio = fullAudio;
        } else {
            console.log(`[AudioCaptureService] No VAD segments and no audio samples processed`);
        }
    } else {
        // CASE: Segments detected. Send potential TAIL.
        if (this.processedSampleCount > this.lastSegmentEndSample) {
            const tailLen = this.processedSampleCount - this.lastSegmentEndSample;
            console.log(`[AudioCaptureService] Emitting tail segment (${tailLen} samples)`);
            const tailAudio = this.getAudioSlice(this.lastSegmentEndSample, this.processedSampleCount);
            this.emit("vad-segment", tailAudio);
        } else {
            console.log(`[AudioCaptureService] No tail segment needed (processedSampleCount=${this.processedSampleCount}, lastSegmentEndSample=${this.lastSegmentEndSample})`);
        }
    }

    return fallbackAudio;
  }

  // Helper to extract a range from the full history
  private getAudioSlice(start: number, end: number): Float32Array {
      if (start >= end) return new Float32Array(0);
      
      const totalNeeded = end - start;
      const result = new Float32Array(totalNeeded);
      let destOffset = 0;
      let currentPos = 0;

      for (const chunk of this.fullAudioHistory) {
          const chunkLen = chunk.length;
          // Optimizations for skipping
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

  private async handleAudioData(data: Float32Array): Promise<void> {
    // If we received data after stopping native audio but before the flag was flipped 
    // (unlikely given order in stopCapture, but possible if queued), we process it if possible.
    // However, we rely on isRecording check mostly.
    if (!this.isRecording && this.audioBuffer.length === 0) return;

    // 1. Emit audio level for visualizer
    const level = this.nativeAudio.getAudioLevel();
    this.emit("audio-level", level);

    // 2. Process VAD
    // Chain onto the last promise to ensure sequential execution
    this.lastProcessPromise = this.lastProcessPromise.then(async () => {
        if (!this.frameProcessor) {
            this.audioBuffer.push(data);
            return;
        }

        // Track full history for "No VAD" fallback and tail filling
        this.fullAudioHistory.push(data);
        this.processedSampleCount += data.length;

        try {
            const vadEvent = await this.frameProcessor.process(data);
            
            if (vadEvent.msg === Message.SpeechEnd && vadEvent.audio) {
               this.segmentCount++;
               console.log(`VAD Speech End Detected (Segment ${this.segmentCount}), length:`, vadEvent.audio.length);
               this.emit("speech-end");
               
               // Logic:
               // 1. If First Chunk: Send [0 ... currentProcessedTime]
               //    Actually, vadEvent.audio is just the speech.
               //    We want to include the PRE-SPEECH silence too.
               //    So we use getAudioSlice(0, this.processedSampleCount).
               //    NOTE: process() is async, but we are in the .then(), so 'processedSampleCount' is up to date with THIS chunk.
               
               let audioToEmit = vadEvent.audio;

               if (this.segmentCount === 1) {
                   console.log("Emitting First Chunk (Start -> End of first segment)");
                   // We want everything from 0 to NOW.
                   // vadEvent.audio end aligns roughly with processedSampleCount.
                   audioToEmit = this.getAudioSlice(0, this.processedSampleCount);
               } 
               
               this.emit("vad-segment", audioToEmit);
               this.lastSegmentEndSample = this.processedSampleCount;

            } else if (vadEvent.msg === Message.SpeechStart) {
                console.log("VAD Speech Start Detected");
                this.emit("speech-start");
            }
            
        } catch (e) {
            console.error("VAD processing error:", e);
        }
    });

    // We don't await the chain here because this function is a callback that returns void to the native side
    // (though we typed it as Promise<void>, the caller ignores it).
    // The await happens in stopCapture.
  }
}
