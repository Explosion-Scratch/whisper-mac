const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

/**
 * Plugin setup system
 * Runs setup scripts for all transcription plugins
 */
class PluginSetupManager {
  constructor() {
    this.pluginDir = path.join(__dirname, '..', 'plugins-setup');
    this.vendorDir = path.join(__dirname, '..', 'vendor');
  }

  async setupAllPlugins() {
    console.log('=== Setting up transcription plugins ===');
    
    // Ensure vendor directory exists
    if (!fs.existsSync(this.vendorDir)) {
      fs.mkdirSync(this.vendorDir, { recursive: true });
    }

    // Find all plugin setup scripts
    const setupScripts = this.findSetupScripts();
    
    if (setupScripts.length === 0) {
      console.log('No plugin setup scripts found');
      return;
    }

    console.log(`Found ${setupScripts.length} plugin setup scripts:`);
    setupScripts.forEach(script => console.log(`  - ${script}`));

    // Run setup scripts in parallel
    const setupPromises = setupScripts.map(script => this.runSetupScript(script));
    const results = await Promise.allSettled(setupPromises);

    // Report results
    console.log('\n=== Plugin Setup Results ===');
    results.forEach((result, index) => {
      const script = setupScripts[index];
      if (result.status === 'fulfilled') {
        console.log(`✅ ${script}: Success`);
      } else {
        console.log(`❌ ${script}: Failed - ${result.reason}`);
      }
    });

    console.log('=== Plugin setup complete ===');
  }

  findSetupScripts() {
    if (!fs.existsSync(this.pluginDir)) {
      return [];
    }

    return fs.readdirSync(this.pluginDir)
      .filter(file => file.endsWith('-setup.js'))
      .map(file => path.join(this.pluginDir, file));
  }

  async runSetupScript(scriptPath) {
    return new Promise((resolve, reject) => {
      const scriptName = path.basename(scriptPath);
      console.log(`\n🔧 Running ${scriptName}...`);

      const child = spawn('node', [scriptPath], {
        stdio: 'inherit',
        cwd: path.dirname(scriptPath)
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve(scriptName);
        } else {
          reject(new Error(`Setup script ${scriptName} exited with code ${code}`));
        }
      });

      child.on('error', (error) => {
        reject(new Error(`Failed to run setup script ${scriptName}: ${error.message}`));
      });
    });
  }
}

// Run if called directly
if (require.main === module) {
  const manager = new PluginSetupManager();
  manager.setupAllPlugins()
    .then(() => {
      console.log('\n✅ All plugin setups completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Plugin setup failed:', error);
      process.exit(1);
    });
}

module.exports = { PluginSetupManager };
