import { execFile } from "child_process";
import { Notification } from "electron";

interface ProcessResult {
  success: boolean;
  output?: string;
  error?: string;
}

export interface NotificationOptions {
  title?: string;
  subtitle?: string;
  message: string;
  sound?: string;
  timeout?: number;
  icon?: string;
}

export class NotificationService {
  private static readonly DEFAULT_TITLE = "WhisperMac";
  private static readonly TIMEOUT_MS = 10000;

  /**
   * Send a notification to the user using Electron's native notifications
   * @param options Notification configuration options
   */
  async sendNotification(options: NotificationOptions): Promise<void> {
    const {
      title = NotificationService.DEFAULT_TITLE,
      subtitle,
      message,
      sound,
      timeout = NotificationService.TIMEOUT_MS,
      icon,
    } = options;

    if (!message?.trim()) {
      throw new Error("Notification message cannot be empty");
    }

    try {
      // Try using Electron's native notification first
      if (this.canUseNativeNotifications()) {
        console.log("Using native Electron notifications");
        await this.sendNativeNotification(
          title,
          subtitle,
          message,
          sound,
          icon,
        );
      } else {
        console.log("Falling back to AppleScript notifications");
        // Fallback to AppleScript for environments where Electron notifications aren't available
        await this.executeAppleScript(
          this.buildNotificationScript(title, subtitle, message, sound, icon),
          timeout,
        );
      }
    } catch (error) {
      console.warn("Failed to show notification:", error);
      // Fallback to console log if notification fails
      console.log(`NOTIFICATION: ${title} - ${message}`);
    }
  }

  /**
   * Send a simple notification with just a message
   * @param message The notification message
   */
  async sendSimpleNotification(message: string): Promise<void> {
    await this.sendNotification({ message });
  }

  /**
   * Send a clipboard notification specifically for text copy operations
   * @param customMessage Optional custom message, defaults to standard clipboard message
   */
  async sendClipboardNotification(customMessage?: string): Promise<void> {
    const message =
      customMessage || "Text copied to clipboard. Press Cmd+V to paste.";

    await this.sendNotification({
      message,
      sound: "default",
    });
  }

  /**
   * Send an error notification
   * @param message The error message
   * @param title Optional custom title
   */
  async sendErrorNotification(message: string, title?: string): Promise<void> {
    await this.sendNotification({
      title: title || "WhisperMac Error",
      message,
      sound: "Basso",
    });
  }

  /**
   * Send a success notification
   * @param message The success message
   * @param title Optional custom title
   */
  async sendSuccessNotification(
    message: string,
    title?: string,
  ): Promise<void> {
    await this.sendNotification({
      title: title || "WhisperMac",
      message,
      sound: "Glass",
    });
  }

  /**
   * Check if native Electron notifications can be used
   */
  private canUseNativeNotifications(): boolean {
    try {
      return Notification.isSupported && Notification.isSupported();
    } catch (error) {
      return false;
    }
  }

  /**
   * Send notification using Electron's native notification system
   */
  private async sendNativeNotification(
    title: string,
    subtitle?: string,
    message?: string,
    sound?: string,
    icon?: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const notificationOptions: any = {
          title,
          body: message || "",
          silent: !sound, // If sound is specified, don't make it silent
        };

        // Add subtitle if provided (not all platforms support this)
        if (subtitle) {
          notificationOptions.subtitle = subtitle;
        }

        // Only add icon if explicitly provided
        if (icon) {
          notificationOptions.icon = icon;
          console.log(`Using custom notification icon: ${icon}`);
        } else {
          console.log("Using system default notification icon");
        }

        const notification = new Notification(notificationOptions);

        notification.on("show", () => {
          console.log("Native notification shown successfully");
          resolve();
        });

        notification.on("failed", (event, error) => {
          console.warn("Native notification failed:", error);
          reject(new Error(`Native notification failed: ${error}`));
        });

        // Handle sound separately for macOS
        if (sound && process.platform === "darwin") {
          this.playNotificationSound(sound).catch((err) => {
            console.warn("Failed to play notification sound:", err);
          });
        }

        notification.show();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Play notification sound on macOS
   */
  private async playNotificationSound(sound: string): Promise<void> {
    try {
      await this.executeAppleScript(`beep`);
    } catch (error) {
      console.warn("Failed to play notification sound:", error);
    }
  }

  private buildNotificationScript(
    title: string,
    subtitle?: string,
    message?: string,
    sound?: string,
    icon?: string,
  ): string {
    // Escape quotes in the message and title to prevent AppleScript injection
    const escapedMessage = (message || "").replace(/"/g, '\\"');
    const escapedTitle = title.replace(/"/g, '\\"');
    const escapedSubtitle = subtitle?.replace(/"/g, '\\"');

    let script = `display notification "${escapedMessage}" with title "${escapedTitle}"`;

    if (escapedSubtitle) {
      script += ` subtitle "${escapedSubtitle}"`;
    }

    if (sound) {
      script += ` sound name "${sound}"`;
    }

    // Note: macOS notifications typically use the app's bundle icon automatically
    // The custom icon would require using a different notification method
    // For now, we ensure the app bundle has the correct icon set

    return script;
  }

  private async executeAppleScript(
    script: string,
    timeout: number = NotificationService.TIMEOUT_MS,
  ): Promise<string> {
    const result = await this.executeProcess(
      "osascript",
      ["-e", script],
      timeout,
    );

    if (!result.success) {
      throw new Error(`AppleScript failed: ${result.error}`);
    }

    return result.output || "";
  }

  private async executeProcess(
    command: string,
    args: string[],
    timeout: number = NotificationService.TIMEOUT_MS,
  ): Promise<ProcessResult> {
    return new Promise((resolve) => {
      const process = execFile(
        command,
        args,
        { timeout },
        (error, stdout, stderr) => {
          if (error) {
            resolve({
              success: false,
              error: stderr || error.message,
              output: stdout,
            });
          } else {
            resolve({
              success: true,
              output: stdout,
              error: stderr,
            });
          }
        },
      );

      process.on("error", (error) => {
        resolve({
          success: false,
          error: error.message,
        });
      });
    });
  }
}
