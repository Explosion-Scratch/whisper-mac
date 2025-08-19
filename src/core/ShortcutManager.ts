import { globalShortcut } from "electron";

export class ShortcutManager {
  private registeredShortcuts: string[] = [];

  registerShortcuts(onToggleRecording: () => void): void {
    this.unregisterAll();

    const shortcuts = [
      { key: "Control+D", handler: onToggleRecording },
      { key: "CommandOrControl+Option+Space", handler: onToggleRecording },
    ];

    shortcuts.forEach(({ key, handler }) => {
      const success = globalShortcut.register(key, () => {
        console.log(`${key} is pressed`);
        handler();
      });

      if (success) {
        this.registeredShortcuts.push(key);
        console.log(`Registered shortcut: ${key}`);
      } else {
        console.error(`Failed to register ${key} shortcut`);
      }
    });
  }

  unregisterAll(): void {
    globalShortcut.unregisterAll();
    this.registeredShortcuts = [];
    console.log("All shortcuts unregistered");
  }

  isRegistered(shortcut: string): boolean {
    return globalShortcut.isRegistered(shortcut);
  }

  getRegisteredShortcuts(): string[] {
    return [...this.registeredShortcuts];
  }
}
