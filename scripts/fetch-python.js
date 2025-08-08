const {
  mkdirSync,
  existsSync,
  rmSync,
  createWriteStream,
  cpSync,
} = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

// Optional: restrict to a specific python-build-standalone version by
// setting the environment variable `PYTHON_BUILD_STANDALONE_VERSION`.
const VERSION = process.env.PYTHON_BUILD_STANDALONE_VERSION || "3.12";

async function download(url, dest) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }

  const file = createWriteStream(dest);
  const reader = response.body.getReader();

  return new Promise((resolve, reject) => {
    function pump() {
      return reader.read().then(({ done, value }) => {
        if (done) {
          file.close(() => resolve(undefined));
          return;
        }
        file.write(value);
        return pump();
      });
    }

    pump().catch(reject);
  });
}

function untar(archivePath, extractTo) {
  mkdirSync(extractTo, { recursive: true });
  if (archivePath.endsWith(".tar.zst")) {
    // Decompress with zstd if available, then extract
    const haveZstd =
      spawnSync("zstd", ["--version"]).status === 0 ||
      spawnSync("unzstd", ["--version"]).status === 0;
    if (!haveZstd) {
      throw new Error(
        "zstd not found. Please install it (e.g. 'brew install zstd') to extract .tar.zst archives."
      );
    }
    const tarPath = archivePath.replace(/\.zst$/, "");
    const dec = spawnSync("zstd", ["-d", "-f", archivePath, "-o", tarPath], {
      stdio: "inherit",
    });
    if (dec.status !== 0) {
      throw new Error(`Failed to decompress ${archivePath}`);
    }
    const res = spawnSync("tar", ["-xf", tarPath, "-C", extractTo]);
    if (res.status !== 0) throw new Error(`Failed to extract ${tarPath}`);
    return;
  }
  const res = spawnSync("tar", ["-xf", archivePath, "-C", extractTo]);
  if (res.status !== 0) {
    throw new Error(`Failed to extract ${archivePath}`);
  }
}

function archToTriplet(arch) {
  return arch === "arm64"
    ? "aarch64-apple-darwin"
    : arch === "x64"
    ? "x86_64-apple-darwin"
    : null;
}

function createTempDir() {
  const result = spawnSync("mktemp", ["-d", "python-download-XXXXXX"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error("Failed to create temporary directory with mktemp");
  }
  return result.stdout.trim();
}

async function fetchPythonForArch(arch) {
  const triplet = archToTriplet(arch);
  if (!triplet) throw new Error(`Unsupported arch: ${arch}`);

  const vendorDir = path.join(process.cwd(), "vendor");
  const rootDir = path.join(vendorDir, "python");
  const archDir = path.join(rootDir, `darwin-${arch}`);
  mkdirSync(vendorDir, { recursive: true });
  mkdirSync(rootDir, { recursive: true });

  if (existsSync(path.join(archDir, "bin", "python3"))) {
    console.log(`Python already present for ${arch} at ${archDir}`);
    return;
  }

  // Discover latest python-build-standalone asset from GitHub
  const apiUrl =
    "https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest";
  const headers = { "User-Agent": "whispermac-build-script" };

  const response = await fetch(apiUrl, { headers });
  if (!response.ok) {
    throw new Error(`Failed to fetch GitHub API: ${response.status}`);
  }

  const meta = await response.json();

  const assets = (meta && meta.assets) || [];
  // Prefer .tar.xz or .tar.gz to avoid zstd dependency; fall back to .tar.zst
  const preferred = assets.find(
    (a) =>
      typeof a.name === "string" &&
      a.name.includes("cpython-") &&
      (VERSION === "" || a.name.includes(VERSION)) &&
      a.name.includes(triplet) &&
      a.name.includes("install_only") &&
      (a.name.endsWith(".tar.xz") || a.name.endsWith(".tar.gz"))
  );
  const fallback = assets.find(
    (a) =>
      typeof a.name === "string" &&
      a.name.includes("cpython-") &&
      (VERSION === "" || a.name.includes(VERSION)) &&
      a.name.includes(triplet) &&
      a.name.includes("install_only") &&
      a.name.endsWith(".tar.zst")
  );
  const asset = preferred || fallback;
  if (!asset) {
    throw new Error(
      `Could not find python-build-standalone asset for ${triplet}`
    );
  }

  const tmpDir = createTempDir();
  const archivePath = path.join(tmpDir, asset.name);
  console.log(`Downloading ${asset.name} ...`);
  await download(asset.browser_download_url, archivePath);

  const extractTo = path.join(tmpDir, `extract-${arch}`);
  console.log(`Extracting ${asset.name} ...`);
  untar(archivePath, extractTo);

  // install_only archives contain a top-level 'python/' directory
  const extractedPythonDir = path.join(extractTo, "python");
  if (!existsSync(extractedPythonDir)) {
    throw new Error(`Unexpected archive layout: ${asset.name}`);
  }

  // Clean and copy fresh to avoid stale partials
  if (existsSync(archDir)) {
    rmSync(archDir, { recursive: true, force: true });
  }
  mkdirSync(archDir, { recursive: true });
  console.log(`Copying Python to ${archDir} ...`);
  // Prefer rsync with -L to dereference symlinks and avoid links back to the
  // temporary extraction directory. Fall back to fs.cpSync with dereference
  // when rsync isn't available.
  const tryRsync = (() => {
    try {
      const r = spawnSync("rsync", ["--version"]);
      return r.status === 0;
    } catch {
      return false;
    }
  })();

  if (tryRsync) {
    const res = spawnSync(
      "rsync",
      ["-aL", extractedPythonDir + "/", archDir + "/"],
      {
        stdio: "inherit",
      }
    );
    if (res.status !== 0)
      throw new Error("rsync failed while copying Python payload");
  } else {
    try {
      cpSync(extractedPythonDir + "/", archDir + "/", {
        recursive: true,
        dereference: true,
      });
    } catch (e) {
      // Older Node versions may not support dereference; attempt a simple copy
      cpSync(extractedPythonDir + "/", archDir + "/", { recursive: true });
    }
  }
  console.log(`Embedded Python prepared at ${archDir}`);

  // Clean up temporary directory
  rmSync(tmpDir, { recursive: true, force: true });
}

async function main() {
  if (process.platform !== "darwin") {
    console.log("Skipping embedded Python fetch: only implemented for macOS");
    return;
  }

  const requested = process.env.ARCH ? [process.env.ARCH] : ["arm64", "x64"];
  for (const arch of requested) {
    await fetchPythonForArch(arch);
  }

  // Do not mirror into top-level here; staging is handled per-target by stage-python-arch.js
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
