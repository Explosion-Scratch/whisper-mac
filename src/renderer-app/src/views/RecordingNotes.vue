<template>
  <div class="rn-root" v-cloak>
    <div class="rn-toolbar">
      <span class="rn-toolbar-title">Recording Notes</span>
      <div class="rn-toolbar-actions" v-if="status !== 'idle'">
        <button class="rn-toolbar-btn" title="Export as zip" @click="exportSession">
          <i class="ph ph-download-simple"></i>
        </button>
        <button class="rn-toolbar-btn" title="New session" @click="resetSession">
          <i class="ph ph-plus"></i>
        </button>
      </div>
      <div class="rn-toolbar-actions" v-else>
        <button class="rn-toolbar-btn" title="Import session" @click="importSession">
          <i class="ph ph-upload-simple"></i>
        </button>
      </div>
    </div>

    <div class="rn-idle" v-if="status === 'idle'">
      <div class="rn-idle-icon">
        <i class="ph ph-microphone"></i>
      </div>
      <button class="rn-start-btn" @click="startRecording">Start Recording</button>
      <span class="rn-idle-hint">Audio will be transcribed and summarized in real time</span>
    </div>

    <template v-else>
      <div class="rn-body">
        <div class="rn-main">
          <div class="rn-main-header">
            <span class="rn-main-label">Notes</span>
          </div>
          <div class="rn-notes-list" ref="notesList">
            <div
              v-for="(note, idx) in userNotes"
              :key="note.id"
              class="rn-note-item"
              :class="{ 'rn-note-active': activeTimestamp === note.timestampMs }"
              :style="{ paddingLeft: `${16 + (note.indent || 0) * 20}px` }"
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
              <span
                v-else
                class="rn-note-timestamp"
                :class="{ 'rn-note-timestamp-clickable': true }"
                @click="handleTimestampClick(note, idx)"
              >{{ formatTs(note.timestampMs) }}</span>
              <input
                v-if="status !== 'ended' || editingTimestampIdx === idx"
                class="rn-note-input"
                :value="note.text"
                @input="updateNote(idx, ($event.target as HTMLInputElement).value)"
                @keydown="handleNoteKeydown($event, idx)"
                :ref="el => setNoteRef(el, idx)"
                placeholder="Type a note..."
              />
              <span v-else class="rn-note-text" @dblclick="editingTimestampIdx = idx">{{ note.text || '(empty)' }}</span>
              <button
                v-if="status === 'ended'"
                class="rn-note-play-btn"
                @click="seekTo(note.timestampMs)"
                title="Play from here"
              >
                <i class="ph ph-play"></i>
              </button>
            </div>
          </div>
          <div class="rn-audio-controls" v-if="status === 'ended' && audioPath">
            <button class="rn-audio-play-btn" @click="togglePlayback">
              <i :class="isPlaying ? 'ph ph-pause' : 'ph ph-play'"></i>
            </button>
            <span class="rn-audio-time">{{ formatTs(Math.round(currentTime * 1000)) }}</span>
            <div class="rn-audio-bar" @click="seekAudioBar($event)">
              <div class="rn-audio-progress" :style="{ width: audioProgress + '%' }"></div>
            </div>
            <span class="rn-audio-time">{{ formatTs(Math.round(duration * 1000)) }}</span>
          </div>
        </div>

        <div class="rn-sidebar">
          <div class="rn-sidebar-section">
            <div class="rn-recording-indicator">
              <span
                class="rn-recording-dot"
                :class="{
                  'rn-recording-dot-paused': status === 'paused',
                  'rn-recording-dot-stopped': status === 'ended',
                }"
              ></span>
              <span v-if="status === 'recording'">Recording</span>
              <span v-else-if="status === 'paused'">Paused</span>
              <span v-else>Ended</span>
              <span class="rn-elapsed">{{ formatTs(elapsed) }}</span>
              <template v-if="status === 'recording'">
                <button class="rn-toolbar-btn" @click="pauseRecording" title="Pause">
                  <i class="ph ph-pause"></i>
                </button>
                <button class="rn-stop-btn" @click="stopRecording">End</button>
              </template>
              <template v-else-if="status === 'paused'">
                <button class="rn-toolbar-btn" @click="resumeRecording" title="Resume">
                  <i class="ph ph-play"></i>
                </button>
                <button class="rn-stop-btn" @click="stopRecording">End</button>
              </template>
              <template v-else-if="status === 'ended'">
                <button class="rn-toolbar-btn" @click="resumeRecording" title="Continue recording">
                  <i class="ph ph-microphone"></i>
                </button>
              </template>
            </div>
            <div class="rn-model-info" v-if="modelInfo">
              <span>{{ modelInfo.transcriptionPlugin }}</span>
              <span v-if="modelInfo.aiEnabled" class="rn-model-sep"> · </span>
              <span v-if="modelInfo.aiEnabled">{{ modelInfo.aiModel }}</span>
            </div>
          </div>

          <div class="rn-sidebar-section" v-if="status === 'recording'">
            <div class="rn-sidebar-label">Transcript</div>
            <div class="rn-transcript-line">{{ partialTranscript || latestTranscriptText || 'Listening...' }}</div>
          </div>

          <div class="rn-sidebar-section" v-if="(status === 'ended' || status === 'paused') && transcriptSegments.length > 0">
            <div class="rn-sidebar-label">Transcript</div>
            <div class="rn-transcript-full">
              <div
                v-for="seg in transcriptSegments"
                :key="seg.id"
                class="rn-transcript-seg"
                :class="{ 'rn-active-seg': activeTimestamp === seg.startMs }"
                @click="seekTo(seg.startMs)"
              >
                <span class="rn-transcript-seg-time">{{ formatTs(seg.startMs) }}</span>
                {{ seg.text }}
              </div>
            </div>
          </div>

          <div class="rn-sidebar-section-grow">
            <div class="rn-sidebar-label">
              AI Notes
              <span v-if="aiGenerating" class="rn-ai-status-badge"><span class="rn-ask-spinner"></span> Generating</span>
              <button
                v-if="transcriptSegments.length > 0 && !aiGenerating"
                class="rn-ai-retry-btn"
                title="Regenerate all AI notes"
                @click="regenerateAiNotes"
              >
                <i class="ph ph-arrows-clockwise"></i>
              </button>
            </div>
            <div v-if="aiError" class="rn-ai-error" @click="aiError = ''">{{ aiError }}</div>
            <div v-if="aiNotes.length === 0 && !streamingAiNote && !aiGenerating" style="font-size: var(--font-size-sm); color: var(--color-text-tertiary);">
              Notes will appear as the transcript grows...
            </div>
            <div v-for="note in aiNotes" :key="note.id" class="rn-ai-note">
              <div class="rn-ai-note-time" @click="seekTo(note.timestampMs)">
                {{ formatTs(note.timestampMs) }}
              </div>
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
                @click="startEditAiNote(note.id)"
                v-html="renderMd(note.content)"
              ></div>
            </div>
            <div v-if="streamingAiNote" class="rn-ai-note">
              <div class="rn-ai-note-time">{{ formatTs(streamingAiNote.timestampMs) }}</div>
              <div class="rn-ai-note-content" v-html="renderMd(streamingAiNote.content)"></div>
            </div>
          </div>

          <div class="rn-ask-section">
            <div class="rn-ask-input-wrap">
              <input
                class="rn-ask-input"
                v-model="askInput"
                placeholder="Ask about your notes..."
                @keydown.enter="submitQuestion"
                :disabled="askLoading"
              />
              <button
                class="rn-ask-send"
                :disabled="!askInput.trim() || askLoading"
                @click="submitQuestion"
              >
                <template v-if="askLoading">
                  <span class="rn-ask-spinner"></span>
                </template>
                <template v-else>Ask</template>
              </button>
            </div>
            <div class="rn-ask-response" v-if="askResponse" v-html="renderMd(askResponse)"></div>
          </div>
        </div>
      </div>
    </template>

    <audio ref="audioEl" :src="audioSrc" @timeupdate="onTimeUpdate" @ended="isPlaying = false" @loadedmetadata="onMetadata"></audio>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, nextTick, onMounted, onBeforeUnmount, computed } from 'vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

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

type SessionStatus = 'idle' | 'recording' | 'paused' | 'ended';

const api = (window as any).recordingNotesAPI;

let noteIdCounter = 0;
function makeNoteId(): string {
  return `note-${Date.now()}-${++noteIdCounter}`;
}

function formatTs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export default defineComponent({
  name: 'RecordingNotes',
  setup() {
    const status = ref<SessionStatus>('idle');
    const startedAt = ref(0);
    const elapsed = ref(0);
    const baseElapsed = ref(0);
    const userNotes = ref<UserNote[]>([]);
    const transcriptSegments = ref<TranscriptSegment[]>([]);
    const aiNotes = ref<AiNote[]>([]);
    const partialTranscript = ref('');
    const latestTranscriptText = ref('');
    const streamingAiNote = ref<{ noteId: string; content: string; timestampMs: number } | null>(null);
    const activeTimestamp = ref<number | null>(null);
    const editingTimestampIdx = ref<number | null>(null);

    const askInput = ref('');
    const askResponse = ref('');
    const askLoading = ref(false);

    const aiGenerating = ref(false);
    const aiError = ref('');
    const modelInfo = ref<{ transcriptionPlugin: string; aiModel: string; aiEnabled: boolean } | null>(null);
    const editingTsIdx = ref<number | null>(null);
    const editingTsValue = ref('');
    const tsInputRef = ref<HTMLInputElement | null>(null);
    const editingAiNoteId = ref<string | null>(null);
    const aiNoteEditRef = ref<HTMLTextAreaElement | null>(null);

    const audioPath = ref('');
    const audioSrc = computed(() => (audioPath.value ? `file://${audioPath.value}` : ''));
    const isPlaying = ref(false);
    const currentTime = ref(0);
    const duration = ref(0);
    const audioProgress = computed(() => (duration.value > 0 ? (currentTime.value / duration.value) * 100 : 0));
    const audioTimeMappings = ref<AudioTimeMapping[]>([]);

    const notesList = ref<HTMLElement | null>(null);
    const audioEl = ref<HTMLAudioElement | null>(null);
    const noteRefs: Record<number, HTMLInputElement | null> = {};

    let elapsedTimer: ReturnType<typeof setInterval> | null = null;
    const cleanups: (() => void)[] = [];

    function setNoteRef(el: any, idx: number) {
      noteRefs[idx] = el as HTMLInputElement;
    }

    function renderMd(text: string): string {
      if (!text) return '';
      const html = marked.parse(text, { async: false }) as string;
      return DOMPurify.sanitize(html);
    }

    function wallClockToAudioMs(wallClockMs: number): number {
      const mappings = audioTimeMappings.value;
      if (mappings.length === 0) return wallClockMs;

      for (const m of mappings) {
        if (wallClockMs >= m.wallClockMs && wallClockMs < m.wallClockMs + m.durationMs) {
          return m.audioFileMs + (wallClockMs - m.wallClockMs);
        }
      }

      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < mappings.length; i++) {
        const dist = Math.min(
          Math.abs(wallClockMs - mappings[i].wallClockMs),
          Math.abs(wallClockMs - (mappings[i].wallClockMs + mappings[i].durationMs))
        );
        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
      }
      const closest = mappings[bestIdx];
      return wallClockMs < closest.wallClockMs
        ? closest.audioFileMs
        : closest.audioFileMs + closest.durationMs;
    }

    function startElapsedTimer() {
      if (elapsedTimer) clearInterval(elapsedTimer);
      const wallStart = Date.now();
      elapsedTimer = setInterval(() => {
        elapsed.value = baseElapsed.value + (Date.now() - wallStart);
      }, 500);
    }

    function stopElapsedTimer() {
      if (elapsedTimer) {
        clearInterval(elapsedTimer);
        elapsedTimer = null;
      }
    }

    async function startRecording() {
      const result = await api.startRecording();
      if (!result.success) return;
      status.value = 'recording';
      startedAt.value = Date.now();
      baseElapsed.value = 0;
      elapsed.value = 0;
      userNotes.value = [{ id: makeNoteId(), text: '', timestampMs: 0, indent: 0 }];
      transcriptSegments.value = [];
      aiNotes.value = [];
      partialTranscript.value = '';
      latestTranscriptText.value = '';
      streamingAiNote.value = null;
      askResponse.value = '';
      audioPath.value = '';
      editingTimestampIdx.value = null;
      audioTimeMappings.value = [];

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
        const startResult = await api.startRecording();
        if (!startResult.success) return;
      }
    }

    async function stopRecording() {
      await api.stopRecording();
    }

    async function resetSession() {
      if (status.value === 'recording') return;
      await api.resetSession();
      status.value = 'idle';
      stopElapsedTimer();
      userNotes.value = [];
      transcriptSegments.value = [];
      aiNotes.value = [];
      partialTranscript.value = '';
      latestTranscriptText.value = '';
      streamingAiNote.value = null;
      askResponse.value = '';
      audioPath.value = '';
      elapsed.value = 0;
      baseElapsed.value = 0;
      isPlaying.value = false;
      currentTime.value = 0;
      duration.value = 0;
      editingTimestampIdx.value = null;
      audioTimeMappings.value = [];
      aiGenerating.value = false;
      aiError.value = '';
    }

    function updateNote(idx: number, text: string) {
      userNotes.value[idx].text = text;
    }

    function handleNoteKeydown(event: KeyboardEvent, idx: number) {
      if (event.key === 'Tab') {
        event.preventDefault();
        const note = userNotes.value[idx];
        if (event.shiftKey) {
          note.indent = Math.max(0, (note.indent || 0) - 1);
        } else {
          note.indent = Math.min(5, (note.indent || 0) + 1);
        }
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        const ts = status.value === 'recording' ? elapsed.value : elapsed.value;
        const parentIndent = userNotes.value[idx].indent || 0;
        const newNote: UserNote = { id: makeNoteId(), text: '', timestampMs: ts, indent: parentIndent };
        userNotes.value.splice(idx + 1, 0, newNote);
        nextTick(() => focusNote(idx + 1));
      } else if (event.key === 'Backspace' && userNotes.value[idx].text === '' && userNotes.value.length > 1) {
        event.preventDefault();
        userNotes.value.splice(idx, 1);
        const focusIdx = Math.max(0, idx - 1);
        nextTick(() => focusNote(focusIdx));
      } else if (event.key === 'ArrowUp' && idx > 0) {
        event.preventDefault();
        focusNote(idx - 1);
      } else if (event.key === 'ArrowDown' && idx < userNotes.value.length - 1) {
        event.preventDefault();
        focusNote(idx + 1);
      }
    }

    function focusNote(idx: number) {
      const el = noteRefs[idx];
      if (el) {
        el.focus();
        const len = el.value?.length ?? 0;
        el.setSelectionRange(len, len);
      }
    }

    function saveNotes() {
      api.saveNotes(JSON.parse(JSON.stringify(userNotes.value)));
    }

    function startEditAiNote(noteId: string) {
      editingAiNoteId.value = noteId;
      nextTick(() => {
        const el = aiNoteEditRef.value as any;
        if (el) {
          const textarea = Array.isArray(el) ? el[0] : el;
          textarea?.focus?.();
          if (textarea) textarea.style.height = textarea.scrollHeight + 'px';
        }
      });
    }

    function commitAiNoteEdit(noteId: string, newText: string) {
      const note = aiNotes.value.find(n => n.id === noteId);
      if (note && newText.trim() !== note.content) {
        note.content = newText.trim();
        api.saveAiNotes(JSON.parse(JSON.stringify(aiNotes.value)));
      }
      editingAiNoteId.value = null;
    }

    function updateAiNote(noteId: string, newText: string) {
      const note = aiNotes.value.find(n => n.id === noteId);
      if (note) {
        note.content = newText;
        api.saveAiNotes(JSON.parse(JSON.stringify(aiNotes.value)));
      }
    }

    function handleTimestampClick(note: UserNote, idx: number) {
      if (status.value === 'ended') {
        seekTo(note.timestampMs);
      } else {
        editingTsIdx.value = idx;
        editingTsValue.value = formatTs(note.timestampMs);
        nextTick(() => {
          if (tsInputRef.value) {
            (tsInputRef.value as any)?.select?.();
            (tsInputRef.value as any)?.focus?.();
          }
        });
      }
    }

    function parseTimestampInput(input: string): number | null {
      const match = input.trim().match(/^(\d{1,2}):(\d{2})$/);
      if (!match) return null;
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      if (seconds >= 60) return null;
      return (minutes * 60 + seconds) * 1000;
    }

    function commitTimestampEdit(idx: number) {
      if (editingTsIdx.value !== idx) return;
      const parsed = parseTimestampInput(editingTsValue.value);
      if (parsed !== null) {
        userNotes.value[idx].timestampMs = parsed;
      }
      editingTsIdx.value = null;
    }

    function seekTo(ms: number) {
      activeTimestamp.value = ms;
      if (status.value === 'ended' && audioEl.value && audioPath.value) {
        const seg = transcriptSegments.value.find(s => s.startMs === ms);
        const audioMs = seg?.audioOffsetMs != null ? seg.audioOffsetMs : wallClockToAudioMs(ms);
        audioEl.value.currentTime = audioMs / 1000;
        if (!isPlaying.value) {
          audioEl.value.play();
          isPlaying.value = true;
        }
      }
    }

    function togglePlayback() {
      if (!audioEl.value) return;
      if (isPlaying.value) {
        audioEl.value.pause();
        isPlaying.value = false;
      } else {
        audioEl.value.play();
        isPlaying.value = true;
      }
    }

    function onTimeUpdate() {
      if (audioEl.value) {
        currentTime.value = audioEl.value.currentTime;
      }
    }

    function onMetadata() {
      if (audioEl.value) {
        duration.value = audioEl.value.duration;
      }
    }

    function seekAudioBar(event: MouseEvent) {
      if (!audioEl.value || duration.value === 0) return;
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      audioEl.value.currentTime = ratio * duration.value;
    }

    async function submitQuestion() {
      const q = askInput.value.trim();
      if (!q || askLoading.value) return;
      askLoading.value = true;
      askResponse.value = '';
      saveNotes();
      console.log('[RecordingNotes] Submitting question:', q);
      try {
        await api.askQuestion(q);
      } catch (err: any) {
        console.error('[RecordingNotes] Ask question error:', err);
        askResponse.value = `Error: ${err.message || String(err)}`;
        askLoading.value = false;
      }
    }

    async function regenerateAiNotes() {
      if (!confirm('Regenerate all AI notes? This will replace existing AI notes.')) return;
      aiNotes.value = [];
      streamingAiNote.value = null;
      aiError.value = '';
      try {
        await api.regenerateAiNotes();
      } catch (err: any) {
        aiError.value = `Regeneration failed: ${err.message || String(err)}`;
      }
    }

    async function exportSession() {
      try {
        saveNotes();
        const zipPath = await api.exportZip();
        if (zipPath) {
          console.log('[RecordingNotes] Exported to:', zipPath);
        }
      } catch (err) {
        console.error('[RecordingNotes] Export error:', err);
      }
    }

    async function importSession() {
      try {
        const result = await api.importZip();
        if (!result.success) {
          console.log('[RecordingNotes] Import:', result.error);
        }
      } catch (err) {
        console.error('[RecordingNotes] Import error:', err);
      }
    }

    function loadSession(session: any) {
      status.value = session.status || 'ended';
      transcriptSegments.value = session.segments || [];
      userNotes.value = (session.userNotes || []).map((n: any) => ({
        ...n,
        indent: n.indent || 0,
      }));
      aiNotes.value = session.aiNotes || [];
      elapsed.value = session.totalRecordedMs || 0;
      baseElapsed.value = session.totalRecordedMs || 0;
      audioPath.value = session.audioPath || '';
      audioTimeMappings.value = session.audioTimeMappings || [];
      if (transcriptSegments.value.length > 0) {
        latestTranscriptText.value = transcriptSegments.value[transcriptSegments.value.length - 1].text;
      }
    }

    onMounted(() => {
      if (!api) return;

      cleanups.push(api.onStatus((data: any) => {
        if (data.modelInfo) modelInfo.value = data.modelInfo;
        if (data.status === 'recording') {
          status.value = 'recording';
          startedAt.value = data.startedAt;
          baseElapsed.value = data.elapsed || 0;
          startElapsedTimer();
        } else if (data.status === 'paused') {
          status.value = 'paused';
          stopElapsedTimer();
          elapsed.value = data.elapsed || elapsed.value;
          baseElapsed.value = data.elapsed || elapsed.value;
          if (data.audioTimeMappings) audioTimeMappings.value = data.audioTimeMappings;
          api.getAudioPath().then((path: string) => { if (path) audioPath.value = path; });
          saveNotes();
        } else if (data.status === 'ended') {
          status.value = 'ended';
          stopElapsedTimer();
          elapsed.value = data.elapsed || elapsed.value;
          baseElapsed.value = data.elapsed || elapsed.value;
          if (data.audioTimeMappings) audioTimeMappings.value = data.audioTimeMappings;
          api.getAudioPath().then((path: string) => { if (path) audioPath.value = path; });
          saveNotes();
        }
      }));

      cleanups.push(api.onTranscriptUpdate((data: any) => {
        if (data.segment) {
          const exists = transcriptSegments.value.some(s => s.id === data.segment.id);
          if (!exists) {
            transcriptSegments.value.push(data.segment);
            latestTranscriptText.value = data.segment.text;
            partialTranscript.value = '';
          }
        }
      }));

      cleanups.push(api.onTranscriptPartial((data: any) => {
        if (data.text) {
          partialTranscript.value = data.text;
        }
      }));

      cleanups.push(api.onAiNotesChunk((data: any) => {
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
        } else {
          streamingAiNote.value = {
            noteId: data.noteId,
            content: data.content,
            timestampMs: data.timestampMs,
          };
        }
      }));

      cleanups.push(api.onAskResponseChunk((data: any) => {
        askResponse.value = data.content;
        if (data.done) {
          askLoading.value = false;
        }
      }));

      cleanups.push(api.onSessionLoaded((session: any) => {
        loadSession(session);
      }));

      cleanups.push(api.onAiStatus((data: any) => {
        aiGenerating.value = !!data.generating;
        if (data.error) aiError.value = data.error;
        else if (!data.generating) aiError.value = '';
      }));

      cleanups.push(api.onAiNotesCleared(() => {
        aiNotes.value = [];
        streamingAiNote.value = null;
      }));

      cleanups.push(api.onSettingsUpdated(() => {
        api.getModelInfo().then((info: any) => {
          if (info) modelInfo.value = info;
        });
      }));

      api.getModelInfo().then((info: any) => {
        if (info) modelInfo.value = info;
      });
    });

    onBeforeUnmount(() => {
      stopElapsedTimer();
      for (const c of cleanups) { try { c(); } catch {} }
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
      activeTimestamp,
      editingTimestampIdx,
      askInput,
      askResponse,
      askLoading,
      aiGenerating,
      aiError,
      modelInfo,
      editingTsIdx,
      editingTsValue,
      tsInputRef,
      editingAiNoteId,
      aiNoteEditRef,
      audioPath,
      audioSrc,
      isPlaying,
      currentTime,
      duration,
      audioProgress,
      notesList,
      audioEl,
      setNoteRef,
      formatTs,
      renderMd,
      startRecording,
      pauseRecording,
      resumeRecording,
      stopRecording,
      resetSession,
      updateNote,
      handleNoteKeydown,
      updateAiNote,
      startEditAiNote,
      commitAiNoteEdit,
      handleTimestampClick,
      commitTimestampEdit,
      seekTo,
      togglePlayback,
      onTimeUpdate,
      onMetadata,
      seekAudioBar,
      submitQuestion,
      regenerateAiNotes,
      exportSession,
      importSession,
    };
  },
});
</script>

<style>
@import "../styles/recording-notes.less";
</style>
