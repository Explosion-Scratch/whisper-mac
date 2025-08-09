#!/usr/bin/env bun

const fs = require("fs");
const path = require("path");

const srcDir = path.join(__dirname, "../src/renderer");
const distDir = path.join(__dirname, "../dist/renderer");
const photonSrcDir = path.join(__dirname, "../src/photon");
const photonDistDir = path.join(__dirname, "../dist/photon");
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

// Copy Photon assets
function copyPhotonAssets(srcPath, destPath) {
  if (!fs.existsSync(srcPath)) return;

  if (!fs.existsSync(destPath)) {
    fs.mkdirSync(destPath, { recursive: true });
  }

  const items = fs.readdirSync(srcPath);
  items.forEach((item) => {
    const srcItemPath = path.join(srcPath, item);
    const destItemPath = path.join(destPath, item);

    if (fs.statSync(srcItemPath).isDirectory()) {
      copyPhotonAssets(srcItemPath, destItemPath);
    } else {
      if (EXTENSIONS.find((ext) => item.endsWith(ext))) {
        fs.copyFileSync(srcItemPath, destItemPath);
        console.log(
          `Copied Photon ${item} to ${path.relative(
            __dirname + "/..",
            destItemPath
          )}`
        );
      }
    }
  });
}

copyPhotonAssets(photonSrcDir, photonDistDir);

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
