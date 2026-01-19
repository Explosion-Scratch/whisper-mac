# Fix Push-to-Talk Transcription Issues

## Context

### Original Request
User reports two issues with push-to-talk transcription:
1. When no VAD segments are detected, the same segment gets transcribed twice
2. Sometimes the window closes with no transcription despite detecting VAD segments throughout recording

### Interview Summary
**Key Discussions:**
- Issue occurs specifically with push-to-talk mode, not continuous dictation
- Problem 1: Duplicate processing of audio when VAD fails to detect speech segments
- Problem 2: Race condition where transcription completes after window timeout/hide

**Research Findings:**
- AudioCaptureService.stopCapture() emits "vad-segment" event when no VAD segments detected
- DictationFlowManager.finishCurrentDictation() also processes the returned audio from stopCapture()
- This creates double processing in the "no VAD segments" case
- Window close timing may not wait for all async transcription to complete

### Metis Review
**Identified Gaps** (addressed):
- Double processing in AudioCaptureService.stopCapture() and DictationFlowManager.finishCurrentDictation()
- Race condition between transcription completion and window hiding
- Missing synchronization between VAD event emission and transcription processing

---

## Work Objectives

### Core Objective
Fix duplicate transcription and premature window closing in push-to-talk mode by eliminating double audio processing and ensuring transcription completes before window hides.

### Concrete Deliverables
- Modified AudioCaptureService.stopCapture() to not emit events for returned audio
- Updated DictationFlowManager.finishCurrentDictation() to handle PTT case properly  
- Added synchronization to ensure transcription completes before window close

### Definition of Done
- [ ] Push-to-talk with no speech detected transcribes exactly once
- [ ] Push-to-talk with VAD segments waits for transcription completion before closing
- [ ] No regression in continuous dictation mode

### Must Have
- Eliminate double audio processing in PTT fallback case
- Ensure transcription completion before window hide in PTT
- Maintain existing behavior for continuous dictation

### Must NOT Have (Guardrails)
- No changes to VAD detection logic
- No changes to continuous dictation flow
- No breaking changes to public APIs

---

## Verification Strategy (MANDATORY)

### Test Decision
- **Infrastructure exists**: NO (no test framework detected)
- **User wants tests**: NO (manual verification specified)
- **QA approach**: Manual verification

### Manual QA Procedures

Each change includes detailed verification procedures:

**For Audio Processing Changes:**
- [ ] Record push-to-talk session with no speech (background noise only)
- [ ] Verify exactly one transcription result in logs
- [ ] Verify no duplicate "vad-segment" events emitted

**For Window Timing Changes:**
- [ ] Record push-to-talk session with clear speech segments
- [ ] Verify transcription completes before window closes
- [ ] Verify transcribed text appears in target application

**For Regression Testing:**
- [ ] Test continuous dictation mode still works
- [ ] Test normal push-to-talk with speech works
- [ ] Test push-to-talk cancellation works

---

## Task Flow

```
1. Fix Double Processing → 2. Fix Window Timing → 3. Verify No Regressions
```

---

## TODOs

- [ ] 1. Fix double audio processing in push-to-talk fallback case

  **What to do**:
  - Modify AudioCaptureService.stopCapture() to not emit "vad-segment" for fallback audio
  - Return fallback audio without triggering event emission
  - Update DictationFlowManager to handle the returned audio properly

  **Must NOT do**:
  - Don't change VAD segment detection logic
  - Don't affect continuous dictation mode

  **Parallelizable**: NO (depends on understanding current flow)

  **References** (CRITICAL - Be Exhaustive):
  
  **Pattern References** (existing code to follow):
  - `src/services/AudioCaptureService.ts:173-195` - Current stopCapture() fallback logic (CASE: No segments detected)
  - `src/core/DictationFlowManager.ts:147-152` - Current double processing location
  
  **API/Type References** (contracts to implement against):
  - `src/services/AudioCaptureService.ts:22-23` - EventEmitter interface for "vad-segment" events
  
  **Documentation References** (specs and requirements):
  - CLAUDE.md: "Voice Processing Pipeline" section describing expected flow
  
  **WHY Each Reference Matters** (explain the relevance):
  - `src/services/AudioCaptureService.ts:173-195` - Shows current fallback emission logic that needs to be modified
  - `src/core/DictationFlowManager.ts:147-152` - Shows where returned audio gets processed again, creating duplication
  - `src/services/AudioCaptureService.ts:22-23` - Defines the event contract that should be maintained
  - CLAUDE.md - Documents expected behavior for verification

  **Acceptance Criteria**:
  
  **Manual Execution Verification (ALWAYS include, even with tests):**
  
  **For Push-to-Talk Testing:**
  - [ ] Start app and configure push-to-talk hotkey
  - [ ] Record 5-second session with no speech (just background noise)
  - [ ] Check console logs for "vad-segment" events: should see exactly 1 event
  - [ ] Check transcription results: should see exactly 1 transcription result
  - [ ] Verify no duplicate transcriptions in target application
  
  **Evidence Required:**
  - [ ] Console log output showing single "vad-segment" emission
  - [ ] Screenshot of transcription result in target app
  - [ ] Log excerpt showing no duplicate processing

  **Commit**: YES
  - Message: `fix: eliminate double audio processing in PTT fallback`
  - Files: `src/services/AudioCaptureService.ts`, `src/core/DictationFlowManager.ts`

- [ ] 2. Fix premature window closing in push-to-talk with VAD segments

  **What to do**:
  - Modify DictationFlowManager.finishCurrentDictation() to better wait for transcription completion
  - Add synchronization to ensure all segments are transcribed before window hide
  - Handle PTT-specific timing requirements

  **Must NOT do**:
  - Don't change window display timing
  - Don't affect continuous dictation window behavior

  **Parallelizable**: NO (depends on previous fix)

  **References** (CRITICAL - Be Exhaustive):
  
  **Pattern References** (existing code to follow):
  - `src/core/DictationFlowManager.ts:198-199` - Current waitForCompletedSegments() call
  - `src/core/DictationFlowManager.ts:226-234` - Current window hide timing logic
  - `src/services/SegmentManager.ts:575-585` - waitForCompletedSegments implementation
  
  **API/Type References** (contracts to implement against):
  - `src/types/SegmentTypes.ts` - Segment completion state definitions
  
  **Documentation References** (specs and requirements):
  - CLAUDE.md: "Voice Processing Pipeline" section
  
  **WHY Each Reference Matters** (explain the relevance):
  - `src/core/DictationFlowManager.ts:198-199` - Shows current wait logic that may timeout too early
  - `src/core/DictationFlowManager.ts:226-234` - Shows window hide logic that needs PTT-specific handling
  - `src/services/SegmentManager.ts:575-585` - Shows how segment completion waiting works
  - `src/types/SegmentTypes.ts` - Defines what constitutes a "completed" segment

  **Acceptance Criteria**:
  
  **Manual Execution Verification (ALWAYS include, even with tests):**
  
  **For Push-to-Talk with Speech Testing:**
  - [ ] Start app and configure push-to-talk hotkey
  - [ ] Record session with clear speech segments (say "Hello world test")
  - [ ] Verify window stays open until transcription completes
  - [ ] Verify transcribed text "Hello world test" appears in target application
  - [ ] Check logs show transcription completed before window hide
  
  **Evidence Required:**
  - [ ] Screenshot of dictation window showing transcription progress
  - [ ] Screenshot of final transcribed text in target application
  - [ ] Log excerpt showing transcription completion timing vs window hide timing

  **Commit**: YES
  - Message: `fix: ensure transcription completes before PTT window closes`
  - Files: `src/core/DictationFlowManager.ts`

- [ ] 3. Verify no regressions in continuous dictation and other modes

  **What to do**:
  - Test continuous dictation mode still works correctly
  - Test normal push-to-talk cancellation
  - Test edge cases and error conditions

  **Must NOT do**:
  - Don't introduce new bugs in existing functionality

  **Parallelizable**: NO (depends on previous fixes)

  **References** (CRITICAL - Be Exhaustive):
  
  **Pattern References** (existing code to follow):
  - `src/core/DictationFlowManager.ts:59-108` - startDictation() flow for continuous mode
  - `src/core/DictationFlowManager.ts:119-117` - stopDictation() vs finishCurrentDictation()
  - `src/core/PushToTalkManager.ts:414-437` - PTT cancellation logic
  
  **API/Type References** (contracts to implement against):
  - `src/core/DictationFlowManager.ts:45-52` - isRecording() and isFinishing() state checks
  
  **Documentation References** (specs and requirements):
  - CLAUDE.md: "Data Flow" section describing dictation workflow
  
  **WHY Each Reference Matters** (explain the relevance):
  - `src/core/DictationFlowManager.ts:59-108` - Shows continuous dictation startup that should remain unchanged
  - `src/core/DictationFlowManager.ts:119-117` - Shows difference between stop and finish that should be preserved
  - `src/core/PushToTalkManager.ts:414-437` - Shows PTT cancellation that should still work
  - `src/core/DictationFlowManager.ts:45-52` - Shows state management that should remain consistent

  **Acceptance Criteria**:
  
  **Manual Execution Verification (ALWAYS include, even with tests):**
  
  **For Continuous Dictation Testing:**
  - [ ] Start continuous dictation mode
  - [ ] Speak multiple segments with pauses
  - [ ] Use toggle hotkey to finish dictation
  - [ ] Verify all segments transcribed and injected properly
  
  **For Push-to-Talk Cancellation Testing:**
  - [ ] Start push-to-talk session
  - [ ] Release hotkey before speaking
  - [ ] Verify no transcription occurs and window closes cleanly
  
  **For Error Case Testing:**
  - [ ] Test transcription plugin failure scenarios
  - [ ] Test audio capture failure scenarios
  - [ ] Verify graceful error handling in all modes
  
  **Evidence Required:**
  - [ ] Screenshots/logs from continuous dictation test
  - [ ] Screenshots/logs from PTT cancellation test
  - [ ] Error logs from failure scenario tests

  **Commit**: YES
  - Message: `test: verify no regressions in dictation modes`
  - Files: (testing only, no code changes)

---

## Commit Strategy

| After Task | Message | Files | Verification |
|------------|---------|-------|--------------|
| 1 | `fix: eliminate double audio processing in PTT fallback` | src/services/AudioCaptureService.ts, src/core/DictationFlowManager.ts | Manual testing of PTT with no speech |
| 2 | `fix: ensure transcription completes before PTT window closes` | src/core/DictationFlowManager.ts | Manual testing of PTT with speech |
| 3 | `test: verify no regressions in dictation modes` | (none) | Manual testing of all dictation modes |

---

## Success Criteria

### Verification Commands
```bash
# Test PTT with no speech
bun run build
# 1. Configure PTT hotkey in settings
# 2. Record 5 seconds of silence
# 3. Check logs for single vad-segment event
# 4. Verify single transcription result

# Test PTT with speech  
bun run build
# 1. Configure PTT hotkey in settings
# 2. Record session saying "test message"
# 3. Verify window waits for transcription
# 4. Verify text appears in target app

# Test continuous dictation
bun run build
# 1. Start continuous dictation
# 2. Speak "first segment" + pause + "second segment"
# 3. Toggle to finish
# 4. Verify both segments transcribed
```

### Final Checklist
- [ ] PTT fallback case transcribes exactly once
- [ ] PTT with speech waits for transcription completion
- [ ] Continuous dictation works unchanged
- [ ] PTT cancellation works unchanged
- [ ] No new crashes or errors introduced