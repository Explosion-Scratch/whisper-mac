const { execSync } = require("child_process");
const { mkdirSync, existsSync, rmSync } = require("fs");
const path = require("path");
const os = require("os");

function main() {
  const arch = process.arch; // 'arm64' or 'x64'
  const platform = process.platform; // expect 'darwin'
  if (platform !== "darwin") {
    console.log("Skipping embedded Python fetch: not macOS");
    return;
  }

  const vendorDir = path.join(process.cwd(), "vendor");
  const target = path.join(vendorDir, "python");
  mkdirSync(vendorDir, { recursive: true });

  if (existsSync(target)) {
    console.log("Removing existing vendor/python...");
    rmSync(target, { recursive: true, force: true });
  }

  // Use python.org installer payloads extracted via pkgutil --expand-full
  // For brevity, we rely on 'pyenv' if available to build a relocatable python,
  // otherwise we try system python to bootstrap venv during install time.
  try {
    execSync("command -v pyenv", { stdio: "ignore" });
    const ver = "3.12";
    console.log(`Using pyenv to build Python ${ver} (${arch})...`);
    execSync(`pyenv install -s ${ver}`, { stdio: "inherit" });
    const prefix = execSync(`pyenv prefix ${ver}`).toString().trim();
    console.log("Copying pyenv Python to vendor/python...");
    execSync(`rsync -a --delete ${prefix}/ ${target}/`, { stdio: "inherit" });
    console.log("Embedded Python prepared at vendor/python");
    return;
  } catch (e) {
    console.log(
      "pyenv not available; will fall back to system python at runtime."
    );
  }
}

main();
