#!/usr/bin/env node

/**
 * This script has been deprecated.
 * 
 * VAD assets are now copied automatically via vite-plugin-static-copy
 * configured in src/renderer-app/vite.config.ts
 * 
 * The Vite plugin copies the following files during build:
 * - vad.worklet.bundle.min.js (from @ricky0123/vad-web)
 * - silero_vad_v5.onnx (from @ricky0123/vad-web)
 * - silero_vad_legacy.onnx (from @ricky0123/vad-web)
 * - *.wasm files (from onnxruntime-web)
 * - *.mjs files (from onnxruntime-web)
 * 
 * This file is kept for reference but no longer performs any operations.
 */

console.log("prep-vad-assets.js: VAD assets are now handled by vite-plugin-static-copy in renderer-app/vite.config.ts");
