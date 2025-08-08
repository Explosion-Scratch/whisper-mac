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
  const arch = process.env.ARCH || process.arch; // allow override for cross-build
  const vendorDir = path.join(process.cwd(), "vendor");
  const whisperDir = path.join(vendorDir, "whisperlive");
  const pythondir = path.join(vendorDir, "python", `darwin-${arch}`, "bin");
  const wheelsDir = path.join(vendorDir, "wheels", `darwin-${arch}`);
  mkdirSync(wheelsDir, { recursive: true });

  if (!existsSync(whisperDir)) {
    console.log("vendor/whisperlive missing; preparing snapshot...");
    run("node", [path.join("scripts", "fetch-whisperlive.js")]);
  }

  const req = path.join(whisperDir, "requirements", "server.txt");
  const python = path.join(pythondir, "python3");

  console.log(
    `Building complete wheelhouse to ${wheelsDir} using ${python}...`
  );
  const args = ["-m", "pip", "wheel", "-r", req, "-w", wheelsDir];
  console.log("");
  console.log(python + " " + args.join(" "));
  console.log("");
  run(python, args);
}

main();
