import os
import subprocess

REPO_URL = "https://github.com/collabora/WhisperLive.git"
REPO_DIR = os.path.expanduser("~/WhisperLive")
SERVER_SCRIPT = os.path.join(REPO_DIR, "run_server.py")
PORT = 9090
BACKEND = "faster_whisper"
MAX_CLIENTS = 4
MAX_CONNECTION_TIME = 600


def clone_repo():
    if not os.path.exists(REPO_DIR):
        print(f"Cloning WhisperLive repo into {REPO_DIR}...")
        subprocess.run(["git", "clone", REPO_URL, REPO_DIR], check=True)
    else:
        print("WhisperLive repo already cloned.")


def run_server():
    cmd = [
        "python3",
        SERVER_SCRIPT,
        "--port",
        str(PORT),
        "--backend",
        BACKEND,
        "--max_clients",
        str(MAX_CLIENTS),
        "--max_connection_time",
        str(MAX_CONNECTION_TIME),
    ]
    print(f"Running server: {' '.join(cmd)}")
    subprocess.run(cmd)


if __name__ == "__main__":
    clone_repo()
    run_server()
