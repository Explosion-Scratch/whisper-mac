#!/usr/bin/env bun

const fs = require("fs");
const path = require("path");
const https = require("https");
const { execSync } = require("child_process");

//
// Icon definitions
function getIconUrl(iconName, color = "#000000") {
  const iconMap = {
    "icon-template": "ph:microphone",
    "icon-recording": "ph:record-fill",
  };
  const iconId = iconMap[iconName];
  if (!iconId) {
    throw new Error(`Unknown icon name: ${iconName}`);
  }
  // Encode iconId for URL safety
  const encodedIconId = encodeURIComponent(iconId);
  // Encode color for URL safety
  const encodedColor = encodeURIComponent(color);
  return `https://api.iconify.design/${encodedIconId}.svg?color=${encodedColor}`;
}

const ICONS = {
  "icon-template": getIconUrl("icon-template"),
  "icon-recording": getIconUrl("icon-recording"),
};

// PNG size
const SIZE = "32x32";

// Output directory
const ASSETS_DIR = path.resolve(__dirname, "assets");
if (!fs.existsSync(ASSETS_DIR)) {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
}

// Helper to download SVG
function downloadSVG(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(
            new Error(`Failed to download ${url}: ${response.statusCode}`),
          );
          return;
        }
        response.pipe(file);
        file.on("finish", () => file.close(resolve));
      })
      .on("error", reject);
  });
}

// Main logic
async function main() {
  const iconArg = process.argv[2];
  let iconsToProcess = Object.keys(ICONS);

  if (iconArg) {
    if (!ICONS[iconArg]) {
      console.error(`Invalid icon option: ${iconArg}`);
      process.exit(1);
    }
    iconsToProcess = [iconArg];
  }

  for (const icon of iconsToProcess) {
    const svgUrl = ICONS[icon];
    const svgPath = path.join(ASSETS_DIR, `${icon}.svg`);
    const pngPath = path.join(ASSETS_DIR, `${icon}.png`);

    console.log(`Downloading ${icon} from ${svgUrl}...`);
    await downloadSVG(svgUrl, svgPath);

    console.log(`Converting ${svgPath} to ${pngPath}...`);
    execSync(
      `convert "${svgPath}" -flatten -background white -resize ${SIZE} "${pngPath}"`,
    );
  }

  console.log("Icons downloaded and converted to PNGs in ./assets");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
