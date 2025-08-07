#!/usr/bin/env bun

const fs = require("fs");
const path = require("path");
const https = require("https");
const sharp = require("sharp");

//
// Icon definitions
function getIconUrl(iconName, color = "#000000") {
  const iconMap = {
    "icon-template": "ph:microphone-duotone",
    "icon-recording": "ph:record-duotone",
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

// PNG base size
const BASE_SIZE = "22x22";

// Output directory
const ASSETS_DIR = path.resolve(__dirname, "assets");
if (!fs.existsSync(ASSETS_DIR)) {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
}

// Helper to download SVG as Buffer
function downloadSVGBuffer(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(
            new Error(`Failed to download ${url}: ${response.statusCode}`),
          );
          return;
        }
        const data = [];
        response.on("data", (chunk) => data.push(chunk));
        response.on("end", () => resolve(Buffer.concat(data)));
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

  const [baseWidth, baseHeight] = BASE_SIZE.split("x").map(Number);
  const scales = [
    { suffix: "", multiplier: 1 },
    { suffix: "@2x", multiplier: 2 },
    { suffix: "@3x", multiplier: 3 },
  ];

  for (const icon of iconsToProcess) {
    const svgUrl = ICONS[icon];
    const svgPath = path.join(ASSETS_DIR, `${icon}.svg`);

    console.log(`Downloading ${icon} from ${svgUrl}...`);
    const svgBuffer = await downloadSVGBuffer(svgUrl);

    // Save SVG file
    fs.writeFileSync(svgPath, svgBuffer);
    console.log(`Saved SVG: ${svgPath}`);

    // Convert SVG to PNGs for different scales
    for (const scale of scales) {
      const { suffix, multiplier } = scale;
      const targetWidth = baseWidth * multiplier;
      const targetHeight = baseHeight * multiplier;
      const pngPath = path.join(ASSETS_DIR, `${icon}${suffix}.png`);

      console.log(
        `Converting ${svgPath} to ${pngPath} (${targetWidth}x${targetHeight})...`,
      );
      await sharp(svgBuffer)
        .resize(targetWidth, targetHeight)
        .png({ transparent: true })
        .toFile(pngPath);
    }
  }

  console.log("Icons downloaded and converted to PNGs in ./assets");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
