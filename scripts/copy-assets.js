#!/usr/bin/env bun

const fs = require("fs");
const path = require("path");

const srcDir = path.join(__dirname, "../src/renderer");
const distDir = path.join(__dirname, "../dist/renderer");

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

fs.readdirSync(srcDir).forEach((file) => {
  if (file.endsWith(".html")) {
    fs.copyFileSync(path.join(srcDir, file), path.join(distDir, file));
    console.log(`Copied ${file} to dist/renderer`);
  }
});
