import { spawn, ChildProcess } from "child_process";
import { createServer } from "net";
import * as WebSocket from "ws";
import { join } from "path";
import { AppConfig } from "../config/AppConfig";
import { ModelManager } from "./ModelManager";
import { existsSync } from "fs";
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
  private websocketAvailable: boolean = true;
  private config: AppConfig;
  private modelManager: ModelManager;
  private onTranscriptionCallback: ((update: SegmentUpdate) => void) | null =
    null;
  private sessionUid: string = "";
  private currentSegments: Segment[] = [];
  // Optional error callback set by consumers
  public onError?: (err: any) => void;

  constructor(config: AppConfig, modelManager: ModelManager) {
    if (!WebSocket) {
      console.error("WebSocket not found");
      // Defer throwing until an operation is attempted so main can surface errors
      this.websocketAvailable = false;
    }
    this.config = config;
    this.modelManager = modelManager;
  }

  private resolvePythonPaths(): { mambaExecutable: string; pythonDir: string } {
    const explicitPath = process.env.WHISPERMAC_PYTHON;
    if (explicitPath && explicitPath.length > 0) {
      // This override might be tricky now, but we'll keep it for advanced users.
      // It should point to the PYTHON environment directory.
      return {
        mambaExecutable: join(explicitPath, "..", "micromamba", "micromamba"),
        pythonDir: explicitPath,
      };
    }

    // Common root for vendor directory in dev vs. prod
    const vendorDir = existsSync(join(process.cwd(), "vendor"))
      ? join(process.cwd(), "vendor")
      : join(process.resourcesPath);

    const mambaExecutable = join(vendorDir, "micromamba", "micromamba");
    const pythonDir = join(vendorDir, "python");

    if (!existsSync(mambaExecutable) || !existsSync(pythonDir)) {
      throw new Error(
        "Embedded Micromamba or Python environment not found. Run 'bun run prep' before building."
      );
    }

    return { mambaExecutable, pythonDir };
  }

  async startServer(
    modelRepoId: string,
    onProgress?: (progress: WhisperSetupProgress) => void,
    onLog?: (line: string) => void
  ): Promise<void> {
    console.log("=== Starting WhisperLive server ===");

    if (this.serverProcess) {
      const pid = this.serverProcess.pid;
      let alive = false;
      if (pid && this.serverProcess.exitCode === null) {
        try {
          process.kill(pid, 0);
          alive = true;
        } catch {
          alive = false;
        }
      }
      if (alive) {
        onLog?.("[WhisperLive] Server already running; skipping launch\n");
        onProgress?.({ status: "complete", message: "Whisper server ready" });
        return;
      } else {
        this.serverProcess = null;
      }
    }

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

    // Use whisper-live directly from vendor directory
    let repoDir: string;

    // Try production bundled path first
    const packagedPath = join(process.resourcesPath, "whisperlive");
    if (existsSync(packagedPath)) {
      repoDir = packagedPath;
    } else {
      // Fall back to development vendor path
      const devPath = join(process.cwd(), "vendor", "whisperlive");
      if (existsSync(devPath)) {
        repoDir = devPath;
      } else {
        throw new Error(
          "WhisperLive not found. It should be bundled with the app or available in vendor/whisperlive."
        );
      }
    }

    const runScript = join(repoDir, "run_server.py");
    if (!existsSync(runScript)) {
      throw new Error(`WhisperLive run_server.py not found at ${runScript}`);
    }

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
      const modelDir = this.modelManager.getModelDirectory(modelRepoId);

      // Get the paths using our updated function
      const { mambaExecutable, pythonDir } = this.resolvePythonPaths();

      // These are the arguments for run_server.py
      const pythonArgs = [
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
        modelDir,
      ];

      // These are the new arguments for micromamba itself
      const mambaArgs = [
        "run",
        "-p",
        pythonDir,
        "python", // The command to run
        ...pythonArgs, // Arguments for the command
      ];

      console.log(
        "Launching WhisperLive server:",
        [mambaExecutable, ...mambaArgs].join(" ")
      );

      onProgress?.({
        status: "launching",
        message: "Starting Whisper server...",
      });

      // Spawn micromamba, not python
      this.serverProcess = spawn(mambaExecutable, mambaArgs, {
        cwd: repoDir,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let resolved = false;

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
        same_output_threshold: 2,
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

    this.websocket.on("error", (err) => {
      console.error("WS error:", err);
      // Notify consumer if provided
      try {
        this.onError?.(err);
      } catch (e) {}
    });

    this.websocket.on("close", (code, reason) => {
      console.log("WS closed", { code, reason: reason?.toString() });
      if (code !== 1005) {
        // abnormal closure
        const err = new Error(
          `WebSocket closed unexpectedly (code=${code}) ${
            reason ? reason.toString() : ""
          }`
        );
        try {
          this.onError?.(err);
        } catch (e) {}
      }
    });
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
      // Check both production and development paths for run_server.py
      let runScript: string;

      const packagedPath = join(
        process.resourcesPath,
        "whisperlive",
        "run_server.py"
      );
      const devPath = join(
        process.cwd(),
        "vendor",
        "whisperlive",
        "run_server.py"
      );

      if (existsSync(packagedPath)) {
        runScript = packagedPath;
      } else if (existsSync(devPath)) {
        runScript = devPath;
      } else {
        return; // No whisper-live found, nothing to kill
      }

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
