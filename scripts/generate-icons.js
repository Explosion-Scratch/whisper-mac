#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

async function main() {
  const srcPng = path.join(__dirname, "../assets/icon.png");
  const buildDir = path.join(__dirname, "../build/icons");
  fs.mkdirSync(buildDir, { recursive: true });
  if (!fs.existsSync(srcPng)) {
    throw new Error(`Missing source icon at ${srcPng}`);
  }

  const sizes = [16, 32, 64, 128, 256, 512, 1024];
  for (const size of sizes) {
    const out = path.join(buildDir, `icon_${size}x${size}.png`);
    await sharp(srcPng)
      .resize(size, size, { fit: "cover" })
      .png({ compressionLevel: 9 })
      .toFile(out);
  }

  // Create macOS .icns using sips + iconutil (native tools)
  const iconset = path.join(buildDir, "WhisperMac.iconset");
  if (fs.existsSync(iconset))
    fs.rmSync(iconset, { recursive: true, force: true });
  fs.mkdirSync(iconset);

  const mapping = [
    [16, "icon_16x16.png"],
    [32, "icon_16x16@2x.png"],
    [32, "icon_32x32.png"],
    [64, "icon_32x32@2x.png"],
    [128, "icon_128x128.png"],
    [256, "icon_128x128@2x.png"],
    [256, "icon_256x256.png"],
    [512, "icon_256x256@2x.png"],
    [512, "icon_512x512.png"],
    [1024, "icon_512x512@2x.png"],
  ];

  // Generate required files
  for (const [size, name] of mapping) {
    const src = path.join(buildDir, `icon_${size}x${size}.png`);
    const dest = path.join(iconset, name);
    fs.copyFileSync(src, dest);
  }

  // Use iconutil to make .icns
  const { spawnSync } = require("child_process");
  const icnsPath = path.join(buildDir, "WhisperMac.icns");
  const res = spawnSync("iconutil", ["-c", "icns", iconset, "-o", icnsPath], {
    stdio: "inherit",
  });
  if (res.status !== 0) {
    throw new Error("iconutil failed to generate .icns");
  }
  console.log(`Generated ${icnsPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
