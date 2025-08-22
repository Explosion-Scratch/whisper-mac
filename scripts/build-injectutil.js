#!/usr/bin/env bun

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const swiftSourcePath = path.join(__dirname, "injectUtil.swift");
const distDir = path.join(__dirname, "../dist");
const binaryPath = path.join(distDir, "injectUtil");

console.log("Building injectUtil Swift binary...");

// Ensure dist directory exists
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Compile Swift binary
const swiftc = spawn("swiftc", ["-o", binaryPath, swiftSourcePath]);

swiftc.stdout.on("data", (data) => {
  console.log(`swiftc: ${data}`);
});

swiftc.stderr.on("data", (data) => {
  console.error(`swiftc error: ${data}`);
});

swiftc.on("close", (code) => {
  if (code === 0) {
    // Make binary executable
    fs.chmodSync(binaryPath, 0o755);
    console.log(`Successfully compiled injectUtil to ${binaryPath}`);
  } else {
    console.error(`Swift compilation failed with code ${code}`);
    process.exit(1);
  }
});

swiftc.on("error", (error) => {
  console.error("Failed to spawn swiftc:", error);
  process.exit(1);
});
