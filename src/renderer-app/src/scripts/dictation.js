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

        const showVisualizer = computed(() => {
            // Priority 1: If the user is speaking, always show the visualizer.
            if (isSpeaking.value) {
                return true;
            }
            if (currentStatus.value === "idle" && isRecording.value) {
                return true;
            }
            // Priority 2: In these final states, never show the visualizer.
            if (
                ["transforming", "injecting", "complete"].includes(
                    currentStatus.value,
                )
            ) {
                return false;
            }

            // Priority 3: If we have text segments to display, hide the visualizer to show them.
            if (displaySegments.value.length > 0) {
                return false;
            }

            // Priority 4: If we are 'transcribing' but have no segments, hide visualizer to show 'Transcribing...'.
            if (
                currentStatus.value === "transcribing" &&
                displaySegments.value.length === 0
            ) {
                return false;
            }

            // Priority 5: If we are in the 'recording' state without any text, show the visualizer.
            if (currentStatus.value === "recording") {
                return true;
            }

            return false; // Default case
        });

        const hasTranscription = computed(() => {
            return transcriptionSegments.value.length > 0 || finalText.value;
        });

        const textContent = ref(null);
        const textScrollContainer = ref(null);
        const dictationRoot = ref(null);
        let visualizer = null;
        let resizeObserver = null;

        // VAD state
        const vadInstance = ref(null);
        const isVadInitialized = ref(false);
        const mediaStream = ref(null);
        let audioContext = null;
        let analyser = null;
        let sourceNode = null;
        let rmsArray = null;
        let allowFinalFlush = false;
        let deviceChangeTimeout = null;

        const scrollToEnd = () => {
            if (textScrollContainer.value) {
                textScrollContainer.value.scrollLeft =
                    textScrollContainer.value.scrollWidth;
            }
        };

        // Methods
        const resetTranscription = () => {
            transcriptionSegments.value = [];
            finalText.value = "";
            currentAudioLevel.value = 0;
        };

        // Sound feedback
        const playStartSound = () => {
            try {
                const startSound = document.getElementById("startSound");
                if (startSound) {
                    startSound.volume = 0.8;
                    startSound.play().catch(() => { });
                }
            } catch (_) { }
        };

        const playEndSound = () => {
            try {
                const endSound = document.getElementById("endSound");
                if (endSound) {
                    endSound.volume = 0.8;
                    endSound.play().catch(() => { });
                }
            } catch (_) { }
        };

        const getSegmentClass = (segment) => {
            if (segment.type === "transcribed") {
                return segment.completed ? "transcribed" : "in-progress";
            }
            if (segment.type === "inprogress") return "in-progress";
            return "";
        };

        const getSegmentDisplayText = (segment) => {
            return segment.text;
        };

        setInterval(() => {
            if (analyser && rmsArray) {
                try {
                    analyser.getFloatTimeDomainData(rmsArray);
                    let sum = 0;
                    for (let i = 0; i < rmsArray.length; i++) {
                        const v = rmsArray[i];
                        sum += v * v;
                    }
                    const rms = Math.sqrt(sum / rmsArray.length);
                    const scaled = Math.min(1, rms * 8);
                    currentAudioLevel.value = scaled;
                } catch (_) { }
            }
        }, 50);

        const handleClose = () => {
            disableVADStream();
            playEndSound();
            window.electronAPI.cancelDictation();
        };

        const createVAD = (stream) => window.vad.MicVAD.new({
                    // Needs trailing slash
                    baseAssetPath: "./vad/",
                    // Needs protocol
                    onnxWASMBasePath: './',
                    model: "v5",
                    positiveSpeechThreshold: 0.5,
                    negativeSpeechThreshold: 0.35,
                    preSpeechPadFrames: 40,
                    redemptionFrames: 10,
                    frameSamples: 512,
                    minSpeechFrames: 3,
                    submitUserSpeechOnPause: true,
                    stream: stream,
                    onSpeechStart: () => {
                        isSpeaking.value = true;
                    },
                    onSpeechEnd: (audio) => {
                        isSpeaking.value = false;
                        if (
                            (isRecording.value || allowFinalFlush) &&
                            audio.length > 0
                        ) {
                            window.electronAPI.sendAudioSegment(audio);
                            allowFinalFlush = false;
                        }
                    },
                });
        // VAD Methods
        const initializeVAD = async () => {
            try {

                // Get selected microphone from settings
                const selectedMicrophone = await window.electronAPI.getSelectedMicrophone() || "default";

                // Validate device availability if not using default
                if (selectedMicrophone !== "default") {
                    const isAvailable = await checkDeviceAvailability(selectedMicrophone);
                    if (!isAvailable) {
                        console.log(
                            `Selected device ${selectedMicrophone} is not available, resetting to default`
                        );
                        await window.electronAPI.setSelectedMicrophone("default");
                        // Recursively call with default to avoid code duplication
                        return await initializeVAD();
                    }
                }

                // Build audio constraints with selected microphone
                const audioConstraints = {
                    sampleRate: 16000,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                };

                // Add device ID if not using default
                if (selectedMicrophone !== "default") {
                    audioConstraints.deviceId = { exact: selectedMicrophone };
                }

                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: audioConstraints,
                });

                mediaStream.value = stream;
                stream
                    .getAudioTracks()
                    .forEach((track) => (track.enabled = false));
                const myVAD = await createVAD(stream);
                vadInstance.value = myVAD;
                isVadInitialized.value = true;
                await startVAD();
            } catch (error) {
                console.error("Failed to initialize VAD:", error);
                // If specific microphone fails, try with default
                try {
                    console.log("Falling back to default microphone");
                    const stream = await navigator.mediaDevices.getUserMedia({
                        audio: {
                            sampleRate: 16000,
                            channelCount: 1,
                            echoCancellation: true,
                            noiseSuppression: true,
                        },
                    });

                    mediaStream.value = stream;
                    stream
                        .getAudioTracks()
                        .forEach((track) => (track.enabled = false));
                    const myVAD = await createVAD(stream);
                    vadInstance.value = myVAD;
                    isVadInitialized.value = true;
                    await startVAD();
                } catch (fallbackError) {
                    console.error("Failed to initialize VAD with fallback:", fallbackError);
                }
            }
        };

        const startVAD = async () => {
            if (!isVadInitialized.value) await initializeVAD();
            if (vadInstance.value) await vadInstance.value.start();
        };

        const enableVADStream = async () => {
            if (mediaStream.value) {
                mediaStream.value
                    .getAudioTracks()
                    .forEach((track) => (track.enabled = true));
                if (!audioContext)
                    audioContext = new (window.AudioContext ||
                        window.webkitAudioContext)();
                if (sourceNode) sourceNode.disconnect();
                sourceNode = audioContext.createMediaStreamSource(
                    mediaStream.value,
                );
                analyser = audioContext.createAnalyser();
                analyser.fftSize = 512;
                rmsArray = new Float32Array(analyser.fftSize);
                sourceNode.connect(analyser);
            }
        };

        const disableVADStream = async () => {
            if (mediaStream.value) {
                mediaStream.value
                    .getAudioTracks()
                    .forEach((track) => (track.enabled = false));
            }
            if (sourceNode) sourceNode.disconnect();
            sourceNode = null;
            analyser = null;
            rmsArray = null;
        };

        const stopVAD = async () => {
            if (vadInstance.value) await vadInstance.value.pause();
        };

        const stopMediaStream = () => {
            if (mediaStream.value) {
                mediaStream.value.getTracks().forEach((track) => track.stop());
                mediaStream.value = null;
            }
        };

        const cleanupMediaStream = () => {
            stopMediaStream();
        };

        const cleanupVAD = async () => {
            if (vadInstance.value) {
                try {
                    await vadInstance.value.pause();
                } catch (e) {
                    console.error("Error pausing VAD:", e);
                }
                vadInstance.value = null;
            }
            cleanupMediaStream();
            isVadInitialized.value = false;
        };

        const checkDeviceAvailability = async (deviceId) => {
            if (deviceId === "default") {
                return true;
            }
            try {
                const devices = await navigator.mediaDevices.enumerateDevices();
                return devices.some(
                    (device) =>
                        device.kind === "audioinput" && device.deviceId === deviceId
                );
            } catch (error) {
                console.error("Error checking device availability:", error);
                return false;
            }
        };

        const handleDeviceChange = async () => {
            if (deviceChangeTimeout) {
                clearTimeout(deviceChangeTimeout);
            }
            deviceChangeTimeout = setTimeout(async () => {
                try {
                    const selectedMicrophone =
                        (await window.electronAPI.getSelectedMicrophone()) || "default";

                    if (selectedMicrophone === "default") {
                        return;
                    }

                    const isAvailable = await checkDeviceAvailability(
                        selectedMicrophone
                    );

                    if (!isAvailable) {
                        console.log(
                            `Selected device ${selectedMicrophone} is no longer available, resetting to default`
                        );
                        await window.electronAPI.setSelectedMicrophone("default");
                        const wasInitialized = isVadInitialized.value;
                        const wasRecording = isRecording.value;
                        await cleanupVAD();
                        await initializeVAD();
                        if (wasInitialized && wasRecording) {
                            await startRecording();
                        }
                    }
                } catch (error) {
                    console.error("Error handling device change:", error);
                }
            }, 500);
        };

        // IPC event handlers
        const initializeDictation = (data) => {
            selectedText.value = data.selectedText || "";
            isRunOnAllPlugin.value = data.isRunOnAll || false;
            resetTranscription();
            isSpeaking.value = false;
            allowFinalFlush = false;
            currentStatus.value = "idle";
        };

        const startRecording = async () => {
            isRecording.value = true;
            allowFinalFlush = false;
            resetTranscription();
            if (!mediaStream.value || !isVadInitialized.value) {
                await initializeVAD();
            }
            await enableVADStream();
            await startVAD();
            nextTick(setupVisualizer);
        };

        const stopRecording = async () => {
            isRecording.value = false;
            allowFinalFlush = true;
            await stopVAD();
            setTimeout(async () => {
                allowFinalFlush = false;
                await disableVADStream();
                teardownVisualizer();
                stopMediaStream();
            }, 320);
        };

        const updateTranscription = (update) => {
            transcriptionSegments.value = update.segments;
        };

        const completeDictation = (text) => {
            finalText.value = text;
            transcriptionSegments.value = [
                { type: "transcribed", text, completed: true },
            ];
        };

        const clearDictation = () => {
            isRecording.value = false;
            resetTranscription();
            isSpeaking.value = false;
            allowFinalFlush = false;
        };

        const flushPendingAudio = async () => {
            console.log("[DictationWindow] Flushing pending audio...");
            if (vadInstance.value) {
                await vadInstance.value.pause();
                await vadInstance.value.start();
            }
            transcriptionSegments.value = [];
            finalText.value = "";
        };

        watch([displaySegments], () => nextTick(scrollToEnd));

        onMounted(async () => {
            console.log("Dictation window mounted, pre-initializing VAD...");
            initializeVAD().catch(err => console.error("VAD pre-init failed:", err));

            window.electronAPI.onAnimateIn(async () => {
                if (dictationRoot.value) {
                    dictationRoot.value.classList.add("visible");
                }
                playStartSound();
            });
            window.electronAPI.onInitializeDictation(initializeDictation);
            window.electronAPI.onStartRecording(startRecording);
            window.electronAPI.onStopRecording(stopRecording);
            window.electronAPI.onTranscriptionUpdate(updateTranscription);
            window.electronAPI.onDictationComplete(completeDictation);
            window.electronAPI.onDictationClear(clearDictation);
            window.electronAPI.onSetStatus(
                (status) => (currentStatus.value = status),
            );
            window.electronAPI.onPlayEndSound(playEndSound);
            window.electronAPI.onWindowHidden(() => {
                stopMediaStream();
            });
            window.electronAPI.onFlushPendingAudio(flushPendingAudio);
            setupVisualizer();
            document.addEventListener("dragstart", (e) => e.preventDefault());
            window.addEventListener("beforeunload", () => {
                playEndSound();
                cleanupMediaStream();
            });

            document.addEventListener("visibilitychange", () => {
                if (document.hidden) {
                    stopMediaStream();
                }
            });

            // Listen for device changes
            navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
        });

        onUnmounted(() => {
            if (deviceChangeTimeout) {
                clearTimeout(deviceChangeTimeout);
            }
            navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
            cleanupVAD();
        });

        function setupVisualizer() {
            const container = textScrollContainer.value;
            const canvas = document.getElementById("waveCanvas");
            if (!container || !canvas) return;
            canvas.width = container.offsetWidth;
            if (!visualizer) {
                visualizer = createAudioVisualizer(canvas, {
                    getLevel: () => currentAudioLevel.value,
                    bars: 64,
                    smoothing: 0.6,
                });
                visualizer.start();
            }
            if (!resizeObserver) {
                resizeObserver = new ResizeObserver(() => {
                    canvas.width = container.offsetWidth;
                    if (visualizer) visualizer.resize();
                });
                resizeObserver.observe(container);
            }
        }

        function teardownVisualizer() {
            try {
                if (visualizer && typeof visualizer.stop === "function") {
                    visualizer.stop();
                }
            } catch (_) { }
            visualizer = null;
            if (resizeObserver && textScrollContainer.value) {
                try {
                    resizeObserver.unobserve(textScrollContainer.value);
                } catch (_) { }
            }
            resizeObserver = null;
            const canvas = document.getElementById("waveCanvas");
            if (canvas && canvas.getContext) {
                const ctx = canvas.getContext("2d");
                if (ctx) {
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                }
            }
        }

    const statusIconClass = computed(() => currentStatus.value);

    return {
      isRecording,
      currentStatus,
      finalText,
      showVisualizer,
      isRunOnAllPlugin,
      selectedText,
      statusIconClass,
      hasTranscription,
      displaySegments,
      textContent,
      textScrollContainer,
      dictationRoot,
      resetTranscription,
      getSegmentClass,
      getSegmentDisplayText,
      handleClose,
    };
  },
};