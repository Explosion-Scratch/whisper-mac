/**
 * Simple test script to start the WhisperLive server using TranscriptionClient.
 *
 * Usage:
 *   bun run scripts/test-whisperlive.ts [modelRepoId] [port]
 *
 * Examples:
 *   bun run scripts/test-whisperlive.ts
 *   bun run scripts/test-whisperlive.ts Systran/faster-whisper-tiny.en 9091
 */

import { AppConfig } from "../src/config/AppConfig";
import { ModelManager } from "../src/services/ModelManager";
import { TranscriptionClient } from "../src/services/WhisperLiveClient";

async function main(): Promise<void> {
  process.env.USE_LOCAL_DATA_DIR = process.env.USE_LOCAL_DATA_DIR || "1";

  const args = process.argv.slice(2);
  const modelRepoId = args[0] || "Systran/faster-whisper-tiny.en";
  const portArg = args[1];

  const config = new AppConfig();
  if (portArg) {
    const parsed = Number(portArg);
    if (!Number.isNaN(parsed) && parsed > 0) config.setServerPort(parsed);
  }
  config.setDefaultModel(modelRepoId);

  const modelManager = new ModelManager(config);
  const client = new TranscriptionClient(config, modelManager);

  const onProgress = (p: { status: string; message: string }) => {
    console.log(`[progress] ${p.status}: ${p.message}`);
  };
  const onLog = (line: string) => process.stdout.write(line);

  console.log("Ensuring model is available:", modelRepoId);
  await modelManager.ensureModelExists(modelRepoId, undefined, onLog);

  console.log(`Starting server on port ${config.serverPort}...`);
  await client.startServer(modelRepoId, onProgress, onLog);

  console.log("WhisperLive server started. Press Ctrl+C to stop.");

  const shutdown = async () => {
    console.log("\nStopping server...");
    try {
      await client.stopServer();
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Failed to start WhisperLive server:", err);
  process.exit(1);
});
