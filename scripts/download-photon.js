#!/usr/bin/env bun

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const PHOTON_URL = "https://github.com/connors/photon/archive/v0.1.2-alpha.zip";
const PHOTON_ZIP_PATH = path.join(__dirname, "photon.zip");
const PHOTON_EXTRACT_PATH = path.join(__dirname, "../src/photon");
const PHOTON_DIST_PATH = path.join(__dirname, "../dist/photon");

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

async function extractZip(zipPath, extractPath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(extractPath)) {
      fs.mkdirSync(extractPath, { recursive: true });
    }

    const unzip = spawn("unzip", ["-o", zipPath, "-d", extractPath]);

    unzip.stdout.on("data", (data) => {
      console.log(`Extracting: ${data}`);
    });

    unzip.stderr.on("data", (data) => {
      console.error(`Extract error: ${data}`);
    });

    unzip.on("close", (code) => {
      if (code === 0) {
        console.log(`Extracted Photon to ${extractPath}`);
        resolve();
      } else {
        reject(new Error(`Extraction failed with code ${code}`));
      }
    });
  });
}

async function main() {
  try {
    // Remove existing photon from dist if it exists
    if (fs.existsSync(PHOTON_DIST_PATH)) {
      console.log("Removing existing Photon from dist...");
      fs.rmSync(PHOTON_DIST_PATH, { recursive: true, force: true });
    }

    if (!fs.existsSync(PHOTON_ZIP_PATH)) {
      console.log("Downloading Photon...");
      await downloadFile(PHOTON_URL, PHOTON_ZIP_PATH);
    } else {
      console.log("Photon zip already exists, skipping download");
    }

    if (!fs.existsSync(PHOTON_EXTRACT_PATH)) {
      console.log("Extracting Photon...");
      await extractZip(PHOTON_ZIP_PATH, PHOTON_EXTRACT_PATH);
    } else {
      console.log("Photon already extracted, skipping extraction");
    }

    console.log("Photon setup complete!");
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

main();
