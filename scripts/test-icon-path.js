#!/usr/bin/env bun

const { join } = require("path");
const { existsSync } = require("fs");

// Test the same path resolution logic as in main.ts
const iconPath = join(__dirname, "../dist/assets/icon-template.png");
console.log("Icon path:", iconPath);
console.log("File exists:", existsSync(iconPath));

// Test the path that main.ts uses
const mainIconPath = join(__dirname, "../dist", "./assets/icon-template.png");
console.log("Main icon path:", mainIconPath);
console.log("File exists:", existsSync(mainIconPath));

// Test with __dirname being dist directory
const distDir = join(__dirname, "../dist");
const distIconPath = join(distDir, "./assets/icon-template.png");
console.log("Dist icon path:", distIconPath);
console.log("File exists:", existsSync(distIconPath));
