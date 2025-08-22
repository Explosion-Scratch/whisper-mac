#!/usr/bin/env bun

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const PHOTON_URL = "https://github.com/connors/photon/archive/v0.1.2-alpha.zip";
const PHOTON_ZIP_PATH = path.join(__dirname, "photon.zip");

async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const curl = spawn("curl", ["-L", "-o", destPath, url]);

    curl.stdout.on("data", (data) => {
      console.log(`Downloading: ${data}`);
    });

    curl.stderr.on("data", (data) => {
      // curl progress is sent to stderr, so we don't treat it as an error
      console.log(`Download progress: ${data}`);
    });

    curl.on("close", (code) => {
      if (code === 0) {
        console.log(`Downloaded Photon to ${destPath}`);
        resolve();
      } else {
        reject(new Error(`Download failed with code ${code}`));
      }
    });
  });
}

async function main() {
  try {
    if (!fs.existsSync(PHOTON_ZIP_PATH)) {
      console.log("Downloading Photon...");
      await downloadFile(PHOTON_URL, PHOTON_ZIP_PATH);
    } else {
      console.log("Photon zip already exists, skipping download");
    }

    console.log("Photon download complete!");
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

main();
