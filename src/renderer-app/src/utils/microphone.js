/**
 * Microphone enumeration and testing utilities.
 * Provides functions to list available microphones and test microphone access.
 */

/**
 * @typedef {Object} MicrophoneDevice
 * @property {string} deviceId - The device ID
 * @property {string} label - The device label/name
 * @property {string|undefined} groupId - The device group ID
 */

/**
 * @typedef {Object} MicrophoneOption
 * @property {string} value - The device ID
 * @property {string} label - The device label for display
 */

const DEFAULT_MICROPHONE = {
  deviceId: "default",
  label: "System Default",
  groupId: undefined,
};

const AUDIO_CONSTRAINTS = {
  sampleRate: 16000,
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
};

const ENUMERATION_AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: false,
};

/**
 * Enumerate available microphone devices
 * @returns {Promise<MicrophoneDevice[]>}
 */
export async function enumerateMicrophones() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: ENUMERATION_AUDIO_CONSTRAINTS,
    });

    stream.getTracks().forEach((track) => track.stop());

    const allDevices = await navigator.mediaDevices.enumerateDevices();

    const audioInputs = allDevices
      .filter((device) => device.kind === "audioinput")
      .map((device) => ({
        deviceId: device.deviceId,
        label:
          device.label ||
          (device.deviceId === "default" ? "System Default" : "Microphone"),
        groupId: device.groupId,
      }));

    if (!audioInputs.some((device) => device.deviceId === "default")) {
      audioInputs.unshift(DEFAULT_MICROPHONE);
    }

    return audioInputs;
  } catch (error) {
    console.error("Failed to enumerate microphones:", error);
    return [DEFAULT_MICROPHONE];
  }
}

/**
 * Test microphone access by requesting a stream and immediately stopping it
 * @returns {Promise<boolean>} Whether microphone access was granted
 */
export async function testMicrophoneAccess() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: AUDIO_CONSTRAINTS,
    });

    stream.getTracks().forEach((track) => track.stop());
    return true;
  } catch (error) {
    console.error("Microphone permission denied:", error);
    return false;
  }
}

/**
 * Request microphone access and return the stream
 * Caller is responsible for stopping the stream when done
 * @returns {Promise<MediaStream>}
 * @throws {Error} If microphone access is denied
 */
export async function requestMicrophoneStream() {
  return navigator.mediaDevices.getUserMedia({
    audio: AUDIO_CONSTRAINTS,
  });
}

/**
 * Format microphone devices for use in a select element
 * @param {MicrophoneDevice[]} microphones
 * @returns {MicrophoneOption[]}
 */
export function formatMicrophoneOptions(microphones) {
  return microphones.map((mic) => ({
    value: mic.deviceId,
    label: mic.label,
  }));
}

/**
 * Update microphone options in a settings schema
 * @param {Array} schema - The settings schema array
 * @param {MicrophoneDevice[]} microphones - The available microphones
 * @returns {Array} Updated schema
 */
export function updateSchemaWithMicrophones(schema, microphones) {
  const microphoneOptions = formatMicrophoneOptions(microphones);

  return schema.map((section) => ({
    ...section,
    fields: section.fields.map((field) => {
      if (field.key === "selectedMicrophone") {
        return {
          ...field,
          options: microphoneOptions,
        };
      }
      return field;
    }),
  }));
}
