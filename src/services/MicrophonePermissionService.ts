import { systemPreferences } from "electron";

export class MicrophonePermissionService {
  private microphoneEnabled: boolean | null = null;

  /**
   * Check if the application has microphone permissions
   * Uses Electron's systemPreferences API to check microphone access status
   */
  async checkMicrophonePermissions(): Promise<boolean> {
    if (this.microphoneEnabled !== null) {
      return this.microphoneEnabled;
    }

    console.log(
      "=== MicrophonePermissionService.checkMicrophonePermissions ===",
    );

    try {
      // Use Electron's systemPreferences API to check microphone access
      const microphoneAccessStatus = systemPreferences.getMediaAccessStatus('microphone');
      console.log("Microphone access status:", microphoneAccessStatus);

      // 'granted' means the user has explicitly granted permission
      // 'not-determined' means the user hasn't been asked yet
      // 'denied' means the user has explicitly denied permission
      // 'restricted' means access is restricted (parental controls, etc.)
      // 'unknown' means the status cannot be determined
      this.microphoneEnabled = microphoneAccessStatus === 'granted';

      return this.microphoneEnabled;
    } catch (error) {
      console.error("Error checking microphone permissions:", error);
      this.microphoneEnabled = false;
      return false;
    }
  }

  /**
   * Show instructions for enabling microphone permissions
   */
  async showMicrophoneInstructions(): Promise<void> {
    console.log(
      "=== MicrophonePermissionService.showMicrophoneInstructions ===",
    );

    const script = `
      display dialog "WhisperMac needs microphone permissions to capture your voice for transcription.

To enable microphone permissions:
1. Click 'Open System Preferences' below
2. Go to Privacy & Security > Microphone
3. Find WhisperMac in the list
4. Check the box next to WhisperMac
5. Return to this window and click 'Check Permission'

The app will automatically detect when permissions are enabled." buttons {"Open System Preferences", "OK"} default button "Open System Preferences" with title "Microphone Permissions Required"
    `;

    try {
      const { execFile } = require("child_process");
      await new Promise<void>((resolve, reject) => {
        execFile("osascript", ["-e", script], (error: any) => {
          if (error) {
            console.error("Failed to show microphone instructions:", error);
            reject(error);
          } else {
            console.log("Microphone instructions displayed successfully");
            resolve();
          }
        });
      });
    } catch (error) {
      console.error("Failed to show microphone instructions:", error);
      throw new Error(
        "MICROPHONE PERMISSIONS REQUIRED - CHECK SYSTEM PREFERENCES",
      );
    }
  }

  /**
   * Check if microphone permissions are enabled and show instructions if not
   */
  async ensureMicrophonePermissions(): Promise<boolean> {
    console.log(
      "=== MicrophonePermissionService.ensureMicrophonePermissions ===",
    );

    // Reset cache to get fresh status
    this.microphoneEnabled = null;

    try {
      const microphoneAccessStatus = systemPreferences.getMediaAccessStatus('microphone');
      console.log("Current microphone access status:", microphoneAccessStatus);

      if (microphoneAccessStatus === 'granted') {
        this.microphoneEnabled = true;
        return true;
      } else if (microphoneAccessStatus === 'not-determined') {
        // Try to ask for microphone access by making a request
        try {
          console.log("Requesting microphone access...");
          await systemPreferences.askForMediaAccess('microphone');

          // Check status again after request
          const newStatus = systemPreferences.getMediaAccessStatus('microphone');
          console.log("Microphone access status after request:", newStatus);
          this.microphoneEnabled = newStatus === 'granted';

          if (!this.microphoneEnabled) {
            await this.showMicrophoneInstructions();
          }

          return this.microphoneEnabled;
        } catch (error) {
          console.error("Error requesting microphone access:", error);
          await this.showMicrophoneInstructions();
          return false;
        }
      } else {
        // Status is 'denied', 'restricted', or 'unknown'
        console.log("Microphone permissions not enabled, showing instructions...");
        await this.showMicrophoneInstructions();
        return false;
      }
    } catch (error) {
      console.error("Error in ensureMicrophonePermissions:", error);
      await this.showMicrophoneInstructions();
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
