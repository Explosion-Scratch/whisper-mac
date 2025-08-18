# Screenshot Feature

## Overview

When starting recording, WhisperMac now captures a screenshot of the current screen and sends it to Gemini as base64 image data. This provides visual context to the AI model, allowing it to better understand the current application state and provide more relevant transcriptions.

## Implementation Details

### Screenshot Capture

- Uses Electron's `desktopCapturer` API to capture screen content
- Captures at 1920x1080 resolution for optimal quality/size balance
- Converts to PNG format and extracts base64 data
- Captured before the dictation window appears to avoid UI interference

### Integration with Gemini

- Screenshot is sent as an inline data part with `image/png` MIME type
- Added as an additional part in the Gemini API request alongside audio data
- Only sent when screenshot capture is successful
- Properly cleaned up after use to prevent memory leaks

### Code Changes

#### Main Process (`src/main.ts`)

- Added `desktopCapturer` import
- Added `screenshotBase64` property to store captured screenshot
- Added `captureScreenshot()` method for screen capture
- Modified `startDictation()` to capture screenshot before showing UI
- Updated `finishCurrentDictation()` to pass screenshot to Gemini
- Added cleanup in `cancelDictationFlow()` and `completeDictationAfterFinishing()`

#### Gemini Service (`src/services/GeminiService.ts`)

- Updated `processAudioWithContext()` method signature to accept optional screenshot
- Modified request body construction to include screenshot as inline data
- Maintains backward compatibility when no screenshot is provided

## Testing

Run the screenshot test to verify functionality:

```bash
bun run test:screenshot
```

## Error Handling

- Screenshot capture failures are logged but don't prevent recording
- If screenshot capture fails, dictation continues without visual context
- Proper cleanup ensures no memory leaks even on errors

## Performance Considerations

- Screenshot capture adds minimal latency (~10-50ms typically)
- Base64 encoding increases data size by ~33%
- Screenshot is only captured once per recording session
- Memory is properly cleaned up after each use
