# Status-Aware Menu Bar

The app features a status-aware menu bar that provides user-friendly feedback during setup and initialization operations.

## Overview

The menu bar displays user-friendly status messages during startup and setup.

## Status Messages

The menu bar shows different status messages based on the current operation:

- **"Preparing app..."** - Initial app startup and directory setup
  No model downloads or local servers are used in this version.
- **"Loading windows..."** - When pre-loading application windows
- **"Checking permissions..."** - When verifying accessibility permissions

## Menu Behavior

### During Setup Operations

When any setup operation is in progress, the menu bar shows:

- A grayed-out status message as the first menu item
- Only the "Quit" option is available
- The tooltip shows the current status message

### When Ready

Once all setup operations are complete, the menu bar shows the normal menu with:

- Start Dictation
- Settings
- Download Models
- Quit

## Implementation Details

### Status Management

- `SetupStatus` type defines all possible status states
- `setSetupStatus()` method updates the current status and refreshes the menu
- `updateTrayMenu()` method rebuilds the menu based on current status

### Progress Callbacks

This version no longer downloads models or runs a local server. Recording is single-chunk and processed by Gemini.

- All progress updates are translated to user-friendly status messages

### Initialization Flow

1. App starts with "Preparing app..." status
2. No model download or server setup in this version
3. Window preloading shows "Loading windows..." status
4. App becomes ready with normal menu

## User Experience Benefits

- **Non-technical language**: Use simple, clear messages.
- **Clear feedback**: Users always know what the app is doing
- **Reduced confusion**: No more wondering why the app seems unresponsive during startup
- **Professional appearance**: Status messages are consistent and polished

## Technical Notes

- Status updates are thread-safe and don't block the main process
- All status changes trigger immediate menu updates
- Progress callbacks are optional and don't break existing functionality
- Status messages are centralized in the `getStatusMessage()` method for easy maintenance
