import { BrowserWindow, ipcMain, app, dialog, shell } from "electron";
import { basename, dirname, join } from "path";
import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import { AudioCaptureService } from "./AudioCaptureService";
import { TranscriptionPluginManager } from "../plugins/TranscriptionPluginManager";
import { AppConfig } from "../config/AppConfig";
import { SecureStorageService } from "./SecureStorageService";
import { SegmentUpdate } from "../types/SegmentTypes";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { readPrompt, fillPrompt } from "../helpers/getPrompt";
import { AiProviderService } from "./AiProviderService";
import { appStore, selectors } from "../core/AppStore";

export interface AudioTimeMapping {
  wallClockMs: number;
  audioFileMs: number;
  durationMs: number;
}

export interface TranscriptSegment {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  audioOffsetMs: number;
}

export interface UserNote {
  id: string;
  text: string;
  timestampMs: number;
  indent: number;
}

export interface AiNote {
  id: string;
  content: string;
  timestampMs: number;
  basedOnSegmentIds: string[];
}

export type SessionStatus = "idle" | "recording" | "paused" | "ended";

export interface RecordingNotesSession {
  id: string;
  startedAt: number;
  title: string;
  projectPath: string;
  segments: TranscriptSegment[];
  userNotes: UserNote[];
  aiNotes: AiNote[];
  audioPath: string;
  status: SessionStatus;
  totalRecordedMs: number;
  audioTimeMappings: AudioTimeMapping[];
}

const SAMPLE_RATE = 16000;
const AI_WORD_THRESHOLD = 30;

export class RecordingNotesService extends EventEmitter {
  private window: BrowserWindow | null = null;
  private session: RecordingNotesSession | null = null;
  private audioCaptureService: AudioCaptureService;
  private transcriptionPluginManager: TranscriptionPluginManager;
  private config: AppConfig;

  private sessionAudioChunks: Float32Array[] = [];
  private pendingAudioChunks: Float32Array[] = [];
  private totalSamplesRecorded = 0;
  private transcriptionInProgress = false;
  private lastAiNoteSegmentCount = 0;
  private pendingAiWords = 0;
  private aiNotesInFlight = false;
  private ipcHandlersRegistered = false;
  private askAbortController: AbortController | null = null;
  private recordingStartWallTime = 0;
  private pausedAtMs = 0;
  private accumulatedRecordedMs = 0;
  private currentBatchAudioStartMs = 0;
  private aiModelOverride: string | null = null;
  private aiModelOverrideKey: string | null = null;

  constructor(
    config: AppConfig,
    audioCaptureService: AudioCaptureService,
    transcriptionPluginManager: TranscriptionPluginManager,
  ) {
    super();
    this.config = config;
    this.audioCaptureService = audioCaptureService;
    this.transcriptionPluginManager = transcriptionPluginManager;
  }

  private getElapsedRecordingMs(): number {
    if (!this.session) return 0;
    if (this.session.status === "recording") {
      return this.accumulatedRecordedMs + (Date.now() - this.recordingStartWallTime);
    }
    return this.accumulatedRecordedMs;
  }

  async openWindow(): Promise<void> {
    if (this.window && !this.window.isDestroyed()) {
      this.window.show();
      this.window.focus();
      return;
    }

    this.window = new BrowserWindow({
      width: 1100,
      height: 760,
      minWidth: 860,
      minHeight: 560,
      transparent: true,
      backgroundColor: "#00000000",
      vibrancy: "under-window",
      visualEffectState: "followWindow",
      titleBarStyle: "hidden",
      trafficLightPosition: { x: 14, y: 15 },
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: join(__dirname, "../preload/rendererAppPreload.js"),
        backgroundThrottling: false,
      },
      show: false,
    });

    this.window.loadFile(join(__dirname, "../renderer-app/index.html"), {
      hash: "/recording-notes",
    });

    this.window.once("ready-to-show", () => {
      this.window?.show();
      try {
        app.dock?.show();
      } catch {}
    });

    this.window.on("closed", () => {
      this.window = null;
      try {
        app.dock?.hide();
      } catch {}
    });

    this.registerIpcHandlers();
  }

  private registerIpcHandlers(): void {
    if (this.ipcHandlersRegistered) return;
    this.ipcHandlersRegistered = true;

    ipcMain.handle("recording-notes:start", async () => {
      return this.startRecording();
    });

    ipcMain.handle("recording-notes:stop", async () => {
      return this.stopRecording();
    });

    ipcMain.handle("recording-notes:pause", async () => {
      return this.pauseRecording();
    });

    ipcMain.handle("recording-notes:resume", async () => {
      return this.resumeRecording();
    });

    ipcMain.handle(
      "recording-notes:rename-session",
      async (_e, title: string) => {
        if (!this.session) {
          return { success: false, error: "No active session" };
        }
        this.session.title = title.trim();
        this.saveSession();
        this.sendToRenderer("recording-notes:session-renamed", {
          title: this.session.title,
        });
        return { success: true, title: this.session.title };
      },
    );

    ipcMain.handle(
      "recording-notes:save-notes",
      async (_e, notes: UserNote[]) => {
        if (this.session) {
          this.session.userNotes = notes;
          this.saveSession();
        }
      },
    );

    ipcMain.handle(
      "recording-notes:save-ai-notes",
      async (_e, aiNotes: AiNote[]) => {
        if (this.session) {
          this.session.aiNotes = aiNotes;
          this.saveSession();
        }
      },
    );

    ipcMain.handle("recording-notes:get-audio-path", async () => {
      return this.session?.audioPath || null;
    });

    ipcMain.handle("recording-notes:get-session", async () => {
      if (!this.session) {
        return null;
      }
      return {
        ...this.session,
        totalRecordedMs: this.getElapsedRecordingMs(),
      };
    });

    ipcMain.handle(
      "recording-notes:ask-question",
      async (_e, question: string) => {
        return this.handleAskQuestion(question);
      },
    );

    ipcMain.handle("recording-notes:cancel-ask", async () => {
      if (this.askAbortController) {
        this.askAbortController.abort();
        this.askAbortController = null;
      }
    });

    ipcMain.handle("recording-notes:generate-ai-notes", async () => {
      if (this.session && this.session.segments.length > 0) {
        await this.generateAiNotes(true);
      }
    });

    ipcMain.handle("recording-notes:regenerate-ai-notes", async () => {
      return this.regenerateAllAiNotes();
    });

    ipcMain.handle("recording-notes:reset-session", async () => {
      if (this.session?.status === "recording") {
        await this.stopRecording();
      }
      this.session = null;
      this.sessionAudioChunks = [];
      this.pendingAudioChunks = [];
      this.totalSamplesRecorded = 0;
      this.accumulatedRecordedMs = 0;
      this.lastAiNoteSegmentCount = 0;
      this.pendingAiWords = 0;
    });

    ipcMain.handle("recording-notes:get-model-info", async () => {
      return this.getModelInfo();
    });

    ipcMain.handle("recording-notes:get-project-state", async () => {
      return this.getProjectState();
    });

    ipcMain.handle("recording-notes:open-project", async (_e, projectPath: string) => {
      return this.importSessionFolder(projectPath);
    });

    ipcMain.handle(
      "recording-notes:reveal-project",
      async (_e, projectPath?: string) => {
        return this.revealProject(projectPath);
      },
    );

    ipcMain.handle(
      "recording-notes:delete-project",
      async (_e, projectPath: string) => {
        return this.deleteProject(projectPath);
      },
    );

    ipcMain.handle("recording-notes:export-zip", async () => {
      return this.exportSessionFolder();
    });

    ipcMain.handle("recording-notes:import-zip", async () => {
      const result = await dialog.showOpenDialog({
        title: "Import Recording Notes",
        defaultPath: this.getProjectState().lastDirectory,
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled || !result.filePaths?.[0]) {
        return { success: false, error: "Cancelled" };
      }
      return this.importSessionFolder(result.filePaths[0]);
    });
  }

  private async startRecording(): Promise<{
    success: boolean;
    error?: string;
  }> {
    if (
      appStore.select((state) => state.dictation.state) !== "idle" ||
      (appStore.select(selectors.isCapturing) && this.session?.status !== "recording")
    ) {
      return {
        success: false,
        error: "Another transcription session is already using the microphone.",
      };
    }

    const isResume =
      this.session &&
      (this.session.status === "ended" || this.session.status === "paused");

    if (this.session?.status === "recording") {
      return { success: false, error: "Already recording" };
    }

    if (!isResume) {
      const sessionId = uuidv4();
      const startedAt = Date.now();
      const projectPath = this.createProjectPath(sessionId, startedAt);
      const audioPath = join(projectPath, "audio.wav");

      this.session = {
        id: sessionId,
        startedAt,
        title: "",
        projectPath,
        segments: [],
        userNotes: [],
        aiNotes: [],
        audioPath,
        status: "recording",
        totalRecordedMs: 0,
        audioTimeMappings: [],
      };

      this.sessionAudioChunks = [];
      this.pendingAudioChunks = [];
      this.totalSamplesRecorded = 0;
      this.lastAiNoteSegmentCount = 0;
      this.pendingAiWords = 0;
      this.transcriptionInProgress = false;
      this.accumulatedRecordedMs = 0;
      this.currentBatchAudioStartMs = 0;
      this.ensureProjectDir(this.session);
      this.setProjectState(projectPath);
      this.saveSession();
    } else {
      this.session!.status = "recording";
      this.pendingAudioChunks = [];
      this.transcriptionInProgress = false;
    }

    this.recordingStartWallTime = Date.now();
    this.setupAudioListeners();

    await this.audioCaptureService.initialize();

    await this.transcriptionPluginManager.startTranscription(
      (update: SegmentUpdate) => this.handleTranscriptionUpdate(update),
    );

    const success = await this.audioCaptureService.startCapture();
    if (!success) {
      this.session!.status = "idle";
      return { success: false, error: "Failed to start audio capture" };
    }

    this.sendToRenderer("recording-notes:status", {
      status: "recording",
      startedAt: this.session!.startedAt,
      elapsed: this.accumulatedRecordedMs,
      modelInfo: this.getModelInfo(),
    });
    return { success: true };
  }

  private async pauseRecording(): Promise<{ success: boolean }> {
    if (!this.session || this.session.status !== "recording") {
      return { success: false };
    }

    this.removeAudioListeners();
    this.accumulatedRecordedMs += Date.now() - this.recordingStartWallTime;

    await this.audioCaptureService.stopCapture();
    await this.transcriptionPluginManager.stopTranscription();

    if (this.pendingAudioChunks.length > 0) {
      const pending = this.combinePendingAudio();
      if (pending.length > 0) {
        this.currentBatchAudioStartMs =
          ((this.totalSamplesRecorded - pending.length) / SAMPLE_RATE) * 1000;
        await this.transcribeSegment(pending);
      }
    }

    await this.generateAiNotes(true);

    this.session.status = "paused";
    this.session.totalRecordedMs = this.accumulatedRecordedMs;

    await this.saveAudioFile();
    this.saveSession();

    this.sendToRenderer("recording-notes:status", {
      status: "paused",
      elapsed: this.accumulatedRecordedMs,
      audioTimeMappings: this.session.audioTimeMappings,
      modelInfo: this.getModelInfo(),
    });
    return { success: true };
  }

  private async resumeRecording(): Promise<{
    success: boolean;
    error?: string;
  }> {
    if (
      !this.session ||
      (this.session.status !== "paused" && this.session.status !== "ended")
    ) {
      return { success: false, error: "Not paused or ended" };
    }

    return this.startRecording();
  }

  private async stopRecording(): Promise<{ success: boolean }> {
    if (
      !this.session ||
      (this.session.status !== "recording" && this.session.status !== "paused")
    ) {
      return { success: false };
    }

    if (this.session.status === "recording") {
      this.removeAudioListeners();
      this.accumulatedRecordedMs += Date.now() - this.recordingStartWallTime;

      await this.audioCaptureService.stopCapture();
      await this.transcriptionPluginManager.stopTranscription();

      if (this.pendingAudioChunks.length > 0) {
        const pending = this.combinePendingAudio();
        if (pending.length > 0) {
          this.currentBatchAudioStartMs =
            ((this.totalSamplesRecorded - pending.length) / SAMPLE_RATE) * 1000;
          await this.transcribeSegment(pending);
        }
      }
    }

    await this.generateAiNotes(true);

    this.session.status = "ended";
    this.session.totalRecordedMs = this.accumulatedRecordedMs;

    await this.saveAudioFile();
    this.saveSession();

    this.sendToRenderer("recording-notes:status", {
      status: "ended",
      elapsed: this.accumulatedRecordedMs,
      audioTimeMappings: this.session.audioTimeMappings,
      modelInfo: this.getModelInfo(),
    });
    return { success: true };
  }

  private handleIncomingAudio(audioClone: Float32Array): void {
    const segDurationMs = (audioClone.length / SAMPLE_RATE) * 1000;
    const audioFileMs = (this.totalSamplesRecorded / SAMPLE_RATE) * 1000;
    const wallClockMs = Math.max(0, this.getElapsedRecordingMs() - segDurationMs);

    this.sessionAudioChunks.push(audioClone);
    this.pendingAudioChunks.push(audioClone);
    this.totalSamplesRecorded += audioClone.length;

    if (this.session) {
      this.session.audioTimeMappings.push({ wallClockMs, audioFileMs, durationMs: segDurationMs });
    }

    if (!this.transcriptionInProgress) {
      const audioToTranscribe = this.combinePendingAudio();
      this.currentBatchAudioStartMs =
        ((this.totalSamplesRecorded - audioToTranscribe.length) / SAMPLE_RATE) * 1000;
      this.transcribeSegment(audioToTranscribe);
    }
  }

  private vadSegmentHandler = (audio: Float32Array) => {
    this.handleIncomingAudio(new Float32Array(audio));
  };

  private chunkReadyHandler = (event: any) => {
    if (event.audio) {
      this.handleIncomingAudio(new Float32Array(event.audio));
    }
  };

  private setupAudioListeners(): void {
    this.audioCaptureService.on("vad-segment", this.vadSegmentHandler);
    this.audioCaptureService.on("chunk-ready", this.chunkReadyHandler);
  }

  private removeAudioListeners(): void {
    this.audioCaptureService.removeListener(
      "vad-segment",
      this.vadSegmentHandler,
    );
    this.audioCaptureService.removeListener(
      "chunk-ready",
      this.chunkReadyHandler,
    );
  }

  private combinePendingAudio(): Float32Array {
    const total = this.pendingAudioChunks.reduce(
      (sum, c) => sum + c.length,
      0,
    );
    const combined = new Float32Array(total);
    let offset = 0;
    for (const chunk of this.pendingAudioChunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    this.pendingAudioChunks = [];
    return combined;
  }

  private async transcribeSegment(audio: Float32Array): Promise<void> {
    if (audio.length === 0) return;
    this.transcriptionInProgress = true;

    try {
      await this.transcriptionPluginManager.processAudioSegment(audio);
    } catch (error) {
      console.error("[RecordingNotesService] Transcription error:", error);
    } finally {
      this.transcriptionInProgress = false;
    }
  }

  private handleTranscriptionUpdate(update: SegmentUpdate): void {
    if (!this.session) return;

    const elapsedNow = this.getElapsedRecordingMs();

    for (const seg of update.segments) {
      if (seg.type === "transcribed" && (seg as any).completed) {
        const exists = this.session.segments.some((s) => s.id === seg.id);
        if (!exists) {
          const segStartMs = elapsedNow - Math.round((seg.text.length / 15) * 1000);
          const startMs = Math.max(0, segStartMs);
          const endMs = elapsedNow;

          const transcriptSegment: TranscriptSegment = {
            id: seg.id || uuidv4(),
            text: seg.text,
            startMs,
            endMs,
            audioOffsetMs: this.currentBatchAudioStartMs,
          };

          this.session.segments.push(transcriptSegment);
          this.saveSession();

          this.sendToRenderer("recording-notes:transcript-update", {
            segment: transcriptSegment,
            allSegments: this.session.segments,
          });

          const wordCount = seg.text
            .trim()
            .split(/\s+/)
            .filter((w) => w.length > 0).length;
          this.pendingAiWords += wordCount;

          if (this.pendingAiWords >= AI_WORD_THRESHOLD) {
            this.generateAiNotes(false);
          }
        }
      } else if (seg.type === "inprogress") {
        this.sendToRenderer("recording-notes:transcript-partial", {
          text: seg.text,
        });
      }
    }
  }

  private async getApiKey(): Promise<string | undefined> {
    let apiKey: string | undefined;
    try {
      const secure = new SecureStorageService();
      apiKey =
        (await secure.getSecureValue("ai_service", "api_key")) || undefined;
    } catch {}
    if (!apiKey) apiKey = process.env["AI_API_KEY"];
    return apiKey;
  }

  private async generateAiNotes(force: boolean): Promise<void> {
    if (!this.session || this.session.segments.length === 0 || this.aiNotesInFlight) {
      return;
    }
    if (!force && this.pendingAiWords < AI_WORD_THRESHOLD) return;

    const aiConfig = this.config.ai;
    if (!aiConfig?.enabled) {
      console.log("[RecordingNotesService] AI not enabled, skipping notes gen");
      return;
    }

    const newSegments = this.session.segments.slice(
      this.lastAiNoteSegmentCount,
    );
    if (newSegments.length === 0) return;

    const fullTranscript = this.session.segments
      .map((s) => `[${this.formatTimestamp(s.startMs)}] ${s.text}`)
      .join("\n");

    const newText = newSegments
      .map((s) => `[${this.formatTimestamp(s.startMs)}] ${s.text}`)
      .join("\n");

    const existingNotes = this.session.aiNotes
      .map((n) => n.content)
      .join("\n\n");

    const noteId = uuidv4();
    const timestampMs = newSegments[0]?.startMs ?? 0;
    const processedSegmentCount = this.lastAiNoteSegmentCount + newSegments.length;

    console.log(
      `[RecordingNotesService] Generating AI notes: ${newSegments.length} new segments, timestamp=${timestampMs}ms, model=${aiConfig.model}, url=${aiConfig.baseUrl}`,
    );

    this.sendToRenderer("recording-notes:ai-status", {
      generating: true,
      error: null,
    });
    this.aiNotesInFlight = true;

    try {
      const systemPrompt = readPrompt("recording_notes_system");
      const userPrompt = fillPrompt(readPrompt("recording_notes_user"), {
        FULL_TRANSCRIPT: fullTranscript,
        EXISTING_NOTES: existingNotes
          ? `Previous notes:\n${existingNotes}\n\n`
          : "",
        NEW_TEXT: newText,
      });
      const content = await this.streamAiResponse(systemPrompt, userPrompt, undefined, (nextContent) => {
        this.sendToRenderer("recording-notes:ai-notes-chunk", {
          noteId,
          content: nextContent,
          timestampMs,
          done: false,
        });
      });

      if (content.trim()) {
        const aiNote: AiNote = {
          id: noteId,
          content: content.trim(),
          timestampMs,
          basedOnSegmentIds: newSegments.map((s) => s.id),
        };
        this.session.aiNotes.push(aiNote);
        this.sendToRenderer("recording-notes:ai-notes-chunk", {
          noteId,
          content: content.trim(),
          timestampMs,
          done: true,
        });
        this.saveSession();
        console.log(
          `[RecordingNotesService] AI note generated: ${content.trim().length} chars`,
        );
      }
      this.lastAiNoteSegmentCount = processedSegmentCount;
      this.pendingAiWords = 0;
      this.sendToRenderer("recording-notes:ai-status", {
        generating: false,
        error: null,
      });
    } catch (error: any) {
      const errMsg = `AI error: ${error.message || String(error)}`;
      console.error("[RecordingNotesService] AI notes generation error:", error);
      this.sendToRenderer("recording-notes:ai-status", {
        generating: false,
        error: errMsg,
      });
    } finally {
      this.aiNotesInFlight = false;
    }
  }

  private async handleAskQuestion(question: string): Promise<void> {
    if (!this.session) {
      console.log("[RecordingNotesService] Ask: no session");
      this.sendToRenderer("recording-notes:ask-response-chunk", {
        content: "No active session.",
        done: true,
      });
      return;
    }

    const aiConfig = this.config.ai;
    if (!aiConfig?.enabled) {
      console.log("[RecordingNotesService] Ask: AI not enabled");
      this.sendToRenderer("recording-notes:ask-response-chunk", {
        content: "AI is not enabled. Enable it in Settings > AI Enhancement.",
        done: true,
      });
      return;
    }

    if (!(await this.getApiKey())) {
      console.log("[RecordingNotesService] Ask: no API key");
      this.sendToRenderer("recording-notes:ask-response-chunk", {
        content:
          "No API key configured. Add one in Settings > AI Enhancement.",
        done: true,
      });
      return;
    }

    console.log(
      `[RecordingNotesService] Ask question: "${question}" using model=${aiConfig.model} baseUrl=${aiConfig.baseUrl}`,
    );

    const transcript = this.session.segments
      .map((s) => `[${this.formatTimestamp(s.startMs)}] ${s.text}`)
      .join("\n");

    const userNotes = this.session.userNotes
      .map((n) => `[${this.formatTimestamp(n.timestampMs)}] ${n.text}`)
      .join("\n");

    const aiNotes = this.session.aiNotes
      .map((n) => `[${this.formatTimestamp(n.timestampMs)}]\n${n.content}`)
      .join("\n\n");

    this.askAbortController = new AbortController();

    try {
      const askSystemPrompt = readPrompt("recording_notes_ask_system");
      const askUserPrompt = fillPrompt(
        readPrompt("recording_notes_ask_user"),
        {
          TRANSCRIPT: transcript || "(empty)",
          USER_NOTES: userNotes || "(empty)",
          AI_NOTES: aiNotes || "(empty)",
          QUESTION: question,
        },
      );

      console.log("[RecordingNotesService] Ask: sending request...");
      const content = await this.streamAiResponse(
        askSystemPrompt,
        askUserPrompt,
        this.askAbortController.signal,
        (nextContent) => {
          this.sendToRenderer("recording-notes:ask-response-chunk", {
            content: nextContent,
            done: false,
          });
        },
      );

      console.log(
        `[RecordingNotesService] Ask: complete, ${content.length} chars`,
      );
      this.sendToRenderer("recording-notes:ask-response-chunk", {
        content: content || "(No response)",
        done: true,
      });
    } catch (error: any) {
      if (error.name !== "AbortError") {
        console.error("[RecordingNotesService] Ask question error:", error);
        this.sendToRenderer("recording-notes:ask-response-chunk", {
          content: `Error: ${error.message || String(error)}`,
          done: true,
        });
      }
    } finally {
      this.askAbortController = null;
    }
  }

  private async saveAudioFile(): Promise<void> {
    if (!this.session || this.sessionAudioChunks.length === 0) return;

    const total = this.sessionAudioChunks.reduce(
      (sum, c) => sum + c.length,
      0,
    );
    const combined = new Float32Array(total);
    let offset = 0;
    for (const chunk of this.sessionAudioChunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    this.ensureRecordingNotesDir();

    try {
      const wavPath = this.session.audioPath;
      const pcmData = new Int16Array(combined.length);
      for (let i = 0; i < combined.length; i++) {
        const clamped = Math.max(-1, Math.min(1, combined[i]));
        pcmData[i] = Math.round(clamped * 32767);
      }

      const wavHeader = this.createWavHeader(
        pcmData.length * 2,
        SAMPLE_RATE,
        1,
        16,
      );
      const wavBuffer = new ArrayBuffer(
        wavHeader.byteLength + pcmData.byteLength,
      );
      const wavView = new Uint8Array(wavBuffer);
      wavView.set(new Uint8Array(wavHeader), 0);
      wavView.set(new Uint8Array(pcmData.buffer), wavHeader.byteLength);

      writeFileSync(wavPath, Buffer.from(wavBuffer));
    } catch (error) {
      console.error("[RecordingNotesService] Failed to save audio:", error);
    }
  }

  private createWavHeader(
    dataSize: number,
    sampleRate: number,
    numChannels: number,
    bitsPerSample: number,
  ): ArrayBuffer {
    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    const writeStr = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
    view.setUint16(32, numChannels * (bitsPerSample / 8), true);
    view.setUint16(34, bitsPerSample, true);
    writeStr(36, "data");
    view.setUint32(40, dataSize, true);
    return header;
  }

  private saveSession(): void {
    if (!this.session) return;
    const sessionPath = this.getSessionFilePath(this.session);
    writeFileSync(sessionPath, JSON.stringify(this.session, null, 2));
  }

  private async exportSessionFolder(): Promise<string | null> {
    if (!this.session) return null;
    this.saveSession();

    try {
      const result = await dialog.showOpenDialog({
        title: "Export Recording Notes",
        defaultPath: this.getProjectState().lastDirectory,
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled || !result.filePaths?.[0]) {
        return null;
      }
      const exportDir = join(
        result.filePaths[0],
        basename(this.session.projectPath || `recording-notes-${this.session.id}`),
      );
      mkdirSync(exportDir, { recursive: true });
      const sessionPath = this.getSessionFilePath(this.session);
      if (existsSync(sessionPath)) {
        copyFileSync(sessionPath, join(exportDir, "session.json"));
      }
      if (existsSync(this.session.audioPath)) {
        copyFileSync(this.session.audioPath, join(exportDir, "audio.wav"));
      }
      this.setProjectState(exportDir);
      return exportDir;
    } catch (error) {
      console.error("[RecordingNotesService] Export folder error:", error);
      return null;
    }
  }

  private async importSessionFolder(
    projectPath: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const sessionFilePath = join(projectPath, "session.json");
      if (!existsSync(sessionFilePath)) {
        return { success: false, error: "No session.json found in folder" };
      }
      let sessionData: RecordingNotesSession | null = JSON.parse(
        readFileSync(sessionFilePath, "utf-8"),
      );
      if (!sessionData) {
        return { success: false, error: "Invalid session.json" };
      }
      const audioFilePath = join(projectPath, "audio.wav");
      sessionData.title = typeof sessionData.title === "string" ? sessionData.title : "";
      sessionData.projectPath = projectPath;
      if (existsSync(audioFilePath)) {
        sessionData.audioPath = audioFilePath;
      }

      this.session = sessionData;
      this.session.status = "ended";
      this.accumulatedRecordedMs = this.session.totalRecordedMs || 0;
      this.lastAiNoteSegmentCount = this.session.segments.length;
      this.saveSession();
      this.setProjectState(projectPath);
      this.sendToRenderer("recording-notes:session-loaded", this.session);
      return { success: true };
    } catch (error: any) {
      console.error("[RecordingNotesService] Import folder error:", error);
      return { success: false, error: error.message || String(error) };
    }
  }

  private formatTimestamp(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  private sendToRenderer(channel: string, data: any): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, data);
    }
  }

  private ensureRecordingNotesDir(): string {
    const sessionsDir = join(this.config.dataDir, "recording-notes");
    if (!existsSync(sessionsDir)) {
      mkdirSync(sessionsDir, { recursive: true });
    }
    return sessionsDir;
  }

  private ensureRecordingNotesProjectsDir(): string {
    const projectsDir = join(this.ensureRecordingNotesDir(), "projects");
    if (!existsSync(projectsDir)) {
      mkdirSync(projectsDir, { recursive: true });
    }
    return projectsDir;
  }

  private createProjectPath(sessionId: string, startedAt: number): string {
    const stamp = new Date(startedAt)
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .replace("Z", "");
    return join(
      this.ensureRecordingNotesProjectsDir(),
      `${stamp}_${sessionId.slice(0, 8)}`,
    );
  }

  private ensureProjectDir(session: RecordingNotesSession): string {
    if (!existsSync(session.projectPath)) {
      mkdirSync(session.projectPath, { recursive: true });
    }
    return session.projectPath;
  }

  private getSessionFilePath(session: RecordingNotesSession | null): string {
    if (!session) return "";
    return join(this.ensureProjectDir(session), "session.json");
  }

  private getProjectState(): {
    lastDirectory: string;
    recentProjectPaths: string[];
    currentProjectPath: string | null;
    projectMetadata: Record<string, { title: string; durationMs: number; wordCount: number }>;
  } {
    const fallback = {
      lastDirectory: this.ensureRecordingNotesDir(),
      recentProjectPaths: [] as string[],
      currentProjectPath: this.session?.projectPath || null,
      projectMetadata: {} as Record<string, { title: string; durationMs: number; wordCount: number }>,
    };
    try {
      const statePath = join(this.ensureRecordingNotesDir(), "projects.json");
      if (!existsSync(statePath)) {
        return fallback;
      }
      const parsed = JSON.parse(readFileSync(statePath, "utf-8"));
      const recentProjectPaths = Array.isArray(parsed?.recentProjectPaths)
        ? parsed.recentProjectPaths.filter(
            (projectPath: unknown) =>
              typeof projectPath === "string" && existsSync(projectPath),
          )
        : [];
      const projectMetadata: Record<string, { title: string; durationMs: number; wordCount: number }> = {};
      for (const projectPath of recentProjectPaths) {
        try {
          const sessionFile = join(projectPath, "session.json");
          if (!existsSync(sessionFile)) continue;
          const sessionData = JSON.parse(readFileSync(sessionFile, "utf-8"));
          const title = typeof sessionData.title === "string" ? sessionData.title : "";
          const durationMs = typeof sessionData.totalRecordedMs === "number" ? sessionData.totalRecordedMs : 0;
          let wordCount = 0;
          if (Array.isArray(sessionData.userNotes)) {
            for (const note of sessionData.userNotes) {
              if (typeof note.text === "string" && note.text.trim()) {
                wordCount += note.text.trim().split(/\s+/).filter((w: string) => w.length > 0).length;
              }
            }
          }
          projectMetadata[projectPath] = { title, durationMs, wordCount };
        } catch {}
      }
      return {
        lastDirectory: typeof parsed?.lastDirectory === "string" && parsed.lastDirectory ? parsed.lastDirectory : fallback.lastDirectory,
        recentProjectPaths,
        currentProjectPath: this.session?.projectPath || null,
        projectMetadata,
      };
    } catch {
      return fallback;
    }
  }

  private setProjectState(projectPath: string): void {
    const current = this.getProjectState();
    const recentProjectPaths = [
      projectPath,
      ...current.recentProjectPaths.filter((value) => value !== projectPath),
    ].slice(0, 10);
    writeFileSync(
      join(this.ensureRecordingNotesDir(), "projects.json"),
      JSON.stringify(
        {
          lastDirectory: dirname(projectPath),
          recentProjectPaths,
        },
        null,
        2,
      ),
    );
  }

  private async revealProject(
    projectPath?: string,
  ): Promise<{ success: boolean; error?: string }> {
    const targetPath = projectPath || this.session?.projectPath;
    if (!targetPath || !existsSync(targetPath)) {
      return { success: false, error: "Project folder not found" };
    }
    shell.showItemInFolder(join(targetPath, "session.json"));
    return { success: true };
  }

  private async deleteProject(
    projectPath: string,
  ): Promise<{ success: boolean; error?: string; currentDeleted?: boolean }> {
    try {
      const current = this.getProjectState();
      const recentProjectPaths = current.recentProjectPaths.filter(
        (value) => value !== projectPath,
      );
      writeFileSync(
        join(this.ensureRecordingNotesDir(), "projects.json"),
        JSON.stringify(
          {
            lastDirectory: this.ensureRecordingNotesDir(),
            recentProjectPaths,
          },
          null,
          2,
        ),
      );
      if (existsSync(projectPath)) {
        rmSync(projectPath, { recursive: true, force: true });
      }
      const currentDeleted = this.session?.projectPath === projectPath;
      if (currentDeleted) {
        this.session = null;
        this.sessionAudioChunks = [];
        this.pendingAudioChunks = [];
        this.totalSamplesRecorded = 0;
        this.accumulatedRecordedMs = 0;
        this.lastAiNoteSegmentCount = 0;
        this.pendingAiWords = 0;
      }
      return { success: true, currentDeleted };
    } catch (error: any) {
      return { success: false, error: error.message || String(error) };
    }
  }

  private async streamAiResponse(
    systemPrompt: string,
    userPrompt: string,
    signal?: AbortSignal,
    onChunk?: (content: string) => void,
    modelOverride?: string,
  ): Promise<string> {
    const aiConfig = this.config.ai;
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      throw new Error("No API key configured");
    }
    const model = modelOverride || this.getAiRequestModel();
    const response = await fetch(
      AiProviderService.getChatCompletionsUrl(aiConfig.baseUrl),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        signal,
        body: JSON.stringify({
          model,
          stream: true,
          max_tokens: aiConfig.maxTokens,
          temperature: aiConfig.temperature,
          top_p: aiConfig.topP,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
      },
    );
    if (!response.ok) {
      const providerMessage = await this.getAiErrorMessage(response);
      const fallbackModel =
        !modelOverride &&
        (await this.getFallbackAiModel(model, providerMessage, response.status));
      if (fallbackModel && fallbackModel !== model) {
        return this.streamAiResponse(
          systemPrompt,
          userPrompt,
          signal,
          onChunk,
          fallbackModel,
        );
      }
      const details = providerMessage ? `: ${providerMessage}` : "";
      throw new Error(
        `${response.status} ${response.statusText}${details} (model=${model})`,
      );
    }
    if (!response.body) {
      throw new Error("Empty response from AI");
    }
    let content = "";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") return content.trim();
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (!delta) continue;
          content += delta;
          onChunk?.(content);
        } catch {}
      }
    }
    return content.trim();
  }

  private getAiRequestModel(): string {
    const key = this.getAiModelOverrideKey();
    if (this.aiModelOverrideKey === key && this.aiModelOverride) {
      return this.aiModelOverride;
    }
    return this.config.ai.model;
  }

  private getAiModelOverrideKey(): string {
    return `${this.config.ai.baseUrl}::${this.config.ai.model}`;
  }

  private async getAiErrorMessage(response: Response): Promise<string> {
    try {
      const body = await response.text();
      if (!body) {
        return "";
      }
      try {
        const parsed = JSON.parse(body);
        return (
          parsed?.error?.message ||
          parsed?.message ||
          parsed?.detail ||
          body
        );
      } catch {
        return body;
      }
    } catch {
      return "";
    }
  }

  private async getFallbackAiModel(
    requestedModel: string,
    providerMessage: string,
    status: number,
  ): Promise<string | null> {
    if (!this.shouldRetryWithFallback(requestedModel, providerMessage, status)) {
      return null;
    }
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      return null;
    }
    const result = await new AiProviderService().validateAndListModels(
      this.config.ai.baseUrl,
      apiKey,
    );
    if (!result.success || !result.models.length) {
      return null;
    }
    if (result.models.some((modelInfo) => modelInfo.id === requestedModel)) {
      return null;
    }
    const fallbackModel = result.models[0]?.id || null;
    if (!fallbackModel) {
      return null;
    }
    this.aiModelOverride = fallbackModel;
    this.aiModelOverrideKey = this.getAiModelOverrideKey();
    console.warn(
      `[RecordingNotesService] AI model "${requestedModel}" unavailable, retrying with "${fallbackModel}"`,
    );
    return fallbackModel;
  }

  private shouldRetryWithFallback(
    requestedModel: string,
    providerMessage: string,
    status: number,
  ): boolean {
    if (!requestedModel.trim()) {
      return false;
    }
    if (status !== 400 && status !== 404) {
      return false;
    }
    const message = providerMessage.toLowerCase();
    return (
      message.includes(requestedModel.toLowerCase()) ||
      message.includes("model") ||
      message.includes("not found") ||
      message.includes("does not exist")
    );
  }

  private getModelInfo() {
    const plugin = this.transcriptionPluginManager.getActivePlugin();
    return {
      transcriptionPlugin: plugin?.displayName || plugin?.name || "None",
      aiModel: this.getAiRequestModel() || "None",
      aiEnabled: this.config.ai?.enabled || false,
    };
  }

  private async regenerateAllAiNotes(): Promise<void> {
    if (!this.session || this.session.segments.length === 0) return;

    this.session.aiNotes = [];
    this.lastAiNoteSegmentCount = 0;
    this.pendingAiWords = Infinity;

    this.sendToRenderer("recording-notes:ai-notes-cleared", {});
    await this.generateAiNotes(true);
    this.saveSession();
  }

  async cleanup(): Promise<void> {
    if (this.session?.status === "recording") {
      await this.stopRecording();
    }
    if (this.window && !this.window.isDestroyed()) {
      this.window.close();
    }
    this.removeAllListeners();
  }

  isRecordingActive(): boolean {
    return this.session?.status === "recording";
  }
}
