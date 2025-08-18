const fs = require("fs");
const path = require("path");
const https = require("https");
const { spawn } = require("child_process");
const { pipeline } = require("stream");
const { promisify } = require("util");

const pipelineAsync = promisify(pipeline);

/**
 * Whisper.cpp Plugin Setup
 * Downloads, builds, and sets up Whisper.cpp for the transcription plugin
 */
class WhisperCppPluginSetup {
  constructor() {
    this.vendorDir = path.join(__dirname, "..", "vendor", "whisper-cpp");
    this.modelsDir = path.join(this.vendorDir, "models");
    this.whisperVersion = "v1.7.6";
    this.repoUrl = "https://github.com/ggml-org/whisper.cpp";
    this.modelsToDownload = [
      "ggml-base.en.bin", // Default bundled speech model
      "ggml-silero-v5.1.2.bin", // VAD model
    ];
  }

  async setup() {
    console.log("Setting up Whisper.cpp transcription plugin...");

    // Create vendor directories
    if (!fs.existsSync(this.vendorDir)) {
      fs.mkdirSync(this.vendorDir, { recursive: true });
      console.log(`Created directory: ${this.vendorDir}`);
    }

    if (!fs.existsSync(this.modelsDir)) {
      fs.mkdirSync(this.modelsDir, { recursive: true });
      console.log(`Created directory: ${this.modelsDir}`);
    }

    // Check if already available
    if (await this.isWhisperCppAvailable()) {
      console.log("Whisper.cpp is already available and working");
      return;
    }

    try {
      // Step 1: Download or clone whisper.cpp source
      console.log("📥 Downloading Whisper.cpp source...");
      await this.downloadSource();

      // Step 2: Build whisper.cpp
      console.log("🔨 Building Whisper.cpp...");
      await this.buildWhisperCpp();

      // Step 3: Download models
      console.log("📦 Downloading Whisper models...");
      await this.downloadModels();

      // Step 4: Verify installation
      if (await this.isWhisperCppAvailable()) {
        console.log("✅ Whisper.cpp setup completed successfully");
      } else {
        throw new Error("Whisper.cpp verification failed after setup");
      }
    } catch (error) {
      console.error("❌ Whisper.cpp setup failed:", error.message);
      throw error;
    }
  }

  async isWhisperCppAvailable() {
    const whisperBinaryPath = path.join(this.vendorDir, "whisper-cli");
    const baseModelPath = path.join(this.modelsDir, "ggml-base.en.bin");

    // Check if binary and model exist
    if (!fs.existsSync(whisperBinaryPath) || !fs.existsSync(baseModelPath)) {
      return false;
    }

    // Test if binary works
    return await this.testWhisperBinary(whisperBinaryPath);
  }

  async testWhisperBinary(binaryPath) {
    return new Promise((resolve) => {
      const child = spawn(binaryPath, ["--help"], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let hasOutput = false;
      child.stdout?.on("data", () => {
        hasOutput = true;
      });

      child.on("close", (code) => {
        resolve(hasOutput && (code === 0 || code === 1)); // Some versions return 1 for --help
      });

      child.on("error", () => {
        resolve(false);
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        child.kill();
        resolve(false);
      }, 10000);
    });
  }

  async downloadSource() {
    const sourceDir = path.join(this.vendorDir, "src");

    // Remove existing source if it exists
    if (fs.existsSync(sourceDir)) {
      await this.rmdir(sourceDir);
    }

    // Clone the repository
    return new Promise((resolve, reject) => {
      const child = spawn(
        "git",
        [
          "clone",
          "--depth",
          "1",
          "--branch",
          this.whisperVersion,
          this.repoUrl,
          sourceDir,
        ],
        {
          stdio: "inherit",
        }
      );

      child.on("close", (code) => {
        if (code === 0) {
          console.log(`Downloaded Whisper.cpp ${this.whisperVersion}`);
          resolve();
        } else {
          reject(new Error(`Git clone failed with code ${code}`));
        }
      });

      child.on("error", (error) => {
        reject(new Error(`Git clone failed: ${error.message}`));
      });
    });
  }

  async buildWhisperCpp() {
    const sourceDir = path.join(this.vendorDir, "src");

    if (!fs.existsSync(sourceDir)) {
      throw new Error("Source directory not found");
    }

    // Build using CMake
    await this.runMake(sourceDir);

    // Copy binaries to vendor root
    await this.copyBinaries(sourceDir);
  }

  async runMake(sourceDir) {
    return new Promise((resolve, reject) => {
      // Use cmake to build whisper.cpp
      console.log("Configuring with CMake...");
      const configChild = spawn(
        "cmake",
        [
          "-B",
          "build",
          "-DCMAKE_BUILD_TYPE=Release",
          // Enable CoreML/Metal backend on macOS for Apple Silicon
          process.platform === "darwin" ? "-DWHISPER_COREML=1" : "",
        ].filter(Boolean),
        {
          cwd: sourceDir,
          stdio: "inherit",
        }
      );

      configChild.on("close", (configCode) => {
        if (configCode !== 0) {
          reject(
            new Error(`CMake configuration failed with code ${configCode}`)
          );
          return;
        }

        console.log("Building with CMake...");
        const buildChild = spawn(
          "cmake",
          [
            "--build",
            "build",
            "--config",
            "Release",
            "--target",
            "whisper-cli",
          ],
          {
            cwd: sourceDir,
            stdio: "inherit",
          }
        );

        buildChild.on("close", (buildCode) => {
          if (buildCode === 0) {
            console.log("Whisper.cpp built successfully");
            resolve();
          } else {
            reject(new Error(`CMake build failed with code ${buildCode}`));
          }
        });

        buildChild.on("error", (error) => {
          reject(new Error(`CMake build failed: ${error.message}`));
        });
      });

      configChild.on("error", (error) => {
        reject(new Error(`CMake configuration failed: ${error.message}`));
      });
    });
  }

  async copyBinaries(sourceDir) {
    // CMake builds binaries in the build directory
    const buildBinary = path.join(sourceDir, "build", "bin", "whisper-cli");
    const altBuildBinary = path.join(sourceDir, "build", "whisper-cli"); // Alternative location
    const targetBinary = path.join(this.vendorDir, "whisper-cli");

    let sourceBinary;
    if (fs.existsSync(buildBinary)) {
      sourceBinary = buildBinary;
    } else if (fs.existsSync(altBuildBinary)) {
      sourceBinary = altBuildBinary;
    } else {
      throw new Error("Built whisper-cli binary not found in build directory");
    }

    fs.copyFileSync(sourceBinary, targetBinary);
    fs.chmodSync(targetBinary, 0o755); // Make executable
    console.log(`Copied whisper-cli from ${sourceBinary} to ${targetBinary}`);
  }

  async downloadModels() {
    const downloadPromises = this.modelsToDownload.map((modelName) =>
      this.downloadModel(modelName)
    );

    await Promise.allSettled(downloadPromises);
  }

  async downloadModel(modelName) {
    const modelPath = path.join(this.modelsDir, modelName);

    if (fs.existsSync(modelPath)) {
      console.log(`Model ${modelName} already exists`);
      return;
    }

    const modelUrl = this.getModelUrl(modelName);
    console.log(`Downloading ${modelName}...`);

    try {
      await this.downloadFile(modelUrl, modelPath);
      console.log(`✅ Downloaded ${modelName}`);
    } catch (error) {
      console.error(`❌ Failed to download ${modelName}:`, error.message);
    }
  }

  getModelUrl(modelName) {
    if (modelName.includes("silero")) {
      // VAD model from Hugging Face
      return `https://huggingface.co/ggml-org/whisper-vad/resolve/main/${modelName}`;
    } else {
      // Regular Whisper model from Hugging Face
      return `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${modelName}`;
    }
  }

  async downloadFile(url, outputPath) {
    return new Promise((resolve, reject) => {
      const request = https.get(url, (response) => {
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location;
          return this.downloadFile(redirectUrl, outputPath)
            .then(resolve)
            .catch(reject);
        }

        if (response.statusCode !== 200) {
          reject(
            new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`)
          );
          return;
        }

        const fileStream = fs.createWriteStream(outputPath);

        response.pipe(fileStream);

        fileStream.on("finish", () => {
          fileStream.close();
          resolve();
        });

        fileStream.on("error", (error) => {
          fs.unlink(outputPath, () => {}); // Delete partial file
          reject(error);
        });
      });

      request.on("error", (error) => {
        reject(error);
      });

      request.setTimeout(300000, () => {
        // 5 minute timeout
        request.abort();
        reject(new Error("Download timeout"));
      });
    });
  }

  async rmdir(dirPath) {
    return new Promise((resolve, reject) => {
      const child = spawn("rm", ["-rf", dirPath], {
        stdio: "inherit",
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`rm -rf failed with code ${code}`));
        }
      });

      child.on("error", (error) => {
        reject(error);
      });
    });
  }
}

// Run if called directly
if (require.main === module) {
  const setup = new WhisperCppPluginSetup();
  setup
    .setup()
    .then(() => {
      console.log("✅ Whisper.cpp plugin setup completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Whisper.cpp plugin setup failed:", error.message);
      console.error(
        "Please ensure you have git, make, and a C++ compiler installed"
      );
      process.exit(1);
    });
}

module.exports = { WhisperCppPluginSetup };
