<div align=center><img src="./assets/icon-upscale.png" width="200" alt="WhisperMac" /></div>
<div align=center><h1>WhisperMac</h1></div>

Local first, extensible, privacy friendly and fast dictation app for macOS. It supports WhisperCPP, Vosk, mac's native Speech framework (all local) or cloud services like Gemini, or Mistral for transcribing things. This app is currently still in heavy beta, meaning you'll likely run into bugs or it just won't work the way you intend, but I still use it daily (and update frequently).

## Some features:
- Real time transcription using [Silero VAD](https://www.vad.ricky0123.com/) to chunk audio
- Extensible with plugins. See plugins like [the whisper plugin](src/plugins/WhisperCppTranscirptionPlugin.ts)
- WhisperCpp with apple metal CoreML support (the fastest implementation I could find for apple's MPS)
- (Optional) enhancement of transcribed text via an OpenAI compatible service (using Cerebras as the default)
- Configurable actions (Say "Open Safari" or "Open hackernews")
- Unified model management and controllable data storage: You have full control



## Installation
I will build it and upload it once I have things ironed out but for now clone the repo, run `bun run prep` (to download and setup whisper binaries, needs to be done on a apple silicon mac for support for whisper-cli-metal) and then `bun run build`.
