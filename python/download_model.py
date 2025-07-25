#!/usr/bin/env python3
import argparse
import os
import subprocess

WHISPER_MODEL_URLS = {
    "tiny.en": "https://openaipublic.azureedge.net/main/whisper/models/d3dd57d32accea0b295c96e26691aa14d8822fac7d9d27d5dc00b4ca2826dd03/tiny.en.pt",
    "tiny": "https://openaipublic.azureedge.net/main/whisper/models/65147644a518d12f04e32d6f3b26facc3f8dd46e5390956a9424a650c0ce22b9/tiny.pt",
    "base.en": "https://openaipublic.azureedge.net/main/whisper/models/25a8566e1d0c1e2231d1c762132cd20e0f96a85d16145c3a00adf5d1ac670ead/base.en.pt",
    "base": "https://openaipublic.azureedge.net/main/whisper/models/ed3a0b6b1c0edf879ad9b11b1af5a0e6ab5db9205f891f668f8b0e6c6326e34e/base.pt",
    "small.en": "https://openaipublic.azureedge.net/main/whisper/models/f953ad0fd29cacd07d5a9eda5624af0f6bcf2258be67c92b79389873d91e0872/small.en.pt",
    "small": "https://openaipublic.azureedge.net/main/whisper/models/9ecf779972d90ba49c06d968637d720dd632c55bbf19d441fb42bf17a411e794/small.pt",
    "medium.en": "https://openaipublic.azureedge.net/main/whisper/models/d7440d1dc186f76616474e0ff0b3b6b879abc9d1a4926b7adfa41db2d497ab4f/medium.en.pt",
    "medium": "https://openaipublic.azureedge.net/main/whisper/models/345ae4da62f9b3d59415adc60127b97c714f32e89e936602e85993674d08dcb1/medium.pt",
    "large-v2": "https://openaipublic.azureedge.net/main/whisper/models/e4b87e7e0bf463eb8e6956e646f1e277e901512310def2c24bf0e11bd3c28e9a/large-v2.pt",
    "large-v3": "https://openaipublic.azureedge.net/main/whisper/models/81f7c96c852ee8fc832187b0132e569d6c3065a3252ed18e56effd0b6a73e524/large-v3.pt",
    "large": "https://openaipublic.azureedge.net/main/whisper/models/81f7c96c852ee8fc832187b0132e569d6c3065a3252ed18e56effd0b6a73e524/large-v3.pt",
}


def get_model_url(model_name):
    return WHISPER_MODEL_URLS.get(model_name)


def download_model(model_name, output_dir):
    url = get_model_url(model_name)
    if not url:
        raise ValueError(f"Unknown model name: {model_name}")
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, f"{model_name}.pt")
    if os.path.exists(output_path):
        print(f"Model already exists: {output_path}")
        return output_path
    print(f"Downloading {model_name} from {url} to {output_path}")
    try:
        subprocess.run(["wget", "-O", output_path, url], check=True)
    except Exception as e:
        print(f"Failed to download model: {e}")
        return None
    return output_path


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Download OpenAI Whisper Model"
    )
    parser.add_argument(
        "--model",
        type=str,
        required=True,
        help="Whisper model size (e.g., tiny, base, small, medium, large-v2, large-v3)",
    )
    parser.add_argument(
        "--output",
        type=str,
        required=False,
        default=os.path.expanduser("~/.cache/whisper-live/"),
        help="Directory to save the model",
    )
    args = parser.parse_args()
    download_model(args.model, args.output)
