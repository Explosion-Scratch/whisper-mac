const fs = require("fs");
const path = require("path");

const config = {
  baseSrc: path.join(__dirname, "../src"),
  baseDist: path.join(__dirname, "../dist"),
  renderer: {
    src: path.join(__dirname, "../src/renderer"),
    dist: path.join(__dirname, "../dist/renderer"),
  },
  photon: {
    src: path.join(__dirname, "../src/photon"),
    dist: path.join(__dirname, "../dist/photon"),
  },
  prompts: {
    src: path.join(__dirname, "../src/prompts"),
    dist: path.join(__dirname, "../dist/prompts"),
  },
};

const EXTENSIONS = [
  ".html",
  ".js",
  ".css",
  ".png",
  ".svg",
  ".ico",
  ".eot",
  ".ttf",
  ".woff",
];

// Copy renderer files
if (!fs.existsSync(config.renderer.dist)) {
  fs.mkdirSync(config.renderer.dist, { recursive: true });
}

fs.readdirSync(config.renderer.src).forEach((file) => {
  if (EXTENSIONS.find((ext) => file.endsWith(ext))) {
    fs.copyFileSync(
      path.join(config.renderer.src, file),
      path.join(config.renderer.dist, file)
    );
    console.log(`Copied ${file} to dist/renderer`);
  }
});

// Copy Photon assets
function copyPhotonAssets(srcPath, destPath) {
  if (!fs.existsSync(srcPath)) return;

  if (!fs.existsSync(destPath)) {
    fs.mkdirSync(destPath, { recursive: true });
  }

  const items = fs.readdirSync(srcPath);
  items.forEach((item) => {
    const srcItemPath = path.join(srcPath, item);
    const destItemPath = path.join(destPath, item);

    if (fs.statSync(srcItemPath).isDirectory()) {
      copyPhotonAssets(srcItemPath, destItemPath);
    } else {
      if (EXTENSIONS.find((ext) => item.endsWith(ext))) {
        fs.copyFileSync(srcItemPath, destItemPath);
        console.log(
          `Copied Photon ${item} to ${path.relative(
            __dirname + "/..",
            destItemPath
          )}`
        );
      }
    }
  });
}

copyPhotonAssets(config.photon.src, config.photon.dist);

// Copy prompts files
if (!fs.existsSync(config.prompts.dist)) {
  fs.mkdirSync(config.prompts.dist, { recursive: true });
}

fs.readdirSync(config.prompts.src).forEach((file) => {
  if (file.endsWith(".txt")) {
    fs.copyFileSync(
      path.join(config.prompts.src, file),
      path.join(config.prompts.dist, file)
    );
    console.log(`Copied ${file} to dist/prompts`);
  }
});
