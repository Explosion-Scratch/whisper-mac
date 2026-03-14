<template>
  <div class="rn-root" v-cloak>
    <div class="rn-toolbar">
      <div class="rn-toolbar-meta">
        <span class="rn-toolbar-title">Recording Notes</span>
        <input
          v-if="editingSessionTitle"
          ref="sessionTitleInputRef"
          class="rn-toolbar-title-input"
          :value="editingSessionTitleValue"
          placeholder="Untitled session"
          @input="editingSessionTitleValue = ($event.target as HTMLInputElement).value"
          @blur="commitSessionTitle"
          @keydown.enter.prevent="commitSessionTitle"
          @keydown.escape.prevent="cancelSessionTitleEdit"
        />
        <button
          v-else-if="canRenameSession"
          class="rn-toolbar-session-name"
          :title="currentProjectName"
          @click="startSessionTitleEdit"
        >
          {{ currentProjectName }}
        </button>
      </div>
      <div class="rn-toolbar-actions">
        <button class="rn-icon-btn" title="Import project folder" @click="importSession">
          <i class="ph ph-upload-simple"></i>
        </button>
        <button
          v-if="currentProjectPath"
          class="rn-icon-btn"
          title="Reveal project folder"
          @click="revealCurrentProject"
        >
          <i class="ph ph-folder-open"></i>
        </button>
        <button
          v-if="status !== 'idle'"
          class="rn-icon-btn"
          title="Export project folder"
          @click="exportSession"
        >
          <i class="ph ph-download-simple"></i>
        </button>
        <button
          v-if="status !== 'recording'"
          class="rn-icon-btn"
          title="New session"
          @click="resetSession"
        >
          <i class="ph ph-plus"></i>
        </button>
      </div>
    </div>

    <div v-if="status === 'idle'" class="rn-home">
      <div class="rn-home-main">
        <div class="rn-home-hero">
          <div class="rn-home-eyebrow">Auto-saved projects</div>
          <h1 class="rn-home-title">Capture notes, transcript, and audio in one place.</h1>
          <p class="rn-home-copy">
            Every recording is saved as its own folder so you can return later, reveal it in Finder, or clean up old sessions.
          </p>
          <div class="rn-home-actions">
            <button class="rn-primary-btn" @click="startRecording">
              <i class="ph ph-microphone"></i>
              <span>Start Recording</span>
            </button>
            <button class="rn-secondary-btn" @click="importSession">
              <i class="ph ph-upload-simple"></i>
              <span>Open Folder</span>
            </button>
          </div>
        </div>
        <div v-if="sessionError" class="rn-inline-error">{{ sessionError }}</div>
      </div>

      <div class="rn-home-sidebar">
        <div class="rn-section-head">
          <span class="rn-section-title">Recent Projects</span>
          <span class="rn-section-meta">{{ recentProjects.length }}</span>
        </div>
        <div v-if="recentProjects.length" class="rn-project-list">
          <div
            v-for="projectPath in recentProjects"
            :key="projectPath"
            class="rn-project-row"
            :class="{ 'rn-project-row-current': currentProjectPath === projectPath }"
          >
            <button class="rn-project-main" :title="projectPath" @click="openProject(projectPath)">
              <span class="rn-project-name">{{ formatProjectPath(projectPath) }}</span>
              <span class="rn-project-path">{{ projectPath }}</span>
            </button>
            <div class="rn-project-actions">
              <button class="rn-icon-btn rn-icon-btn-sm" title="Reveal folder" @click="revealProject(projectPath)">
                <i class="ph ph-folder-open"></i>
              </button>
              <button class="rn-icon-btn rn-icon-btn-sm" title="Delete project" @click="deleteProject(projectPath)">
                <i class="ph ph-trash"></i>
              </button>
            </div>
          </div>
        </div>
        <div v-else class="rn-empty-state">
          Recent recordings will appear here once you start or open a project.
        </div>
      </div>
    </div>

    <div v-else class="rn-workspace">
      <div class="rn-session-bar">
        <div class="rn-session-status">
          <span
            class="rn-status-dot"
            :class="{
              'rn-status-dot-paused': status === 'paused',
              'rn-status-dot-ended': status === 'ended',
            }"
          ></span>
          <span class="rn-status-label">{{ statusLabel }}</span>
          <span class="rn-status-time">{{ formatTs(elapsed) }}</span>
        </div>
        <div class="rn-session-models" v-if="modelInfo">
          <span>{{ modelInfo.transcriptionPlugin }}</span>
          <span v-if="modelInfo.aiEnabled">· {{ modelInfo.aiModel }}</span>
        </div>
        <div class="rn-session-actions">
          <button v-if="status === 'recording'" class="rn-secondary-btn rn-compact-btn" @click="pauseRecording">
            <i class="ph ph-pause"></i>
            <span>Pause</span>
          </button>
          <button v-else-if="status === 'paused'" class="rn-secondary-btn rn-compact-btn" @click="resumeRecording">
            <i class="ph ph-play"></i>
            <span>Resume</span>
          </button>
          <button v-else class="rn-secondary-btn rn-compact-btn" @click="resumeRecording">
            <i class="ph ph-microphone"></i>
            <span>Continue</span>
          </button>
          <button v-if="status !== 'ended'" class="rn-danger-btn rn-compact-btn" @click="stopRecording">
            <i class="ph ph-stop"></i>
            <span>End</span>
          </button>
        </div>
      </div>

      <div class="rn-workspace-grid">
        <section class="rn-panel rn-notes-panel">
          <div class="rn-panel-head">
            <div>
              <div class="rn-section-title">Notes</div>
              <div class="rn-section-subtitle">Markdown shortcuts render inline. Enter adds a timestamped row, Shift+Enter stays within one.</div>
            </div>
            <div class="rn-panel-tools">
              <button
                v-if="currentProjectPath"
                class="rn-icon-btn rn-icon-btn-sm"
                title="Reveal project folder"
                @click="revealCurrentProject"
              >
                <i class="ph ph-folder-open"></i>
              </button>
            </div>
          </div>

          <div class="rn-notes-list" ref="notesList">
            <div
              v-for="(note, idx) in userNotes"
              :key="note.id"
              class="rn-note-item"
              :class="{ 'rn-note-active': isNoteActive(note.timestampMs) }"
              :style="{ paddingLeft: `${16 + (note.indent || 0) * 18}px` }"
            >
              <input
                v-if="editingTsIdx === idx"
                class="rn-note-timestamp-input"
                :value="editingTsValue"
                @input="editingTsValue = ($event.target as HTMLInputElement).value"
                @blur="commitTimestampEdit(idx)"
                @keydown.enter.prevent="commitTimestampEdit(idx)"
                @keydown.escape.prevent="editingTsIdx = null"
                maxlength="5"
                ref="tsInputRef"
              />
              <button v-else class="rn-note-timestamp" @click="handleTimestampClick(note, idx)">
                {{ formatTs(note.timestampMs) }}
              </button>
              <TimestampedMarkdownNoteEditor
                :model-value="note.text"
                :ref="el => setNoteRef(el, idx)"
                placeholder="Type markdown..."
                @update:model-value="updateNote(idx, $event)"
                @split="handleNoteSplit(idx)"
                @remove="handleNoteRemove(idx)"
                @indent="handleNoteIndent(idx, $event)"
                @navigate="handleNoteNavigate(idx, $event)"
              />
              <button
                v-if="canPlayAudio"
                class="rn-note-jump"
                title="Jump to audio"
                @click="seekTo(note.timestampMs)"
              >
                <i class="ph ph-play"></i>
              </button>
            </div>
          </div>

          <div class="rn-audio-bar-wrap" v-if="canPlayAudio">
            <button class="rn-audio-play-btn" @click="togglePlayback">
              <i :class="isPlaying ? 'ph ph-pause' : 'ph ph-play'"></i>
            </button>
            <span class="rn-audio-time">{{ formatTs(Math.round(currentTime * 1000)) }}</span>
            <div class="rn-audio-bar" @click="seekAudioBar($event)">
              <div class="rn-audio-progress" :style="{ width: `${audioProgress}%` }"></div>
            </div>
            <span class="rn-audio-time">{{ formatTs(Math.round(duration * 1000)) }}</span>
          </div>
        </section>

        <section class="rn-side-stack">
          <div class="rn-panel rn-transcript-panel">
            <div class="rn-panel-head">
              <div>
                <div class="rn-section-title">Transcript</div>
                <div class="rn-section-subtitle">
                  {{ status === 'recording' ? 'Live as you speak' : 'Click any line to jump' }}
                </div>
              </div>
            </div>
            <div class="rn-transcript-live" v-if="status === 'recording'">
              {{ partialTranscript || latestTranscriptText || 'Listening…' }}
            </div>
            <div v-else class="rn-transcript-list">
              <button
                v-for="seg in transcriptSegments"
                :key="seg.id"
                class="rn-transcript-seg"
                :class="{ 'rn-transcript-seg-active': isSegmentActive(seg) }"
                @click="seekTo(seg.startMs)"
              >
                <span class="rn-transcript-seg-time">{{ formatTs(seg.startMs) }}</span>
                <span>{{ seg.text }}</span>
              </button>
            </div>
          </div>

          <div class="rn-panel rn-ai-panel">
            <div class="rn-panel-head">
              <div>
                <div class="rn-section-title">AI Notes</div>
                <div class="rn-section-subtitle">Summaries stay linked to the timeline</div>
              </div>
              <div class="rn-panel-tools">
                <span v-if="aiGenerating" class="rn-inline-status">
                  <span class="rn-ask-spinner"></span>
                  <span>Generating</span>
                </span>
                <button
                  v-if="transcriptSegments.length > 0 && !aiGenerating"
                  class="rn-icon-btn rn-icon-btn-sm"
                  title="Regenerate AI notes"
                  @click="regenerateAiNotes"
                >
                  <i class="ph ph-arrows-clockwise"></i>
                </button>
              </div>
            </div>
            <div v-if="aiError" class="rn-inline-error" @click="aiError = ''">{{ aiError }}</div>
            <div v-if="aiNotes.length === 0 && !streamingAiNote && !aiGenerating" class="rn-empty-state">
              Notes will appear as the transcript grows.
            </div>
            <div v-for="note in aiNotes" :key="note.id" class="rn-ai-note" :class="{ 'rn-ai-note-active': isAiNoteActive(note.timestampMs) }">
              <button class="rn-ai-note-time" @click="seekTo(note.timestampMs)">
                {{ formatTs(note.timestampMs) }}
              </button>
              <textarea
                v-if="editingAiNoteId === note.id"
                class="rn-ai-note-edit"
                :value="note.content"
                @blur="commitAiNoteEdit(note.id, ($event.target as HTMLTextAreaElement).value)"
                @keydown.escape.prevent="editingAiNoteId = null"
                ref="aiNoteEditRef"
              ></textarea>
              <div
                v-else
                class="rn-ai-note-content rn-ai-note-content-editable"
                @click="handleAiNoteClick($event, note.id)"
                v-html="renderMd(note.content)"
              ></div>
            </div>
            <div v-if="streamingAiNote" class="rn-ai-note rn-ai-note-streaming">
              <button class="rn-ai-note-time" @click="seekTo(streamingAiNote.timestampMs)">
                {{ formatTs(streamingAiNote.timestampMs) }}
              </button>
              <div
                class="rn-ai-note-content"
                @click="handleTimestampContentClick"
                v-html="renderMd(streamingAiNote.content)"
              ></div>
            </div>
          </div>

          <div class="rn-panel rn-chat-panel">
            <div class="rn-panel-head">
              <div>
                <div class="rn-section-title">Chat</div>
                <div class="rn-section-subtitle">Ask about the recording or notes</div>
              </div>
            </div>
            <div class="rn-chat-input-row">
              <input
                class="rn-ask-input"
                v-model="askInput"
                placeholder="Ask a question about this session..."
                @keydown.enter="submitQuestion"
                :disabled="askLoading"
              />
              <button
                class="rn-primary-btn rn-compact-btn"
                :disabled="!askInput.trim() || askLoading"
                @click="submitQuestion"
              >
                <span v-if="askLoading" class="rn-ask-spinner"></span>
                <span v-else>Ask</span>
              </button>
            </div>
            <div
              v-if="askResponse"
              class="rn-ask-response"
              @click="handleTimestampContentClick"
              v-html="renderMd(askResponse)"
            ></div>
          </div>
        </section>
      </div>
    </div>

    <audio
      ref="audioEl"
      :src="audioSrc"
      @timeupdate="onTimeUpdate"
      @ended="onAudioEnded"
      @loadedmetadata="onMetadata"
    ></audio>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { marked } from "marked";
import DOMPurify from "dompurify";
import TimestampedMarkdownNoteEditor from "../components/TimestampedMarkdownNoteEditor.vue";

interface AudioTimeMapping {
  wallClockMs: number;
  audioFileMs: number;
  durationMs: number;
}

interface TranscriptSegment {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  audioOffsetMs: number;
}

interface UserNote {
  id: string;
  text: string;
  timestampMs: number;
  indent: number;
}

interface AiNote {
  id: string;
  content: string;
  timestampMs: number;
  basedOnSegmentIds: string[];
}

interface ProjectState {
  lastDirectory: string;
  recentProjectPaths: string[];
  currentProjectPath: string | null;
}

interface NoteEditorRef {
  focusEditor: () => void;
}

type SessionStatus = "idle" | "recording" | "paused" | "ended";

const api = (window as any).recordingNotesAPI;

let noteIdCounter = 0;

function makeNoteId(): string {
  return `note-${Date.now()}-${++noteIdCounter}`;
}

function formatTs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function parseTimestampInput(input: string): number | null {
  const match = input.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const minutes = parseInt(match[1], 10);
  const seconds = parseInt(match[2], 10);
  if (seconds >= 60) return null;
  return (minutes * 60 + seconds) * 1000;
}

function decorateTimestampLinks(text: string): string {
  return text.replace(
    /(^|[\s[(])(\d{1,2}:\d{2})(?=$|[\s).,\]])/g,
    (match, prefix, value) => {
      const timestampMs = parseTimestampInput(value);
      if (timestampMs === null) return match;
      return `${prefix}<a href="#" data-rn-timestamp="${timestampMs}">${value}</a>`;
    },
  );
}

export default defineComponent({
  name: "RecordingNotes",
  components: {
    TimestampedMarkdownNoteEditor,
  },
  setup() {
    const status = ref<SessionStatus>("idle");
    const startedAt = ref(0);
    const elapsed = ref(0);
    const baseElapsed = ref(0);
    const userNotes = ref<UserNote[]>([]);
    const transcriptSegments = ref<TranscriptSegment[]>([]);
    const aiNotes = ref<AiNote[]>([]);
    const partialTranscript = ref("");
    const latestTranscriptText = ref("");
    const streamingAiNote = ref<{
      noteId: string;
      content: string;
      timestampMs: number;
    } | null>(null);
    const askInput = ref("");
    const askResponse = ref("");
    const askLoading = ref(false);
    const sessionError = ref("");
    const recentProjects = ref<string[]>([]);
    const currentProjectPath = ref<string | null>(null);
    const aiGenerating = ref(false);
    const aiError = ref("");
    const modelInfo = ref<{
      transcriptionPlugin: string;
      aiModel: string;
      aiEnabled: boolean;
    } | null>(null);
    const sessionTitle = ref("");
    const editingSessionTitle = ref(false);
    const editingSessionTitleValue = ref("");
    const editingTsIdx = ref<number | null>(null);
    const editingTsValue = ref("");
    const tsInputRef = ref<HTMLInputElement | null>(null);
    const sessionTitleInputRef = ref<HTMLInputElement | null>(null);
    const editingAiNoteId = ref<string | null>(null);
    const aiNoteEditRef = ref<HTMLTextAreaElement | null>(null);
    const audioPath = ref("");
    const isPlaying = ref(false);
    const currentTime = ref(0);
    const duration = ref(0);
    const audioTimeMappings = ref<AudioTimeMapping[]>([]);
    const activeWallClockMs = ref<number | null>(null);
    const notesList = ref<HTMLElement | null>(null);
    const audioEl = ref<HTMLAudioElement | null>(null);
    const noteRefs: Record<number, NoteEditorRef | null> = {};
    const audioSrc = computed(() => (audioPath.value ? `file://${audioPath.value}` : ""));
    const audioProgress = computed(() =>
      duration.value > 0 ? (currentTime.value / duration.value) * 100 : 0,
    );
    const canPlayAudio = computed(
      () =>
        !!audioPath.value && (status.value === "paused" || status.value === "ended"),
    );
    const statusLabel = computed(() =>
      status.value === "recording"
        ? "Recording"
        : status.value === "paused"
          ? "Paused"
          : "Session Ended",
    );
    const canRenameSession = computed(
      () => !!currentProjectPath.value && status.value !== "idle",
    );
    const currentProjectName = computed(() =>
      sessionTitle.value.trim() ||
      (currentProjectPath.value
        ? formatProjectPath(currentProjectPath.value)
        : "Untitled session"),
    );

    let elapsedTimer: ReturnType<typeof setInterval> | null = null;
    let saveNotesTimer: ReturnType<typeof setTimeout> | null = null;
    const cleanups: (() => void)[] = [];

    function setNoteRef(el: unknown, idx: number) {
      noteRefs[idx] = el as NoteEditorRef | null;
    }

    function renderMd(text: string): string {
      if (!text) return "";
      const html = marked.parse(decorateTimestampLinks(text), { async: false }) as string;
      return DOMPurify.sanitize(html, { ADD_ATTR: ["data-rn-timestamp"] });
    }

    function scheduleSaveNotes() {
      if (!api) return;
      if (saveNotesTimer) clearTimeout(saveNotesTimer);
      saveNotesTimer = setTimeout(() => {
        api.saveNotes(JSON.parse(JSON.stringify(userNotes.value)));
      }, 250);
    }

    function saveNotesNow() {
      if (saveNotesTimer) {
        clearTimeout(saveNotesTimer);
        saveNotesTimer = null;
      }
      api?.saveNotes?.(JSON.parse(JSON.stringify(userNotes.value)));
    }

    function setProjectState(projectState: ProjectState | null | undefined) {
      recentProjects.value = projectState?.recentProjectPaths || [];
      currentProjectPath.value = projectState?.currentProjectPath || null;
    }

    async function refreshProjectState() {
      const projectState = await api.getProjectState?.();
      setProjectState(projectState);
    }

    function wallClockToAudioMs(wallClockMs: number): number {
      const mappings = audioTimeMappings.value;
      if (!mappings.length) return wallClockMs;
      for (const mapping of mappings) {
        if (
          wallClockMs >= mapping.wallClockMs &&
          wallClockMs <= mapping.wallClockMs + mapping.durationMs
        ) {
          return mapping.audioFileMs + (wallClockMs - mapping.wallClockMs);
        }
      }
      let closest = mappings[0];
      let distance = Infinity;
      for (const mapping of mappings) {
        const startDistance = Math.abs(wallClockMs - mapping.wallClockMs);
        const endDistance = Math.abs(
          wallClockMs - (mapping.wallClockMs + mapping.durationMs),
        );
        const nextDistance = Math.min(startDistance, endDistance);
        if (nextDistance < distance) {
          distance = nextDistance;
          closest = mapping;
        }
      }
      return wallClockMs < closest.wallClockMs
        ? closest.audioFileMs
        : closest.audioFileMs + closest.durationMs;
    }

    function audioMsToWallClockMs(audioMs: number): number {
      const mappings = audioTimeMappings.value;
      if (!mappings.length) return audioMs;
      for (const mapping of mappings) {
        if (
          audioMs >= mapping.audioFileMs &&
          audioMs <= mapping.audioFileMs + mapping.durationMs
        ) {
          return mapping.wallClockMs + (audioMs - mapping.audioFileMs);
        }
      }
      let closest = mappings[0];
      let distance = Infinity;
      for (const mapping of mappings) {
        const startDistance = Math.abs(audioMs - mapping.audioFileMs);
        const endDistance = Math.abs(
          audioMs - (mapping.audioFileMs + mapping.durationMs),
        );
        const nextDistance = Math.min(startDistance, endDistance);
        if (nextDistance < distance) {
          distance = nextDistance;
          closest = mapping;
        }
      }
      return audioMs < closest.audioFileMs
        ? closest.wallClockMs
        : closest.wallClockMs + closest.durationMs;
    }

    function isNoteActive(timestampMs: number): boolean {
      return activeWallClockMs.value !== null && Math.abs(activeWallClockMs.value - timestampMs) < 2500;
    }

    function isAiNoteActive(timestampMs: number): boolean {
      return activeWallClockMs.value !== null && Math.abs(activeWallClockMs.value - timestampMs) < 3500;
    }

    function isSegmentActive(segment: TranscriptSegment): boolean {
      if (activeWallClockMs.value === null) return false;
      return (
        activeWallClockMs.value >= segment.startMs - 400 &&
        activeWallClockMs.value <= segment.endMs + 1200
      );
    }

    function syncActiveTimestampFromAudio() {
      if (!canPlayAudio.value) {
        activeWallClockMs.value = null;
        return;
      }
      activeWallClockMs.value = audioMsToWallClockMs(currentTime.value * 1000);
    }

    function startElapsedTimer() {
      if (elapsedTimer) clearInterval(elapsedTimer);
      const wallStart = Date.now();
      elapsedTimer = setInterval(() => {
        elapsed.value = baseElapsed.value + (Date.now() - wallStart);
        if (status.value === "recording") {
          activeWallClockMs.value = elapsed.value;
        }
      }, 500);
    }

    function stopElapsedTimer() {
      if (elapsedTimer) {
        clearInterval(elapsedTimer);
        elapsedTimer = null;
      }
    }

    function clearSessionState(nextStatus: SessionStatus = "idle") {
      status.value = nextStatus;
      stopElapsedTimer();
      userNotes.value = [];
      transcriptSegments.value = [];
      aiNotes.value = [];
      partialTranscript.value = "";
      latestTranscriptText.value = "";
      streamingAiNote.value = null;
      askResponse.value = "";
      askInput.value = "";
      audioPath.value = "";
      elapsed.value = 0;
      baseElapsed.value = 0;
      isPlaying.value = false;
      currentTime.value = 0;
      duration.value = 0;
      audioTimeMappings.value = [];
      activeWallClockMs.value = null;
      aiGenerating.value = false;
      aiError.value = "";
      sessionError.value = "";
      sessionTitle.value = "";
      editingSessionTitle.value = false;
      editingSessionTitleValue.value = "";
      editingTsIdx.value = null;
      editingAiNoteId.value = null;
      currentProjectPath.value = null;
    }

    function ensureAtLeastOneNote() {
      if (!userNotes.value.length) {
        userNotes.value = [{ id: makeNoteId(), text: "", timestampMs: 0, indent: 0 }];
      }
    }

    async function startRecording() {
      const result = await api.startRecording();
      if (!result.success) {
        sessionError.value = result.error || "Could not start recording";
        return;
      }
      clearSessionState("recording");
      startedAt.value = Date.now();
      userNotes.value = [{ id: makeNoteId(), text: "", timestampMs: 0, indent: 0 }];
      sessionError.value = "";
      await refreshProjectState();
      scheduleSaveNotes();
      startElapsedTimer();
      await nextTick();
      focusNote(0);
    }

    async function pauseRecording() {
      await api.pauseRecording();
    }

    async function resumeRecording() {
      const result = await api.resumeRecording();
      if (!result.success) {
        sessionError.value = result.error || "Could not resume recording";
        return;
      }
      sessionError.value = "";
    }

    async function stopRecording() {
      await api.stopRecording();
    }

    async function resetSession() {
      if (status.value === "recording") return;
      await api.resetSession();
      clearSessionState();
      await refreshProjectState();
    }

    function updateNote(idx: number, text: string) {
      if (!userNotes.value[idx]) return;
      userNotes.value[idx].text = text;
      scheduleSaveNotes();
    }

    function focusNote(idx: number) {
      const element = noteRefs[idx];
      if (!element) return;
      element.focusEditor();
    }

    function insertNoteAt(idx: number) {
      const note = userNotes.value[idx];
      if (!note) return;
      const newNote: UserNote = {
        id: makeNoteId(),
        text: "",
        timestampMs: elapsed.value,
        indent: note.indent || 0,
      };
      userNotes.value.splice(idx + 1, 0, newNote);
      scheduleSaveNotes();
      nextTick(() => focusNote(idx + 1));
    }

    function handleNoteSplit(idx: number) {
      insertNoteAt(idx);
    }

    function handleNoteRemove(idx: number) {
      const note = userNotes.value[idx];
      if (!note || note.text.trim() !== "" || userNotes.value.length <= 1) return;
      userNotes.value.splice(idx, 1);
      scheduleSaveNotes();
      nextTick(() => focusNote(Math.max(0, idx - 1)));
    }

    function handleNoteIndent(idx: number, delta: number) {
      const note = userNotes.value[idx];
      if (!note) return;
      note.indent = Math.max(0, Math.min(5, (note.indent || 0) + delta));
      scheduleSaveNotes();
    }

    function handleNoteNavigate(idx: number, delta: number) {
      const nextIndex = idx + delta;
      if (nextIndex < 0 || nextIndex >= userNotes.value.length) return;
      nextTick(() => focusNote(nextIndex));
    }

    function startSessionTitleEdit() {
      if (!canRenameSession.value) return;
      editingSessionTitle.value = true;
      editingSessionTitleValue.value = sessionTitle.value;
      nextTick(() => {
        sessionTitleInputRef.value?.focus();
        sessionTitleInputRef.value?.select();
      });
    }

    function cancelSessionTitleEdit() {
      editingSessionTitle.value = false;
      editingSessionTitleValue.value = sessionTitle.value;
    }

    async function commitSessionTitle() {
      if (!editingSessionTitle.value) return;
      const nextTitle = editingSessionTitleValue.value.trim();
      try {
        const result = await api.renameSession(nextTitle);
        if (!result?.success) {
          sessionError.value = result?.error || "Could not rename session";
        } else {
          sessionTitle.value = result.title || "";
          sessionError.value = "";
        }
      } catch (error: any) {
        sessionError.value = error.message || String(error);
      } finally {
        editingSessionTitle.value = false;
      }
    }

    function handleTimestampClick(note: UserNote, idx: number) {
      if (canPlayAudio.value) {
        seekTo(note.timestampMs);
        return;
      }
      editingTsIdx.value = idx;
      editingTsValue.value = formatTs(note.timestampMs);
      nextTick(() => {
        tsInputRef.value?.focus();
        tsInputRef.value?.select();
      });
    }

    function commitTimestampEdit(idx: number) {
      if (editingTsIdx.value !== idx) return;
      const parsed = parseTimestampInput(editingTsValue.value);
      if (parsed !== null) {
        userNotes.value[idx].timestampMs = parsed;
        scheduleSaveNotes();
      }
      editingTsIdx.value = null;
    }

    function seekTo(timestampMs: number) {
      activeWallClockMs.value = timestampMs;
      if (!canPlayAudio.value || !audioEl.value) return;
      const audioMs = wallClockToAudioMs(timestampMs);
      audioEl.value.currentTime = audioMs / 1000;
      if (!isPlaying.value) {
        void audioEl.value.play();
        isPlaying.value = true;
      }
    }

    function togglePlayback() {
      if (!audioEl.value) return;
      if (isPlaying.value) {
        audioEl.value.pause();
        isPlaying.value = false;
        return;
      }
      void audioEl.value.play();
      isPlaying.value = true;
    }

    function onTimeUpdate() {
      if (!audioEl.value) return;
      currentTime.value = audioEl.value.currentTime;
      syncActiveTimestampFromAudio();
    }

    function onMetadata() {
      if (!audioEl.value) return;
      duration.value = Number.isFinite(audioEl.value.duration)
        ? audioEl.value.duration
        : 0;
    }

    function onAudioEnded() {
      isPlaying.value = false;
      syncActiveTimestampFromAudio();
    }

    function seekAudioBar(event: MouseEvent) {
      if (!audioEl.value || duration.value === 0) return;
      const target = event.currentTarget as HTMLElement;
      const rect = target.getBoundingClientRect();
      const ratio = Math.max(
        0,
        Math.min(1, (event.clientX - rect.left) / rect.width),
      );
      audioEl.value.currentTime = ratio * duration.value;
      currentTime.value = audioEl.value.currentTime;
      syncActiveTimestampFromAudio();
    }

    function startEditAiNote(noteId: string) {
      editingAiNoteId.value = noteId;
      nextTick(() => {
        aiNoteEditRef.value?.focus();
      });
    }

    function commitAiNoteEdit(noteId: string, nextText: string) {
      const note = aiNotes.value.find((entry) => entry.id === noteId);
      if (note && nextText.trim() !== note.content) {
        note.content = nextText.trim();
        api.saveAiNotes(JSON.parse(JSON.stringify(aiNotes.value)));
      }
      editingAiNoteId.value = null;
    }

    function handleTimestampContentClick(event: MouseEvent) {
      const target = (event.target as HTMLElement | null)?.closest?.(
        "[data-rn-timestamp]",
      ) as HTMLElement | null;
      if (!target) return;
      event.preventDefault();
      const timestampMs = Number(target.getAttribute("data-rn-timestamp"));
      if (Number.isFinite(timestampMs)) {
        seekTo(timestampMs);
      }
    }

    function handleAiNoteClick(event: MouseEvent, noteId: string) {
      const target = (event.target as HTMLElement | null)?.closest?.(
        "[data-rn-timestamp]",
      ) as HTMLElement | null;
      if (target) {
        handleTimestampContentClick(event);
        return;
      }
      startEditAiNote(noteId);
    }

    async function submitQuestion() {
      const question = askInput.value.trim();
      if (!question || askLoading.value) return;
      askLoading.value = true;
      askResponse.value = "";
      saveNotesNow();
      try {
        await api.askQuestion(question);
      } catch (error: any) {
        askResponse.value = `Error: ${error.message || String(error)}`;
        askLoading.value = false;
      }
    }

    async function regenerateAiNotes() {
      if (!confirm("Regenerate all AI notes? This will replace existing AI notes.")) return;
      aiNotes.value = [];
      streamingAiNote.value = null;
      aiError.value = "";
      try {
        await api.regenerateAiNotes();
      } catch (error: any) {
        aiError.value = `Regeneration failed: ${error.message || String(error)}`;
      }
    }

    async function exportSession() {
      saveNotesNow();
      try {
        await api.exportZip();
        await refreshProjectState();
      } catch {}
    }

    async function importSession() {
      try {
        const result = await api.importZip();
        if (!result?.success) {
          sessionError.value = result?.error || "Could not import project";
          return;
        }
        sessionError.value = "";
        await refreshProjectState();
      } catch (error: any) {
        sessionError.value = error.message || String(error);
      }
    }

    async function openProject(projectPath: string) {
      const result = await api.openProject(projectPath);
      if (!result?.success) {
        sessionError.value = result?.error || "Could not open project";
        return;
      }
      sessionError.value = "";
      await refreshProjectState();
    }

    async function revealProject(projectPath?: string) {
      const result = await api.revealProject(projectPath);
      if (!result?.success) {
        sessionError.value = result?.error || "Could not reveal project";
      }
    }

    async function revealCurrentProject() {
      await revealProject(currentProjectPath.value || undefined);
    }

    async function deleteProject(projectPath: string) {
      if (!confirm(`Delete "${formatProjectPath(projectPath)}"? This removes the project folder.`)) {
        return;
      }
      const result = await api.deleteProject(projectPath);
      if (!result?.success) {
        sessionError.value = result?.error || "Could not delete project";
        return;
      }
      if (result.currentDeleted) {
        clearSessionState();
      }
      await refreshProjectState();
    }

    function formatProjectPath(projectPath: string): string {
      const normalized = projectPath.split("/").filter(Boolean);
      return normalized[normalized.length - 1] || projectPath;
    }

    function loadSession(session: any) {
      startedAt.value = session.startedAt || 0;
      status.value = session.status || "ended";
      sessionTitle.value = session.title || "";
      transcriptSegments.value = session.segments || [];
      userNotes.value = (session.userNotes || []).map((note: any) => ({
        ...note,
        indent: note.indent || 0,
      }));
      aiNotes.value = session.aiNotes || [];
      elapsed.value = session.totalRecordedMs || 0;
      baseElapsed.value = session.totalRecordedMs || 0;
      audioPath.value = session.audioPath || "";
      audioTimeMappings.value = session.audioTimeMappings || [];
      currentProjectPath.value = session.projectPath || currentProjectPath.value;
      latestTranscriptText.value =
        transcriptSegments.value[transcriptSegments.value.length - 1]?.text || "";
      partialTranscript.value = "";
      ensureAtLeastOneNote();
      activeWallClockMs.value =
        status.value === "recording" ? elapsed.value : transcriptSegments.value[0]?.startMs ?? 0;
    }

    onMounted(() => {
      if (!api) return;

      cleanups.push(
        api.onStatus((data: any) => {
          if (data.modelInfo) modelInfo.value = data.modelInfo;
          if (data.status === "recording") {
            status.value = "recording";
            startedAt.value = data.startedAt || startedAt.value;
            baseElapsed.value = data.elapsed || 0;
            startElapsedTimer();
            ensureAtLeastOneNote();
          } else if (data.status === "paused" || data.status === "ended") {
            status.value = data.status;
            stopElapsedTimer();
            elapsed.value = data.elapsed || elapsed.value;
            baseElapsed.value = data.elapsed || elapsed.value;
            if (data.audioTimeMappings) {
              audioTimeMappings.value = data.audioTimeMappings;
            }
            api.getAudioPath().then((path: string) => {
              if (path) audioPath.value = path;
            });
            saveNotesNow();
          }
        }),
      );

      cleanups.push(
        api.onTranscriptUpdate((data: any) => {
          if (!data.segment) return;
          const exists = transcriptSegments.value.some(
            (segment) => segment.id === data.segment.id,
          );
          if (!exists) {
            transcriptSegments.value.push(data.segment);
            latestTranscriptText.value = data.segment.text;
            partialTranscript.value = "";
          }
        }),
      );

      cleanups.push(
        api.onTranscriptPartial((data: any) => {
          if (data.text) {
            partialTranscript.value = data.text;
          }
        }),
      );

      cleanups.push(
        api.onAiNotesChunk((data: any) => {
          if (data.done) {
            if (streamingAiNote.value) {
              aiNotes.value.push({
                id: streamingAiNote.value.noteId,
                content: data.content,
                timestampMs: data.timestampMs,
                basedOnSegmentIds: [],
              });
              streamingAiNote.value = null;
            }
            return;
          }
          streamingAiNote.value = {
            noteId: data.noteId,
            content: data.content,
            timestampMs: data.timestampMs,
          };
        }),
      );

      cleanups.push(
        api.onAskResponseChunk((data: any) => {
          askResponse.value = data.content;
          if (data.done) {
            askLoading.value = false;
          }
        }),
      );

      cleanups.push(
        api.onSessionLoaded((session: any) => {
          loadSession(session);
        }),
      );

      cleanups.push(
        api.onSessionRenamed((data: any) => {
          sessionTitle.value = data?.title || "";
        }),
      );

      cleanups.push(
        api.onAiStatus((data: any) => {
          aiGenerating.value = !!data.generating;
          if (data.error) aiError.value = data.error;
          else if (!data.generating) aiError.value = "";
        }),
      );

      cleanups.push(
        api.onAiNotesCleared(() => {
          aiNotes.value = [];
          streamingAiNote.value = null;
        }),
      );

      cleanups.push(
        api.onSettingsUpdated(() => {
          api.getModelInfo().then((info: any) => {
            if (info) modelInfo.value = info;
          });
        }),
      );

      api.getSession().then((session: any) => {
        if (!session) return;
        loadSession(session);
        if (session.status === "recording") {
          startElapsedTimer();
        }
      });

      refreshProjectState();

      api.getModelInfo().then((info: any) => {
        if (info) modelInfo.value = info;
      });
    });

    onBeforeUnmount(() => {
      stopElapsedTimer();
      saveNotesNow();
      if (saveNotesTimer) clearTimeout(saveNotesTimer);
      for (const cleanup of cleanups) {
        try {
          cleanup();
        } catch {}
      }
      api?.cleanup?.();
    });

    return {
      status,
      elapsed,
      userNotes,
      transcriptSegments,
      aiNotes,
      partialTranscript,
      latestTranscriptText,
      streamingAiNote,
      askInput,
      askResponse,
      askLoading,
      sessionError,
      recentProjects,
      currentProjectPath,
      currentProjectName,
      aiGenerating,
      aiError,
      modelInfo,
      canRenameSession,
      editingSessionTitle,
      editingSessionTitleValue,
      editingTsIdx,
      editingTsValue,
      tsInputRef,
      sessionTitleInputRef,
      editingAiNoteId,
      aiNoteEditRef,
      audioSrc,
      isPlaying,
      currentTime,
      duration,
      audioProgress,
      canPlayAudio,
      statusLabel,
      notesList,
      audioEl,
      setNoteRef,
      formatTs,
      renderMd,
      isNoteActive,
      isAiNoteActive,
      isSegmentActive,
      startRecording,
      pauseRecording,
      resumeRecording,
      stopRecording,
      resetSession,
      updateNote,
      handleNoteSplit,
      handleNoteRemove,
      handleNoteIndent,
      handleNoteNavigate,
      startSessionTitleEdit,
      cancelSessionTitleEdit,
      commitSessionTitle,
      handleTimestampClick,
      commitTimestampEdit,
      seekTo,
      togglePlayback,
      onTimeUpdate,
      onMetadata,
      onAudioEnded,
      seekAudioBar,
      startEditAiNote,
      commitAiNoteEdit,
      handleAiNoteClick,
      handleTimestampContentClick,
      submitQuestion,
      regenerateAiNotes,
      exportSession,
      importSession,
      openProject,
      revealProject,
      revealCurrentProject,
      deleteProject,
      formatProjectPath,
    };
  },
});
</script>

<style>
@import "../styles/recording-notes.less";
</style>
