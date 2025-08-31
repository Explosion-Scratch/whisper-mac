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
        console.log("PermissionsManager.checkAccessibilityPermissions: Starting accessibility permission check");
        try {
            const granted = await this.textInjector.checkAccessibilityPermissions();
            console.log(`PermissionsManager.checkAccessibilityPermissions: Accessibility permission ${granted ? 'granted' : 'denied'}`);
            return { granted, checked: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`PermissionsManager.checkAccessibilityPermissions: Error checking accessibility permissions: ${errorMessage}`);
            return {
                granted: false,
                checked: true,
                error: errorMessage,
            };
        }
    }

    /**
     * Check accessibility permissions without prompting user
     */
    async checkAccessibilityPermissionsQuiet(): Promise<PermissionStatus> {
        console.log("PermissionsManager.checkAccessibilityPermissionsQuiet: Starting quiet accessibility permission check");
        try {
            // Reset cache to ensure fresh check for quiet operations
            console.log("PermissionsManager.checkAccessibilityPermissionsQuiet: Resetting accessibility cache for fresh check");
            this.textInjector.resetAccessibilityCache();
            const granted = await this.textInjector.checkAccessibilityPermissions();
            console.log(`PermissionsManager.checkAccessibilityPermissionsQuiet: Accessibility permission ${granted ? 'granted' : 'denied'} (quiet check)`);
            return { granted, checked: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`PermissionsManager.checkAccessibilityPermissionsQuiet: Error checking accessibility permissions (quiet): ${errorMessage}`);
            return {
                granted: false,
                checked: true,
                error: errorMessage,
            };
        }
    }

    /**
     * Check microphone permissions using existing service
     */
    async checkMicrophonePermissions(): Promise<PermissionStatus> {
        console.log("PermissionsManager.checkMicrophonePermissions: Starting microphone permission check");
        try {
            const granted = await this.microphoneService.checkMicrophonePermissions();
            console.log(`PermissionsManager.checkMicrophonePermissions: Microphone permission ${granted ? 'granted' : 'denied'}`);
            return { granted, checked: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`PermissionsManager.checkMicrophonePermissions: Error checking microphone permissions: ${errorMessage}`);
            return {
                granted: false,
                checked: true,
                error: errorMessage,
            };
        }
    }

    /**
     * Check microphone permissions without prompting user
     */
    async checkMicrophonePermissionsQuiet(): Promise<PermissionStatus> {
        console.log("PermissionsManager.checkMicrophonePermissionsQuiet: Starting quiet microphone permission check");
        try {
            // Reset cache to ensure fresh check for quiet operations
            console.log("PermissionsManager.checkMicrophonePermissionsQuiet: Resetting microphone cache for fresh check");
            this.microphoneService.resetMicrophoneCache();
            const granted = await this.microphoneService.checkMicrophonePermissions();
            console.log(`PermissionsManager.checkMicrophonePermissionsQuiet: Microphone permission ${granted ? 'granted' : 'denied'} (quiet check)`);
            return { granted, checked: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`PermissionsManager.checkMicrophonePermissionsQuiet: Error checking microphone permissions (quiet): ${errorMessage}`);
            return {
                granted: false,
                checked: true,
                error: errorMessage,
            };
        }
    }

    /**
     * Ensure microphone permissions are granted, requesting them if needed
     */
    async ensureMicrophonePermissions(): Promise<PermissionStatus> {
        console.log("PermissionsManager.ensureMicrophonePermissions: Ensuring microphone permissions are granted");
        try {
            const granted = await this.microphoneService.ensureMicrophonePermissions();
            console.log(`PermissionsManager.ensureMicrophonePermissions: Microphone permission ${granted ? 'granted' : 'denied'} after ensure`);
            return { granted, checked: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`PermissionsManager.ensureMicrophonePermissions: Error ensuring microphone permissions: ${errorMessage}`);
            return {
                granted: false,
                checked: true,
                error: errorMessage,
            };
        }
    }

    /**
     * Get all permission statuses in parallel
     */
    async getAllPermissions(): Promise<AllPermissionsStatus> {
        console.log("PermissionsManager.getAllPermissions: Starting comprehensive permission check");
        const [accessibility, microphone] = await Promise.all([
            this.checkAccessibilityPermissions(),
            this.checkMicrophonePermissions(),
        ]);

        console.log(`PermissionsManager.getAllPermissions: Results - Accessibility: ${accessibility.granted ? 'granted' : 'denied'}, Microphone: ${microphone.granted ? 'granted' : 'denied'}`);
        return { accessibility, microphone };
    }

    /**
     * Get all permission statuses without prompting user
     */
    async getAllPermissionsQuiet(): Promise<AllPermissionsStatus> {
        console.log("PermissionsManager.getAllPermissionsQuiet: Starting comprehensive quiet permission check");
        const [accessibility, microphone] = await Promise.all([
            this.checkAccessibilityPermissionsQuiet(),
            this.checkMicrophonePermissionsQuiet(),
        ]);

        console.log(`PermissionsManager.getAllPermissionsQuiet: Results - Accessibility: ${accessibility.granted ? 'granted' : 'denied'}, Microphone: ${microphone.granted ? 'granted' : 'denied'} (quiet check)`);
        return { accessibility, microphone };
    }

    /**
     * Reset permission caches in existing services
     * This ensures fresh permission checks and eliminates restart requirements
     */
    resetCaches(): void {
        console.log("PermissionsManager.resetCaches: Resetting all permission caches");
        try {
            this.textInjector.resetAccessibilityCache();
            this.microphoneService.resetMicrophoneCache();
            console.log("PermissionsManager.resetCaches: All permission caches reset successfully");
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.warn(`PermissionsManager.resetCaches: Failed to reset permission caches: ${errorMessage}`);
            // Non-critical error, continue execution
        }
    }

    /**
     * Open System Preferences to Privacy & Security
     */
    async openSystemPreferences(): Promise<void> {
        console.log("PermissionsManager.openSystemPreferences: Opening System Preferences to Privacy & Security");
        try {
            await execAsync('open "x-apple.systempreferences:com.apple.preference.security"');
            console.log("PermissionsManager.openSystemPreferences: System Preferences opened successfully");
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`PermissionsManager.openSystemPreferences: Failed to open System Preferences: ${errorMessage}`);
            throw new Error("Failed to open System Preferences");
        }
    }

    /**
     * Open System Preferences to Accessibility permissions
     */
    async openAccessibilityPreferences(): Promise<void> {
        console.log("PermissionsManager.openAccessibilityPreferences: Opening System Preferences to Accessibility permissions");
        try {
            await execAsync('open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"');
            console.log("PermissionsManager.openAccessibilityPreferences: Accessibility preferences opened successfully");
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`PermissionsManager.openAccessibilityPreferences: Failed to open Accessibility preferences: ${errorMessage}`);
            throw new Error("Failed to open Accessibility preferences");
        }
    }

    /**
     * Open System Preferences to Microphone permissions
     */
    async openMicrophonePreferences(): Promise<void> {
        console.log("PermissionsManager.openMicrophonePreferences: Opening System Preferences to Microphone permissions");
        try {
            await execAsync('open "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"');
            console.log("PermissionsManager.openMicrophonePreferences: Microphone preferences opened successfully");
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`PermissionsManager.openMicrophonePreferences: Failed to open Microphone preferences: ${errorMessage}`);
            throw new Error("Failed to open Microphone preferences");
        }
    }
}
