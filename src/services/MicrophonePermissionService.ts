import { AudioCaptureNative } from "../native/AudioCaptureBindings";
import { systemPreferences } from "electron";

export class MicrophonePermissionService {
  private microphoneEnabled: boolean | null = null;
  private nativeAudio: AudioCaptureNative;

  constructor() {
    this.nativeAudio = new AudioCaptureNative();
  }

  /**
   * Check if the application has microphone permissions
   * Uses Native Audio Capture module for accurate permission status
   */
  async checkMicrophonePermissions(): Promise<boolean> {
    if (this.microphoneEnabled !== null) {
      return this.microphoneEnabled;
    }

    console.log(
      "=== MicrophonePermissionService.checkMicrophonePermissions (Native) ===",
    );

    try {
      const status = this.nativeAudio.checkMicrophonePermission();
      console.log("Native Microphone permission status:", status);

      this.microphoneEnabled = status === "authorized";

      // Fallback to Electron check if native module fails or returns unknown
      if (status === "unknown") {
        const electronStatus =
          systemPreferences.getMediaAccessStatus("microphone");
        this.microphoneEnabled = electronStatus === "granted";
      }

      return this.microphoneEnabled;
    } catch (error) {
      console.error("Error checking native microphone permissions:", error);
      this.microphoneEnabled = false;
      return false;
    }
  }

  /**
   * Show instructions for enabling microphone permissions
   * @deprecated UI handling moved to main process
   */
  async showMicrophoneInstructions(): Promise<void> {
    // Deprecated, keeping empty implementation or reusing old logic if needed for fallback
    // For now, we rely on ensureMicrophonePermissions to trigger system prompt
  }

  /**
   * Check if microphone permissions are enabled and request them if possible
   */
  async ensureMicrophonePermissions(): Promise<boolean> {
    console.log(
      "=== MicrophonePermissionService.ensureMicrophonePermissions (Native) ===",
    );

    // Reset cache
    this.microphoneEnabled = null;

    try {
      const status = this.nativeAudio.checkMicrophonePermission();
      console.log("Current native microphone status:", status);

      if (status === "authorized") {
        this.microphoneEnabled = true;
        return true;
      } else if (status === "not_determined") {
        console.log("Requesting native microphone access...");
        // This triggers the macOS system dialog
        await this.nativeAudio.requestMicrophonePermission();

        // Check status again
        const newStatus = this.nativeAudio.checkMicrophonePermission();
        console.log("Native microphone status after request:", newStatus);
        this.microphoneEnabled = newStatus === "authorized";
        return this.microphoneEnabled;
      } else {
        // denied or restricted
        console.log("Microphone permissions denied or restricted");
        return false;
      }
    } catch (error) {
      console.error("Error in ensureMicrophonePermissions:", error);
      return false;
    }
  }

  /**
   * Reset the microphone permission cache to force a fresh check
   */
  resetMicrophoneCache(): void {
    console.log("=== MicrophonePermissionService.resetMicrophoneCache ===");
    this.microphoneEnabled = null;
  }
}
