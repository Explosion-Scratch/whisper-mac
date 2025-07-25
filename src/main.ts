import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  globalShortcut,
  ipcMain,
} from "electron";
import { join } from "path";
import { AudioCaptureService } from "./services/AudioCaptureService";
import { WhisperLiveClient } from "./services/WhisperLiveClient";
import { TextInjectionService } from "./services/TextInjectionService";
import { ModelManager } from "./services/ModelManager";
import { AppConfig } from "./config/AppConfig";

class WhisperMacApp {
  private tray: Tray | null = null;
  private settingsWindow: BrowserWindow | null = null;
  private modelManagerWindow: BrowserWindow | null = null;
  private audioService: AudioCaptureService;
  private whisperClient: WhisperLiveClient;
  private textInjector: TextInjectionService;
  private modelManager: ModelManager;
  private config: AppConfig;
  private isRecording = false;

  constructor() {
    this.config = new AppConfig();
    this.audioService = new AudioCaptureService(this.config);
    this.whisperClient = new WhisperLiveClient(this.config);
    this.textInjector = new TextInjectionService();
    this.modelManager = new ModelManager(this.config);
  }

  async initialize() {
    await app.whenReady();

    // Set the model path in config
    const modelsDir = join(__dirname, "../../models");
    this.config.setModelPath(modelsDir);

    // Check and download Whisper tiny model on first launch
    await this.modelManager.ensureModelExists(this.config.defaultModel);

    // Start WhisperLive server
    await this.whisperClient.startServer(this.config.defaultModel);

    this.createTray();
    this.registerGlobalShortcuts();
    this.setupIpcHandlers();

    // Hide dock icon for menu bar only app
    app.dock?.hide();
  }

  private setupIpcHandlers() {
    // Example: listen for dictation requests from renderer
    ipcMain.on("start-dictation", async (event: Electron.IpcMainEvent) => {
      await this.startRecording();
      event.reply("dictation-started");
    });
    ipcMain.on("stop-dictation", async (event: Electron.IpcMainEvent) => {
      await this.stopRecording();
      event.reply("dictation-stopped");
    });
    // Extend with more handlers as needed
    console.log("IPC Handlers set up");
  }

  private showSettings() {
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.settingsWindow.focus();
      return;
    }
    // Create settings window
    this.settingsWindow = new BrowserWindow({
      width: 400,
      height: 600,
      webPreferences: { nodeIntegration: true },
    });
    this.settingsWindow.loadFile("settings.html"); // Or use loadURL if React/Vue
    this.settingsWindow.on("closed", () => {
      this.settingsWindow = null;
    });
  }

  private showModelManager() {
    if (this.modelManagerWindow && !this.modelManagerWindow.isDestroyed()) {
      this.modelManagerWindow.focus();
      return;
    }
    this.modelManagerWindow = new BrowserWindow({
      width: 400,
      height: 400,
      webPreferences: { nodeIntegration: true },
    });
    this.modelManagerWindow.loadFile("model-manager.html");
    this.modelManagerWindow.on("closed", () => {
      this.modelManagerWindow = null;
    });
  }

  private createTray() {
    this.tray = new Tray(join(__dirname, "../assets/icon-template.png"));

    const contextMenu = Menu.buildFromTemplate([
      {
        label: "Start Dictation",
        click: () => this.toggleRecording(),
        accelerator: "Cmd+Shift+D",
      },
      { type: "separator" },
      {
        label: "Settings",
        click: () => this.showSettings(),
      },
      {
        label: "Download Models",
        click: () => this.showModelManager(),
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => app.quit(),
      },
    ]);

    this.tray.setContextMenu(contextMenu);
    this.tray.setToolTip("WhisperMac - AI Dictation");
  }

  private registerGlobalShortcuts() {
    // Unregister any existing shortcuts first
    globalShortcut.unregisterAll();

    // Primary shortcut for dictation
    const success1 = globalShortcut.register("CommandOrControl+Shift+D", () => {
      console.log("CommandOrControl+Shift+D is pressed");
      this.toggleRecording();
    });

    // Alternative shortcut
    const success2 = globalShortcut.register(
      "CommandOrControl+Option+Space",
      () => {
        console.log("CommandOrControl+Option+Space is pressed");
        this.toggleRecording();
      },
    );

    // Log if registration failed
    if (!success1) {
      console.error("Failed to register CommandOrControl+Shift+D shortcut");
    }

    if (!success2) {
      console.error(
        "Failed to register CommandOrControl+Option+Space shortcut",
      );
    }

    // Log all registered shortcuts
    console.log(
      "Registered shortcuts:",
      globalShortcut.isRegistered("CommandOrControl+Shift+D"),
    );
  }

  private async toggleRecording() {
    if (this.isRecording) {
      await this.stopRecording();
    } else {
      await this.startRecording();
    }
  }

  private async startRecording() {
    try {
      this.isRecording = true;
      this.updateTrayIcon("recording");

      // Start audio capture
      await this.audioService.startCapture();

      // Connect to WhisperLive
      await this.whisperClient.startTranscription((text: string) => {
        this.textInjector.insertText(text);
      });
    } catch (error) {
      console.error("Failed to start recording:", error);
      this.isRecording = false;
      this.updateTrayIcon("idle");
    }
  }

  private async stopRecording() {
    this.isRecording = false;
    this.updateTrayIcon("idle");

    await this.audioService.stopCapture();
    await this.whisperClient.stopTranscription();
  }

  private updateTrayIcon(state: "idle" | "recording") {
    const iconPath =
      state === "recording"
        ? "../assets/icon-recording.png"
        : "../assets/icon-template.png";
    this.tray?.setImage(join(__dirname, iconPath));
  }

  // Clean up when app quits
  cleanup() {
    globalShortcut.unregisterAll();
    this.whisperClient.stopServer();
  }
}

const appInstance = new WhisperMacApp();
appInstance.initialize();

// Handle app quit
app.on("will-quit", () => {
  appInstance.cleanup();
});

// Handle app activation (macOS)
app.on("activate", () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  // We don't need this for a menu bar app, but keeping it for completeness
});
