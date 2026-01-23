<template>
  <Transition name="modal-fade">
    <div v-if="visible" class="import-screen">
      <div class="import-card">
        <!-- Status Icon -->
        <div class="status-icon" :class="stage">
          <i v-if="isActiveStage" class="ph ph-circle-notch spinning"></i>
          <i v-else :class="stageIconClass"></i>
        </div>

        <!-- Title -->
        <h2 class="title">{{ stageTitle }}</h2>

        <!-- Message -->
        <p class="message">{{ message || "Preparing..." }}</p>

        <!-- Progress Section -->
        <div
          class="progress-section"
          v-if="stage !== 'complete' && stage !== 'error'"
        >
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: percent + '%' }"></div>
          </div>
          <div class="progress-info">
            <span v-if="totalSteps > 0"
              >Step {{ currentStep }}/{{ totalSteps }}</span
            >
            <span class="percent">{{ Math.round(percent) }}%</span>
          </div>
        </div>

        <!-- Model Download -->
        <div
          v-if="modelProgress && stage === 'downloading'"
          class="model-section"
        >
          <div class="model-row">
            <span class="model-label">{{ modelProgress.modelName }}</span>
            <span class="model-percent"
              >{{ Math.round(modelProgress.downloadPercent || 0) }}%</span
            >
          </div>
          <div class="progress-bar small">
            <div
              class="progress-fill"
              :style="{ width: (modelProgress.downloadPercent || 0) + '%' }"
            ></div>
          </div>
          <div v-if="downloadSizeText" class="download-size">
            {{ downloadSizeText }}
          </div>
        </div>

        <!-- Success State -->
        <div v-if="stage === 'complete'" class="success-section">
          <p class="success-text">Settings imported successfully</p>
        </div>

        <!-- Actions -->
        <div class="actions">
          <button
            v-if="stage === 'complete' || stage === 'error'"
            class="btn primary"
            @click="handleDone"
          >
            {{ stage === "error" ? "Close" : "Done" }}
          </button>
          <button v-else class="btn secondary" @click="handleCancel">
            Cancel
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script>
import { computed } from "vue";

export default {
  name: "ImportProgressModal",

  props: {
    visible: {
      type: Boolean,
      default: false,
    },
    stage: {
      type: String,
      default: "",
      validator: (value) =>
        [
          "",
          "validating",
          "applying",
          "downloading",
          "activating",
          "complete",
          "error",
        ].includes(value),
    },
    message: {
      type: String,
      default: "",
    },
    percent: {
      type: Number,
      default: 0,
    },
    currentStep: {
      type: Number,
      default: 0,
    },
    totalSteps: {
      type: Number,
      default: 0,
    },
    modelProgress: {
      type: Object,
      default: null,
    },
  },

  emits: ["cancel", "done"],

  setup(props, { emit }) {
    const isActiveStage = computed(() => {
      return ["validating", "applying", "downloading", "activating"].includes(
        props.stage,
      );
    });

    const stageTitle = computed(() => {
      const titles = {
        validating: "Validating",
        applying: "Applying Settings",
        downloading: "Downloading Model",
        activating: "Activating",
        complete: "Import Complete",
        error: "Import Failed",
      };
      return titles[props.stage] || "Importing";
    });

    const stageIconClass = computed(() => {
      const icons = {
        complete: "ph ph-check",
        error: "ph ph-x",
      };
      return icons[props.stage] || "ph ph-circle-notch";
    });

    const formatBytes = (bytes) => {
      if (!bytes || bytes === 0) return "0 B";
      const k = 1024;
      const sizes = ["B", "KB", "MB", "GB"];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      const value = bytes / Math.pow(k, i);
      return `${value.toFixed(1)} ${sizes[i]}`;
    };

    const downloadSizeText = computed(() => {
      if (!props.modelProgress) return null;
      const { downloadedBytes, totalBytes } = props.modelProgress;
      if (!totalBytes || totalBytes === 0) return null;
      return `${formatBytes(downloadedBytes || 0)} / ${formatBytes(totalBytes)}`;
    });

    function handleCancel() {
      emit("cancel");
    }

    function handleDone() {
      emit("done");
    }

    return {
      isActiveStage,
      stageTitle,
      stageIconClass,
      downloadSizeText,
      handleCancel,
      handleDone,
    };
  },
};
</script>

<style scoped>
.import-screen {
  position: fixed;
  inset: 0;
  background: var(--bg, #f5f5f7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.import-card {
  width: 280px;
  padding: 24px;
  text-align: center;
}

.status-icon {
  width: 48px;
  height: 48px;
  margin: 0 auto 16px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  background: rgba(0, 0, 0, 0.05);
  color: #666;
}

.status-icon .spinning {
  animation: spin 1s linear infinite;
}

.status-icon.complete {
  background: rgba(52, 199, 89, 0.12);
  color: #34c759;
}

.status-icon.error {
  background: rgba(255, 59, 48, 0.12);
  color: #ff3b30;
}

.title {
  font-size: 15px;
  font-weight: 600;
  color: var(--fg, #1d1d1f);
  margin: 0 0 6px;
}

.message {
  font-size: 12px;
  color: var(--muted, #86868b);
  margin: 0 0 20px;
  line-height: 1.4;
  min-height: 17px;
}

.progress-section {
  margin-bottom: 16px;
}

.progress-bar {
  height: 4px;
  background: rgba(0, 0, 0, 0.08);
  border-radius: 2px;
  overflow: hidden;
}

.progress-bar.small {
  height: 3px;
  margin-top: 6px;
}

.progress-fill {
  height: 100%;
  background: #666;
  border-radius: 2px;
  transition: width 0.2s ease;
}

.progress-info {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  font-size: 11px;
  color: var(--muted, #86868b);
}

.percent {
  font-family: "SF Mono", Monaco, monospace;
}

.model-section {
  background: rgba(0, 0, 0, 0.03);
  border-radius: 6px;
  padding: 10px 12px;
  margin-bottom: 16px;
}

.model-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.model-label {
  font-size: 11px;
  color: var(--fg, #1d1d1f);
  font-weight: 500;
}

.model-percent {
  font-size: 11px;
  font-family: "SF Mono", Monaco, monospace;
  color: var(--muted, #86868b);
}

.download-size {
  margin-top: 6px;
  font-size: 10px;
  font-family: "SF Mono", Monaco, monospace;
  color: var(--muted, #86868b);
  text-align: center;
}

.success-section {
  margin-bottom: 16px;
}

.success-text {
  font-size: 12px;
  color: #34c759;
  margin: 0;
}

.actions {
  margin-top: 4px;
}

.btn {
  padding: 8px 20px;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.15s;
}

.btn:hover {
  opacity: 0.85;
}

.btn.primary {
  background: #1d1d1f;
  color: #fff;
}

.btn.secondary {
  background: rgba(0, 0, 0, 0.06);
  color: var(--fg, #1d1d1f);
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* Transitions */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.15s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

/* Dark mode */
@media (prefers-color-scheme: dark) {
  .import-screen {
    background: #1c1c1e;
  }

  .status-icon {
    background: rgba(255, 255, 255, 0.08);
    color: #98989d;
  }

  .status-icon.complete {
    background: rgba(52, 199, 89, 0.15);
  }

  .status-icon.error {
    background: rgba(255, 59, 48, 0.15);
  }

  .title {
    color: #f5f5f7;
  }

  .message {
    color: #98989d;
  }

  .progress-bar {
    background: rgba(255, 255, 255, 0.1);
  }

  .progress-fill {
    background: #98989d;
  }

  .model-section {
    background: rgba(255, 255, 255, 0.05);
  }

  .model-label {
    color: #f5f5f7;
  }

  .btn.primary {
    background: #f5f5f7;
    color: #1c1c1e;
  }

  .btn.secondary {
    background: rgba(255, 255, 255, 0.1);
    color: #f5f5f7;
  }
}
</style>
