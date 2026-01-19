# Plan: Dictation Flow Restoration

## Context

### Original Request
Restore the "old" dictation behavior where:
1.  **PTT Fallback**: Releasing Push-to-Talk (PTT) without detecting VAD segments should transcribe the *entire* audio buffer.
2.  **Window Persistence**: The window must NOT hide/close while transcribing, transforming, or injecting.
3.  **UI Consistency**:
    - User Speaking → **Visualizer**
    - User Silent + Text → **Text**
    - User Silent + No Text → **Visualizer + Mic Icon** (representing "Listening")

### Technical Diagnosis
1.  **Race Condition**: `DictationFlowManager` checks for segments to process *immediately* after stopping capture. The "fallback audio" (full buffer) is emitted asynchronously via event, arriving *after* the check fails and the window closes.
2.  **Frontend State Mismatch**: `dictation.js` relies on a `processing` state that doesn't exist in the backend `DictationStatus` enum, causing UI inconsistencies.
3.  **UI Logic**: The "Listening" state is correctly implemented as "Visualizer active", but needs to be robust against the "no text yet" state.

### Design Decisions
-   **Synchronous Fallback**: `AudioCaptureService.stopCapture()` will be refactored to **return** the fallback audio (if applicable) instead of just emitting it. This allows `DictationFlowManager` to process it *await*-ed in the same tick, eliminating the race condition.
-   **Strict State Mapping**: Frontend will be updated to handle `transcribing` and `transforming` as active states (equivalent to the old "processing"), keeping the visualizer active if needed or showing loading indicators.
-   **Audio Backend**: Audio recording remains 100% in the backend (Node.js/Electron main process), per constraints.

---

## Work Objectives

### Core Objective
Eliminate the race condition causing PTT fallback failure and prevent premature window closure.

### Concrete Deliverables
-   Modified `src/services/AudioCaptureService.ts`: `stopCapture` returns `Promise<Float32Array | null>`.
-   Modified `src/core/DictationFlowManager.ts`: Handles returned audio from `stopCapture`.
-   Modified `src/renderer-app/src/scripts/dictation.js`: Updates status handling.

### Must Have
-   PTT release with 0 segments -> Transcribes full buffer.
-   Window stays visible until `injection` is complete or `complete` state is reached.
-   "Listening" state shown as Visualizer + Mic Icon (no "Listening..." text).

### Must NOT Have
-   Any changes to the VAD model or audio recording libraries.
-   Moving audio capture to the frontend.

---

## Verification Strategy

### Manual Verification Procedures

**1. PTT Fallback Test**
-   **Action**: Hold global PTT key. Say "Testing fallback". Release key *immediately* (try to keep it under 1s to trigger "no VAD segment" logic).
-   **Expected**:
    -   Window stays open.
    -   Visualizer freezes/updates.
    -   Text "Testing fallback" appears.
    -   Text is injected.
    -   Window hides (after delay).
-   **Failure**: Window closes immediately upon release, no text.

**2. Window Persistence Test**
-   **Action**: Dictate a long sentence. Stop.
-   **Expected**: Window remains visible during "Transcribing..." and "Transforming..." phases.
-   **Failure**: Window flickers or hides during processing.

**3. Visualizer UI Test**
-   **Action**: Open dictation (Trigger). Remain silent.
-   **Expected**: Visualizer (flat line) + Mic icon visible.
-   **Action**: Speak.
-   **Expected**: Visualizer moves.
-   **Action**: Stop speaking (Text appears).
-   **Expected**: Text replaces visualizer.

---

## Task Flow

```
AudioCaptureService (Return Value) → DictationFlowManager (Await Audio) → Frontend (State Alignment)
```

---

## TODOs

- [x] 1. Refactor `AudioCaptureService.stopCapture` to return audio
    -   **File**: `src/services/AudioCaptureService.ts`
    -   **Action**: Modify `stopCapture()` signature to return `Promise<Float32Array | null>`.
    -   **Logic**:
        -   Keep existing event emission for compatibility.
        -   If `segmentCount === 0` (Fallback case): Return the `fullAudio` buffer.
        -   If segments existed: Return `null` (or the tail if needed, but primary focus is fallback).
    -   **References**:
        -   `src/services/AudioCaptureService.ts:122` - Current `stopCapture` implementation.
        -   `src/services/AudioCaptureService.ts:172` - Current fallback logic.

- [x] 2. Eliminate Race Condition in `DictationFlowManager`
    -   **File**: `src/core/DictationFlowManager.ts`
    -   **Action**: Update `finishCurrentDictation()` to handle the returned audio.
    -   **Logic**:
        ```typescript
        const fallbackAudio = await this.audioCaptureService.stopCapture();
        if (fallbackAudio) {
             console.log("Processing fallback audio from PTT...");
             await this.processVadAudioSegment(fallbackAudio);
        }
        // ONLY THEN check hasSegmentsToProcess()
        ```
    -   **References**:
        -   `src/core/DictationFlowManager.ts` - `finishCurrentDictation` method (approx line 140-160).
        -   `src/services/AudioCaptureService.ts` - The method we just modified.

- [x] 3. Fix Frontend State & Visualizer Logic
    -   **File**: `src/renderer-app/src/scripts/dictation.js`
    -   **Action**: Align `currentStatus` handling.
    -   **Logic**:
        -   Ensure `transcribing`, `transforming`, `injecting` are treated as "active" states (keeping window open/visualizer potentially active if no text).
        -   Update `showVisualizer` computed property:
            ```javascript
            return (currentStatus.value === 'recording' || isSpeaking.value) && displaySegments.value.length === 0;
            ```
            (Ensure it matches "User Silent + No Text -> Show Visualizer").
    -   **References**:
        -   `src/renderer-app/src/scripts/dictation.js:46` - Current `showVisualizer` logic.
        -   `src/services/DictationWindowService.ts:14` - `DictationStatus` enum definition.

- [x] 4. Verify Window Closing Logic
    -   **File**: `src/services/DictationWindowService.ts`
    -   **Action**: Audit `closeDictationWindow` vs `hideAndReloadWindow`.
    -   **Check**: Ensure `DictationFlowManager` only calls cancellation/closing when `finishCurrentDictation` explicitly fails or completes. (This is largely covered by Task 2, but a double-check is needed).
    -   **References**:
        -   `src/services/DictationWindowService.ts:341` - `closeDictationWindow`.

## Success Criteria
- [ ] PTT Release on empty buffer -> Full transcription occurs.
- [ ] Window never hides during active processing states.
- [ ] "Listening" state (Silent/No Text) correctly shows visualizer/icon.
