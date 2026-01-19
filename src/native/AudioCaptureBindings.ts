
// Runtime-safe loader for the native audio capture module
// Handles loading from different paths for dev/prod environments

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let nativeBinding: any = {};

try {
  // Primary: next to compiled file (e.g., dist/native/audio_capture.node)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  nativeBinding = require("./audio_capture.node");
} catch (_) {
  try {
    // Dev: built via node-gyp under native/audio-capture
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    nativeBinding = require("../../native/audio-capture/build/Release/audio_capture.node");
  } catch (err) {
    console.warn(
      "audio_capture native module could not be loaded; native audio features will be disabled",
      err
    );
    nativeBinding = {};
  }
}

export interface AudioCaptureBinding {
  start: (options: { sampleRate: number; bufferSize: number }, callback: (data: Float32Array) => void) => boolean;
  stop: () => boolean;
  checkMicrophonePermission: () => "authorized" | "denied" | "restricted" | "not_determined" | "unknown";
  requestMicrophonePermission: () => Promise<boolean>;
  getAudioLevel: () => number;
}

// Helper class to instantiate the native object
export class AudioCaptureNative {
  private instance: AudioCaptureBinding;

  constructor() {
    if (nativeBinding.AudioCapture) {
      this.instance = new nativeBinding.AudioCapture();
    } else {
        // Fallback or error
        this.instance = {
            start: () => false,
            stop: () => false,
            checkMicrophonePermission: () => "unknown",
            requestMicrophonePermission: async () => false,
            getAudioLevel: () => 0
        };
    }
  }

  start(options: { sampleRate: number; bufferSize: number }, callback: (data: Float32Array) => void): boolean {
    return this.instance.start(options, callback);
  }

  stop(): boolean {
    return this.instance.stop();
  }

  checkMicrophonePermission(): "authorized" | "denied" | "restricted" | "not_determined" | "unknown" {
    return this.instance.checkMicrophonePermission();
  }

  requestMicrophonePermission(): Promise<boolean> {
    return this.instance.requestMicrophonePermission();
  }
  
  getAudioLevel(): number {
      return this.instance.getAudioLevel();
  }
}
