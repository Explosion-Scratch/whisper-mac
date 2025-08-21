export class MicrophonePermissionService {
  private microphoneEnabled: boolean | null = null;

  /**
   * Check if the application has microphone permissions
   * Note: This method is called from the main process but the actual
   * permission check happens in the renderer process
   */
  async checkMicrophonePermissions(): Promise<boolean> {
    if (this.microphoneEnabled !== null) {
      return this.microphoneEnabled;
    }

    console.log(
      "=== MicrophonePermissionService.checkMicrophonePermissions ==="
    );

    // Since we can't access navigator.mediaDevices from the main process,
    // we'll just show the instructions and let the renderer handle the actual check
    this.microphoneEnabled = false;
    return false;
  }

  /**
   * Show instructions for enabling microphone permissions
   */
  async showMicrophoneInstructions(): Promise<void> {
    console.log(
      "=== MicrophonePermissionService.showMicrophoneInstructions ==="
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
        "MICROPHONE PERMISSIONS REQUIRED - CHECK SYSTEM PREFERENCES"
      );
    }
  }

  /**
   * Check if microphone permissions are enabled and show instructions if not
   */
  async ensureMicrophonePermissions(): Promise<boolean> {
    console.log(
      "=== MicrophonePermissionService.ensureMicrophonePermissions ==="
    );

    const hasMicrophone = await this.checkMicrophonePermissions();

    if (!hasMicrophone) {
      console.log(
        "Microphone permissions not enabled, showing instructions..."
      );
      await this.showMicrophoneInstructions();
    }

    return hasMicrophone;
  }

  /**
   * Reset the microphone permission cache to force a fresh check
   */
  resetMicrophoneCache(): void {
    console.log("=== MicrophonePermissionService.resetMicrophoneCache ===");
    this.microphoneEnabled = null;
  }
}
