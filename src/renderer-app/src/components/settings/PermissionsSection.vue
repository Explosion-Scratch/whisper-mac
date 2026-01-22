<template>
  <div class="permissions-section-container">
    <!-- Section Header -->
    <div class="section-header">
      <i class="ph-duotone ph-shield"></i>
      <div>
        <h2 class="section-title">Permissions</h2>
        <p class="section-description">
          Manage system permissions required by WhisperMac for full
          functionality
        </p>
      </div>
    </div>

    <!-- Permission Cards Container -->
    <div class="permission-cards">
      <!-- Accessibility Permission Card -->
      <div
        class="permission-card"
        :class="{ granted: permissions?.accessibility?.granted }"
      >
        <div class="permission-card-header">
          <div class="permission-icon-wrapper accessibility">
            <i class="ph-duotone ph-cursor-click"></i>
          </div>
          <div class="permission-info">
            <h3 class="permission-title">Accessibility</h3>
            <p class="permission-description">
              Required for automatic text insertion where you're typing
            </p>
          </div>
          <div class="permission-status">
            <span
              class="status-indicator"
              :class="getAccessibilityStatusClass()"
            >
              <i
                v-if="permissions?.accessibility?.granted"
                class="ph-duotone ph-check-circle"
              ></i>
              <i
                v-else-if="permissions?.accessibility?.checked"
                class="ph-duotone ph-x-circle"
              ></i>
              <i v-else class="ph-duotone ph-circle-notch spinning"></i>
              {{ getAccessibilityStatusText() }}
            </span>
          </div>
        </div>

        <div v-if="permissions?.accessibility?.error" class="permission-error">
          <i class="ph-duotone ph-warning"></i>
          {{ permissions.accessibility.error }}
        </div>

        <div class="permission-card-actions">
          <button
            type="button"
            class="btn btn-primary btn-sm"
            @click="openAccessibilitySettings"
          >
            <i class="ph-duotone ph-gear"></i>
            Open Settings
          </button>
          <button
            type="button"
            class="btn btn-default btn-sm"
            @click="checkAccessibilityPermissions"
            :disabled="isCheckingAccessibility"
          >
            <i
              v-if="isCheckingAccessibility"
              class="ph-duotone ph-circle-notch spinning"
            ></i>
            <i v-else class="ph-duotone ph-arrows-clockwise"></i>
            {{ isCheckingAccessibility ? "Checking..." : "Check Status" }}
          </button>
        </div>
      </div>

      <!-- Microphone Permission Card -->
      <div
        class="permission-card"
        :class="{ granted: permissions?.microphone?.granted }"
      >
        <div class="permission-card-header">
          <div class="permission-icon-wrapper microphone">
            <i class="ph-duotone ph-microphone"></i>
          </div>
          <div class="permission-info">
            <h3 class="permission-title">Microphone</h3>
            <p class="permission-description">
              Required to capture your voice for transcription
            </p>
          </div>
          <div class="permission-status">
            <span class="status-indicator" :class="getMicrophoneStatusClass()">
              <i
                v-if="permissions?.microphone?.granted"
                class="ph-duotone ph-check-circle"
              ></i>
              <i
                v-else-if="permissions?.microphone?.checked"
                class="ph-duotone ph-x-circle"
              ></i>
              <i v-else class="ph-duotone ph-circle-notch spinning"></i>
              {{ getMicrophoneStatusText() }}
            </span>
          </div>
        </div>

        <div v-if="permissions?.microphone?.error" class="permission-error">
          <i class="ph-duotone ph-warning"></i>
          {{ permissions.microphone.error }}
        </div>

        <div class="permission-card-actions">
          <button
            type="button"
            class="btn btn-primary btn-sm"
            @click="openMicrophoneSettings"
          >
            <i class="ph-duotone ph-gear"></i>
            Open Settings
          </button>
          <button
            type="button"
            class="btn btn-default btn-sm"
            @click="checkMicrophonePermissions"
            :disabled="isCheckingMicrophone"
          >
            <i
              v-if="isCheckingMicrophone"
              class="ph-duotone ph-circle-notch spinning"
            ></i>
            <i v-else class="ph-duotone ph-arrows-clockwise"></i>
            {{ isCheckingMicrophone ? "Checking..." : "Check Status" }}
          </button>
        </div>
      </div>
    </div>

    <!-- Quick Actions Section -->
    <div class="quick-actions-card">
      <div class="quick-actions-header">
        <i class="ph-duotone ph-lightning"></i>
        <div>
          <h4 class="quick-actions-title">Quick Actions</h4>
          <p class="quick-actions-description">
            Refresh all permissions or open system settings
          </p>
        </div>
      </div>
      <div class="quick-actions-buttons">
        <button
          type="button"
          class="btn btn-default"
          @click="refreshAllPermissions"
          :disabled="isRefreshingAll"
        >
          <i
            v-if="isRefreshingAll"
            class="ph-duotone ph-circle-notch spinning"
          ></i>
          <i v-else class="ph-duotone ph-arrows-clockwise"></i>
          {{ isRefreshingAll ? "Refreshing..." : "Refresh All" }}
        </button>
        <button
          type="button"
          class="btn btn-default"
          @click="openSystemPreferences"
        >
          <i class="ph-duotone ph-gear-six"></i>
          System Settings
        </button>
      </div>
    </div>

    <!-- Help Information -->
    <div class="info-card">
      <div class="info-card-header">
        <i class="ph-duotone ph-info"></i>
        <span>Important Information</span>
      </div>
      <div class="info-card-content">
        <div class="info-item">
          <i class="ph-duotone ph-check"></i>
          <span>Permission changes take effect immediately in most cases.</span>
        </div>
        <div class="info-item">
          <i class="ph-duotone ph-arrows-clockwise"></i>
          <span
            >If features aren't working after granting permissions, try
            refreshing or restarting the app.</span
          >
        </div>
        <div class="info-item">
          <i class="ph-duotone ph-chat-centered-text"></i>
          <span
            >WhisperMac will show permission dialogs when needed if permissions
            are missing.</span
          >
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import {
  loadPermissions,
  checkAccessibilityPermissions,
  checkMicrophonePermissions,
  refreshPermissions,
  openSystemPreferences,
  getPermissionStatusClass,
  getPermissionStatusText,
} from "../../utils/permissions";

/**
 * PermissionsSection Component
 *
 * A self-contained view component for managing system permissions.
 * Encapsulates all permission-related state, logic, and UI.
 *
 * @emits status - Emitted when a status message should be shown
 *                 Payload: { message: string, type: 'success' | 'error' | 'warning' | 'info' }
 */
export default {
  name: "PermissionsSection",

  emits: ["status"],

  data() {
    return {
      permissions: null,
      isCheckingAccessibility: false,
      isCheckingMicrophone: false,
      isRefreshingAll: false,
    };
  },

  async mounted() {
    await this.loadPermissions();
  },

  methods: {
    /**
     * Emit a status message to the parent component
     */
    emitStatus(message, type = "success") {
      this.$emit("status", { message, type });
    },

    /**
     * Load all permissions status from the main process
     */
    async loadPermissions() {
      window.log?.("Loading permissions status...");
      this.permissions = await loadPermissions();
      if (!this.permissions) {
        this.emitStatus("Failed to load permissions status", "error");
      }
      window.log?.("Permissions loaded:", this.permissions);
    },

    /**
     * Check and update accessibility permission status
     */
    async checkAccessibilityPermissions() {
      this.isCheckingAccessibility = true;
      try {
        window.log?.("Checking accessibility permissions...");
        const status = await checkAccessibilityPermissions();
        if (this.permissions) {
          this.permissions.accessibility = status;
        }
        if (status.granted) {
          this.emitStatus("Accessibility permissions are enabled", "success");
        } else {
          this.emitStatus(
            "Accessibility permissions need to be enabled in System Settings",
            "warning",
          );
        }
        window.log?.("Accessibility permission status:", status);
      } catch (error) {
        window.error?.("Failed to check accessibility permissions:", error);
        this.emitStatus("Failed to check accessibility permissions", "error");
      } finally {
        this.isCheckingAccessibility = false;
      }
    },

    /**
     * Check and update microphone permission status
     */
    async checkMicrophonePermissions() {
      this.isCheckingMicrophone = true;
      try {
        window.log?.("Checking microphone permissions...");
        const status = await checkMicrophonePermissions();
        if (this.permissions) {
          this.permissions.microphone = status;
        }
        if (status.granted) {
          this.emitStatus("Microphone permissions are enabled", "success");
        } else {
          this.emitStatus(
            "Microphone permissions need to be enabled in System Settings",
            "warning",
          );
        }
        window.log?.("Microphone permission status:", status);
      } catch (error) {
        window.error?.("Failed to check microphone permissions:", error);
        this.emitStatus("Failed to check microphone permissions", "error");
      } finally {
        this.isCheckingMicrophone = false;
      }
    },

    /**
     * Refresh all permission statuses
     */
    async refreshAllPermissions() {
      this.isRefreshingAll = true;
      try {
        window.log?.("Refreshing all permissions...");
        this.permissions = await refreshPermissions();
        this.emitStatus("Permission status refreshed", "success");
      } catch (error) {
        window.error?.("Failed to refresh permissions:", error);
        this.emitStatus("Failed to refresh permission status", "error");
      } finally {
        this.isRefreshingAll = false;
      }
    },

    /**
     * Open system preferences
     */
    async openSystemPreferences() {
      window.log?.("Opening System Settings...");
      await openSystemPreferences("general");
      this.emitStatus(
        "System Settings opened - return here after making changes",
        "info",
      );
    },

    /**
     * Open accessibility settings panel
     */
    async openAccessibilitySettings() {
      window.log?.("Opening Accessibility Settings...");
      await openSystemPreferences("accessibility");
      this.emitStatus(
        "Accessibility Settings opened - return here after making changes",
        "info",
      );
    },

    /**
     * Open microphone settings panel
     */
    async openMicrophoneSettings() {
      window.log?.("Opening Microphone Settings...");
      await openSystemPreferences("microphone");
      this.emitStatus(
        "Microphone Settings opened - return here after making changes",
        "info",
      );
    },

    /**
     * Get CSS class for accessibility permission status
     */
    getAccessibilityStatusClass() {
      return getPermissionStatusClass(this.permissions?.accessibility);
    },

    /**
     * Get display text for accessibility permission status
     */
    getAccessibilityStatusText() {
      return getPermissionStatusText(this.permissions?.accessibility);
    },

    /**
     * Get CSS class for microphone permission status
     */
    getMicrophoneStatusClass() {
      return getPermissionStatusClass(this.permissions?.microphone);
    },

    /**
     * Get display text for microphone permission status
     */
    getMicrophoneStatusText() {
      return getPermissionStatusText(this.permissions?.microphone);
    },
  },
};
</script>

<style scoped>
.permissions-section-container {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg, 24px);
}

/* Section Header - matches existing section-header style */
.section-header {
  margin-bottom: var(--spacing-md, 16px);
  padding-bottom: var(--spacing-md, 16px);
  border-bottom: 1px solid var(--color-border-primary, #e0e0e0);
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-sm, 8px);
}

.section-header > .ph-duotone {
  margin-top: 2px;
  font-size: 20px;
  color: var(--color-primary, #007aff);
  flex-shrink: 0;
}

.section-title {
  font-size: var(--font-size-2xl, 18px);
  font-weight: var(--font-weight-semibold, 600);
  color: var(--color-text-primary, #333333);
  margin: 0 0 var(--spacing-xs, 4px) 0;
  line-height: 1.2;
}

.section-description {
  font-size: var(--font-size-md, 13px);
  color: var(--color-text-secondary, #666666);
  margin: 0;
  line-height: 1.4;
}

/* Permission Cards Container */
.permission-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--spacing-md, 16px);
}

/* Permission Card */
.permission-card {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--color-border-primary, #e0e0e0);
  border-radius: var(--radius-lg, 8px);
  padding: var(--spacing-md, 16px);
  transition: all var(--transition-normal, 0.2s ease);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md, 16px);
}

.permission-card:hover {
  border-color: var(--color-border-secondary, #d0d0d0);
  box-shadow: var(--shadow-md, 0 2px 4px rgba(0, 0, 0, 0.1));
}

.permission-card.granted {
  border-color: var(--color-success, #34c759);
  background: rgba(52, 199, 89, 0.04);
}

.permission-card.granted:hover {
  border-color: var(--color-success, #34c759);
  box-shadow: 0 2px 8px rgba(52, 199, 89, 0.15);
}

/* Permission Card Header */
.permission-card-header {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-sm, 8px);
}

.permission-icon-wrapper {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md, 6px);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 20px;
}

.permission-icon-wrapper.accessibility {
  background: rgba(0, 122, 255, 0.1);
  color: var(--color-primary, #007aff);
}

.permission-icon-wrapper.microphone {
  background: rgba(255, 59, 48, 0.1);
  color: var(--color-error, #ff3b30);
}

.permission-card.granted .permission-icon-wrapper {
  background: rgba(52, 199, 89, 0.15);
  color: var(--color-success, #34c759);
}

.permission-info {
  flex: 1;
  min-width: 0;
}

.permission-title {
  font-size: var(--font-size-lg, 14px);
  font-weight: var(--font-weight-semibold, 600);
  color: var(--color-text-primary, #333333);
  margin: 0 0 var(--spacing-xs, 4px) 0;
}

.permission-description {
  font-size: var(--font-size-sm, 12px);
  color: var(--color-text-secondary, #666666);
  margin: 0;
  line-height: 1.4;
}

/* Permission Status */
.permission-status {
  flex-shrink: 0;
}

.status-indicator {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
  padding: 4px 10px;
  border-radius: var(--radius-sm, 4px);
  font-size: var(--font-size-sm, 12px);
  font-weight: var(--font-weight-medium, 500);
}

.status-indicator.granted {
  background: rgba(52, 199, 89, 0.15);
  color: var(--color-success, #34c759);
}

.status-indicator.denied {
  background: rgba(255, 59, 48, 0.15);
  color: var(--color-error, #ff3b30);
}

.status-indicator.unknown {
  background: rgba(255, 149, 0, 0.15);
  color: var(--color-warning, #ff9500);
}

.status-indicator .ph-duotone {
  font-size: 14px;
}

/* Permission Error */
.permission-error {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
  padding: var(--spacing-sm, 8px);
  background: rgba(255, 59, 48, 0.08);
  border-radius: var(--radius-sm, 4px);
  font-size: var(--font-size-sm, 12px);
  color: var(--color-error, #ff3b30);
}

.permission-error .ph-duotone {
  flex-shrink: 0;
}

/* Permission Card Actions */
.permission-card-actions {
  display: flex;
  gap: var(--spacing-sm, 8px);
  flex-wrap: wrap;
  padding-top: var(--spacing-sm, 8px);
  border-top: 1px solid var(--color-border-primary, #e0e0e0);
}

/* Quick Actions Card */
.quick-actions-card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border-primary, #e0e0e0);
  border-radius: var(--radius-lg, 8px);
  padding: var(--spacing-md, 16px);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md, 16px);
}

.quick-actions-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm, 8px);
}

.quick-actions-header > .ph-duotone {
  font-size: 18px;
  color: var(--color-warning, #ff9500);
}

.quick-actions-title {
  font-size: var(--font-size-md, 13px);
  font-weight: var(--font-weight-semibold, 600);
  color: var(--color-text-primary, #333333);
  margin: 0;
}

.quick-actions-description {
  font-size: var(--font-size-sm, 12px);
  color: var(--color-text-secondary, #666666);
  margin: 0;
}

.quick-actions-buttons {
  display: flex;
  gap: var(--spacing-sm, 8px);
  flex-wrap: wrap;
}

/* Info Card */
.info-card {
  background: rgba(0, 122, 255, 0.04);
  border: 1px solid rgba(0, 122, 255, 0.15);
  border-radius: var(--radius-lg, 8px);
  overflow: hidden;
}

.info-card-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm, 8px);
  padding: var(--spacing-sm, 8px) var(--spacing-md, 16px);
  background: rgba(0, 122, 255, 0.06);
  border-bottom: 1px solid rgba(0, 122, 255, 0.1);
  font-size: var(--font-size-sm, 12px);
  font-weight: var(--font-weight-semibold, 600);
  color: var(--color-primary, #007aff);
}

.info-card-header .ph-duotone {
  font-size: 16px;
}

.info-card-content {
  padding: var(--spacing-md, 16px);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm, 8px);
}

.info-item {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-sm, 8px);
  font-size: var(--font-size-sm, 12px);
  color: var(--color-text-secondary, #666666);
  line-height: 1.4;
}

.info-item .ph-duotone {
  flex-shrink: 0;
  font-size: 14px;
  color: var(--color-primary, #007aff);
  margin-top: 1px;
}

/* Button Styles - extending base .btn styles */
.btn {
  padding: 6px 12px;
  border: 1px solid var(--color-border-primary, #e0e0e0);
  border-radius: var(--radius-sm, 4px);
  background: rgba(255, 255, 255, 0.08);
  font-size: var(--font-size-sm, 12px);
  font-weight: var(--font-weight-medium, 500);
  cursor: pointer;
  transition: all var(--transition-fast, 0.15s ease);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-xs, 4px);
  min-height: 28px;
  text-decoration: none;
  color: var(--color-text-primary, #333333);
}

.btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
  border-color: var(--color-border-secondary, #d0d0d0);
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm, 0 1px 2px rgba(0, 0, 0, 0.05));
}

.btn:active:not(:disabled) {
  transform: translateY(0);
  box-shadow: none;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--color-primary, #007aff);
  color: var(--color-text-inverse, #ffffff);
  border-color: var(--color-primary, #007aff);
}

.btn-primary:hover:not(:disabled) {
  background: var(--color-primary-hover, #0056cc);
  border-color: var(--color-primary-hover, #0056cc);
}

.btn-default {
  background: rgba(255, 255, 255, 0.08);
}

.btn-sm {
  padding: 4px 10px;
  min-height: 26px;
  font-size: var(--font-size-sm, 12px);
}

.btn .ph-duotone {
  font-size: 14px;
}

/* Spinning animation */
.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* Responsive adjustments */
@media (max-width: 600px) {
  .permission-cards {
    grid-template-columns: 1fr;
  }

  .permission-card-header {
    flex-wrap: wrap;
  }

  .permission-status {
    width: 100%;
    margin-top: var(--spacing-sm, 8px);
  }
}

/* Dark mode support */
@media (prefers-color-scheme: dark) {
  .section-header > .ph-duotone {
    color: #007aff;
  }

  .section-title {
    color: #ececec;
  }

  .section-description {
    color: #a2a2a7;
  }

  .permission-card {
    background: rgba(255, 255, 255, 0.02);
    border-color: rgba(255, 255, 255, 0.12);
  }

  .permission-card:hover {
    background: rgba(255, 255, 255, 0.04);
    border-color: rgba(255, 255, 255, 0.18);
  }

  .permission-card.granted {
    background: rgba(52, 199, 89, 0.06);
    border-color: rgba(52, 199, 89, 0.3);
  }

  .permission-card.granted:hover {
    background: rgba(52, 199, 89, 0.08);
  }

  .permission-icon-wrapper {
    background: rgba(255, 255, 255, 0.06);
  }

  .permission-icon-wrapper.accessibility {
    color: #007aff;
  }

  .permission-icon-wrapper.microphone {
    color: #ff9500;
  }

  .permission-card.granted .permission-icon-wrapper {
    background: rgba(52, 199, 89, 0.15);
    color: #34c759;
  }

  .permission-title {
    color: #ececec;
  }

  .permission-description {
    color: #a2a2a7;
  }

  .status-indicator.granted {
    background: rgba(52, 199, 89, 0.15);
    color: #34c759;
  }

  .status-indicator.denied {
    background: rgba(255, 59, 48, 0.15);
    color: #ff3b30;
  }

  .status-indicator.unknown {
    background: rgba(255, 149, 0, 0.15);
    color: #ff9500;
  }

  .permission-error {
    color: #ff3b30;
  }

  .quick-actions-card {
    background: rgba(255, 255, 255, 0.02);
    border-color: rgba(255, 255, 255, 0.12);
  }

  .quick-actions-title {
    color: #ececec;
  }

  .quick-actions-description {
    color: #a2a2a7;
  }

  .info-card {
    background: rgba(0, 122, 255, 0.06);
    border-color: rgba(0, 122, 255, 0.15);
  }

  .info-card-header .ph-duotone {
    color: #007aff;
  }

  .info-card-header span {
    color: #ececec;
  }

  .info-item {
    color: #a2a2a7;
  }

  .info-item .ph-duotone {
    color: #666666;
  }

  .btn {
    background: rgba(255, 255, 255, 0.06);
    color: #ececec;
    border-color: rgba(255, 255, 255, 0.12);
  }

  .btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.18);
  }

  .btn-primary {
    background: #007aff;
    color: #ffffff;
    border-color: #007aff;
  }

  .btn-primary:hover:not(:disabled) {
    background: #0056cc;
    border-color: #0056cc;
  }

  .btn-default {
    background: rgba(255, 255, 255, 0.06);
  }
}
</style>
