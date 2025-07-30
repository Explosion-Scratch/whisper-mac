import { spawn, ChildProcess } from "child_process";
import WebSocket from "ws";
import { join } from "path";
import { AppConfig } from "../config/AppConfig";
import { ModelManager } from "./ModelManager";
import { SegmentUpdate } from "../types/SegmentTypes";

export class TranscriptionClient {
  private serverProcess: ChildProcess | null = null;
  private websocket: WebSocket | null = null;
  private config: AppConfig;
  private modelManager: ModelManager;
  private onTranscriptionCallback: ((update: SegmentUpdate) => void) | null =
    null;

  constructor(config: AppConfig, modelManager: ModelManager) {
    this.config = config;
    this.modelManager = modelManager;
  }

  async startServer(modelRepoId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.serverProcess) {
        console.log("RealtimeSTT server already running.");
        resolve();
        return;
      }

      const modelDir = this.modelManager.getModelDirectory(modelRepoId);
      const serverScript = join(__dirname, "../../server/realtimestt.py");

      const args = [
        serverScript,
        "--port",
        this.config.serverPort.toString(),
        "--model",
        modelDir,
        "--language",
        "en",
        "--device",
        "cpu", // Or make configurable
      ];

      console.log(
        "Launching RealtimeSTT server:",
        ["python3", ...args].join(" ")
      );

      this.serverProcess = spawn("python3", args, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let resolved = false;

      setTimeout(() => {
        if (!resolved) {
          resolve();
          resolved = true;
        }
      }, 1000);

      this.serverProcess.stdout?.on("data", (d) => {
        const msg = d.toString();
        console.log("[RealtimeSTT]", msg);
        if (
          !resolved &&
          msg.includes("[RealtimeSTT]") &&
          msg.toLowerCase().includes("listening")
        ) {
          resolved = true;
          resolve();
        }
      });

      this.serverProcess.stderr?.on("data", (d) => {
        const msg = d.toString();
        console.error("[RealtimeSTT]", msg);
        if (!resolved && msg.includes("address already in use")) {
          console.warn("Address already in use, assuming server is running.");
          resolved = true;
          resolve();
        }
      });

      this.serverProcess.on("exit", (code) => {
        console.log("RealtimeSTT server exited with code", code);
        this.serverProcess = null;
        if (!resolved) reject(new Error(`Server exited with code ${code}`));
      });

      setTimeout(() => {
        if (!resolved) {
          console.error("RealtimeSTT server startup timeout.");
          reject(new Error("Server startup timeout"));
        }
      }, 20000);
    });
  }

  async startTranscription(
    onTranscription: (update: SegmentUpdate) => void
  ): Promise<void> {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      console.log("WebSocket already open. Reusing connection.");
      this.onTranscriptionCallback = onTranscription;
      return;
    }

    this.onTranscriptionCallback = onTranscription;

    return new Promise((resolve, reject) => {
      this.websocket = new WebSocket(
        `ws://127.0.0.1:${this.config.serverPort}`
      );

      this.websocket.on("open", () => {
        console.log("Connected to RealtimeSTT server");
        resolve();
      });

      this.websocket.on("message", (data) => {
        try {
          const update: SegmentUpdate = JSON.parse(data.toString());
          this.onTranscriptionCallback?.(update);
        } catch (e) {
          console.error("Bad WebSocket message from RealtimeSTT server:", e);
        }
      });

      this.websocket.on("error", (err) => {
        console.error("RealtimeSTT WS error:", err);
        reject(err);
      });

      this.websocket.on("close", (code, reason) => {
        console.log("RealtimeSTT WS closed:", code, reason.toString());
        this.websocket = null;
      });
    });
  }

  sendAudioData(audioData: Float32Array): void {
    if (this.websocket?.readyState === WebSocket.OPEN) {
      this.websocket.send(audioData);
    }
  }

  async stopTranscription(): Promise<void> {
    if (this.websocket?.readyState === WebSocket.OPEN) {
      this.websocket.send(JSON.stringify({ EOS: true }));
      console.log("Sent EOS to RealtimeSTT server.");
    }
  }

  async stopServer(): Promise<void> {
    if (this.serverProcess) {
      console.log("Stopping RealtimeSTT server...");
      this.serverProcess.kill("SIGTERM");
      this.serverProcess = null;
    }
    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }
  }
}
