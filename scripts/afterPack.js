const fs = require('fs');
const path = require('path');

function rmSync(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`  Removed: ${dir}`);
  }
}

function removeFilesMatching(dir, pattern) {
  if (!fs.existsSync(dir)) return;
  
  const walk = (currentDir) => {
    const files = fs.readdirSync(currentDir);
    for (const file of files) {
      const filePath = path.join(currentDir, file);
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        walk(filePath);
      } else if (pattern.test(file)) {
        fs.unlinkSync(filePath);
      }
    }
  };
  walk(dir);
}

exports.default = async function(context) {
  const { appOutDir, arch } = context;
  const archName = arch === 1 ? 'x64' : 'arm64';
  const otherArch = arch === 1 ? 'arm64' : 'x64';
  
  console.log(`\n[afterPack] Cleaning up build for ${archName}...`);
  
  const resourcesDir = path.join(appOutDir, 'WhisperMac.app', 'Contents', 'Resources');
  const unpackedDir = path.join(resourcesDir, 'app.asar.unpacked');
  const onnxNodeDir = path.join(unpackedDir, 'node_modules', 'onnxruntime-node');
  const onnxBinDir = path.join(onnxNodeDir, 'bin', 'napi-v6');
  
  console.log('[afterPack] Removing unused ONNX platform binaries...');
  rmSync(path.join(onnxBinDir, 'linux'));
  rmSync(path.join(onnxBinDir, 'win32'));
  rmSync(path.join(onnxBinDir, 'darwin', otherArch));
  
  console.log('[afterPack] Removing source maps from asar.unpacked...');
  removeFilesMatching(unpackedDir, /\.map$/);
  
  console.log('[afterPack] Cleanup complete!\n');
};
