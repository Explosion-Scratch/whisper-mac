#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

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

  // Clean previously staged top-level files (avoid copy-into-self issues)
  for (const name of ["bin", "lib", "include", "share", "Resources"]) {
    const p = path.join(vendorRoot, name);
    if (fs.existsSync(p)) rimraf(p);
  }

  // Use rsync for robust directory copy from the arch dir into vendorRoot
  const res = spawnSync("rsync", ["-a", archDir + "/", vendorRoot + "/"], {
    stdio: "inherit",
  });
  if (res.status !== 0) {
    throw new Error("Failed to stage Python using rsync");
  }
  console.log(
    `Staged Python ${arch} into vendor/python top-level for packaging`
  );
}

main();
