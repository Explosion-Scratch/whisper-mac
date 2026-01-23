export interface MicrophoneDevice {
  deviceId: string;
  label: string;
  groupId?: string;
}

export class MicrophoneService {
  private static instance: MicrophoneService;

  static getInstance(): MicrophoneService {
    if (!MicrophoneService.instance) {
      MicrophoneService.instance = new MicrophoneService();
    }
    return MicrophoneService.instance;
  }

  private constructor() {
    // No IPC handlers needed - microphone enumeration moved to settings window
  }

  /**
   * Get audio constraints using stored microphone settings
   */
  getAudioConstraints(selectedDeviceId?: string): MediaStreamConstraints {
    const audioConstraints: MediaTrackConstraints = {
      sampleRate: 16000,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
    };

    if (selectedDeviceId && selectedDeviceId !== "default") {
      audioConstraints.deviceId = { exact: selectedDeviceId };
    }

    return { audio: audioConstraints };
  }
}
