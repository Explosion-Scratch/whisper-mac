import { TextInjectionService } from "./TextInjectionService";
import { MicrophonePermissionService } from "./MicrophonePermissionService";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface PermissionStatus {
    granted: boolean;
    checked: boolean;
    error?: string;
}

export interface AllPermissionsStatus {
    accessibility: PermissionStatus;
    microphone: PermissionStatus;
}

/**
 * Lightweight coordinator for existing permission services.
 * 
 * This class follows the Single Responsibility Principle by acting as a facade
 * for existing permission services rather than duplicating their logic.
 * It provides a unified interface while delegating actual permission checks
 * to specialized services that already exist in the codebase.
 * 
 * @example
 * ```typescript
 * const manager = new PermissionsManager(textInjector, microphoneService);
 * const status = await manager.getAllPermissions();
 * console.log('Accessibility:', status.accessibility.granted);
 * console.log('Microphone:', status.microphone.granted);
 * ```
 */
export class PermissionsManager {
    /**
     * @param textInjector - Service that handles accessibility permissions
     * @param microphoneService - Service that handles microphone permissions
     */
    constructor(
        private textInjector: TextInjectionService,
        private microphoneService: MicrophonePermissionService,
    ) { }

    /**
     * Check accessibility permissions using existing service
     */
    async checkAccessibilityPermissions(): Promise<PermissionStatus> {
        try {
            const granted = await this.textInjector.checkAccessibilityPermissions();
            return { granted, checked: true };
        } catch (error) {
            return {
                granted: false,
                checked: true,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Check accessibility permissions without prompting user
     */
    async checkAccessibilityPermissionsQuiet(): Promise<PermissionStatus> {
        try {
            const granted = await this.textInjector.checkAccessibilityPermissions();
            return { granted, checked: true };
        } catch (error) {
            return {
                granted: false,
                checked: true,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Check microphone permissions using existing service
     */
    async checkMicrophonePermissions(): Promise<PermissionStatus> {
        try {
            const granted = await this.microphoneService.checkMicrophonePermissions();
            return { granted, checked: true };
        } catch (error) {
            return {
                granted: false,
                checked: true,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Check microphone permissions without prompting user
     */
    async checkMicrophonePermissionsQuiet(): Promise<PermissionStatus> {
        try {
            const granted = await this.microphoneService.checkMicrophonePermissions();
            return { granted, checked: true };
        } catch (error) {
            return {
                granted: false,
                checked: true,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Get all permission statuses in parallel
     */
    async getAllPermissions(): Promise<AllPermissionsStatus> {
        const [accessibility, microphone] = await Promise.all([
            this.checkAccessibilityPermissions(),
            this.checkMicrophonePermissions(),
        ]);

        return { accessibility, microphone };
    }

    /**
     * Get all permission statuses without prompting user
     */
    async getAllPermissionsQuiet(): Promise<AllPermissionsStatus> {
        const [accessibility, microphone] = await Promise.all([
            this.checkAccessibilityPermissionsQuiet(),
            this.checkMicrophonePermissionsQuiet(),
        ]);

        return { accessibility, microphone };
    }

    /**
     * Reset permission caches in existing services
     * This ensures fresh permission checks and eliminates restart requirements
     */
    resetCaches(): void {
        try {
            this.textInjector.resetAccessibilityCache();
            this.microphoneService.resetMicrophoneCache();
            console.log("Permission caches reset successfully");
        } catch (error) {
            console.warn("Failed to reset permission caches:", error);
            // Non-critical error, continue execution
        }
    }

    /**
     * Open System Preferences to Privacy & Security
     */
    async openSystemPreferences(): Promise<void> {
        try {
            await execAsync('open "x-apple.systempreferences:com.apple.preference.security"');
        } catch (error) {
            console.error("Failed to open System Preferences:", error);
            throw new Error("Failed to open System Preferences");
        }
    }

    /**
     * Open System Preferences to Accessibility permissions
     */
    async openAccessibilityPreferences(): Promise<void> {
        try {
            await execAsync('open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"');
        } catch (error) {
            console.error("Failed to open Accessibility preferences:", error);
            throw new Error("Failed to open Accessibility preferences");
        }
    }

    /**
     * Open System Preferences to Microphone permissions
     */
    async openMicrophonePreferences(): Promise<void> {
        try {
            await execAsync('open "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"');
        } catch (error) {
            console.error("Failed to open Microphone preferences:", error);
            throw new Error("Failed to open Microphone preferences");
        }
    }
}
