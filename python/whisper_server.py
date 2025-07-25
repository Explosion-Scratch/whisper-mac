import argparse
import sys

from whisper_live.server import TranscriptionServer


def main():
    parser = argparse.ArgumentParser(description="WhisperMac Server")
    parser.add_argument("--port", type=int, default=9090, help="Server port")
    parser.add_argument(
        "--model", type=str, default="tiny", help="Whisper model size"
    )
    parser.add_argument(
        "--model-path",
        type=str,
        default=None,
        help="Path to custom Whisper model",
    )

    args = parser.parse_args()

    # Pass model_path to TranscriptionServer (customize as needed)
    server = TranscriptionServer()

    try:
        server.run(
            host="0.0.0.0",
            port=args.port,
            faster_whisper_custom_model_path=args.model_path,
            backend="faster_whisper",
        )
    except Exception as e:
        print(f"Server error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
