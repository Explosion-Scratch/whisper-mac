const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

/**
 * YAP Plugin Setup
 * Downloads and sets up YAP binary for the transcription plugin
 */
class YapPluginSetup {
  constructor() {
    this.vendorDir = path.join(__dirname, "..", "vendor", "yap");
    this.yapBinaryPath = path.join(this.vendorDir, "yap");
    this.yapVersion = "1.0.3";
    this.githubRepo = "finnvoor/yap";
    this.platform = process.platform;
    this.arch = process.arch;
  }

  async setup() {
    console.log("Setting up YAP transcription plugin...");

    // Create vendor directory
    if (!fs.existsSync(this.vendorDir)) {
      fs.mkdirSync(this.vendorDir, { recursive: true });
      console.log(`Created directory: ${this.vendorDir}`);
    }

    // Check if YAP is already installed and working
    if (await this.isYapAvailable()) {
      console.log("YAP is already available and working");
      return;
    }

    // Download and install YAP binary from GitHub
    console.log("Downloading YAP binary from GitHub...");
    try {
      await this.downloadFromGitHub();

      if (await this.isYapAvailable()) {
        console.log("✅ YAP installed successfully from GitHub");
        return;
      }
    } catch (error) {
      console.log(error);
      console.log("⚠️  YAP installation failed");
      console.log("Please install YAP manually:");
      console.log("  brew install finnvoor/tools/yap");
      console.log("Or build from source: https://github.com/finnvoor/yap");

      throw new Error("YAP installation failed - manual installation required");
    }
  }

  async downloadFromGitHub() {
    const releaseUrl = `https://api.github.com/repos/${this.githubRepo}/releases/latest`;

    try {
      // Get latest release info
      const releaseInfo = await this.fetchJson(releaseUrl);
      console.log(`Latest YAP version: ${releaseInfo.tag_name}`);

      // Find the appropriate asset for this platform
      const asset = this.findAssetForPlatform(releaseInfo.assets);
      if (!asset) {
        throw new Error(
          `No compatible binary found for ${this.platform}-${this.arch}`
        );
      }

      console.log(`Downloading: ${asset.name}`);

      // Download and extract the binary
      await this.downloadAndExtractAsset(asset.browser_download_url);
    } catch (error) {
      throw new Error(`Failed to download from GitHub: ${error.message}`);
    }
  }

  findAssetForPlatform(assets) {
    // YAP provides a single tar.gz file with the binary
    // Look for the tar.gz file
    const tarGzAsset = assets.find((asset) => asset.name.endsWith(".tar.gz"));

    if (tarGzAsset) {
      return tarGzAsset;
    }

    return null;
  }

  async downloadAndExtractAsset(downloadUrl) {
    const tempDir = path.join(this.vendorDir, "temp");
    const downloadPath = path.join(tempDir, "yap-archive.tar.gz");

    // Create temp directory
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    try {
      // Download the file
      await this.downloadFile(downloadUrl, downloadPath);

      // Extract the archive
      await this.extractTarGz(downloadPath, this.vendorDir);

      // Make the binary executable
      if (fs.existsSync(this.yapBinaryPath)) {
        fs.chmodSync(this.yapBinaryPath, 0o755);
      }
    } finally {
      // Clean up temp files
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  }

  async downloadFile(url, filePath) {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Download failed with status ${response.status}`);
    }

    const fileStream = fs.createWriteStream(filePath);
    const reader = response.body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fileStream.write(value);
      }
    } finally {
      fileStream.end();
      reader.releaseLock();
    }
  }

  async extractTarGz(archivePath, extractPath) {
    return new Promise((resolve, reject) => {
      const child = spawn("tar", ["-xzf", archivePath, "-C", extractPath], {
        stdio: "inherit",
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`tar extraction failed with code ${code}`));
        }
      });

      child.on("error", (error) => {
        reject(new Error(`Failed to extract archive: ${error.message}`));
      });
    });
  }

  async fetchJson(url) {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  }

  async isYapAvailable() {
    try {
      // Check if our vendored YAP works
      if (fs.existsSync(this.yapBinaryPath)) {
        return await this.testYapBinary(this.yapBinaryPath);
      }

      // Check if system YAP works
      return await this.testYapBinary("yap");
    } catch (error) {
      return false;
    }
  }

  async testYapBinary(binaryPath) {
    console.log("Testing YAP binary:", binaryPath);
    return new Promise((resolve) => {
      const child = spawn(binaryPath, ["--help"], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let hasOutput = false;
      child.stdout?.on("data", () => {
        hasOutput = true;
      });

      child.on("close", (code) => {
        resolve(hasOutput && code === 0);
      });

      child.on("error", () => {
        resolve(false);
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        child.kill();
        resolve(false);
      }, 5000);
    });
  }
}

// Run if called directly
if (require.main === module) {
  const setup = new YapPluginSetup();
  setup
    .setup()
    .then(() => {
      console.log("✅ YAP plugin setup completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ YAP plugin setup failed:", error.message);
      process.exit(1);
    });
}

module.exports = { YapPluginSetup };
