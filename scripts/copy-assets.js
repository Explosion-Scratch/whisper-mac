#!/usr/bin/env bun

const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
const { spawn } = require("child_process");

// Build injectUtil Swift binary
console.log("Building injectUtil Swift binary...");
require("./build-injectutil.js");

const srcDir = path.join(__dirname, "../src/renderer");
const distDir = path.join(__dirname, "../dist/renderer");
const photonDistDir = path.join(__dirname, "../dist/photon");
const photonZipPath = path.join(__dirname, "photon.zip");
const promptsSrcDir = path.join(__dirname, "../src/prompts");
const promptsDistDir = path.join(__dirname, "../dist/prompts");
const assetsSrcDir = path.join(__dirname, "../assets");
const assetsDistDir = path.join(__dirname, "../dist/assets");
const vueSrcPath = path.join(__dirname, "_vue.js");
const vueDistPath = path.join(distDir, "vue.js");

const EXTENSIONS = [
  ".html",
  ".js",
  ".ts",
  ".css",
  ".png",
  ".svg",
  ".ico",
  ".eot",
  ".ttf",
  ".woff",
  ".mp3",
];

// Parallel copy configuration
const MAX_CONCURRENT_OPERATIONS = 10;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

// Progress tracking
let totalOperations = 0;
let completedOperations = 0;

/**
 * Parallel file copy utility with concurrency control
 * @param {Array} operations - Array of {src, dest, type} objects
 * @param {number} maxConcurrent - Maximum concurrent operations
 * @returns {Promise} Promise that resolves when all operations complete
 */
async function parallelCopy(operations, maxConcurrent = MAX_CONCURRENT_OPERATIONS) {
  if (operations.length === 0) return [];

  const results = [];
  const executing = [];
  
  for (let i = 0; i < operations.length; i++) {
    const operation = operations[i];
    
    const promise = copyWithRetry(operation.src, operation.dest, operation.type)
      .then(result => {
        completedOperations++;
        updateProgress();
        return result;
      })
      .catch(error => {
        console.error(`Failed to copy ${operation.src}: ${error.message}`);
        return { success: false, error, operation };
      });
    
    results.push(promise);
    executing.push(promise);
    
    // Control concurrency
    if (executing.length >= maxConcurrent || i === operations.length - 1) {
      await Promise.all(executing);
      executing.length = 0;
    }
  }
  
  return Promise.all(results);
}

/**
 * Copy a single file with retry logic
 * @param {string} src - Source file path
 * @param {string} dest - Destination file path
 * @param {string} type - Operation type for logging
 * @param {number} attempts - Current attempt number
 * @returns {Promise} Promise that resolves on success
 */
async function copyWithRetry(src, dest, type = 'file', attempts = 0) {
  try {
    // Ensure destination directory exists
    await fsPromises.mkdir(path.dirname(dest), { recursive: true });
    
    // Copy the file
    await fsPromises.copyFile(src, dest);
    
    const relativeDest = path.relative(path.join(__dirname, '..'), dest);
    console.log(`Copied ${path.basename(src)} to ${relativeDest}`);
    
    return { success: true, src, dest, type };
  } catch (error) {
    if (attempts < MAX_RETRY_ATTEMPTS) {
      console.warn(`Retry ${attempts + 1}/${MAX_RETRY_ATTEMPTS} for ${src}: ${error.message}`);
      await delay(RETRY_DELAY_MS * (attempts + 1)); // Exponential backoff
      return copyWithRetry(src, dest, type, attempts + 1);
    }
    throw error;
  }
}

/**
 * Create a delay for retry logic
 * @param {number} ms - Delay in milliseconds
 * @returns {Promise} Promise that resolves after delay
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Update and display progress
 */
function updateProgress() {
  if (totalOperations > 0) {
    const percentage = Math.round((completedOperations / totalOperations) * 100);
    process.stdout.write(`\rCopying files: ${completedOperations}/${totalOperations} (${percentage}%)`);
    
    if (completedOperations === totalOperations) {
      console.log('\n✓ All file operations completed');
    }
  }
}

/**
 * Discover files in a directory with extension filtering
 * @param {string} dirPath - Directory path to scan
 * @param {Array} extensions - File extensions to include
 * @returns {Promise<Array>} Promise that resolves to array of file paths
 */
async function discoverFiles(dirPath, extensions = EXTENSIONS) {
  if (!fs.existsSync(dirPath)) return [];
  
  const files = [];
  const items = await fsPromises.readdir(dirPath);
  
  for (const item of items) {
    const itemPath = path.join(dirPath, item);
    const stat = await fsPromises.stat(itemPath);
    
    if (stat.isFile() && extensions.some(ext => item.endsWith(ext))) {
      files.push(itemPath);
    }
  }
  
  return files;
}

/**
 * Recursively discover all files in a directory tree
 * @param {string} dirPath - Root directory path
 * @param {Array} extensions - File extensions to include
 * @returns {Promise<Array>} Promise that resolves to array of file paths
 */
async function discoverFilesRecursive(dirPath, extensions = EXTENSIONS) {
  if (!fs.existsSync(dirPath)) return [];
  
  const files = [];
  const items = await fsPromises.readdir(dirPath);
  
  for (const item of items) {
    const itemPath = path.join(dirPath, item);
    const stat = await fsPromises.stat(itemPath);
    
    if (stat.isDirectory()) {
      const subFiles = await discoverFilesRecursive(itemPath, extensions);
      files.push(...subFiles);
    } else if (extensions.some(ext => item.endsWith(ext))) {
      files.push(itemPath);
    }
  }
  
  return files;
}

// Parallel renderer file copying
async function copyRendererFiles() {
  console.log('\n📁 Copying renderer files...');
  
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  // Discover all renderer files
  const rendererFiles = await discoverFiles(srcDir, EXTENSIONS);
  
  // Create copy operations
  const operations = rendererFiles.map(srcFile => ({
    src: srcFile,
    dest: path.join(distDir, path.basename(srcFile)),
    type: 'renderer'
  }));
  
  // Add Vue.js copy operation if it exists
  if (fs.existsSync(vueSrcPath)) {
    operations.push({
      src: vueSrcPath,
      dest: vueDistPath,
      type: 'vue'
    });
  }
  
  if (operations.length > 0) {
    totalOperations += operations.length;
    await parallelCopy(operations);
  } else {
    console.log('No renderer files found to copy');
  }
}

// Copy Photon assets from zip
async function downloadPhotonIfNeeded(zipPath) {
  if (fs.existsSync(zipPath)) {
    console.log("Photon zip found, skipping download");
    return;
  }

  console.log("Photon zip not found, downloading...");
  const PHOTON_URL = "https://github.com/connors/photon/archive/v0.1.2-alpha.zip";
  
  return new Promise((resolve, reject) => {
    const curl = spawn("curl", ["-L", "-o", zipPath, PHOTON_URL]);

    curl.stdout.on("data", (data) => {
      console.log(`Downloading: ${data}`);
    });

    curl.stderr.on("data", (data) => {
      // curl progress is sent to stderr, so we don't treat it as an error
      console.log(`Download progress: ${data}`);
    });

    curl.on("close", (code) => {
      if (code === 0) {
        console.log(`Downloaded Photon to ${zipPath}`);
        resolve();
      } else {
        reject(new Error(`Download failed with code ${code}`));
      }
    });
  });
}

async function inflatePhotonZip(zipPath, destPath) {
  if (!fs.existsSync(zipPath)) {
    console.log("Photon zip not found, skipping Photon assets");
    return;
  }

  if (!fs.existsSync(destPath)) {
    fs.mkdirSync(destPath, { recursive: true });
  }

  return new Promise((resolve, reject) => {
    // First, extract to a temporary directory
    const tempDir = path.join(__dirname, "temp-photon");
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempDir, { recursive: true });

    const unzip = spawn("unzip", ["-o", zipPath, "*/dist/*", "-d", tempDir]);

    unzip.stdout.on("data", (data) => {
      console.log(`Inflating Photon: ${data}`);
    });

    unzip.stderr.on("data", (data) => {
      console.error(`Inflate error: ${data}`);
    });

    unzip.on("close", (code) => {
      if (code === 0) {
        // Find the extracted folder structure
        const items = fs.readdirSync(tempDir);
        if (
          items.length === 1 &&
          fs.statSync(path.join(tempDir, items[0])).isDirectory()
        ) {
          const extractedFolder = path.join(tempDir, items[0]);
          const distPath = path.join(extractedFolder, "dist");

          if (fs.existsSync(distPath)) {
            // Copy contents of the dist directory to destPath
            const contents = fs.readdirSync(distPath);
            contents.forEach((item) => {
              const srcPath = path.join(distPath, item);
              const destItemPath = path.join(destPath, item);

              if (fs.statSync(srcPath).isDirectory()) {
                // Copy directory recursively
                fs.cpSync(srcPath, destItemPath, { recursive: true });
              } else {
                // Copy file
                fs.copyFileSync(srcPath, destItemPath);
              }
            });

            console.log(
              `Inflated Photon dist to ${path.relative(
                __dirname + "/..",
                destPath
              )}`
            );
          } else {
            console.error("Dist directory not found in extracted Photon");
          }
        } else {
          console.error("Unexpected zip structure - expected single folder");
        }

        // Clean up temp directory
        fs.rmSync(tempDir, { recursive: true, force: true });
        resolve();
      } else {
        console.error(`Photon inflation failed with code ${code}`);
        // Clean up temp directory on error
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
        reject(new Error(`Photon inflation failed with code ${code}`));
      }
    });
  });
}

async function setupPhoton() {
  console.log('\n🔌 Setting up Photon...');
  try {
    // Download photon.zip if it doesn't exist
    await downloadPhotonIfNeeded(photonZipPath);
    // Extract photon to dist
    await inflatePhotonZip(photonZipPath, photonDistDir);
  } catch (error) {
    console.error("Error setting up Photon:", error.message);
  }
}

// Main execution function
async function main() {
  const startTime = Date.now();
  console.log('🚀 Starting parallel build process...');
  
  try {
    // Reset progress tracking
    totalOperations = 0;
    completedOperations = 0;
    
    // Run operations in parallel where possible
    await Promise.all([
      copyRendererFiles(),
      setupPhoton(), // Can run in parallel with file copying
      copyPromptsFiles()
    ]);
    
    // Copy assets (depends on discovering files, so run after other operations)
    await copyAssetsParallel(assetsSrcDir, assetsDistDir);
    
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    
    console.log(`\n\n✅ Build completed successfully in ${duration} seconds`);
    console.log(`📈 Total files processed: ${completedOperations}`);
    
  } catch (error) {
    console.error('\n❌ Build failed:', error.message);
    process.exit(1);
  }
}

// Execute main function
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

// Parallel prompts file copying
async function copyPromptsFiles() {
  console.log('\n📝 Copying prompts files...');
  
  if (!fs.existsSync(promptsDistDir)) {
    fs.mkdirSync(promptsDistDir, { recursive: true });
  }

  // Discover all .txt files in prompts directory
  const promptFiles = await discoverFiles(promptsSrcDir, ['.txt']);
  
  // Create copy operations
  const operations = promptFiles.map(srcFile => ({
    src: srcFile,
    dest: path.join(promptsDistDir, path.basename(srcFile)),
    type: 'prompt'
  }));
  
  if (operations.length > 0) {
    totalOperations += operations.length;
    await parallelCopy(operations);
  } else {
    console.log('No prompt files found to copy');
  }
}

// Parallel assets copying
async function copyAssetsParallel(srcPath, destPath) {
  console.log('\n🎨 Copying assets files...');
  
  if (!fs.existsSync(srcPath)) {
    console.log('Assets directory not found, skipping');
    return;
  }

  // Recursively discover all files
  const allFiles = await discoverFilesRecursive(srcPath, EXTENSIONS);
  
  // Create copy operations maintaining directory structure
  const operations = allFiles.map(srcFile => {
    const relativePath = path.relative(srcPath, srcFile);
    const destFile = path.join(destPath, relativePath);
    
    return {
      src: srcFile,
      dest: destFile,
      type: 'asset'
    };
  });
  
  if (operations.length > 0) {
    totalOperations += operations.length;
    await parallelCopy(operations);
  } else {
    console.log('No asset files found to copy');
  }
}
