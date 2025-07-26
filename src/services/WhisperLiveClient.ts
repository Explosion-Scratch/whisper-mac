import { spawn, ChildProcess } from "child_process";
import WebSocket from "ws";
import { join } from "path";
import { AppConfig } from "../config/AppConfig";
import { ModelManager } from "./ModelManager";
import { existsSync } from "fs";

export class WhisperLiveClient {
  private serverProcess: ChildProcess | null = null;
  private websocket: WebSocket | null = null;
  private config: AppConfig;
  private modelManager: ModelManager;
  private onTranscriptionCallback: ((text: string) => void) | null = null;

  constructor(config: AppConfig, modelManager: ModelManager) {
    this.config = config;
    this.modelManager = modelManager;
  }

  /* ----------------------------------------------------------
   * 1.  Clone the repo if it isn’t there yet
   * 2.  Start the server with the official run_server.py script
   * ---------------------------------------------------------- */
  async startServer(modelRepoId: string): Promise<void> {
    const repoDir = this.config.getWhisperLiveDir();
    const runScript = join(repoDir, "run_server.py");

    // Install with pip
    const runInstall = async (): Promise<void> => {
      return new Promise((resolve, reject) => {
        const install = spawn(
          "pip",
          ["install", "-r", "requirements/server.txt"],
          {
            cwd: repoDir,
            stdio: "inherit",
          }
        );
        install.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`pip install failed with code ${code}`));
        });
        install.on("error", reject);
      });
    };

    // Helper to run scripts/setup.sh
    const runSetup = async (): Promise<void> => {
      return new Promise((resolve, reject) => {
        const setupScript = join(repoDir, "scripts", "setup.sh");
        const setup = spawn("bash", [setupScript], {
          cwd: repoDir,
          stdio: "inherit",
        });
        setup.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`setup.sh failed with code ${code}`));
        });
        setup.on("error", reject);
      });
    };

    // 1. Clone once
    if (!existsSync(runScript)) {
      return new Promise((resolve, reject) => {
        // Ensure the parent directory exists
        const parentDir = join(repoDir, "..");
        if (!existsSync(parentDir)) {
          require("fs").mkdirSync(parentDir, { recursive: true });
        }

        const git = spawn(
          "git",
          ["clone", "https://github.com/collabora/WhisperLive.git", repoDir],
          { stdio: "inherit" }
        );
        git.on("close", async (code) => {
          if (code === 0) {
            try {
              await runInstall();
              await runSetup();
              resolve(this._launch(repoDir, modelRepoId));
            } catch (err) {
              reject(err);
            }
          } else {
            reject(new Error(`git clone failed with code ${code}`));
          }
        });
        git.on("error", reject);
      });
    }

    // 2. Already cloned – just launch
    return this._launch(repoDir, modelRepoId);
  }

  /* ----------------------------------------------------------
   * Internal: spawn the server exactly like the README shows
   * ---------------------------------------------------------- */
  private async _launch(repoDir: string, modelRepoId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const runScript = join(repoDir, "run_server.py");

      // Get the actual model directory path
      const modelDir = this.modelManager.getModelDirectory(modelRepoId);

      const args = [
        runScript,
        "--port",
        this.config.serverPort.toString(),
        "--backend",
        "faster_whisper",
        "--max_clients",
        "4",
        "--max_connection_time",
        "600",
        "--cache_path",
        this.config.getCacheDir(),
        "--faster_whisper_custom_model_path",
        modelDir, // Pass the actual model directory path
      ];

      console.log(
        "Launching WhisperLive server:",
        ["python3", ...args].join(" ")
      );

      this.serverProcess = spawn("python3", args, {
        cwd: repoDir,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let resolved = false;

      // TODO: use a more robust way to detect server readiness
      setTimeout(() => {
        resolved = true;
        resolve();
      });

      this.serverProcess.stdout?.on("data", (d) => {
        const msg = d.toString();
        console.log("[WhisperLive]", msg);
        if (!resolved && msg.includes("Uvicorn running on")) {
          resolved = true;
          resolve();
        }
      });

      this.serverProcess.stderr?.on("data", (d) => {
        console.error("[WhisperLive]", d.toString());
      });

      this.serverProcess.on("exit", (code) => {
        console.log("WhisperLive server exited with code", code);
        if (!resolved) reject(new Error(`Server exited with code ${code}`));
      });

      setTimeout(() => {
        if (!resolved) reject(new Error("Server startup timeout"));
      }, 30_000);
    });
  }

  /* ----------------------------------------------------------
   * Everything below is unchanged (WebSocket client logic)
   * ---------------------------------------------------------- */
  async startTranscription(
    onTranscription: (text: string) => void
  ): Promise<void> {
    this.onTranscriptionCallback = onTranscription;

    // small delay to let server bind
    await new Promise((r) => setTimeout(r, 1000));

    this.websocket = new WebSocket(`ws://localhost:${this.config.serverPort}`);

    this.websocket.on("open", () => {
      console.log("Connected to WhisperLive server");
      this.websocket?.send(
        JSON.stringify({
          type: "config",
          model: this.config.defaultModel,
          language: "auto",
          task: "transcribe",
        })
      );
    });

    this.websocket.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "transcription" && msg.text) {
          this.onTranscriptionCallback?.(msg.text);
        }
      } catch (e) {
        console.error("Bad WebSocket message:", e);
      }
    });

    this.websocket.on("error", (err) => console.error("WS error:", err));
    this.websocket.on("close", () => console.log("WS closed"));
  }

  sendAudioData(audioData: Uint8Array): void {
    if (this.websocket?.readyState === WebSocket.OPEN) {
      this.websocket.send(audioData);
    }
  }

  async stopTranscription(): Promise<void> {
    this.websocket?.close();
    this.websocket = null;
  }

  async stopServer(): Promise<void> {
    this.serverProcess?.kill("SIGTERM");
    this.serverProcess = null;
  }
}
