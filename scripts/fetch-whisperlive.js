const { spawnSync } = require("child_process");
const { existsSync, rmSync } = require("fs");
const path = require("path");

function main() {
  const target = path.join(process.cwd(), "vendor", "whisperlive");
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  const res = spawnSync(
    "git",
    [
      "clone",
      "--depth",
      "1",
      "https://github.com/collabora/WhisperLive.git",
      target,
    ],
    { stdio: "inherit" }
  );
  if (res.status !== 0) {
    process.exit(res.status || 1);
  }
  console.log("WhisperLive snapshot prepared at vendor/whisperlive");
}

main();
