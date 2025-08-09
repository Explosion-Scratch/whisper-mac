import { spawn, ChildProcess } from "child_process";
import { createServer } from "net";
import * as WebSocket from "ws";
import { join } from "path";
import { AppConfig } from "../config/AppConfig";
import { ModelManager } from "./ModelManager";
import { existsSync, readdirSync, cpSync } from "fs";
import { v4 as uuidv4 } from "uuid";
import { app } from "electron";
import {
  Segment,
  TranscribedSegment,
  InProgressSegment,
  SegmentUpdate,
} from "../types/SegmentTypes";

export type WhisperSetupProgress = {
  status:
    | "starting"
    | "cloning"
    | "installing"
    | "launching"
    | "complete"
    | "error";
  message: string;
};

export class TranscriptionClient {
  private serverProcess: ChildProcess | null = null;
  private websocket: WebSocket | null = null;
  private config: AppConfig;
  private modelManager: ModelManager;
  private onTranscriptionCallback: ((update: SegmentUpdate) => void) | null =
    null;
  private sessionUid: string = "";
  private currentSegments: Segment[] = [];

  constructor(config: AppConfig, modelManager: ModelManager) {
    console.log("Creating transcription client with WebSocket:", WebSocket);
    if (!WebSocket) {
      console.log("WebSocket not found");
      process.exit(1);
    }
    this.config = config;
    this.modelManager = modelManager;
  }

  /**
   * Resolve the Python interpreter to use. Use embedded python
   */
  private resolvePythonInterpreter(): string {
    const explicitPath = process.env.WHISPERMAC_PYTHON;
    if (explicitPath && explicitPath.length > 0) return explicitPath;

    const archKey = process.arch === "arm64" ? "arm64" : "x64";
    const devCandidates = [
      join(
        process.cwd(),
        "vendor",
        "python",
        `darwin-${archKey}`,
        "bin",
        "python3"
      ),
      join(
        process.cwd(),
        "vendor",
        "python",
        `darwin-${archKey}`,
        "bin",
        "python"
      ),
      join(process.cwd(), "vendor", "python", "bin", "python3"),
      join(process.cwd(), "vendor", "python", "bin", "python"),
    ];
    for (const p of devCandidates) {
      if (existsSync(p)) return p;
    }

    const base = process.resourcesPath;
    const archSuffix = `darwin-${process.arch}`;
    const packagedCandidates: string[] = [
      join(base, "python", archSuffix, "bin", "python3"),
      join(base, "python", archSuffix, "bin", "python"),
      join(base, "python", "bin", "python3"),
      join(base, "python", "python3"),
    ];
    for (const p of packagedCandidates) {
      if (existsSync(p)) return p;
    }

    throw new Error(
      "Embedded Python not found. Run 'bun run prep:python' before building, or ensure vendor/python exists."
    );
  }

  /**
   * Ensure a dedicated virtual environment exists under userData to keep packages writable in production.
   *
   * The virtual environment is stored in the app's cache directory and should persist between app launches.
   * This method checks if the venv exists and is valid (can import required packages) before recreating it.
   *
   * Location: ~/Library/Application Support/WhisperMac/cache/python-venv/
   */
  private async ensureVenv(
    pythonPath: string,
    repoDir: string
  ): Promise<string> {
    const venvDir = join(this.config.getCacheDir(), "python-venv");
    const venvPython = join(venvDir, "bin", "python");

    // Check if virtual environment exists and is valid
    const venvExists = existsSync(venvPython);
    const venvValid =
      venvExists && (await this.isVenvValid(venvPython, repoDir));

    if (!venvValid) {
      console.log(
        "Virtual environment not found or invalid, creating new one..."
      );

      // Remove existing venv if it exists but is invalid
      if (venvExists) {
        try {
          const { rmSync } = require("fs");
          rmSync(venvDir, { recursive: true, force: true });
        } catch (error) {
          console.warn("Failed to remove existing venv:", error);
        }
      }

      await new Promise<void>((resolve, reject) => {
        const proc = spawn(pythonPath, ["-m", "venv", venvDir], {
          stdio: "inherit",
        });
        proc.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`venv creation failed with code ${code}`));
        });
        proc.on("error", reject);
      });

      await new Promise<void>((resolve, reject) => {
        const proc = spawn(
          venvPython,
          ["-m", "pip", "install", "-r", "requirements/server.txt"],
          {
            cwd: repoDir,
            stdio: "inherit",
          }
        );
        proc.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`pip install failed with code ${code}`));
        });
        proc.on("error", reject);
      });
    } else {
      console.log("Using existing virtual environment");
    }

    return venvPython;
  }

  /**
   * Check if the virtual environment is valid by testing if it can import required packages
   */
  private async isVenvValid(
    venvPython: string,
    repoDir: string
  ): Promise<boolean> {
    try {
      // Test if the virtual environment can import key packages
      const testScript = `
import sys
try:
    import faster_whisper
    print("VENV_VALID")
except ImportError as e:
    print(f"VENV_INVALID: {e}")
    sys.exit(1)
`;

      return new Promise<boolean>((resolve) => {
        const proc = spawn(venvPython, ["-c", testScript], {
          cwd: repoDir,
          stdio: ["ignore", "pipe", "pipe"],
        });

        let output = "";
        proc.stdout?.on("data", (d) => {
          output += d.toString();
        });

        proc.on("close", (code) => {
          console.log("Venv test output:", output);
          resolve(code === 0 && output.includes("VENV_VALID"));
        });

        proc.on("error", () => {
          console.log("Venv test error", output);
          resolve(false);
        });
      });
    } catch {
      return false;
    }
  }

  /**
   * Check the status of the virtual environment and log details
   */
  private async checkVenvStatus(): Promise<void> {
    const venvDir = join(this.config.getCacheDir(), "python-venv");
    const venvPython =
      process.platform === "win32"
        ? join(venvDir, "Scripts", "python.exe")
        : join(venvDir, "bin", "python");

    console.log("=== Virtual Environment Status ===");
    console.log("Venv directory:", venvDir);
    console.log("Venv Python path:", venvPython);
    console.log("Venv exists:", existsSync(venvPython));

    if (existsSync(venvPython)) {
      console.log(
        "Venv directory contents:",
        require("fs").readdirSync(venvDir)
      );
    }
    console.log("=== End Virtual Environment Status ===");
  }

  async startServer(
    modelRepoId: string,
    onProgress?: (progress: WhisperSetupProgress) => void,
    onLog?: (line: string) => void
  ): Promise<void> {
    console.log("=== Starting WhisperLive server ===");

    // Check virtual environment status for debugging
    await this.checkVenvStatus();

    // Best-effort cleanup of stale embedded python servers before starting
    await this.killStaleEmbeddedPythonProcesses();

    // Ensure port is available before doing any heavy setup
    const desiredPort = this.config.serverPort;
    const portOk = await this.isPortAvailable(desiredPort);
    if (!portOk) {
      const error = new Error(
        `Whisper server port ${desiredPort} is already in use. Update the port in Settings and try again.`
      );
      (error as any).code = "PORT_IN_USE";
      throw error;
    }
    const repoDir = this.config.getWhisperLiveDir();
    console.log("WhisperLive directory:", repoDir);
    const runScript = join(repoDir, "run_server.py");

    // Check if server script exists
    if (!existsSync(runScript)) {
      console.log("Server script not found, will clone WhisperLive repository");
    } else {
      console.log(
        "Server script found, using existing WhisperLive installation"
      );
    }

    // Install with pip using the resolved interpreter
    const runInstall = async (pythonPath: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        onProgress?.({
          status: "installing",
          message: "Installing Whisper dependencies...",
        });

        const ensure = spawn(pythonPath, ["-m", "ensurepip", "--upgrade"], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        ensure.stdout?.on("data", (d) => onLog?.(d.toString()));
        ensure.stderr?.on("data", (d) => onLog?.(d.toString()));
        ensure.on("close", (code) => {
          if (code !== 0) {
            console.warn("ensurepip failed or unavailable; continuing...");
          }
          runPip();
        });
        ensure.on("error", () => runPip());

        const runPip = () => {
          const platformKey = `darwin-${process.arch}`;
          const wheelsDir = ((): string | null => {
            // Prefer packaged wheelhouse; fall back to dev wheelhouse when running unpackaged
            const prodPath = join(process.resourcesPath, "wheels", platformKey);
            const devPath = join(
              process.cwd(),
              "vendor",
              "wheels",
              platformKey
            );
            const candidate = existsSync(prodPath) ? prodPath : devPath;
            if (existsSync(candidate)) {
              try {
                const files = readdirSync(candidate);
                if (files.some((f) => f.endsWith(".whl"))) return candidate;
              } catch {}
            }
            return null;
          })();

          if (!wheelsDir) {
            reject(
              new Error(
                "Wheelhouse not found. Ensure wheels are prepared at build time (bun run prep:wheels:[arch])."
              )
            );
            return;
          }

          const pipArgs = [
            "-m",
            "pip",
            "install",
            "--no-index",
            "--find-links",
            wheelsDir,
            "-r",
            "requirements/server.txt",
          ];

          const install = spawn(pythonPath, pipArgs, {
            cwd: repoDir,
            stdio: ["ignore", "pipe", "pipe"],
          });
          install.stdout?.on("data", (d) => onLog?.(d.toString()));
          install.stderr?.on("data", (d) => onLog?.(d.toString()));
          install.on("close", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`pip install failed with code ${code}`));
          });
          install.on("error", reject);
        };
      });
    };

    // Helper to run scripts/setup.sh
    const runSetup = async (): Promise<void> => {
      return new Promise((resolve, reject) => {
        const setupScript = join(repoDir, "scripts", "setup.sh");
        const shouldRun =
          existsSync(setupScript) &&
          process.platform === "linux" &&
          process.env.WHISPERMAC_RUN_SETUP !== "0";
        if (!shouldRun) {
          resolve();
          return;
        }
        const setup = spawn("bash", [setupScript], {
          cwd: repoDir,
          stdio: ["ignore", "pipe", "pipe"],
        });
        setup.stdout?.on("data", (d) => onLog?.(d.toString()));
        setup.stderr?.on("data", (d) => onLog?.(d.toString()));
        setup.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`setup.sh failed with code ${code}`));
        });
        setup.on("error", reject);
      });
    };

    // 1. Ensure server sources exist: prefer bundled snapshot, otherwise clone
    if (!existsSync(runScript)) {
      return new Promise((resolve, reject) => {
        onProgress?.({
          status: "cloning",
          message: "Downloading Whisper server...",
        });

        // Ensure the parent directory exists
        const parentDir = join(repoDir, "..");
        if (!existsSync(parentDir)) {
          require("fs").mkdirSync(parentDir, { recursive: true });
        }

        // Try to use bundled snapshot first
        try {
          const packagedSnapshot = join(process.resourcesPath, "whisperlive");
          if (existsSync(packagedSnapshot)) {
            if (existsSync(repoDir)) {
              require("fs").rmSync(repoDir, { recursive: true, force: true });
            }
            cpSync(packagedSnapshot, repoDir, { recursive: true });
            (async () => {
              try {
                const pythonPath = this.resolvePythonInterpreter();
                await runInstall(pythonPath);
                await runSetup();
                resolve(this._launch(repoDir, modelRepoId, onProgress, onLog));
              } catch (err) {
                reject(err);
              }
            })();
            return;
          }
        } catch {
          // fall back to git
        }

        const git = spawn(
          "git",
          ["clone", "https://github.com/collabora/WhisperLive.git", repoDir],
          { stdio: ["ignore", "pipe", "pipe"] }
        );
        git.stdout?.on("data", (d) => onLog?.(d.toString()));
        git.stderr?.on("data", (d) => onLog?.(d.toString()));
        git.on("close", async (code) => {
          if (code === 0) {
            try {
              const pythonPath = this.resolvePythonInterpreter();
              await runInstall(pythonPath);
              await runSetup();
              resolve(this._launch(repoDir, modelRepoId, onProgress, onLog));
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
    return this._launch(repoDir, modelRepoId, onProgress, onLog);
  }

  /* ----------------------------------------------------------
   * Internal: spawn the server exactly like the README shows
   * ---------------------------------------------------------- */
  private async _launch(
    repoDir: string,
    modelRepoId: string,
    onProgress?: (progress: WhisperSetupProgress) => void,
    onLog?: (line: string) => void
  ): Promise<void> {
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

      const basePython = this.resolvePythonInterpreter();
      console.log(
        "Launching WhisperLive server:",
        [basePython, ...args].join(" ")
      );

      onProgress?.({
        status: "launching",
        message: "Starting Whisper server...",
      });

      // Always use isolated venv for consistency
      const useIsolated = true;

      const launchWith = async (): Promise<string> => {
        if (useIsolated) {
          return await this.ensureVenv(basePython, repoDir);
        }
        return basePython;
      };

      launchWith()
        .then((pythonBin) => {
          this.serverProcess = spawn(pythonBin, args, {
            cwd: repoDir,
            stdio: ["ignore", "pipe", "pipe"],
          });

          let resolved = false;

          // TODO: use a more robust way to detect server readiness
          setTimeout(() => {
            if (!resolved) {
              resolved = true;
              onProgress?.({
                status: "complete",
                message: "Whisper server ready",
              });
              resolve();
            }
          }, 1000);

          this.serverProcess?.stdout?.on("data", (d) => {
            const msg = d.toString();
            console.log("[WhisperLive]", msg);
            onLog?.(msg);
            if (!resolved && msg.includes("Uvicorn running on")) {
              resolved = true;
              onProgress?.({
                status: "complete",
                message: "Whisper server ready",
              });
              resolve();
            }
          });

          this.serverProcess?.stderr?.on("data", (d) => {
            const msg = d.toString();
            console.error("[WhisperLive]", msg);
            onLog?.(msg);
          });

          this.serverProcess?.on("exit", (code) => {
            console.log("WhisperLive server exited with code", code);
            if (!resolved) reject(new Error(`Server exited with code ${code}`));
          });

          setTimeout(() => {
            if (!resolved) reject(new Error("Server startup timeout"));
          }, 30_000);
        })
        .catch((err) => {
          reject(err);
        });
    });
  }

  /* ----------------------------------------------------------
   * WebSocket client logic following the protocol specification
   * ---------------------------------------------------------- */
  async startTranscription(
    onTranscription: (update: SegmentUpdate) => void
  ): Promise<void> {
    console.log("Starting transcription");
    this.onTranscriptionCallback = onTranscription;
    this.sessionUid = uuidv4();
    this.currentSegments = [];

    // small delay to let server bind
    await new Promise((r) => setTimeout(r, 1000));
    console.log("Connecting....", this.config.serverPort);
    this.websocket = new WebSocket(`ws://127.0.0.1:${this.config.serverPort}`);
    console.log("Connected to WhisperLive server", this.websocket);

    this.websocket.on("open", () => {
      console.log("Connected to WhisperLive server");

      // Send initial configuration message according to protocol
      const configMessage = {
        uid: this.sessionUid,
        language: null, // auto-detect
        task: "transcribe",
        model: this.config.defaultModel,
        no_speech_thresh: 0.2,
        same_output_threshold: 5,
        use_vad: true,
      };

      this.websocket?.send(JSON.stringify(configMessage));
    });

    this.websocket.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        console.log("Received message:", msg); // This can be very noisy

        // Handle different message types according to protocol
        if (msg.uid === this.sessionUid) {
          if (msg.segments) {
            // Handle transcription segments
            this.updateSegments(msg.segments);
          } else if (msg.language) {
            // Language detection message
            console.log("Detected language:", msg.language);
          } else if (msg.status === "WAIT") {
            // Server busy message
            console.log(
              "Server busy, estimated wait time:",
              msg.message,
              "minutes"
            );
          } else if (msg.message === "DISCONNECT") {
            // Server requests disconnect
            console.log("Server requested disconnect");
            this.stopTranscription();
          }
        }
      } catch (e) {
        console.error("Bad WebSocket message:", e);
      }
    });

    this.websocket.on("error", (err) => console.error("WS error:", err));
    this.websocket.on("close", () => console.log("WS closed"));
  }

  private updateSegments(serverSegments: any[]): void {
    console.log(
      `[WhisperLiveClient] Received ${serverSegments.length} segments from server`
    );

    // Convert server segments to our segment format
    const newSegments: Segment[] = [];

    serverSegments.forEach((segment: any) => {
      if (segment.text) {
        const isCompleted = segment.completed || false;

        // Only check for duplicates if this is a completed segment
        if (isCompleted) {
          // Create a unique key for this segment based on content and timing
          const segmentKey = `${segment.start}-${
            segment.end
          }-${segment.text.trim()}`;

          // Skip if we've already processed this completed segment
          if (
            this.currentSegments.some((s) => {
              if (s.type !== "transcribed" || !s.completed) return false;
              const existingKey = `${s.start}-${s.end}-${s.text.trim()}`;
              return existingKey === segmentKey;
            })
          ) {
            console.log(
              `[WhisperLiveClient] Skipping duplicate completed segment: "${segment.text.trim()}"`
            );
            return;
          }
        }

        console.log(
          `[WhisperLiveClient] Processing new segment: "${segment.text.trim()}" (completed: ${isCompleted})`
        );

        if (isCompleted) {
          // Create a TranscribedSegment
          const transcribedSegment: TranscribedSegment = {
            id: uuidv4(),
            type: "transcribed",
            text: segment.text,
            completed: true,
            start: segment.start,
            end: segment.end,
            timestamp: Date.now(),
          };
          newSegments.push(transcribedSegment);
        } else {
          // Create an InProgressSegment
          const inProgressSegment: InProgressSegment = {
            id: uuidv4(),
            type: "inprogress",
            text: segment.text,
            completed: false,
            start: segment.start,
            end: segment.end,
            timestamp: Date.now(),
          };
          newSegments.push(inProgressSegment);
        }
      }
    });

    // Only send update if we have new segments
    if (newSegments.length > 0) {
      console.log(
        `[WhisperLiveClient] Sending ${newSegments.length} new segments to callback`
      );

      // Update our current segments tracking - only track completed segments for deduplication
      this.currentSegments = serverSegments
        .filter((segment: any) => segment.completed) // Only track completed segments
        .map((segment: any) => {
          return {
            id: uuidv4(),
            type: "transcribed" as const,
            text: segment.text,
            completed: true,
            start: segment.start,
            end: segment.end,
            timestamp: Date.now(),
          } as TranscribedSegment;
        });

      // Send update to callback with new segments only (status should always be "listening" from transcription client)
      this.onTranscriptionCallback?.({
        segments: newSegments,
        status: "listening",
      });
    } else {
      console.log(`[WhisperLiveClient] No new segments to process`);
    }
  }

  getCurrentSegments(): Segment[] {
    return this.currentSegments;
  }

  sendAudioData(audioData: Float32Array): void {
    if (this.websocket && this.websocket.readyState === 1) {
      // Send raw Float32Array as binary data
      this.websocket.send(audioData);
    } else {
      console.log(
        "WebSocket not ready",
        this.websocket?.readyState,
        this.websocket?.url,
        this.websocket
      );
    }
  }

  async stopTranscription(): Promise<void> {
    if (this.websocket && this.websocket.readyState === 1) {
      this.websocket.send(JSON.stringify({ uid: this.sessionUid, EOS: true }));
      this.websocket.close();
    }
    console.log("Stopped transcription, setting websocket to null");
    this.websocket = null;
    this.sessionUid = "";
  }

  async stopServer(): Promise<void> {
    console.log("=== Stopping WhisperLive server ===");

    // Close WebSocket connection if open
    if (this.websocket) {
      if (this.websocket.readyState === 1) {
        this.websocket.close();
      }
      console.log("Stopping whisperlive websocket, setting websocket to null");
      this.websocket = null;
    }

    // Kill the server process
    if (this.serverProcess) {
      console.log("Terminating WhisperLive server process...");

      // Try graceful shutdown first
      this.serverProcess.kill("SIGTERM");

      // Wait a bit for graceful shutdown
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Force kill if still running
      if (this.serverProcess && !this.serverProcess.killed) {
        console.log("Force killing WhisperLive server process...");
        this.serverProcess.kill("SIGKILL");
      }

      this.serverProcess = null;
    }

    // Clear session
    this.sessionUid = "";
    this.currentSegments = [];
    this.onTranscriptionCallback = null;

    console.log("=== WhisperLive server stopped ===");
  }

  /**
   * Attempt to terminate any lingering WhisperLive server processes that were
   * started by this app's embedded Python. This targets the specific
   * run_server.py path under the app's WhisperLive directory to avoid killing
   * unrelated Python processes on the system.
   */
  async killStaleEmbeddedPythonProcesses(): Promise<void> {
    try {
      const repoDir = this.config.getWhisperLiveDir();
      const runScript = join(repoDir, "run_server.py");

      // Only supported on Unix-like platforms; silently no-op elsewhere
      if (process.platform === "darwin" || process.platform === "linux") {
        await new Promise<void>((resolve) => {
          const proc = require("child_process").spawn("pkill", [
            "-f",
            runScript,
          ]);
          proc.on("close", () => resolve());
          proc.on("error", () => resolve());
        });
      }
    } catch {
      // Best-effort cleanup; ignore errors
    }
  }

  /**
   * Check if a TCP port is available on localhost.
   */
  private isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = createServer();
      server.once("error", (err: any) => {
        if (err && (err.code === "EADDRINUSE" || err.code === "EACCES")) {
          resolve(false);
        } else {
          resolve(false);
        }
      });
      server.once("listening", () => {
        server.close(() => resolve(true));
      });
      server.listen(port, "127.0.0.1");
    });
  }
}
