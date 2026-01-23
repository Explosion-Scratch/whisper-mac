import { app } from "electron";
import { join, resolve } from "path";
import { existsSync, readdirSync } from "fs";
import { spawn } from "child_process";
import { SettingsManager } from "../config/SettingsManager";

export type SoundType = "start" | "stop" | "transformComplete";

export interface SoundSettings {
  enabled: boolean;
  volume: number;
  startSound: string;
  stopSound: string;
  transformCompleteSound: string;
  playTransformCompleteSound: boolean;
}

export class SoundService {
  private soundsDirectory: string;
  private availableSounds: string[] = [];

  constructor(private readonly settingsManager: SettingsManager) {
    this.soundsDirectory = this.resolveSoundsDirectory();
    this.loadAvailableSounds();
  }

  private resolveSoundsDirectory(): string {
    if (app.isPackaged) {
      return join(process.resourcesPath, "assets", "sounds");
    }
    return resolve(__dirname, "../../assets/sounds");
  }

  private loadAvailableSounds(): void {
    try {
      if (existsSync(this.soundsDirectory)) {
        this.availableSounds = readdirSync(this.soundsDirectory)
          .filter((file) => file.endsWith(".mp3") || file.endsWith(".wav"))
          .map((file) => file.replace(/\.(mp3|wav)$/, ""));
        console.log(
          `[SoundService] Loaded ${this.availableSounds.length} sounds from ${this.soundsDirectory}`,
        );
      } else {
        console.warn(
          `[SoundService] Sounds directory not found: ${this.soundsDirectory}`,
        );
      }
    } catch (error) {
      console.error("[SoundService] Failed to load available sounds:", error);
      this.availableSounds = [];
    }
  }

  getAvailableSounds(): string[] {
    return [...this.availableSounds];
  }

  private getSoundSettings(): SoundSettings {
    return {
      enabled: this.settingsManager.get<boolean>("sounds.enabled", true),
      volume: this.settingsManager.get<number>("sounds.volume", 0.5),
      startSound: this.settingsManager.get<string>(
        "sounds.startSound",
        "start",
      ),
      stopSound: this.settingsManager.get<string>("sounds.stopSound", "end"),
      transformCompleteSound: this.settingsManager.get<string>(
        "sounds.transformCompleteSound",
        "end",
      ),
      playTransformCompleteSound: this.settingsManager.get<boolean>(
        "sounds.playTransformCompleteSound",
        false,
      ),
    };
  }

  private getSoundPath(soundName: string): string | null {
    const mp3Path = join(this.soundsDirectory, `${soundName}.mp3`);
    const wavPath = join(this.soundsDirectory, `${soundName}.wav`);

    if (existsSync(mp3Path)) return mp3Path;
    if (existsSync(wavPath)) return wavPath;

    console.warn(`[SoundService] Sound file not found: ${soundName}`);
    return null;
  }

  /**
   * Play a sound asynchronously (fire-and-forget).
   * Does not wait for sound to complete or even start.
   */
  playSound(type: SoundType): void {
    const settings = this.getSoundSettings();

    if (!settings.enabled) {
      return;
    }

    if (type === "transformComplete" && !settings.playTransformCompleteSound) {
      return;
    }

    let soundName: string;
    switch (type) {
      case "start":
        soundName = settings.startSound;
        break;
      case "stop":
        soundName = settings.stopSound;
        break;
      case "transformComplete":
        soundName = settings.transformCompleteSound;
        break;
      default:
        return;
    }

    if (!soundName || soundName === "none") {
      return;
    }

    const soundPath = this.getSoundPath(soundName);
    if (!soundPath) {
      return;
    }

    this.playSoundFile(soundPath, settings.volume);
  }

  /**
   * Preview a sound by name with specified volume.
   * Used for previewing sounds in the settings UI.
   */
  playSoundPreview(soundName: string, volume: number = 0.5): void {
    if (!soundName || soundName === "none") {
      return;
    }

    const soundPath = this.getSoundPath(soundName);
    if (!soundPath) {
      return;
    }

    this.playSoundFile(soundPath, volume);
  }

  /**
   * Play a sound file using macOS afplay command.
   * This is fire-and-forget - does not wait for completion.
   */
  private playSoundFile(soundPath: string, volume: number): void {
    const volumeArg = Math.max(0, Math.min(1, volume)).toString();

    const child = spawn("afplay", ["-v", volumeArg, soundPath], {
      stdio: "ignore",
      detached: true,
    });

    child.unref();

    child.on("error", (error) => {
      console.warn(`[SoundService] Failed to play sound: ${error.message}`);
    });
  }

  /**
   * Refresh the list of available sounds.
   */
  refreshAvailableSounds(): void {
    this.loadAvailableSounds();
  }
}
