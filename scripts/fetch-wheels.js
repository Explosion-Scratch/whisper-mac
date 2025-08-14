const { spawnSync } = require("child_process");
const { mkdirSync, existsSync } = require("fs");
const path = require("path");

function runCommand(cmd, args, opts) {
  const res = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  return {
    status: res.status === null ? 1 : res.status,
    stdout: res.stdout || "",
    stderr: res.stderr || "",
  };
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
    runCommand("node", [path.join("scripts", "fetch-whisperlive.js")]);
  }

  const req = path.join(whisperDir, "requirements", "server.txt");
  const { readdirSync, statSync } = require("fs");

  function findPythonBinary(dir) {
    try {
      const items = readdirSync(dir);
      // prefer exact python3 then any python3.* then python
      const prefer = items.find((i) => i === "python3");
      if (prefer) return path.join(dir, prefer);
      const v3 = items.find((i) => /^python3(\.|$)/.test(i));
      if (v3) return path.join(dir, v3);
      const py = items.find((i) => i === "python");
      if (py) return path.join(dir, py);
      return null;
    } catch {
      return null;
    }
  }

  const python = findPythonBinary(pythondir);

  console.log(
    `Building complete wheelhouse to ${wheelsDir} using ${python}...`
  );
  const args = ["-m", "pip", "wheel", "-r", req, "-w", wheelsDir];
  if (!python || !existsSync(python)) {
    console.error(`Python interpreter not found in ${pythondir}`);
    console.error(
      "Ensure 'bun run prep:python:[arch]' completed successfully and the embedded python exists."
    );
    process.exit(1);
  }

  console.log("");
  console.log(python + " " + args.join(" "));
  console.log("");

  // Run pip wheel and capture output for diagnostics
  const res = runCommand(python, args, { cwd: process.cwd() });
  process.stdout.write(res.stdout);
  process.stderr.write(res.stderr);
  if (res.status !== 0) {
    console.error(
      `\nFailed to build wheelhouse (exit ${res.status}). Common causes:`
    );
    console.error(
      " - Missing Xcode Command Line Tools (run: xcode-select --install)"
    );
    console.error(
      " - Missing system libraries or headers required to build native wheels"
    );
    console.error(" - Network issues when fetching sdists");
    console.error("Retry locally and inspect above pip output.\n");
    process.exit(res.status || 1);
  }
}

main();
