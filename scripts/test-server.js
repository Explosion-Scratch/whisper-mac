const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

// Paths
const pythonServerPath = path.join(__dirname, "../python/whisper_server.py");
const modelDir = path.join(__dirname, "../models");
const modelName = "tiny.en";
const modelPath = path.join(modelDir, `${modelName}.pt`);
const port = 9090;
const testHtmlPath = path.join(__dirname, "test-server.html");

// Check if model exists
if (!fs.existsSync(modelPath)) {
  console.error(`Model file not found: ${modelPath}`);
  process.exit(1);
}

// Start Python server
console.log(`Starting Whisper server on port ${port}...`);
const serverProcess = spawn(
  "python3",
  [
    pythonServerPath,
    "--port",
    port.toString(),
    "--model",
    modelName,
    "--model-path",
    modelPath,
  ],
  {
    stdio: ["ignore", "pipe", "pipe"],
  },
);

serverProcess.stdout.on("data", (data) => {
  console.log(`[server stdout] ${data.toString().trim()}`);
});

serverProcess.stderr.on("data", (data) => {
  console.error(`[server stderr] ${data.toString().trim()}`);
});

serverProcess.on("exit", (code) => {
  console.log(`Whisper server exited with code ${code}`);
  process.exit(code);
});

// Open test HTML file in default browser using CLI
console.log(`Opening test HTML: ${testHtmlPath}`);
spawn("open", [testHtmlPath], { stdio: "ignore" });

// Cleanup on exit
process.on("SIGINT", () => {
  console.log("Shutting down server...");
  serverProcess.kill("SIGTERM");
  process.exit(0);
});
