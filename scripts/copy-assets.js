#!/usr/bin/env bun

const fs = require("fs");
const path = require("path");

const srcDir = path.join(__dirname, "../src/renderer");
const distDir = path.join(__dirname, "../dist/renderer");
const photonSrcDir = path.join(__dirname, "../src/photon");
const photonDistDir = path.join(__dirname, "../dist/photon");
const photonZipPath = path.join(__dirname, "photon.zip");
const promptsSrcDir = path.join(__dirname, "../src/prompts");
const promptsDistDir = path.join(__dirname, "../dist/prompts");
const assetsSrcDir = path.join(__dirname, "../assets");
const assetsDistDir = path.join(__dirname, "../dist/assets");

const EXTENSIONS = [
  ".html",
  ".js",
  ".ts",
  ".css",
  ".png",
  ".svg",
  ".ico",
  ".eot",
  ".ttf",
  ".woff",
  ".mp3",
];

// Copy renderer files
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

fs.readdirSync(srcDir).forEach((file) => {
  if (EXTENSIONS.find((ext) => file.endsWith(ext))) {
    fs.copyFileSync(path.join(srcDir, file), path.join(distDir, file));
    console.log(`Copied ${file} to dist/renderer`);
  }
});

// Copy Photon assets from zip
function inflatePhotonZip(zipPath, destPath) {
  if (!fs.existsSync(zipPath)) {
    console.log("Photon zip not found, skipping Photon assets");
    return;
  }

  if (!fs.existsSync(destPath)) {
    fs.mkdirSync(destPath, { recursive: true });
  }

  const { spawn } = require("child_process");

  // First, extract to a temporary directory
  const tempDir = path.join(__dirname, "temp-photon");
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  fs.mkdirSync(tempDir, { recursive: true });

  const unzip = spawn("unzip", ["-o", zipPath, "*/dist/*", "-d", tempDir]);

  unzip.stdout.on("data", (data) => {
    console.log(`Inflating Photon: ${data}`);
  });

  unzip.stderr.on("data", (data) => {
    console.error(`Inflate error: ${data}`);
  });

  unzip.on("close", (code) => {
    if (code === 0) {
      // Find the extracted folder structure
      const items = fs.readdirSync(tempDir);
      if (
        items.length === 1 &&
        fs.statSync(path.join(tempDir, items[0])).isDirectory()
      ) {
        const extractedFolder = path.join(tempDir, items[0]);
        const distPath = path.join(extractedFolder, "dist");

        if (fs.existsSync(distPath)) {
          // Copy contents of the dist directory to destPath
          const contents = fs.readdirSync(distPath);
          contents.forEach((item) => {
            const srcPath = path.join(distPath, item);
            const destItemPath = path.join(destPath, item);

            if (fs.statSync(srcPath).isDirectory()) {
              // Copy directory recursively
              fs.cpSync(srcPath, destItemPath, { recursive: true });
            } else {
              // Copy file
              fs.copyFileSync(srcPath, destItemPath);
            }
          });

          console.log(
            `Inflated Photon dist to ${path.relative(
              __dirname + "/..",
              destPath
            )}`
          );
        } else {
          console.error("Dist directory not found in extracted Photon");
        }
      } else {
        console.error("Unexpected zip structure - expected single folder");
      }

      // Clean up temp directory
      fs.rmSync(tempDir, { recursive: true, force: true });
    } else {
      console.error(`Photon inflation failed with code ${code}`);
      // Clean up temp directory on error
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  });
}

inflatePhotonZip(photonZipPath, photonDistDir);

// Copy prompts files
if (!fs.existsSync(promptsDistDir)) {
  fs.mkdirSync(promptsDistDir, { recursive: true });
}

fs.readdirSync(promptsSrcDir).forEach((file) => {
  if (file.endsWith(".txt")) {
    fs.copyFileSync(
      path.join(promptsSrcDir, file),
      path.join(promptsDistDir, file)
    );
    console.log(`Copied ${file} to dist/prompts`);
  }
});

// Copy assets files
function copyAssets(srcPath, destPath) {
  if (!fs.existsSync(srcPath)) return;

  if (!fs.existsSync(destPath)) {
    fs.mkdirSync(destPath, { recursive: true });
  }

  const items = fs.readdirSync(srcPath);
  items.forEach((item) => {
    const srcItemPath = path.join(srcPath, item);
    const destItemPath = path.join(destPath, item);

    if (fs.statSync(srcItemPath).isDirectory()) {
      copyAssets(srcItemPath, destItemPath);
    } else {
      if (EXTENSIONS.find((ext) => item.endsWith(ext))) {
        fs.copyFileSync(srcItemPath, destItemPath);
        console.log(
          `Copied Asset ${item} to ${path.relative(
            __dirname + "/..",
            destItemPath
          )}`
        );
      }
    }
  });
}

copyAssets(assetsSrcDir, assetsDistDir);
