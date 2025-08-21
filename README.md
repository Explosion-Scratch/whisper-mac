# WhisperMac

Local first, extensible, privacy friendly and fast dictation app for macOS. It supports WhisperCPP, Vosk, Gemini or mac's native Speech framework for transcribing things. This app is currently still in heavy beta, meaning you'll likely run into bugs or it just won't work the way you intend, but I still use it daily (and update it daily).


## Some features:
- Real time transcription using [Silero VAD](https://www.vad.ricky0123.com/) to chunk audio
- Extensible with plugins. See plugins like [the whisper plugin](src/plugins/WhisperCppTranscirptionPlugin.ts)
- WhisperCpp with apple metal CoreML support (the fastest implementation I could find for apple's MPS)
- (Optional) enhancement of transcribed text via an OpenAI compatible service (using Cerebras as the default)
- Configurable actions (Say "Open Safari" or "Open hackernews")
- Unified model management and controllable data storage



## Installation
I will build it and upload it once I have things ironed out but for now clone the repo, run `bun run prep` (to download and setup whisper binaries, needs to be done on a apple silicon mac for support for whisper-cli-metal) and then `bun run build`.
