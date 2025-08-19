import { EventEmitter } from 'events';
import { exec } from 'child_process';
import { shell } from 'electron';
import { ActionHandler, ActionMatch, MatchPattern, ActionHandlerConfig, HandlerConfig } from '../types/ActionTypes';

export class ConfigurableActionsService extends EventEmitter {
  private actions: ActionHandler[] = [];
  private installedApps: Set<string> = new Set();

  constructor() {
    super();
    this.initializeInstalledApps();
  }

  private async initializeInstalledApps(): Promise<void> {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      const { stdout } = await execAsync('ls /Applications');
      const apps = stdout
        .split('\n')
        .filter(app => app.endsWith('.app'))
        .map(app => app.replace('.app', '').toLowerCase());

      this.installedApps = new Set(apps);
      console.log(`[ConfigurableActions] Discovered ${apps.length} installed applications`);
    } catch (error) {
      console.error('[ConfigurableActions] Failed to discover installed applications:', error);
    }
  }

  setActions(actions: ActionHandler[]): void {
    this.actions = actions.filter(action => action.enabled);
    console.log(`[ConfigurableActions] Loaded ${this.actions.length} enabled actions`);
  }

  detectAction(text: string): ActionMatch | null {
    const normalizedText = this.normalizeText(text);

    for (const action of this.actions) {
      for (const pattern of action.matchPatterns) {
        const match = this.testPattern(normalizedText, pattern);
        if (match) {
          return {
            actionId: action.id,
            matchedPattern: pattern,
            originalText: text,
            extractedArgument: match.argument,
            handlers: action.handlers.sort((a, b) => a.order - b.order)
          };
        }
      }
    }

    return null;
  }

  async executeAction(match: ActionMatch): Promise<void> {
    console.log(`[ConfigurableActions] Executing action: ${match.actionId} with argument: "${match.extractedArgument}"`);

    for (const handler of match.handlers) {
      try {
        const success = await this.executeHandler(handler, match);
        if (success) {
          this.emit('action-executed', match);
          return;
        }
      } catch (error) {
        console.warn(`[ConfigurableActions] Handler ${handler.id} failed:`, error);
        continue;
      }
    }

    console.error(`[ConfigurableActions] All handlers failed for action: ${match.actionId}`);
    this.emit('action-error', { match, error: new Error('All handlers failed') });
  }

  private async executeHandler(handler: ActionHandlerConfig, match: ActionMatch): Promise<boolean> {
    const config = this.interpolateConfig(handler.config, match);

    switch (handler.type) {
      case 'openUrl':
        return this.executeOpenUrl(config);
      case 'openApplication':
        return this.executeOpenApplication(config);
      case 'quitApplication':
        return this.executeQuitApplication(config);
      case 'executeShell':
        return this.executeShell(config);
      default:
        console.warn(`[ConfigurableActions] Unknown handler type: ${handler.type}`);
        return false;
    }
  }

  private async executeOpenUrl(config: any): Promise<boolean> {
    try {
      const url = config.urlTemplate;
      
      // Validate URL
      if (!url || typeof url !== 'string') {
        return false;
      }

      // Check if it's a valid URL or needs protocol
      let finalUrl = url;
      if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('file://')) {
        if (url.startsWith('www.') || url.includes('.')) {
          finalUrl = `https://${url}`;
        } else {
          return false;
        }
      }

      await shell.openExternal(finalUrl);
      return true;
    } catch (error) {
      console.error('[ConfigurableActions] Failed to open URL:', error);
      return false;
    }
  }

  private async executeOpenApplication(config: any): Promise<boolean> {
    try {
      const appName = config.applicationName?.toLowerCase();
      if (!appName) {
        return false;
      }

      // Check if app is installed
      if (!this.installedApps.has(appName)) {
        return false;
      }

      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      const command = `open -a "${appName}"`;
      await execAsync(command);
      return true;
    } catch (error) {
      console.error('[ConfigurableActions] Failed to open application:', error);
      return false;
    }
  }

  private async executeQuitApplication(config: any): Promise<boolean> {
    try {
      const appName = config.applicationName;
      const forceQuit = config.forceQuit || false;

      if (!appName) {
        // Quit WhisperMac itself
        const { app } = await import('electron');
        app.quit();
        return true;
      }

      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      const command = forceQuit 
        ? `pkill -f "${appName}"` 
        : `osascript -e 'tell application "${appName}" to quit'`;
      
      await execAsync(command);
      return true;
    } catch (error) {
      console.error('[ConfigurableActions] Failed to quit application:', error);
      return false;
    }
  }

  private async executeShell(config: any): Promise<boolean> {
    try {
      const command = config.command;
      const workingDirectory = config.workingDirectory || process.cwd();
      const timeout = config.timeout || 10000;
      const runInBackground = config.runInBackground || false;

      if (!command) {
        return false;
      }

      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      const execOptions = {
        cwd: workingDirectory,
        timeout,
        env: { ...process.env, ...config.environment }
      };

      if (runInBackground) {
        exec(command, execOptions);
        return true;
      } else {
        await execAsync(command, execOptions);
        return true;
      }
    } catch (error) {
      console.error('[ConfigurableActions] Failed to execute shell command:', error);
      return false;
    }
  }

  private interpolateConfig(config: HandlerConfig, match: ActionMatch): any {
    const interpolated = JSON.parse(JSON.stringify(config));
    const replacements = {
      '{match}': match.originalText,
      '{argument}': match.extractedArgument || '',
      '{pattern}': match.matchedPattern.pattern
    };

    const interpolateValue = (value: any): any => {
      if (typeof value === 'string') {
        let result = value;
        Object.entries(replacements).forEach(([key, replacement]) => {
          result = result.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), replacement);
        });
        return result;
      } else if (Array.isArray(value)) {
        return value.map(interpolateValue);
      } else if (typeof value === 'object' && value !== null) {
        const result: any = {};
        Object.entries(value).forEach(([key, val]) => {
          result[key] = interpolateValue(val);
        });
        return result;
      }
      return value;
    };

    return interpolateValue(interpolated);
  }

  private testPattern(text: string, pattern: MatchPattern): { argument?: string } | null {
    const testText = pattern.caseSensitive ? text : text.toLowerCase();
    const testPattern = pattern.caseSensitive ? pattern.pattern : pattern.pattern.toLowerCase();

    switch (pattern.type) {
      case 'exact':
        return testText === testPattern ? {} : null;

      case 'startsWith':
        if (testText.startsWith(testPattern)) {
          const argument = text.substring(pattern.pattern.length).trim();
          return { argument };
        }
        return null;

      case 'endsWith':
        if (testText.endsWith(testPattern)) {
          const argument = text.substring(0, text.length - pattern.pattern.length).trim();
          return { argument };
        }
        return null;

      case 'regex':
        try {
          const flags = pattern.caseSensitive ? 'g' : 'gi';
          const regex = new RegExp(testPattern, flags);
          const match = regex.exec(text);
          if (match) {
            const argument = match[1] || match[0];
            return { argument };
          }
        } catch (error) {
          console.error(`[ConfigurableActions] Invalid regex pattern: ${pattern.pattern}`, error);
        }
        return null;

      default:
        return null;
    }
  }

  private normalizeText(text: string): string {
    return text.trim().replace(/[^\w\s]/g, '');
  }

  getActions(): ActionHandler[] {
    return [...this.actions];
  }
}
