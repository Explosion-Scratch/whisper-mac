#!/bin/bash
# Strip debug symbols and optimize release binaries

set -e

echo "=== Stripping release binaries ==="

# Strip parakeet-backend (Rust)
if [ -f native/parakeet-backend/target/release/parakeet-backend ]; then
    echo "Stripping parakeet-backend..."
    strip native/parakeet-backend/target/release/parakeet-backend
    ls -lh native/parakeet-backend/target/release/parakeet-backend
fi

# Strip whisper-cli binaries
if [ -f vendor/whisper-cpp/whisper-cli ]; then
    echo "Stripping whisper-cli..."
    strip vendor/whisper-cpp/whisper-cli 2>/dev/null || true
fi

if [ -f vendor/whisper-cpp/whisper-cli-metal ]; then
    echo "Stripping whisper-cli-metal..."
    strip vendor/whisper-cpp/whisper-cli-metal 2>/dev/null || true
fi

# Strip yap if present
if [ -f vendor/yap/yap ]; then
    echo "Stripping yap..."
    strip vendor/yap/yap 2>/dev/null || true
fi

# Strip bun CLI (limited effect but worth trying)
if [ -f bin/whisper-mac-cli ]; then
    echo "Stripping whisper-mac-cli..."
    strip bin/whisper-mac-cli 2>/dev/null || true
fi

echo ""
echo "=== Final binary sizes ==="
ls -lh native/parakeet-backend/target/release/parakeet-backend 2>/dev/null || true
ls -lh vendor/whisper-cpp/whisper-cli 2>/dev/null || true
ls -lh vendor/yap/yap 2>/dev/null || true
ls -lh bin/whisper-mac-cli 2>/dev/null || true

echo ""
echo "Done!"
