import { spawnSync } from "bun";
import { existsSync, rmSync } from "fs";
import { join } from "path";
import { arch } from "os";

const APP_NAME = "WhisperMac.app";
const DEST_PATH = join("/Applications", APP_NAME);
const ARCH = arch() === "arm64" ? "arm64" : "x64";
const BUILD_SCRIPT = `build:mac:${ARCH}`;
const SOURCE_PATH = join(process.cwd(), "release", `mac-${ARCH}`, APP_NAME);

/**
 * Executes a command and prints its output.
 */
function run(command: string, args: string[]) {
  console.log(`> ${command} ${args.join(" ")}`);
  const result = spawnSync([command, ...args], {
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) {
    console.error(`Command failed with exit code ${result.exitCode}`);
    process.exit(1);
  }
}

async function main() {
  console.log(`Installing ${APP_NAME} for ${ARCH}...`);

  // 1. Build the app
  console.log("Building application...");
  run("bun", ["run", BUILD_SCRIPT]);

  // 2. Verify source exists
  if (!existsSync(SOURCE_PATH)) {
    console.error(`Error: Could not find built app at ${SOURCE_PATH}`);
    process.exit(1);
  }

  // 3. Remove old version
  if (existsSync(DEST_PATH)) {
    console.log(`Removing old version at ${DEST_PATH}...`);
    // Using rm -rf via spawn to handle potential permission issues or large directories better
    run("rm", ["-rf", DEST_PATH]);
  }

  // 4. Copy to /Applications
  console.log(`Copying ${SOURCE_PATH} to ${DEST_PATH}...`);
  run("cp", ["-R", SOURCE_PATH, DEST_PATH]);

  // 5. Post-install cleanup (like in package.json)
  console.log("Updating permissions and removing quarantine flags...");
  run("xattr", ["-cr", DEST_PATH]);
  
  // Note: resetperms in package.json uses tccutil reset All com.whispermac.app
  // We'll include it to ensure a fresh start
  try {
    run("tccutil", ["reset", "All", "com.whispermac.app"]);
  } catch (e) {
    console.warn("Could not reset TCC permissions (this is usually fine).");
  }

  console.log("\nSuccessfully installed WhisperMac to /Applications!");
}

main().catch((err) => {
  console.error("Installation failed:", err);
  process.exit(1);
});
