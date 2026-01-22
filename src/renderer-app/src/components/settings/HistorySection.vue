<template>
  <div class="history-section-container">
    <!-- Section Header -->
    <div class="section-header">
      <i class="ph-duotone ph-clock-counter-clockwise"></i>
      <div>
        <h2 class="section-title">Recording History</h2>
        <p class="section-description">
          View and manage your past recordings and transcriptions.
        </p>
      </div>
    </div>

    <!-- Settings Card -->
    <div class="settings-card">
      <div class="settings-row">
        <label class="toggle-label">
          <input
            type="checkbox"
            v-model="localSettings.enabled"
            @change="markSettingsDirty"
          />
          <span class="toggle-text">Enable History</span>
        </label>
        <div class="max-recordings-input">
          <label>Max:</label>
          <input
            type="number"
            v-model.number="localSettings.maxRecordings"
            min="1"
            max="1000"
            @input="markSettingsDirty"
            class="number-input"
          />
        </div>
        <button
          type="button"
          class="btn-save"
          :class="{ dirty: settingsDirty }"
          @click="saveSettings"
          :disabled="!settingsDirty || isSavingSettings"
        >
          <i
            class="ph-duotone"
            :class="isSavingSettings ? 'ph-spinner spinning' : 'ph-floppy-disk'"
          ></i>
          Save
        </button>
      </div>
    </div>

    <!-- Stats Row -->
    <div class="stats-row" v-if="stats">
      <span class="stat-item">
        <i class="ph ph-microphone"></i>
        {{ stats.totalRecordings }}
      </span>
      <span class="stat-item">
        <i class="ph ph-timer"></i>
        {{ formatDuration(stats.totalDuration) }}
      </span>
      <span class="stat-item">
        <i class="ph ph-hard-drives"></i>
        {{ formatBytes(stats.storageUsed) }}
      </span>
      <div class="stat-actions">
        <button
          type="button"
          class="btn-sm"
          @click="loadRecordings"
          :disabled="isLoading"
          title="Refresh"
        >
          <i class="ph ph-arrow-clockwise" :class="{ spinning: isLoading }"></i>
        </button>
        <button
          type="button"
          class="btn-sm btn-danger"
          @click="confirmDeleteAll"
          :disabled="recordings.length === 0 || isDeleting"
          title="Delete All"
        >
          <i class="ph ph-trash"></i>
        </button>
      </div>
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
            <span class="recording-date">{{
              formatDate(recording.timestamp)
            }}</span>
            <span class="recording-duration">{{
              formatDuration(recording.duration)
            }}</span>
            <span class="recording-plugin" v-if="recording.pluginUsed">{{
              recording.pluginUsed
            }}</span>
          </div>
          <button
            type="button"
            class="btn-icon btn-delete"
            @click="deleteRecording(recording.id)"
            title="Delete"
          >
            <i class="ph ph-x"></i>
          </button>
        </div>

        <!-- Audio Player -->
        <div
          class="audio-player"
          v-if="playingId === recording.id || waveformData[recording.id]"
        >
          <div class="player-controls">
            <button
              type="button"
              class="btn-icon btn-play"
              @click="togglePlayPause(recording)"
              :title="
                playingId === recording.id && !isPaused ? 'Pause' : 'Play'
              "
            >
              <i
                class="ph"
                :class="
                  playingId === recording.id && !isPaused
                    ? 'ph-pause'
                    : 'ph-play'
                "
              ></i>
            </button>
            <button
              v-if="playingId === recording.id"
              type="button"
              class="btn-icon btn-stop"
              @click="stopAudio"
              title="Stop"
            >
              <i class="ph ph-stop"></i>
            </button>
          </div>
          <div
            class="waveform-container"
            @click="seekAudio($event, recording)"
            @mousedown="startSeeking"
            @mousemove="handleSeekDrag($event, recording)"
            @mouseup="stopSeeking"
            @mouseleave="stopSeeking"
          >
            <canvas
              :ref="(el) => setCanvasRef(el, recording.id)"
              class="waveform-canvas"
            ></canvas>
            <div
              class="waveform-progress"
              :style="{
                width: (playingId === recording.id ? audioProgress : 0) + '%',
              }"
            ></div>
            <div
              class="waveform-cursor"
              v-if="playingId === recording.id"
              :style="{ left: audioProgress + '%' }"
            ></div>
          </div>
          <span class="player-time">{{
            formatTime(playingId === recording.id ? audioCurrentTime : 0)
          }}</span>
        </div>

        <!-- Play button for recordings without waveform loaded -->
        <button
          v-else
          type="button"
          class="btn-load-audio"
          @click="loadAndPlay(recording)"
        >
          <i class="ph ph-play"></i>
          <span>Play Audio</span>
        </button>

        <!-- Transcriptions - Click to Copy -->
        <div class="transcriptions">
          <div
            class="transcription-block"
            @click="copyToClipboard(recording.rawTranscription, 'Raw')"
            title="Click to copy"
          >
            <div class="transcription-header">
              <span class="transcription-label">
                <i class="ph ph-text-aa"></i>
                Raw
              </span>
            </div>
            <p class="transcription-text">
              {{ recording.rawTranscription || "(empty)" }}
            </p>
          </div>

          <div
            class="transcription-block polished"
            v-if="
              recording.transformedTranscription &&
              recording.transformedTranscription !== recording.rawTranscription
            "
            @click="
              copyToClipboard(recording.transformedTranscription, 'Enhanced')
            "
            title="Click to copy"
          >
            <div class="transcription-header">
              <span class="transcription-label polished-label">
                <i class="ph ph-sparkle"></i>
                Enhanced
              </span>
            </div>
            <p class="transcription-text">
              {{ recording.transformedTranscription }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div class="empty-state" v-else-if="!isLoading">
      <i class="ph ph-microphone-slash"></i>
      <p>No recordings yet</p>
    </div>

    <!-- Loading State -->
    <div class="loading-state" v-if="isLoading">
      <i class="ph ph-spinner spinning"></i>
    </div>

    <!-- Delete Confirmation Modal -->
    <div
      class="modal-overlay"
      v-if="showDeleteConfirm"
      @click.self="showDeleteConfirm = false"
    >
      <div class="modal-content">
        <div class="modal-header">
          <i class="ph ph-warning"></i>
          <h3>Delete All?</h3>
        </div>
        <p class="modal-body">
          Delete all {{ recordings.length }} recordings? This cannot be undone.
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
            class="btn btn-danger"
            @click="deleteAllRecordings"
            :disabled="isDeleting"
          >
            Delete All
          </button>
        </div>
      </div>
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
      localSettings: {
        enabled: true,
        maxRecordings: 100,
      },
      settingsDirty: false,
      isSavingSettings: false,
      stats: null,
      isLoading: false,
      isDeleting: false,
      showDeleteConfirm: false,
      playingId: null,
      isPaused: false,
      audioElement: null,
      audioProgress: 0,
      audioCurrentTime: 0,
      waveformData: {},
      canvasRefs: {},
      isSeeking: false,
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
    setCanvasRef(el, id) {
      if (el) {
        this.canvasRefs[id] = el;
        if (this.waveformData[id]) {
          this.$nextTick(() => this.drawWaveform(id));
        }
      }
    },

    emitStatus(message, type = "success") {
      this.$emit("status", { message, type });
    },

    async loadSettings() {
      try {
        const result = await window.electronAPI.historyGetSettings();
        if (result.settings) {
          this.localSettings = {
            enabled: result.settings.enabled,
            maxRecordings: result.settings.maxRecordings,
          };
          this.settingsDirty = false;
        }
      } catch (error) {
        console.error("Failed to load history settings:", error);
      }
    },

    markSettingsDirty() {
      this.settingsDirty = true;
    },

    async saveSettings() {
      if (!this.settingsDirty) return;

      this.isSavingSettings = true;
      try {
        const result = await window.electronAPI.historyUpdateSettings({
          enabled: this.localSettings.enabled,
          maxRecordings: this.localSettings.maxRecordings,
        });
        if (result.success) {
          this.settingsDirty = false;
          this.emitStatus("History settings saved", "success");
          await this.loadStats();
        } else {
          this.emitStatus("Failed to save settings", "error");
        }
      } catch (error) {
        console.error("Failed to update history settings:", error);
        this.emitStatus("Failed to save settings", "error");
      } finally {
        this.isSavingSettings = false;
      }
    },

    async loadRecordings() {
      this.isLoading = true;
      try {
        const result = await window.electronAPI.historyGetAll();
        if (result.recordings) {
          this.recordings = result.recordings;
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
          delete this.waveformData[id];
          delete this.canvasRefs[id];
          await this.loadStats();
          this.emitStatus("Recording deleted", "success");
        }
      } catch (error) {
        console.error("Failed to delete recording:", error);
        this.emitStatus("Failed to delete", "error");
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
          this.waveformData = {};
          this.canvasRefs = {};
          await this.loadStats();
          this.emitStatus(`Deleted ${result.count} recordings`, "success");
        }
      } catch (error) {
        console.error("Failed to delete all recordings:", error);
        this.emitStatus("Failed to delete", "error");
      } finally {
        this.isDeleting = false;
        this.showDeleteConfirm = false;
      }
    },

    async loadAndPlay(recording) {
      await this.loadAudioAndWaveform(recording);
      this.playAudio(recording);
    },

    async loadAudioAndWaveform(recording) {
      try {
        const result = await window.electronAPI.historyGetAudioPath(
          recording.id,
        );
        if (!result.path) {
          this.emitStatus("Audio file not found", "error");
          return;
        }

        // Fetch and decode audio for waveform
        const response = await fetch(`file://${result.path}`);
        const arrayBuffer = await response.arrayBuffer();
        const audioContext = new (
          window.AudioContext || window.webkitAudioContext
        )();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        // Generate waveform data
        const rawData = audioBuffer.getChannelData(0);
        const samples = 100;
        const blockSize = Math.floor(rawData.length / samples);
        const waveform = [];

        for (let i = 0; i < samples; i++) {
          let sum = 0;
          for (let j = 0; j < blockSize; j++) {
            sum += Math.abs(rawData[i * blockSize + j]);
          }
          waveform.push(sum / blockSize);
        }

        // Normalize
        const max = Math.max(...waveform);
        this.waveformData[recording.id] = waveform.map((v) => v / max);

        await this.$nextTick();
        this.drawWaveform(recording.id);

        audioContext.close();
      } catch (error) {
        console.error("Failed to load audio:", error);
      }
    },

    drawWaveform(recordingId) {
      const canvas = this.canvasRefs[recordingId];
      const data = this.waveformData[recordingId];

      if (!canvas || !data) return;

      const ctx = canvas.getContext("2d");
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();

      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);

      const width = rect.width;
      const height = rect.height;
      const barWidth = width / data.length;
      const halfHeight = height / 2;

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "rgba(0, 122, 255, 0.4)";

      data.forEach((value, index) => {
        const barHeight = value * halfHeight * 0.9;
        const x = index * barWidth;
        ctx.fillRect(x, halfHeight - barHeight, barWidth - 1, barHeight * 2);
      });
    },

    async playAudio(recording) {
      try {
        const result = await window.electronAPI.historyGetAudioPath(
          recording.id,
        );
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
        this.isPaused = false;
      } catch (error) {
        console.error("Failed to play audio:", error);
        this.emitStatus("Failed to play", "error");
      }
    },

    togglePlayPause(recording) {
      if (this.playingId !== recording.id) {
        this.stopAudio();
        this.loadAndPlay(recording);
        return;
      }

      if (this.isPaused) {
        this.audioElement?.play();
        this.isPaused = false;
      } else {
        this.audioElement?.pause();
        this.isPaused = true;
      }
    },

    stopAudio() {
      if (this.audioElement) {
        this.audioElement.pause();
        this.audioElement.currentTime = 0;
        this.audioElement.removeEventListener("timeupdate", this.onTimeUpdate);
        this.audioElement.removeEventListener("ended", this.onAudioEnded);
        this.audioElement.removeEventListener("error", this.onAudioError);
        this.audioElement = null;
      }
      this.playingId = null;
      this.isPaused = false;
      this.audioProgress = 0;
      this.audioCurrentTime = 0;
    },

    onTimeUpdate() {
      if (this.audioElement && !this.isSeeking) {
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
      this.emitStatus("Playback error", "error");
      this.stopAudio();
    },

    startSeeking() {
      this.isSeeking = true;
    },

    stopSeeking() {
      this.isSeeking = false;
    },

    handleSeekDrag(event, recording) {
      if (this.isSeeking && this.playingId === recording.id) {
        this.seekAudio(event, recording);
      }
    },

    seekAudio(event, recording) {
      if (this.playingId !== recording.id || !this.audioElement) return;

      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const percent = Math.max(0, Math.min(1, x / rect.width));

      this.audioElement.currentTime = percent * this.audioElement.duration;
      this.audioProgress = percent * 100;
      this.audioCurrentTime = this.audioElement.currentTime;
    },

    async copyToClipboard(text, label) {
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        this.emitStatus(`${label} copied to clipboard`, "success");
      } catch (error) {
        console.error("Failed to copy:", error);
        this.emitStatus("Failed to copy", "error");
      }
    },

    formatDate(timestamp) {
      const date = new Date(timestamp);
      const now = new Date();
      const diff = now.getTime() - date.getTime();
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));

      const time = date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });

      if (days === 0) return `Today ${time}`;
      if (days === 1) return `Yesterday ${time}`;
      if (days < 7)
        return `${date.toLocaleDateString([], { weekday: "short" })} ${time}`;

      return (
        date.toLocaleDateString([], { month: "short", day: "numeric" }) +
        ` ${time}`
      );
    },

    formatDuration(seconds) {
      if (!seconds || seconds < 1) return "<1s";
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      if (mins === 0) return `${secs}s`;
      return `${mins}m${secs}s`;
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
  gap: 10px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.section-header > .ph-duotone {
  font-size: 24px;
  color: var(--color-primary, #007aff);
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
}

.section-description {
  font-size: 12px;
  color: var(--color-text-secondary, #666);
  margin: 2px 0 0 0;
}

/* Settings Card */
.settings-card {
  background: var(--color-bg-secondary, #f8f8f8);
  border: 1px solid var(--color-border-primary, #e0e0e0);
  border-radius: 6px;
  padding: 8px 12px;
}

.settings-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 13px;
}

.max-recordings-input {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--color-text-secondary, #666);
}

.number-input {
  width: 60px;
  padding: 4px 6px;
  border: 1px solid var(--color-border-primary, #e0e0e0);
  border-radius: 4px;
  font-size: 12px;
}

.btn-save {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid var(--color-border-primary, #e0e0e0);
  border-radius: 4px;
  background: var(--color-bg-primary, #fff);
  color: var(--color-text-secondary, #888);
  cursor: pointer;
  transition: all 0.15s;
}

.btn-save:hover:not(:disabled) {
  background: var(--color-bg-tertiary, #f0f0f0);
}

.btn-save:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-save.dirty {
  color: var(--color-primary, #007aff);
  border-color: var(--color-primary, #007aff);
}

.btn-save.dirty:hover:not(:disabled) {
  background: rgba(0, 122, 255, 0.1);
}

/* Stats Row */
.stats-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 8px;
  font-size: 11px;
  color: var(--color-text-tertiary, #999);
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 3px;
}

.stat-item .ph {
  font-size: 12px;
}

.stat-actions {
  margin-left: auto;
  display: flex;
  gap: 4px;
}

.btn-sm {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 1px solid var(--color-border-primary, #e0e0e0);
  border-radius: 4px;
  background: var(--color-bg-primary, #fff);
  cursor: pointer;
  transition: all 0.15s;
  font-size: 12px;
}

.btn-sm:hover:not(:disabled) {
  background: var(--color-bg-secondary, #f8f8f8);
}

.btn-sm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-sm.btn-danger {
  color: var(--color-text-inverse, #fff);
}

.btn-sm.btn-danger:hover {
  color: var(--color-error, #ff3b30);
}

.btn-sm.btn-danger:hover:not(:disabled) {
  background: rgba(255, 59, 48, 0.1);
}

/* Recordings List */
.recordings-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.recording-card {
  background: var(--color-bg-primary, #fff);
  border: 1px solid var(--color-border-primary, #e0e0e0);
  border-radius: 6px;
  padding: 8px 10px;
  transition: border-color 0.2s;
}

.recording-card:hover {
  border-color: var(--color-border-secondary, #ccc);
}

.recording-card.playing {
  border-color: var(--color-primary, #007aff);
}

.recording-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.recording-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}

.recording-date {
  font-weight: 500;
  color: var(--color-text-primary, #333);
}

.recording-duration {
  color: var(--color-text-tertiary, #999);
  background: var(--color-bg-tertiary, #f0f0f0);
  padding: 1px 5px;
  border-radius: 3px;
}

.recording-plugin {
  color: var(--color-text-tertiary, #999);
  font-size: 10px;
}

.btn-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  transition: all 0.15s;
  color: var(--color-text-secondary, #666);
  font-size: 12px;
}

.btn-icon:hover {
  background: var(--color-bg-tertiary, #f0f0f0);
}

.btn-delete:hover {
  color: var(--color-error, #ff3b30);
  background: rgba(255, 59, 48, 0.1);
}

/* Audio Player */
.audio-player {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  background: var(--color-bg-tertiary, #f0f0f0);
  border-radius: 4px;
  margin-bottom: 6px;
}

.player-controls {
  display: flex;
  gap: 2px;
}

.btn-play {
  color: var(--color-primary, #007aff);
}

.btn-play:hover {
  background: rgba(0, 122, 255, 0.1);
}

.btn-stop {
  color: var(--color-error, #ff3b30);
}

.btn-stop:hover {
  background: rgba(255, 59, 48, 0.1);
}

.waveform-container {
  flex: 1;
  height: 24px;
  position: relative;
  cursor: pointer;
  border-radius: 3px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.03);
}

.waveform-canvas {
  width: 100%;
  height: 100%;
  display: block;
}

.waveform-progress {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  background: rgba(0, 122, 255, 0.2);
  pointer-events: none;
}

.waveform-cursor {
  position: absolute;
  top: 0;
  width: 2px;
  height: 100%;
  background: var(--color-primary, #007aff);
  pointer-events: none;
}

.player-time {
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-tertiary, #999);
  min-width: 32px;
  text-align: right;
}

.btn-load-audio {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 5px;
  margin-bottom: 6px;
  border: 1px dashed var(--color-border-primary, #e0e0e0);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  font-size: 11px;
  color: var(--color-text-secondary, #666);
  transition: all 0.15s;
}

.btn-load-audio:hover {
  border-color: var(--color-primary, #007aff);
  color: var(--color-primary, #007aff);
  background: rgba(0, 122, 255, 0.05);
}

.btn-load-audio .ph {
  font-size: 14px;
}

/* Transcriptions - Click to Copy */
.transcriptions {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.transcription-block {
  background: var(--color-bg-secondary, #f8f8f8);
  border-radius: 4px;
  padding: 5px 8px;
  cursor: pointer;
  transition: background 0.15s;
}

.transcription-block:hover {
  background: var(--color-bg-tertiary, #f0f0f0);
}

.transcription-block:active {
  background: #e8e8e8;
}

.transcription-block.polished {
  border-left: 2px solid #8a2be2;
}

.transcription-header {
  margin-bottom: 2px;
}

.transcription-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--color-text-tertiary, #999);
  text-transform: uppercase;
  letter-spacing: 0.3px;
  display: flex;
  align-items: center;
  gap: 3px;
}

.transcription-label .ph {
  font-size: 11px;
}

.polished-label {
  color: #8a2be2;
}

.transcription-text {
  font-size: 12px;
  color: var(--color-text-primary, #333);
  line-height: 1.4;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

/* Empty & Loading States */
.empty-state,
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
  color: var(--color-text-tertiary, #999);
}

.empty-state .ph,
.loading-state .ph {
  font-size: 28px;
  margin-bottom: 6px;
  opacity: 0.5;
}

.empty-state p,
.loading-state p {
  font-size: 12px;
  margin: 0;
}

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: var(--color-bg-primary, #fff);
  border-radius: 8px;
  padding: 16px;
  max-width: 300px;
  width: 90%;
}

.modal-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.modal-header .ph {
  font-size: 20px;
  color: var(--color-warning, #ff9500);
}

.modal-header h3 {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
}

.modal-body {
  font-size: 12px;
  color: var(--color-text-secondary, #666);
  line-height: 1.4;
  margin: 0 0 14px 0;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.btn {
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-default {
  background: var(--color-bg-secondary, #f8f8f8);
  border: 1px solid var(--color-border-primary, #e0e0e0);
  color: var(--color-text-primary, #333);
}

.btn-default:hover {
  background: var(--color-bg-tertiary, #f0f0f0);
}

.btn-danger {
  background: var(--color-error, #ff3b30);
  border: 1px solid var(--color-error, #ff3b30);
  color: white;
}

.btn-danger:hover:not(:disabled) {
  background: #e0352b;
}

.btn-danger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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

  .settings-card {
    background: rgba(255, 255, 255, 0.02);
    border-color: rgba(255, 255, 255, 0.12);
  }

  .toggle-label {
    color: #ececec;
  }

  .number-input {
    background: rgba(255, 255, 255, 0.06);
    color: #ececec;
    border-color: rgba(255, 255, 255, 0.12);
  }

  .number-input:focus {
    border-color: #007aff;
    box-shadow: 0 0 0 2px rgba(0, 122, 255, 0.25);
  }

  .btn-save {
    background: rgba(255, 255, 255, 0.06);
    color: #ececec;
    border-color: rgba(255, 255, 255, 0.12);
  }

  .btn-save:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.12);
  }

  .btn-save.dirty {
    background: #007aff;
    color: #ffffff;
    border-color: #007aff;
  }

  .stats-row {
    background: rgba(255, 255, 255, 0.02);
    border-color: rgba(255, 255, 255, 0.12);
  }

  .stat-item {
    color: #a2a2a7;
  }

  .btn-sm {
    background: rgba(255, 255, 255, 0.06);
    color: #ececec;
    border-color: rgba(255, 255, 255, 0.12);
  }

  .btn-sm:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.12);
  }

  .btn-sm.btn-danger {
    background: rgba(255, 59, 48, 0.1);
    color: #ff3b30;
    border-color: rgba(255, 59, 48, 0.3);
  }

  .btn-sm.btn-danger:hover:not(:disabled) {
    background: #ff3b30;
    color: #ffffff;
  }

  .recording-card {
    background: rgba(255, 255, 255, 0.02);
    border-color: rgba(255, 255, 255, 0.12);
  }

  .recording-card:hover {
    background: rgba(255, 255, 255, 0.04);
    border-color: rgba(255, 255, 255, 0.18);
  }

  .recording-card.playing {
    border-color: #007aff;
    background: rgba(0, 122, 255, 0.06);
  }

  .recording-date {
    color: #ececec;
  }

  .recording-duration,
  .recording-plugin {
    color: #a2a2a7;
  }

  .btn-icon {
    color: #a2a2a7;
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(255, 255, 255, 0.12);
  }

  .btn-icon:hover {
    background: rgba(255, 255, 255, 0.12);
    color: #ececec;
  }

  .btn-delete:hover {
    background: rgba(255, 59, 48, 0.15);
    color: #ff3b30;
    border-color: #ff3b30;
  }

  .audio-player {
    background: rgba(255, 255, 255, 0.02);
    border-color: rgba(255, 255, 255, 0.12);
  }

  .waveform-container {
    background: rgba(255, 255, 255, 0.04);
  }

  .player-time {
    color: #a2a2a7;
  }

  .btn-load-audio {
    background: rgba(255, 255, 255, 0.04);
    border-color: rgba(255, 255, 255, 0.12);
    color: #a2a2a7;
  }

  .btn-load-audio:hover {
    background: rgba(0, 122, 255, 0.08);
    border-color: #007aff;
    color: #007aff;
  }

  .transcription-block {
    background: rgba(255, 255, 255, 0.02);
    border-color: rgba(255, 255, 255, 0.12);
  }

  .transcription-block:hover {
    background: rgba(255, 255, 255, 0.04);
    border-color: rgba(255, 255, 255, 0.18);
  }

  .transcription-block.polished {
    border-color: rgba(52, 199, 89, 0.3);
  }

  .transcription-label {
    color: #a2a2a7;
  }

  .polished-label {
    color: #34c759;
  }

  .transcription-text {
    color: #ececec;
  }

  .empty-state,
  .loading-state {
    color: #a2a2a7;
  }

  .modal-overlay {
    background: rgba(0, 0, 0, 0.5);
  }

  .modal-content {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.12);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
  }

  .modal-header h3 {
    color: #ececec;
  }

  .modal-body {
    color: #a2a2a7;
  }

  .btn-default {
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(255, 255, 255, 0.12);
    color: #ececec;
  }

  .btn-default:hover {
    background: rgba(255, 255, 255, 0.12);
  }
}
</style>
