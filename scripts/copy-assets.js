#!/usr/bin/env bun

const fs = require("fs");
const path = require("path");

const srcDir = path.join(__dirname, "../src/renderer");
const distDir = path.join(__dirname, "../dist/renderer");
const photonSrcDir = path.join(__dirname, "../src/photon");
const photonDistDir = path.join(__dirname, "../dist/photon");

const EXTENSIONS = [
  ".html",
  ".js",
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
