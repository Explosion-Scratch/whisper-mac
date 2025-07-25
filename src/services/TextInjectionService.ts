import { execFile } from 'child_process';
import { join } from 'path';

export class TextInjectionService {
  async insertText(text: string): Promise<void> {
    try {
      // Use AppleScript to insert text into the active application
      const script = `
        tell application "System Events"
          keystroke "${this.escapeText(text)}"
        end tell
      `;
      
      await this.runAppleScript(script);
    } catch (error) {
      console.error('Failed to insert text:', error);
      
      // Fallback: Copy to clipboard and paste
      await this.fallbackInsert(text);
    }
  }

  private escapeText(text: string): string {
    return text
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r');
  }

  private async runAppleScript(script: string): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile('osascript', ['-e', script], (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  private async fallbackInsert(text: string): Promise<void> {
    const { clipboard } = require('electron');
    const originalClipboard = clipboard.readText();
    
    clipboard.writeText(text);
    
    // Send Cmd+V to paste
    const pasteScript = `
      tell application "System Events"
        keystroke "v" using command down
      end tell
    `;
    
    await this.runAppleScript(pasteScript);
    
    // Restore original clipboard after a delay
    setTimeout(() => {
      clipboard.writeText(originalClipboard);
    }, 1000);
  }
}