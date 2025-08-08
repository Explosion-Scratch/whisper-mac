#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

function rimraf(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {}
}

function main() {
  if (process.platform !== "darwin") return;
  const arch = process.env.ARCH || process.arch;
  const vendorRoot = path.join(process.cwd(), "vendor", "python");
  const archDir = path.join(vendorRoot, `darwin-${arch}`);
  const marker = path.join(archDir, "bin", "python3");
  if (!fs.existsSync(marker)) {
    throw new Error(`Embedded Python for ${arch} not found at ${marker}`);
  }

  // Ensure only the target arch is present at top-level for packaging simplicity
  // Keep both arch folders, but also mirror selected arch files into top-level for dev/electron-builder compatibility
  const topBin = path.join(vendorRoot, "bin");
  if (fs.existsSync(topBin)) rimraf(topBin);
  fs.mkdirSync(topBin, { recursive: true });

  // Symlink is risky for packaging; copy instead
  fs.cpSync(archDir + "/", vendorRoot + "/", { recursive: true });
  console.log(`Staged Python ${arch} into vendor/python for packaging`);
}

main();
