import { dialog } from "electron";
import {
  ErrorWindowService,
  ErrorPayload,
} from "../services/ErrorWindowService";

export class ErrorManager {
  private errorService: ErrorWindowService;

  constructor() {
    this.errorService = new ErrorWindowService();
    this.setupGlobalErrorHandlers();
  }

  private setupGlobalErrorHandlers(): void {
    process.on("uncaughtException", (err: any) => {
      console.error("Uncaught exception:", err);
      this.showError({
        title: "Unexpected error",
        description: err?.message || String(err),
        actions: ["ok", "quit"],
      });
    });

    process.on("unhandledRejection", (reason: any) => {
      console.error("Unhandled rejection:", reason);
      this.showError({
        title: "Unexpected error",
        description:
          (reason && (reason.message || reason.toString())) || "Unknown error",
        actions: ["ok", "quit"],
      });
    });
  }

  async showError(payload: ErrorPayload): Promise<void> {
    try {
      await this.errorService.show(payload);
    } catch (e) {
      await this.showFallbackError(payload);
    }
  }

  private async showFallbackError(payload: ErrorPayload): Promise<void> {
    try {
      await dialog.showMessageBox({
        type: "error",
        title: payload.title || "Error",
        message: payload.title || "Error",
        detail: payload.description || "",
        buttons: ["OK"],
        defaultId: 0,
      });
    } catch (e) {
      console.error("Failed to show fallback error dialog:", e);
    }
  }

  async showPortInUseError(port: number): Promise<void> {
    await this.showError({
      title: "Port in use",
      description: `Port ${port} is already in use. Open Settings → Advanced and change "Server Port", then try again.`,
      actions: ["ok"],
    });
  }

  cleanup(): void {
    this.errorService.cleanup();
  }
}
