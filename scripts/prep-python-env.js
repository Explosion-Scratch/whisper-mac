const { spawnSync } = require("child_process");
const { mkdirSync, existsSync, createWriteStream, rmSync } = require("fs");
const path = require("path");

const MAMBA_VERSION = "2.3.1-0";
const VENDOR_DIR = path.join(process.cwd(), "vendor");
const MAMBA_DIR = path.join(VENDOR_DIR, "micromamba");
const PYTHON_DIR = path.join(VENDOR_DIR, "python");
const MAMBA_EXECUTABLE = path.join(MAMBA_DIR, "micromamba");

async function download(url, dest) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Failed to download ${url}: ${response.status}`);

  const file = createWriteStream(dest, { mode: 0o755 });
  await new Promise((resolve, reject) => {
    if (response.body && typeof response.body.pipe === "function") {
      // Node.js 18+ with readable streams
      response.body.pipe(file);
      file.on("finish", resolve);
      file.on("error", reject);
    } else {
      // Fallback for environments where response.body is not a readable stream
      response
        .arrayBuffer()
        .then((buffer) => {
          file.write(Buffer.from(buffer));
          file.end();
          file.on("finish", resolve);
          file.on("error", reject);
        })
        .catch(reject);
    }
  });
}

function runCommand(
  command,
  args,
  { cwd = process.cwd(), stdio = "inherit" } = {}
) {
  const result = spawnSync(command, args, { cwd, stdio });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const message = `${command} ${args.join(" ")} failed with status ${
      result.status
    }`;
    console.error(message);
    throw new Error(message);
  }
}

function getMambaUrlForPlatform(platform, arch) {
  const platformMap = {
    darwin: "osx",
    linux: "linux",
    win32: "win",
  };
  const archMap = {
    x64: "64",
    arm64: "arm64",
  };
  const ext = platform === "win32" ? "zip" : "tar.bz2";
  const mambaPlatform = platformMap[platform];
  const mambaArch = archMap[arch] || arch;
  //   https://github.com/mamba-org/micromamba-releases/releases/download/2.3.1-0/micromamba-osx-64.tar.bz2
  if (!mambaPlatform) throw new Error(`Unsupported platform: ${platform}`);
  return `https://github.com/mamba-org/micromamba-releases/releases/download/${MAMBA_VERSION}/micromamba-${mambaPlatform}-${mambaArch}`;
}

async function installMicromamba() {
  if (existsSync(MAMBA_EXECUTABLE)) {
    console.log("Micromamba is already installed.");
    return;
  }
  console.log("Installing micromamba...");
  mkdirSync(MAMBA_DIR, { recursive: true });
  const url = getMambaUrlForPlatform(process.platform, process.arch);
  await download(url, MAMBA_EXECUTABLE);
}

async function createPythonEnvironment() {
  console.log("Creating Python environment...");
  const requirementsPath = path.join(
    VENDOR_DIR,
    "whisperlive",
    "requirements",
    "server.txt"
  );
  if (!existsSync(requirementsPath)) {
    console.log("Cloning WhisperLive to get requirements...");
    runCommand("git", [
      "clone",
      "--depth",
      "1",
      "https://github.com/collabora/WhisperLive.git",
      path.join(VENDOR_DIR, "whisperlive"),
    ]);
  }
  const channels = ["-c", "pytorch", "-c", "conda-forge"];
  const createArgs = [
    "create",
    "-p",
    PYTHON_DIR,
    "--yes",
    ...channels,
    "python=3.12",
    "pip", // Explicitly install pip into the environment
    "pytorch", // Install PyTorch from its dedicated channel for best results
  ];
  console.log("Creating base environment with Python, Pip, and PyTorch...");
  runCommand(MAMBA_EXECUTABLE, createArgs);

  // Step 2: Use the pip from the new environment to install the requirements file.
  // We use `micromamba run` to "activate" the environment for the pip command.
  const installArgs = [
    "run",
    "-p",
    PYTHON_DIR,
    "pip",
    "install",
    "-r",
    requirementsPath,
    "--no-deps", // Important: prevent pip from re-installing things conda already did (like PyTorch)
  ];
  console.log("Installing pip packages from requirements.txt...");
  runCommand(MAMBA_EXECUTABLE, installArgs);
  console.log("Python environment created successfully.");
}

async function main() {
  mkdirSync(VENDOR_DIR, { recursive: true });
  await installMicromamba();
  await createPythonEnvironment();
}

main().catch((err) => {
  console.error("Failed to prepare Python environment:", err);
  process.exit(1);
});
