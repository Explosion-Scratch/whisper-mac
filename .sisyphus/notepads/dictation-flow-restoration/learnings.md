# Learnings: Dictation Flow Restoration

## Race Condition in Audio Capture
- **Issue**: `AudioCaptureService.stopCapture()` was emitting `vad-segment` asynchronously. `DictationFlowManager` was checking for segments immediately after stopping capture, often before the event handler could process the fallback segment.
- **Fix**: Modified `stopCapture` to return the `Float32Array` synchronously (via Promise) in the fallback case. This allows the caller to await and process it explicitly.

## Frontend State Mapping
- **Issue**: `dictation.js` was using a `processing` state that didn't exist in the backend enum. It also wasn't treating `transcribing` or `transforming` as "active" states for the visualizer.
- **Fix**: Updated `showVisualizer` to include `recording`, `transcribing`, `transforming`, `injecting`, `processing`.

## VAD Fallback
- **Mechanism**: If `segmentCount === 0` when stopping, the service emits the full buffer. This ensures short utterances (PTT clicks) that VAD might miss or cut off are still sent for transcription.
