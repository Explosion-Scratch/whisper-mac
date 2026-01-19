<template>
<div class="dictation-root" :class="{ visible: isVisible }" ref="dictationRoot">
  <div class="dictation-container">
    <div class="status-icn" :class="currentStatus">
      <div
        class="loading-circle"
        :class="{
          active:
            isTranscribing || currentStatus === 'transforming' || currentStatus === 'injecting',
        }"
      ></div>
      <!-- Microphone icon for idle and recording states -->
      <i
        v-if="currentStatus === 'idle' || currentStatus === 'recording'"
        class="ph-duotone ph-microphone"
      ></i>

      <!-- Spinner icon for transcribing state -->
      <i v-else-if="currentStatus === 'transcribing'" class="ph-duotone ph-waveform"></i>

      <!-- Sparkle icon for transforming state -->
      <i
        v-else-if="currentStatus === 'transforming'"
        class="ph-duotone ph-sparkle"
      ></i>

      <!-- Paper plane icon for injecting state -->
      <i
        v-else-if="currentStatus === 'injecting'"
        class="ph-duotone ph-paper-plane-tilt"
      ></i>

      <!-- Check icon for complete state -->
      <i
        v-else-if="currentStatus === 'complete'"
        class="ph-duotone ph-check-circle"
      ></i>
    </div>

    <div class="text-scroll-container" ref="textScrollContainer">
      <div class="wave-container" :class="{ active: showVisualizer }">
        <canvas id="waveCanvas" class="wave-canvas" height="24" ref="visualizerCanvas"></canvas>
      </div>
      <div class="text-content" ref="textContent">
        <template v-if="!showVisualizer">
          <template v-if="displaySegments.length > 0">
            <span
              v-for="(segment, index) in displaySegments"
              :key="segment.id || index"
              class="text-segment"
              :class="[
                getSegmentClass(segment),
                { 'no-caret': currentStatus === 'transcribing' },
              ]"
            >
              <!-- Completed Segment -->
              <template v-if="segment.completed">{{ segment.text }}</template>
              <!-- In-Progress Segment -->
              <template v-else>
                <span>{{
                  segment.text ||
                  (currentStatus === "transcribing" ? "Transcribing..." : "")
                }}</span>
                <i
                  v-if="currentStatus === 'transcribing'"
                  class="ph ph-spinner in-progress-spinner"
                ></i>
              </template>
            </span>
          </template>
          <!-- Fallbacks for when there are no segments -->
          <template v-else>
            <span
              v-if="currentStatus === 'transcribing'"
              class="text-segment in-progress"
              >Transcribing...<i class="ph ph-spinner in-progress-spinner"></i
            ></span>
            <span
              v-else-if="
                currentStatus === 'transforming' ||
                currentStatus === 'injecting'
              "
              class="text-segment in-progress"
              >Processing...</span
            >
            <span v-else class="text-segment" style="opacity: 0">&nbsp;</span>
          </template>
        </template>
      </div>
    </div>

    <button class="close-button" @click="handleClose">
      <i class="ph-duotone ph-x"></i>
    </button>
  </div>
  <!-- Audio elements for sound feedback -->
  <audio id="startSound" preload="auto">
    <source src="/assets/start.mp3" type="audio/mpeg" />
  </audio>
  <audio id="endSound" preload="auto">
    <source src="/assets/end.mp3" type="audio/mpeg" />
  </audio>
</div>
</template>
<script>
import dictationComponent from "../scripts/dictation.js";
export default dictationComponent;
</script>

<style lang="less">
@import "../styles/dictation.less";
</style>