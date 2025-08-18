const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');

/**
 * YAP Plugin Setup
 * Downloads and sets up YAP binary for the transcription plugin
 */
class YapPluginSetup {
  constructor() {
    this.vendorDir = path.join(__dirname, '..', 'vendor', 'yap');
    this.yapBinaryPath = path.join(this.vendorDir, 'yap');
    this.yapVersion = '1.0.3';
  }

  async setup() {
    console.log('Setting up YAP transcription plugin...');
    
    // Create vendor directory
    if (!fs.existsSync(this.vendorDir)) {
      fs.mkdirSync(this.vendorDir, { recursive: true });
      console.log(`Created directory: ${this.vendorDir}`);
    }

    // Check if YAP is already installed and working
    if (await this.isYapAvailable()) {
      console.log('YAP is already available and working');
      return;
    }

    // Try to install via Homebrew first (most reliable)
    console.log('Attempting to install YAP via Homebrew...');
    try {
      await this.installViaHomebrew();
      
      // Copy to vendor directory for bundling
      await this.copyFromSystem();
      
      if (await this.isYapAvailable()) {
        console.log('✅ YAP installed successfully via Homebrew');
        return;
      }
    } catch (error) {
      console.log('Homebrew installation failed, trying direct download...');
    }

    // Fallback: try direct download (though YAP doesn't provide pre-built binaries)
    console.log('⚠️  YAP requires building from source or Homebrew installation');
    console.log('Please install YAP manually:');
    console.log('  brew install finnvoor/tools/yap');
    console.log('Or build from source: https://github.com/finnvoor/yap');
    
    throw new Error('YAP installation failed - manual installation required');
  }

  async isYapAvailable() {
    try {
      // Check if our vendored YAP works
      if (fs.existsSync(this.yapBinaryPath)) {
        return await this.testYapBinary(this.yapBinaryPath);
      }
      
      // Check if system YAP works
      return await this.testYapBinary('yap');
    } catch (error) {
      return false;
    }
  }

  async testYapBinary(binaryPath) {
    return new Promise((resolve) => {
      const child = spawn(binaryPath, ['--help'], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let hasOutput = false;
      child.stdout?.on('data', () => {
        hasOutput = true;
      });

      child.on('close', (code) => {
        resolve(hasOutput && code === 0);
      });

      child.on('error', () => {
        resolve(false);
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        child.kill();
        resolve(false);
      }, 5000);
    });
  }

  async installViaHomebrew() {
    return new Promise((resolve, reject) => {
      console.log('Installing YAP via Homebrew...');
      
      const child = spawn('brew', ['install', 'finnvoor/tools/yap'], {
        stdio: 'inherit'
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Homebrew install failed with code ${code}`));
        }
      });

      child.on('error', (error) => {
        reject(new Error(`Homebrew install failed: ${error.message}`));
      });
    });
  }

  async copyFromSystem() {
    return new Promise((resolve, reject) => {
      // Find YAP in system PATH
      const child = spawn('which', ['yap'], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let systemPath = '';
      child.stdout?.on('data', (data) => {
        systemPath += data.toString().trim();
      });

      child.on('close', (code) => {
        if (code === 0 && systemPath && fs.existsSync(systemPath)) {
          try {
            fs.copyFileSync(systemPath, this.yapBinaryPath);
            fs.chmodSync(this.yapBinaryPath, 0o755); // Make executable
            console.log(`Copied YAP from ${systemPath} to ${this.yapBinaryPath}`);
            resolve();
          } catch (error) {
            reject(new Error(`Failed to copy YAP binary: ${error.message}`));
          }
        } else {
          reject(new Error('YAP not found in system PATH'));
        }
      });

      child.on('error', (error) => {
        reject(new Error(`Failed to locate YAP: ${error.message}`));
      });
    });
  }
}

// Run if called directly
if (require.main === module) {
  const setup = new YapPluginSetup();
  setup.setup()
    .then(() => {
      console.log('✅ YAP plugin setup completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ YAP plugin setup failed:', error.message);
      process.exit(1);
    });
}

module.exports = { YapPluginSetup };
