import { ref, computed, onMounted, onUnmounted, nextTick, watch } from "vue";
import createAudioVisualizer from "./audio-visualizer.js";

export default {
  setup() {
    // Reactive state
    const isRecording = ref(false);
    const currentStatus = ref("idle");
    const transcriptionSegments = ref([]);
    const finalText = ref("");
    const currentAudioLevel = ref(0);
    const isRunOnAllPlugin = ref(false);
    const selectedText = ref("");
    const isSpeaking = ref(false);
    const isVisible = ref(false);
    const dictationRoot = ref(null);

    const displaySegments = computed(() => {
      if (finalText.value) {
        return [
          { type: "transcribed", text: finalText.value, completed: true },
        ];
      }

      const segments = transcriptionSegments.value;
      const completedSegments = segments.filter(
        (segment) => segment.type === "transcribed" && segment.completed,
      );

      const lastInProgressSegment = segments
        .filter(
          (segment) =>
            segment.type === "inprogress" ||
            (!segment.completed && segment.type === "transcribed"),
        )
        .pop();

      const result = [...completedSegments];
      if (lastInProgressSegment) {
        result.push(lastInProgressSegment);
      }

      return result;
    });

    // Show visualizer when:
    // 1. User is actively speaking (takes precedence over everything)
    // 2. No segments exist and we're in an active state (recording/processing/transcribing)
    const showVisualizer = computed(() => {
      // Speaking takes precedence - always show visualizer when user is speaking
      if (isSpeaking.value) {
        return true;
      }

      // If there are segments, show them (not the visualizer) unless speaking
      if (displaySegments.value.length > 0) {
        return false;
      }

      // No segments - show visualizer during active states
      return (
        currentStatus.value === "recording" ||
        currentStatus.value === "processing" ||
        currentStatus.value === "transcribing" ||
        currentStatus.value === "transforming" ||
        currentStatus.value === "injecting"
      );
    });

    // Icon should show loading spinner when transcribing
    const isTranscribing = computed(() => {
      return (
        currentStatus.value === "transcribing" ||
        currentStatus.value === "processing"
      );
    });

    // Refs
    const visualizerCanvas = ref(null);
    const textScrollContainer = ref(null);
    let visualizerInstance = null;

    const syncCanvasSize = () => {
      const canvas = visualizerCanvas.value;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    };

    const initialize = () => {
      window.electronAPI.sendDictationWindowReady();

      if (visualizerCanvas.value) {
        try {
          syncCanvasSize();

          visualizerInstance = createAudioVisualizer(visualizerCanvas.value, {
            getLevel: () => currentAudioLevel.value,
            barWidth: 1,
            barGap: 2,
            smoothing: 0.5,
            maxHeightRatio: 1,
          });

          const resizeObserver = new ResizeObserver(() => {
            syncCanvasSize();
            if (visualizerInstance) visualizerInstance.resize();
          });
          resizeObserver.observe(visualizerCanvas.value);

          if (isRecording.value) {
            visualizerInstance.start();
          }
        } catch (e) {
          console.error("Failed to initialize visualizer:", e);
        }
      }
    };

    const cleanup = () => {
      if (visualizerInstance) {
        visualizerInstance.stop();
      }
    };

    const resetVisualizer = () => {
      if (visualizerInstance) {
        visualizerInstance.reset();
      }
    };

    watch(isRecording, (newValue) => {
      if (visualizerInstance) {
        if (newValue) {
          visualizerInstance.start();
        } else {
          visualizerInstance.stop();
        }
      }
    });

    // Auto-scroll to show latest segment when segments update
    const scrollToLatest = () => {
      if (textScrollContainer.value) {
        nextTick(() => {
          textScrollContainer.value.scrollLeft =
            textScrollContainer.value.scrollWidth;
        });
      }
    };

    // Watch for segment changes and auto-scroll
    watch(
      displaySegments,
      () => {
        scrollToLatest();
      },
      { deep: true },
    );

    const handleClose = () => {
      window.electronAPI.closeDictationWindow();
    };

    const getSegmentClass = (segment) => {
      if (segment.completed || segment.type === "transcribed") {
        return "transcribed";
      }
      return "in-progress";
    };

    onMounted(() => {
      // Defer initialization to ensure canvas is mounted (if v-if allows)
      nextTick(() => {
        initialize();
      });

      // IPC Listeners
      if (window.electronAPI.onAudioLevel) {
        window.electronAPI.onAudioLevel((level) => {
          currentAudioLevel.value = level;
          // VAD now handles isSpeaking
        });
      }

      window.electronAPI.onDictationStartRecording(() => {
        isRecording.value = true;
        currentStatus.value = "recording";
      });

      window.electronAPI.onDictationStopRecording(() => {
        isRecording.value = false;
        currentStatus.value = "processing";
      });

      window.electronAPI.onTranscriptionUpdate((update) => {
        if (update && update.segments) {
          transcriptionSegments.value = update.segments;
        }
      });

      window.electronAPI.onDictationComplete((text) => {
        finalText.value = text;
        currentStatus.value = "idle";
        isRecording.value = false;
      });

      window.electronAPI.onDictationClear(() => {
        transcriptionSegments.value = [];
        finalText.value = "";
        currentStatus.value = "idle";
      });
      window.electronAPI.onDictationStatus((status) => {
        currentStatus.value = status;
        if (status === "idle") {
          isRecording.value = false;
        }
      });

      window.electronAPI.onAnimateIn(() => {
        isVisible.value = true;
      });

      window.electronAPI.onWindowHidden(() => {
        isVisible.value = false;
        // Clear all segments and reset visualizer when window is hidden
        transcriptionSegments.value = [];
        finalText.value = "";
        currentStatus.value = "idle";
        isRecording.value = false;
        isSpeaking.value = false;
        currentAudioLevel.value = 0;
        resetVisualizer();
      });

      if (window.electronAPI.onDictationSpeechStart) {
        window.electronAPI.onDictationSpeechStart(() => {
          isSpeaking.value = true;
        });
      }

      if (window.electronAPI.onDictationSpeechEnd) {
        window.electronAPI.onDictationSpeechEnd(() => {
          isSpeaking.value = false;
        });
      }
    });

    onUnmounted(() => {
      cleanup();
    });

    return {
      isRecording,
      currentStatus,
      displaySegments,
      showVisualizer,
      isTranscribing,
      visualizerCanvas,
      textScrollContainer,
      dictationRoot,
      isVisible,
      currentAudioLevel,
      handleClose,
      getSegmentClass,
    };
  },
};
