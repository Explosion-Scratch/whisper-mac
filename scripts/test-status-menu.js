#!/usr/bin/env node

/**
 * Test script to verify status menu functionality
 * This script simulates the status updates that would occur during app startup
 */

const { app, Tray, Menu } = require("electron");
const path = require("path");

// Mock status types
const SetupStatus = {
  IDLE: "idle",
  DOWNLOADING_MODELS: "downloading-models",
  SETTING_UP_WHISPER: "setting-up-whisper",
  PREPARING_APP: "preparing-app",
  CHECKING_PERMISSIONS: "checking-permissions",
  STARTING_SERVER: "starting-server",
  LOADING_WINDOWS: "loading-windows",
};

// Mock status messages
function getStatusMessage(status) {
  switch (status) {
    case SetupStatus.DOWNLOADING_MODELS:
      return "Downloading models...";
    case SetupStatus.SETTING_UP_WHISPER:
      return "Setting up Whisper...";
    case SetupStatus.PREPARING_APP:
      return "Preparing app...";
    case SetupStatus.CHECKING_PERMISSIONS:
      return "Checking permissions...";
    case SetupStatus.STARTING_SERVER:
      return "Starting server...";
    case SetupStatus.LOADING_WINDOWS:
      return "Loading windows...";
    case SetupStatus.IDLE:
    default:
      return "WhisperMac - AI Dictation";
  }
}

// Mock tray menu update function
function updateTrayMenu(tray, status) {
  const isSetupInProgress = status !== SetupStatus.IDLE;

  if (isSetupInProgress) {
    // Show status menu during setup
    const statusMenu = Menu.buildFromTemplate([
      {
        label: getStatusMessage(status),
        enabled: false,
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => app.quit(),
      },
    ]);
    tray.setContextMenu(statusMenu);
    tray.setToolTip(getStatusMessage(status));
    console.log(`✅ Status menu updated: "${getStatusMessage(status)}"`);
  } else {
    // Show normal menu when ready
    const contextMenu = Menu.buildFromTemplate([
      {
        label: "Start Dictation",
        accelerator: "Ctrl+D",
      },
      { type: "separator" },
      {
        label: "Settings",
      },
      {
        label: "Download Models",
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => app.quit(),
      },
    ]);
    tray.setContextMenu(contextMenu);
    tray.setToolTip("WhisperMac - AI Dictation");
    console.log("✅ Normal menu restored");
  }
}

// Test function
async function testStatusMenu() {
  console.log("🧪 Testing status menu functionality...");

  // Wait for app to be ready
  await app.whenReady();

  // Create tray
  const tray = new Tray(path.join(__dirname, "../assets/icon-template.png"));

  // Test different status transitions
  const testStatuses = [
    SetupStatus.PREPARING_APP,
    SetupStatus.DOWNLOADING_MODELS,
    SetupStatus.SETTING_UP_WHISPER,
    SetupStatus.STARTING_SERVER,
    SetupStatus.LOADING_WINDOWS,
    SetupStatus.IDLE,
  ];

  for (const status of testStatuses) {
    console.log(`\n🔄 Testing status: ${status}`);
    updateTrayMenu(tray, status);

    // Wait a bit to see the change
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log("\n✅ Status menu test completed successfully!");
  console.log(
    "The menu should have shown different status messages and then returned to normal."
  );

  // Keep app running for a moment to see final state
  setTimeout(() => {
    app.quit();
  }, 2000);
}

// Run test
testStatusMenu().catch(console.error);

// Handle app events
app.on("window-all-closed", () => {
  // Don't quit on macOS
});

app.on("activate", () => {
  // Handle activation
});
