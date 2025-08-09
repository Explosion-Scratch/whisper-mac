#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function rimraf(p) {
  try {
    console.log(`Removing directory: ${p}`);
    fs.rmSync(p, { recursive: true, force: true });
    console.log(`Successfully removed: ${p}`);
  } catch (error) {
    console.log(`Failed to remove ${p}: ${error.message}`);
  }
}

function main() {
  console.log("Starting Python architecture staging process...");

  if (process.platform !== "darwin") {
    console.log("Skipping - not running on macOS");
    return;
  }

  const arch = process.env.ARCH || process.arch;
  console.log(`Target architecture: ${arch}`);

  const vendorRoot = path.join(process.cwd(), "vendor", "python");
  const archDir = path.join(vendorRoot, `darwin-${arch}`);
  const marker = path.join(archDir, "bin", "python3");

  console.log(`Vendor root: ${vendorRoot}`);
  console.log(`Architecture directory: ${archDir}`);
  console.log(`Checking for Python marker: ${marker}`);

  if (!fs.existsSync(marker)) {
    console.error(`Error: Embedded Python for ${arch} not found at ${marker}`);
    throw new Error(`Embedded Python for ${arch} not found at ${marker}`);
  }

  console.log(`Python marker found, proceeding with staging...`);

  // Clean previously staged top-level files (avoid copy-into-self issues)
  console.log("Cleaning previously staged top-level files...");
  for (const name of ["bin", "lib", "include", "share", "Resources"]) {
    const p = path.join(vendorRoot, name);
    if (fs.existsSync(p)) {
      console.log(`Found existing ${name} directory, removing...`);
      rimraf(p);
    } else {
      console.log(`No existing ${name} directory found`);
    }
  }

  // Use rsync for robust directory copy from the arch dir into vendorRoot
  console.log(`Starting rsync from ${archDir} to ${vendorRoot}...`);
  const res = spawnSync("rsync", ["-a", archDir + "/", vendorRoot + "/"], {
    stdio: "inherit",
  });
  if (res.status !== 0) {
    console.error(`rsync failed with status: ${res.status}`);
    throw new Error("Failed to stage Python using rsync");
  }

  console.log("rsync completed successfully");
  console.log(
    `Staged Python ${arch} into vendor/python top-level for packaging`
  );
}

main();
