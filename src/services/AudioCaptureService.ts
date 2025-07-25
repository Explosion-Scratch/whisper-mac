import { EventEmitter } from "events";
import { AppConfig } from "../config/AppConfig";

export class AudioCaptureService extends EventEmitter {
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private audioChunks: Blob[] = [];
  private config: AppConfig;

  constructor(config: AppConfig) {
    super();
    this.config = config;
  }

  async startCapture(): Promise<void> {
    try {
      // Request microphone permission
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType: "audio/webm;codecs=opus",
      });

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
          this.emit("audioData", event.data);
        }
      };

      this.mediaRecorder.start(100); // Collect 100ms chunks
    } catch (error) {
      let errMsg = "Unknown error";
      if (error instanceof Error) {
        errMsg = error.message;
      }
      throw new Error(`Failed to start audio capture: ${errMsg}`);
    }
  }

  async stopCapture(): Promise<void> {
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.stop();
    }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    this.audioChunks = [];
  }

  getAudioStream(): MediaStream | null {
    return this.stream;
  }
}
