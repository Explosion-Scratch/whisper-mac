import { spawn, ChildProcess } from "child_process";
import WebSocket from "ws";
import { join } from "path";
import { AppConfig } from "../config/AppConfig";

export class WhisperLiveClient {
  private serverProcess: ChildProcess | null = null;
  private websocket: WebSocket | null = null;
  private config: AppConfig;
  private onTranscriptionCallback: ((text: string) => void) | null = null;

  constructor(config: AppConfig) {
    this.config = config;
  }

  async startServer(modelSize: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const modelPath = join(this.config.modelPath, `${modelSize}.pt`);
      const pythonPath = join(__dirname, "../../python/whisper_server.py");

      console.log(`Starting WhisperLive server with model: ${modelPath}`);

      this.serverProcess = spawn(
        "python3",
        [
          pythonPath,
          "--port",
          this.config.serverPort.toString(),
          "--model",
          modelSize,
          "--model-path",
          modelPath,
        ],
        {
          stdio: ["pipe", "pipe", "pipe"],
        },
      );

      let serverStarted = false;

      this.serverProcess.stdout?.on("data", (data) => {
        const output = data.toString();
        console.log("WhisperLive Server:", output);

        // Check for different server start messages
        if (
          output.includes("Uvicorn running on") ||
          output.includes("Server started")
        ) {
          if (!serverStarted) {
            serverStarted = true;
            resolve();
          }
        }
      });

      this.serverProcess.stderr?.on("data", (data) => {
        const errorOutput = data.toString();
        console.error("WhisperLive Server Error:", errorOutput);

        // Sometimes server info goes to stderr
        if (errorOutput.includes("Uvicorn running on") && !serverStarted) {
          serverStarted = true;
          resolve();
        }
      });

      this.serverProcess.on("error", (error) => {
        console.error("Failed to start WhisperLive server:", error);
        reject(new Error(`Failed to start server: ${error.message}`));
      });

      this.serverProcess.on("exit", (code) => {
        console.log(`WhisperLive server exited with code ${code}`);
        if (code !== 0 && !serverStarted) {
          reject(new Error(`Server failed to start, exit code: ${code}`));
        }
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        if (!serverStarted) {
          reject(new Error("Server startup timeout"));
        }
      }, 30000);
    });
  }

  async startTranscription(
    onTranscription: (text: string) => void,
  ): Promise<void> {
    this.onTranscriptionCallback = onTranscription;

    // Wait a bit for server to be ready
    await new Promise((resolve) => setTimeout(resolve, 1000));

    this.websocket = new WebSocket(`ws://localhost:${this.config.serverPort}`);

    this.websocket.on("open", () => {
      console.log("Connected to WhisperLive server");

      // Send configuration
      this.websocket?.send(
        JSON.stringify({
          type: "config",
          model: this.config.defaultModel,
          language: "auto",
          task: "transcribe",
        }),
      );
    });

    this.websocket.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.type === "transcription" && message.text) {
          this.onTranscriptionCallback?.(message.text);
        }
      } catch (error) {
        console.error("Failed to parse WebSocket message:", error);
      }
    });

    this.websocket.on("error", (error) => {
      console.error("WebSocket error:", error);
    });

    this.websocket.on("close", () => {
      console.log("WebSocket connection closed");
    });
  }

  async stopTranscription(): Promise<void> {
    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }
  }

  sendAudioData(audioBlob: Blob): void {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      audioBlob.arrayBuffer().then((buffer) => {
        this.websocket?.send(buffer);
      });
    }
  }

  async stopServer(): Promise<void> {
    if (this.serverProcess) {
      this.serverProcess.kill("SIGTERM");
      this.serverProcess = null;
    }
  }
}
