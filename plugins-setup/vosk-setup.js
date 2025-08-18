const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

/**
 * Vosk Plugin Setup
 * Sets up Python vosk package and creates transcription script
 */
class VoskPluginSetup {
  constructor() {
    this.vendorDir = path.join(__dirname, "..", "vendor", "vosk");
    this.transcriptScriptPath = path.join(this.vendorDir, "vosk_transcribe.py");
  }

  async setup() {
    console.log("Setting up Vosk transcription plugin...");

    // Create vendor directory
    if (!fs.existsSync(this.vendorDir)) {
      fs.mkdirSync(this.vendorDir, { recursive: true });
      console.log(`Created directory: ${this.vendorDir}`);
    }

    // Check if Python and pip are available
    const pythonAvailable = await this.checkPython();
    if (!pythonAvailable) {
      console.log("⚠️  Python3 not found. Vosk plugin requires Python 3.7+");
      console.log("Please install Python 3 and try again.");
      throw new Error("Python 3 not available");
    }

    // Install vosk package if not available
    const voskAvailable = await this.checkVoskPackage();
    if (!voskAvailable) {
      console.log("Installing vosk package...");
      await this.installVoskPackage();

      // Verify installation
      const voskNowAvailable = await this.checkVoskPackage();
      if (!voskNowAvailable) {
        console.log("⚠️  Failed to install vosk package");
        console.log("Please install manually: pip3 install vosk");
        throw new Error("Vosk package installation failed");
      }
    }

    // Create the transcription script
    await this.createTranscriptionScript();

    console.log("✅ Vosk plugin setup completed successfully");
    console.log(
      "📝 Note: Vosk models will be downloaded automatically when first used"
    );
    console.log(
      "📝 Models are downloaded from: https://alphacephei.com/vosk/models"
    );
  }

  async checkPython() {
    return new Promise((resolve) => {
      const python = spawn("python3", ["--version"], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let hasOutput = false;
      python.stdout?.on("data", () => {
        hasOutput = true;
      });

      python.on("close", (code) => {
        resolve(hasOutput && code === 0);
      });

      python.on("error", () => {
        resolve(false);
      });

      setTimeout(() => {
        python.kill();
        resolve(false);
      }, 5000);
    });
  }

  async checkVoskPackage() {
    return new Promise((resolve) => {
      const python = spawn(
        "python3",
        ["-c", "import vosk; print('vosk available')"],
        {
          stdio: ["ignore", "pipe", "pipe"],
        }
      );

      let hasOutput = false;
      python.stdout?.on("data", () => {
        hasOutput = true;
      });

      python.on("close", (code) => {
        resolve(hasOutput && code === 0);
      });

      python.on("error", () => {
        resolve(false);
      });

      setTimeout(() => {
        python.kill();
        resolve(false);
      }, 5000);
    });
  }

  async installVoskPackage() {
    return new Promise((resolve, reject) => {
      // Try user installation first (recommended)
      const pip = spawn("pip3", ["install", "--user", "vosk"], {
        stdio: "inherit",
      });

      pip.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          // If user install fails, try with break-system-packages
          console.log(
            "User installation failed, trying with --break-system-packages..."
          );
          const pip2 = spawn(
            "pip3",
            ["install", "--break-system-packages", "vosk"],
            {
              stdio: "inherit",
            }
          );

          pip2.on("close", (code2) => {
            if (code2 === 0) {
              resolve();
            } else {
              reject(new Error(`pip install failed with code ${code2}`));
            }
          });

          pip2.on("error", (error) => {
            reject(new Error(`Failed to run pip: ${error.message}`));
          });
        }
      });

      pip.on("error", (error) => {
        reject(new Error(`Failed to run pip: ${error.message}`));
      });
    });
  }

  async createTranscriptionScript() {
    const scriptContent = `#!/usr/bin/env python3
"""
Vosk transcription script for WhisperMac
Transcribes audio files using the Vosk speech recognition engine
"""

import json
import wave
import sys
import argparse
import vosk
import logging

# Suppress vosk debug output
logging.getLogger("vosk").setLevel(logging.WARNING)

def transcribe_audio(audio_path, model_path, sample_rate=16000):
    """Transcribe audio file using Vosk model"""
    try:
        # Load the model
        if not vosk.Model.Exists(model_path):
            print(f"Error: Model not found at {model_path}", file=sys.stderr)
            sys.exit(1)
            
        model = vosk.Model(model_path)
        rec = vosk.KaldiRecognizer(model, sample_rate)
        
        # Open the audio file
        wf = wave.open(audio_path, 'rb')
        
        # Check audio format
        if wf.getnchannels() != 1 or wf.getsampwidth() != 2 or wf.getcomptype() != 'NONE':
            print("Error: Audio file must be WAV format mono PCM.", file=sys.stderr)
            sys.exit(1)
            
        results = []
        
        # Process audio in chunks
        while True:
            data = wf.readframes(4000)
            if len(data) == 0:
                break
            if rec.AcceptWaveform(data):
                result = json.loads(rec.Result())
                if result.get('text', '').strip():
                    results.append(result['text'])
        
        # Get final result
        final_result = json.loads(rec.FinalResult())
        if final_result.get('text', '').strip():
            results.append(final_result['text'])
        
        wf.close()
        
        # Combine all results
        full_text = ' '.join(results).strip()
        return full_text if full_text else "[No speech detected]"
        
    except Exception as e:
        print(f"Transcription error: {e}", file=sys.stderr)
        sys.exit(1)

def main():
    parser = argparse.ArgumentParser(description='Transcribe audio using Vosk')
    parser.add_argument('--audio', required=True, help='Path to audio file')
    parser.add_argument('--model', required=True, help='Path to Vosk model directory')
    parser.add_argument('--sample-rate', type=int, default=16000, help='Audio sample rate')
    
    args = parser.parse_args()
    
    # Transcribe the audio
    transcription = transcribe_audio(args.audio, args.model, args.sample_rate)
    
    # Output the transcription
    print(transcription)

if __name__ == "__main__":
    main()
`;

    fs.writeFileSync(this.transcriptScriptPath, scriptContent);
    fs.chmodSync(this.transcriptScriptPath, 0o755);
    console.log(`Created transcription script: ${this.transcriptScriptPath}`);
  }
}

// Run if called directly
if (require.main === module) {
  const setup = new VoskPluginSetup();
  setup
    .setup()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Vosk plugin setup failed:", error.message);
      process.exit(1);
    });
}

module.exports = { VoskPluginSetup };
