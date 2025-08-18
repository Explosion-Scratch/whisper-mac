#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function copyFile(fromPath, toPath) {
  ensureDir(path.dirname(toPath));
  fs.copyFileSync(fromPath, toPath);
  console.log(
    `Copied ${path.basename(fromPath)} -> ${path.relative(
      path.join(__dirname, ".."),
      toPath
    )}`
  );
}

function copyDirFiltered(fromDir, toDir, allowedExtensions) {
  if (!fs.existsSync(fromDir)) return;
  ensureDir(toDir);
  const items = fs.readdirSync(fromDir);
  for (const item of items) {
    const src = path.join(fromDir, item);
    const dest = path.join(toDir, item);
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
      copyDirFiltered(src, dest, allowedExtensions);
    } else {
      const ext = path.extname(item).toLowerCase();
      if (!allowedExtensions || allowedExtensions.includes(ext)) {
        copyFile(src, dest);
      }
    }
  }
}

(function main() {
  const projectRoot = path.join(__dirname, "..");
  const distRendererDir = path.join(projectRoot, "dist/renderer");

  ensureDir(distRendererDir);

  const vadWebDist = path.join(
    projectRoot,
    "node_modules/@ricky0123/vad-web/dist"
  );
  const ortWebDist = path.join(
    projectRoot,
    "node_modules/onnxruntime-web/dist"
  );

  const vadFiles = [
    "bundle.min.js",
    "vad.worklet.bundle.min.js",
    "silero_vad_v5.onnx",
    "silero_vad_legacy.onnx",
  ];
  for (const file of vadFiles) {
    const src = path.join(vadWebDist, file);
    const dest = path.join(distRendererDir, file);
    if (!fs.existsSync(src)) {
      console.warn(`WARN: Missing ${src}; did you install dependencies?`);
      continue;
    }
    copyFile(src, dest);
  }

  const allowedExtensions = [".js", ".mjs", ".wasm"];
  if (fs.existsSync(ortWebDist)) {
    copyDirFiltered(ortWebDist, distRendererDir, allowedExtensions);
  } else {
    console.warn(
      `WARN: ${ortWebDist} not found; skipping onnxruntime-web copy.`
    );
  }
})();
