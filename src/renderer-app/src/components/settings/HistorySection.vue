<template>
  <div class="history-section-container">
    <!-- Section Header -->
    <div class="section-header">
      <i class="ph-duotone ph-clock-counter-clockwise"></i>
      <div>
        <h2 class="section-title">Recording History</h2>
        <p class="section-description">
          View and manage your past recordings, transcriptions, and
          transformations.
        </p>
      </div>
    </div>

    <!-- Settings Card -->
    <div class="settings-card">
      <div class="settings-card-header">
        <i class="ph-duotone ph-gear"></i>
        <div>
          <h4>History Settings</h4>
          <p class="settings-description">
            Configure how recordings are saved
          </p>
        </div>
      </div>
      <div class="settings-card-content">
        <div class="setting-row">
          <label class="toggle-label">
            <input
              type="checkbox"
              v-model="historySettings.enabled"
              @change="updateSettings"
            />
            <span class="toggle-text">Enable Recording History</span>
          </label>
          <p class="setting-hint">Save audio and transcriptions for review</p>
        </div>
        <div class="setting-row">
          <label class="input-label">Maximum Recordings</label>
          <div class="input-with-hint">
            <input
              type="number"
              v-model.number="historySettings.maxRecordings"
              min="1"
              max="1000"
              @change="updateSettings"
              class="number-input"
            />
            <p class="setting-hint">
              Older recordings will be automatically deleted
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- Stats Card -->
    <div class="stats-card" v-if="stats">
      <div class="stat-item">
        <i class="ph-duotone ph-microphone"></i>
        <div class="stat-content">
          <span class="stat-value">{{ stats.totalRecordings }}</span>
          <span class="stat-label">Recordings</span>
        </div>
      </div>
      <div class="stat-item">
        <i class="ph-duotone ph-timer"></i>
        <div class="stat-content">
          <span class="stat-value">{{ formatDuration(stats.totalDuration) }}</span>
          <span class="stat-label">Total Duration</span>
        </div>
      </div>
      <div class="stat-item">
        <i class="ph-duotone ph-hard-drives"></i>
        <div class="stat-content">
          <span class="stat-value">{{ formatBytes(stats.storageUsed) }}</span>
          <span class="stat-label">Storage Used</span>
        </div>
      </div>
    </div>

    <!-- Actions Bar -->
    <div class="actions-bar">
      <button
        type="button"
        class="btn btn-default"
        @click="loadRecordings"
        :disabled="isLoading"
      >
        <i class="ph-duotone ph-arrow-clockwise" :class="{ spinning: isLoading }"></i>
        Refresh
      </button>
      <button
        type="button"
        class="btn btn-negative"
        @click="confirmDeleteAll"
        :disabled="recordings.length === 0 || isDeleting"
      >
        <i class="ph-duotone ph-trash"></i>
        Delete All
      </button>
    </div>

    <!-- Recordings List -->
    <div class="recordings-list" v-if="recordings.length > 0">
      <div
        v-for="recording in recordings"
        :key="recording.id"
        class="recording-card"
        :class="{ playing: playingId === recording.id }"
      >
        <div class="recording-header">
          <div class="recording-meta">
            <span class="recording-date">{{ formatDate(recording.timestamp) }}</span>
            <span class="recording-duration">{{ formatDuration(recording.duration) }}</span>
            <span class="recording-plugin" v-if="recording.pluginUsed">
              <i class="ph-duotone ph-plug"></i>
              {{ recording.pluginUsed }}
            </span>
          </div>
          <div class="recording-actions">
            <button
              type="button"
              class="btn btn-icon"
              @click="togglePlay(recording)"
              :title="playingId === recording.id ? 'Stop' : 'Play'"
            >
              <i
                class="ph-duotone"
                :class="playingId === recording.id ? 'ph-stop' : 'ph-play'"
              ></i>
            </button>
            <button
              type="button"
              class="btn btn-icon"
              @click="deleteRecording(recording.id)"
              title="Delete recording"
            >
              <i class="ph-duotone ph-trash"></i>
            </button>
          </div>
        </div>

        <!-- Audio Progress Bar -->
        <div class="audio-progress" v-if="playingId === recording.id">
          <div class="progress-bar">
            <div
              class="progress-fill"
              :style="{ width: audioProgress + '%' }"
            ></div>
          </div>
          <span class="progress-time">{{ formatTime(audioCurrentTime) }} / {{ formatTime(recording.duration) }}</span>
        </div>

        <!-- Transcriptions -->
        <div class="transcriptions">
          <div class="transcription-block">
            <div class="transcription-header">
              <span class="transcription-label">
                <i class="ph-duotone ph-text-aa"></i>
                Raw Transcription
              </span>
              <button
                type="button"
                class="btn btn-copy"
                @click="copyToClipboard(recording.rawTranscription, 'raw')"
                title="Copy raw transcription"
              >
                <i class="ph-duotone ph-copy"></i>
              </button>
            </div>
            <p class="transcription-text">{{ recording.rawTranscription || '(empty)' }}</p>
          </div>

          <div
            class="transcription-block polished"
            v-if="recording.transformedTranscription && recording.transformedTranscription !== recording.rawTranscription"
          >
            <div class="transcription-header">
              <span class="transcription-label">
                <i class="ph-duotone ph-sparkle"></i>
                AI Enhanced
              </span>
              <button
                type="button"
                class="btn btn-copy"
                @click="copyToClipboard(recording.transformedTranscription, 'polished')"
                title="Copy enhanced transcription"
              >
                <i class="ph-duotone ph-copy"></i>
              </button>
            </div>
            <p class="transcription-text">{{ recording.transformedTranscription }}</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div class="empty-state" v-else-if="!isLoading">
      <i class="ph-duotone ph-microphone-slash"></i>
      <h3>No Recordings Yet</h3>
      <p>Your recording history will appear here after you make some dictations.</p>
    </div>

    <!-- Loading State -->
    <div class="loading-state" v-if="isLoading">
      <i class="ph-duotone ph-spinner spinning"></i>
      <p>Loading recordings...</p>
    </div>

    <!-- Delete Confirmation Modal -->
    <div class="modal-overlay" v-if="showDeleteConfirm" @click.self="showDeleteConfirm = false">
      <div class="modal-content">
        <div class="modal-header">
          <i class="ph-duotone ph-warning"></i>
          <h3>Delete All Recordings?</h3>
        </div>
        <p class="modal-body">
          This will permanently delete all {{ recordings.length }} recordings and their audio files.
          This action cannot be undone.
        </p>
        <div class="modal-actions">
          <button
            type="button"
            class="btn btn-default"
            @click="showDeleteConfirm = false"
          >
            Cancel
          </button>
          <button
            type="button"
            class="btn btn-negative"
            @click="deleteAllRecordings"
            :disabled="isDeleting"
          >
            <i class="ph-duotone ph-trash"></i>
            Delete All
          </button>
        </div>
      </div>
    </div>

    <!-- Copy Toast -->
    <div class="copy-toast" :class="{ show: showCopyToast }">
      <i class="ph-duotone ph-check-circle"></i>
      {{ copyToastMessage }}
    </div>
  </div>
</template>

<script>
export default {
  name: "HistorySection",

  emits: ["status"],

  data() {
    return {
      recordings: [],
      historySettings: {
        enabled: true,
        maxRecordings: 100,
      },
      stats: null,
      isLoading: false,
      isDeleting: false,
      showDeleteConfirm: false,
      playingId: null,
      audioElement: null,
      audioProgress: 0,
      audioCurrentTime: 0,
      showCopyToast: false,
      copyToastMessage: "",
    };
  },

  async mounted() {
    await this.loadSettings();
    await this.loadRecordings();
    await this.loadStats();
  },

  beforeUnmount() {
    this.stopAudio();
  },

  methods: {
    emitStatus(message, type = "success") {
      this.$emit("status", { message, type });
    },

    async loadSettings() {
      try {
        const result = await window.electronAPI.historyGetSettings();
        if (result.settings) {
          this.historySettings = result.settings;
        }
      } catch (error) {
        console.error("Failed to load history settings:", error);
      }
    },

    async updateSettings() {
      try {
        await window.electronAPI.historyUpdateSettings(this.historySettings);
        this.emitStatus("History settings updated", "success");
        await this.loadStats();
      } catch (error) {
        console.error("Failed to update history settings:", error);
        this.emitStatus("Failed to update settings", "error");
      }
    },

    async loadRecordings() {
      this.isLoading = true;
      try {
        const result = await window.electronAPI.historyGetAll();
        if (result.recordings) {
          this.recordings = result.recordings;
        }
        if (result.error) {
          console.error("Error loading recordings:", result.error);
        }
      } catch (error) {
        console.error("Failed to load recordings:", error);
        this.emitStatus("Failed to load recordings", "error");
      } finally {
        this.isLoading = false;
      }
    },

    async loadStats() {
      try {
        const result = await window.electronAPI.historyGetStats();
        if (result.stats) {
          this.stats = result.stats;
        }
      } catch (error) {
        console.error("Failed to load history stats:", error);
      }
    },

    async deleteRecording(id) {
      try {
        if (this.playingId === id) {
          this.stopAudio();
        }
        const result = await window.electronAPI.historyDelete(id);
        if (result.success) {
          this.recordings = this.recordings.filter((r) => r.id !== id);
          await this.loadStats();
          this.emitStatus("Recording deleted", "success");
        } else {
          this.emitStatus("Failed to delete recording", "error");
        }
      } catch (error) {
        console.error("Failed to delete recording:", error);
        this.emitStatus("Failed to delete recording", "error");
      }
    },

    confirmDeleteAll() {
      this.showDeleteConfirm = true;
    },

    async deleteAllRecordings() {
      this.isDeleting = true;
      try {
        this.stopAudio();
        const result = await window.electronAPI.historyDeleteAll();
        if (result.success) {
          this.recordings = [];
          await this.loadStats();
          this.emitStatus(`Deleted ${result.count} recordings`, "success");
        } else {
          this.emitStatus("Failed to delete recordings", "error");
        }
      } catch (error) {
        console.error("Failed to delete all recordings:", error);
        this.emitStatus("Failed to delete recordings", "error");
      } finally {
        this.isDeleting = false;
        this.showDeleteConfirm = false;
      }
    },

    async togglePlay(recording) {
      if (this.playingId === recording.id) {
        this.stopAudio();
        return;
      }

      this.stopAudio();

      try {
        const result = await window.electronAPI.historyGetAudioPath(recording.id);
        if (!result.path) {
          this.emitStatus("Audio file not found", "error");
          return;
        }

        this.audioElement = new Audio(`file://${result.path}`);
        this.audioElement.addEventListener("timeupdate", this.onTimeUpdate);
        this.audioElement.addEventListener("ended", this.onAudioEnded);
        this.audioElement.addEventListener("error", this.onAudioError);

        await this.audioElement.play();
        this.playingId = recording.id;
      } catch (error) {
        console.error("Failed to play audio:", error);
        this.emitStatus("Failed to play audio", "error");
      }
    },

    stopAudio() {
      if (this.audioElement) {
        this.audioElement.pause();
        this.audioElement.removeEventListener("timeupdate", this.onTimeUpdate);
        this.audioElement.removeEventListener("ended", this.onAudioEnded);
        this.audioElement.removeEventListener("error", this.onAudioError);
        this.audioElement = null;
      }
      this.playingId = null;
      this.audioProgress = 0;
      this.audioCurrentTime = 0;
    },

    onTimeUpdate() {
      if (this.audioElement) {
        this.audioCurrentTime = this.audioElement.currentTime;
        this.audioProgress =
          (this.audioElement.currentTime / this.audioElement.duration) * 100;
      }
    },

    onAudioEnded() {
      this.stopAudio();
    },

    onAudioError(e) {
      console.error("Audio playback error:", e);
      this.emitStatus("Audio playback error", "error");
      this.stopAudio();
    },

    async copyToClipboard(text, type) {
      try {
        await navigator.clipboard.writeText(text);
        this.copyToastMessage =
          type === "raw"
            ? "Raw transcription copied!"
            : "Enhanced transcription copied!";
        this.showCopyToast = true;
        setTimeout(() => {
          this.showCopyToast = false;
        }, 2000);
      } catch (error) {
        console.error("Failed to copy to clipboard:", error);
        this.emitStatus("Failed to copy to clipboard", "error");
      }
    },

    formatDate(timestamp) {
      const date = new Date(timestamp);
      const now = new Date();
      const diff = now.getTime() - date.getTime();
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));

      if (days === 0) {
        return (
          "Today, " +
          date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        );
      } else if (days === 1) {
        return (
          "Yesterday, " +
          date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        );
      } else if (days < 7) {
        return (
          date.toLocaleDateString([], { weekday: "long" }) +
          ", " +
          date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        );
      }
      return (
        date.toLocaleDateString([], {
          month: "short",
          day: "numeric",
          year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
        }) +
        ", " +
        date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      );
    },

    formatDuration(seconds) {
      if (!seconds || seconds < 1) return "< 1s";
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      if (mins === 0) return `${secs}s`;
      return `${mins}m ${secs}s`;
    },

    formatTime(seconds) {
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs.toString().padStart(2, "0")}`;
    },

    formatBytes(bytes) {
      if (!bytes || bytes === 0) return "0 B";
      const units = ["B", "KB", "MB", "GB"];
      let i = 0;
      let v = bytes;
      while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i++;
      }
      return `${v.toFixed(1)} ${units[i]}`;
    },
  },
};
</script>

<style scoped>
.history-section-container {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg, 24px);
}

.section-header {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-md, 16px);
}

.section-header > .ph-duotone {
  font-size: 28px;
  color: var(--color-primary, #007aff);
  flex-shrink: 0;
}

.section-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text-primary, #333);
  margin: 0 0 4px 0;
}

.section-description {
  font-size: 13px;
  color: var(--color-text-secondary, #666);
  margin: 0;
  line-height: 1.4;
}

/* Settings Card */
.settings-card {
  background: var(--color-bg-secondary, #f8f8f8);
  border: 1px solid var(--color-border-primary, #e0e0e0);
  border-radius: var(--radius-lg, 8px);
  padding: var(--spacing-md, 16px);
}

.settings-card-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm, 8px);
  margin-bottom: var(--spacing-md, 16px);
}

.settings-card-header .ph-duotone {
  font-size: 20px;
  color: var(--color-text-secondary, #666);
}

.settings-card-header h4 {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
  color: var(--color-text-primary, #333);
}

.settings-description {
  font-size: 12px;
  color: var(--color-text-tertiary, #999);
  margin: 2px 0 0 0;
}

.settings-card-content {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md, 16px);
}

.setting-row {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs, 4px);
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm, 8px);
  cursor: pointer;
}

.toggle-text {
  font-size: 13px;
  color: var(--color-text-primary, #333);
}

.input-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-primary, #333);
}

.number-input {
  width: 100px;
  padding: 6px 10px;
  border: 1px solid var(--color-border-primary, #e0e0e0);
  border-radius: var(--radius-sm, 4px);
  font-size: 13px;
}

.setting-hint {
  font-size: 11px;
  color: var(--color-text-tertiary, #999);
  margin: 2px 0 0 0;
}

/* Stats Card */
.stats-card {
  display: flex;
  gap: var(--spacing-md, 16px);
  padding: var(--spacing-md, 16px);
  background: linear-gradient(135deg, #f0f4ff 0%, #f8f0ff 100%);
  border-radius: var(--radius-lg, 8px);
  border: 1px solid var(--color-border-primary, #e0e0e0);
}

.stat-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm, 8px);
  flex: 1;
}

.stat-item .ph-duotone {
  font-size: 24px;
  color: var(--color-primary, #007aff);
}

.stat-content {
  display: flex;
  flex-direction: column;
}

.stat-value {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-primary, #333);
}

.stat-label {
  font-size: 11px;
  color: var(--color-text-tertiary, #999);
}

/* Actions Bar */
.actions-bar {
  display: flex;
  gap: var(--spacing-sm, 8px);
}

/* Recordings List */
.recordings-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md, 16px);
}

.recording-card {
  background: var(--color-bg-primary, #fff);
  border: 1px solid var(--color-border-primary, #e0e0e0);
  border-radius: var(--radius-lg, 8px);
  padding: var(--spacing-md, 16px);
  transition: box-shadow 0.2s ease, border-color 0.2s ease;
}

.recording-card:hover {
  box-shadow: var(--shadow-md, 0 2px 4px rgba(0, 0, 0, 0.1));
}

.recording-card.playing {
  border-color: var(--color-primary, #007aff);
  box-shadow: 0 0 0 2px rgba(0, 122, 255, 0.15);
}

.recording-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacing-sm, 8px);
}

.recording-meta {
  display: flex;
  align-items: center;
  gap: var(--spacing-md, 16px);
  flex-wrap: wrap;
}

.recording-date {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-primary, #333);
}

.recording-duration {
  font-size: 12px;
  color: var(--color-text-tertiary, #999);
  background: var(--color-bg-tertiary, #f0f0f0);
  padding: 2px 8px;
  border-radius: var(--radius-sm, 4px);
}

.recording-plugin {
  font-size: 11px;
  color: var(--color-text-tertiary, #999);
  display: flex;
  align-items: center;
  gap: 4px;
}

.recording-actions {
  display: flex;
  gap: var(--spacing-xs, 4px);
}

/* Audio Progress */
.audio-progress {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm, 8px);
  margin-bottom: var(--spacing-sm, 8px);
  padding: var(--spacing-sm, 8px);
  background: var(--color-bg-tertiary, #f0f0f0);
  border-radius: var(--radius-sm, 4px);
}

.progress-bar {
  flex: 1;
  height: 4px;
  background: var(--color-border-primary, #e0e0e0);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--color-primary, #007aff);
  border-radius: 2px;
  transition: width 0.1s linear;
}

.progress-time {
  font-size: 11px;
  color: var(--color-text-tertiary, #999);
  font-variant-numeric: tabular-nums;
  min-width: 70px;
  text-align: right;
}

/* Transcriptions */
.transcriptions {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm, 8px);
}

.transcription-block {
  background: var(--color-bg-secondary, #f8f8f8);
  border-radius: var(--radius-md, 6px);
  padding: var(--spacing-sm, 8px) var(--spacing-md, 16px);
}

.transcription-block.polished {
  background: linear-gradient(135deg, #f8f0ff 0%, #f0f4ff 100%);
  border: 1px solid rgba(138, 43, 226, 0.1);
}

.transcription-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacing-xs, 4px);
}

.transcription-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-tertiary, #999);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
}

.transcription-label .ph-duotone {
  font-size: 14px;
}

.transcription-block.polished .transcription-label {
  color: #8a2be2;
}

.transcription-text {
  font-size: 13px;
  color: var(--color-text-primary, #333);
  line-height: 1.5;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-xs, 4px);
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 500;
  border: 1px solid var(--color-border-primary, #e0e0e0);
  border-radius: var(--radius-md, 6px);
  background: var(--color-bg-primary, #fff);
  color: var(--color-text-primary, #333);
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn:hover:not(:disabled) {
  background: var(--color-bg-secondary, #f8f8f8);
  border-color: var(--color-border-secondary, #d0d0d0);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-negative {
  color: var(--color-error, #ff3b30);
  border-color: rgba(255, 59, 48, 0.3);
}

.btn-negative:hover:not(:disabled) {
  background: rgba(255, 59, 48, 0.1);
  border-color: var(--color-error, #ff3b30);
}

.btn-icon {
  padding: 6px;
  min-width: 32px;
  min-height: 32px;
}

.btn-icon .ph-duotone {
  font-size: 16px;
}

.btn-copy {
  padding: 4px 8px;
  font-size: 12px;
  background: transparent;
  border: none;
  color: var(--color-text-tertiary, #999);
}

.btn-copy:hover {
  color: var(--color-primary, #007aff);
  background: transparent;
}

/* Empty State */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-xl, 32px);
  text-align: center;
  color: var(--color-text-tertiary, #999);
}

.empty-state .ph-duotone {
  font-size: 48px;
  margin-bottom: var(--spacing-md, 16px);
  opacity: 0.5;
}

.empty-state h3 {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-secondary, #666);
  margin: 0 0 var(--spacing-sm, 8px) 0;
}

.empty-state p {
  font-size: 13px;
  margin: 0;
}

/* Loading State */
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-xl, 32px);
  color: var(--color-text-tertiary, #999);
}

.loading-state .ph-duotone {
  font-size: 32px;
  margin-bottom: var(--spacing-sm, 8px);
}

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: var(--color-bg-primary, #fff);
  border-radius: var(--radius-lg, 8px);
  padding: var(--spacing-lg, 24px);
  max-width: 400px;
  width: 90%;
  box-shadow: var(--shadow-lg, 0 4px 8px rgba(0, 0, 0, 0.15));
}

.modal-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm, 8px);
  margin-bottom: var(--spacing-md, 16px);
}

.modal-header .ph-duotone {
  font-size: 24px;
  color: var(--color-warning, #ff9500);
}

.modal-header h3 {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
}

.modal-body {
  font-size: 13px;
  color: var(--color-text-secondary, #666);
  line-height: 1.5;
  margin: 0 0 var(--spacing-lg, 24px) 0;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-sm, 8px);
}

/* Copy Toast */
.copy-toast {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%) translateY(100px);
  background: var(--color-text-primary, #333);
  color: var(--color-text-inverse, #fff);
  padding: 10px 20px;
  border-radius: var(--radius-lg, 8px);
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: var(--spacing-sm, 8px);
  opacity: 0;
  transition: all 0.3s ease;
  z-index: 1001;
}

.copy-toast.show {
  transform: translateX(-50%) translateY(0);
  opacity: 1;
}

.copy-toast .ph-duotone {
  color: var(--color-success, #34c759);
}

/* Animations */
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

/* Responsive */
@media (max-width: 600px) {
  .stats-card {
    flex-direction: column;
  }

  .recording-meta {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--spacing-xs, 4px);
  }
}
</style>
