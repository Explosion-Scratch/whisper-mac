const { spawnSync } = require("child_process");
const { mkdirSync, existsSync } = require("fs");
const path = require("path");

function run(cmd, args, opts) {
  const res = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (res.status !== 0) process.exit(res.status || 1);
}

function main() {
  const platform = process.platform;
  if (platform !== "darwin") {
    console.log("Skipping wheel fetch: not macOS");
    return;
  }
  const arch = process.arch; // arm64 or x64
  const vendorDir = path.join(process.cwd(), "vendor");
  const whisperDir = path.join(vendorDir, "whisperlive");
  const pythondir = path.join(vendorDir, "python", "bin")
  const wheelsDir = path.join(vendorDir, "wheels", `darwin-${arch}`);
  mkdirSync(wheelsDir, { recursive: true });

  if (!existsSync(whisperDir)) {
    console.log("vendor/whisperlive missing; preparing snapshot...");
    run("node", [path.join("scripts", "fetch-whisperlive.js")]);
  }

  const req = path.join(whisperDir, "requirements", "server.txt");
  const python =path.join(pythondir, "python");

  console.log(`Downloading wheels to ${wheelsDir} using ${python}...`);
  run(python, ["-m", "pip", "download", "-r", req, "-d", wheelsDir]);
}

main();
