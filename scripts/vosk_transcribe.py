#!/usr/bin/env python3

import argparse
import wave
import os
import sys
import json

from vosk import Model, KaldiRecognizer

def main():
    parser = argparse.ArgumentParser(
        description="Transcribe audio using Vosk"
    )
    parser.add_argument("--audio", required=True, type=str, help="Path to audio file")
    parser.add_argument("--model", required=True, type=str, help="Path to Vosk model directory")
    parser.add_argument("--sample-rate", type=int, default=16000, help="Audio sample rate")
    args = parser.parse_args()

    # Open the audio file
    if not os.path.exists(args.audio):
        print(f"Audio file '{args.audio}' not found.")
        sys.exit(1)

    wf = wave.open(args.audio, "rb")
    if wf.getnchannels() != 1 or wf.getsampwidth() != 2 or wf.getframerate() != args.sample_rate:
        print("Audio file must be WAV format mono PCM.")
        sys.exit(1)

    # Load Vosk model
    if not os.path.exists(args.model):
        print(f"Model directory '{args.model}' not found.")
        sys.exit(1)
    model = Model(args.model)

    rec = KaldiRecognizer(model, args.sample_rate)
    rec.SetWords(True)

    results = []
    while True:
        data = wf.readframes(4000)
        if len(data) == 0:
            break
        if rec.AcceptWaveform(data):
            res = json.loads(rec.Result())
            print(res.get("text", ""))
            results.append(res)
        else:
            res = json.loads(rec.PartialResult())
            # You may print partial results if desired

    # Final result
    res = json.loads(rec.FinalResult())
    print(res.get("text", ""))
    results.append(res)

if __name__ == "__main__":
    main()