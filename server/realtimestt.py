import asyncio
import websockets
import json
import argparse
import logging
import numpy as np
import threading
import uuid
from RealtimeSTT import AudioToTextRecorder

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("RealtimeSTT_Server")

def float32_to_int16(audio_float32: np.ndarray) -> bytes:
    """Convert float32 audio chunk to int16 bytes."""
    return (audio_float32 * 32767).astype(np.int16).tobytes()

async def handler(websocket):
    """Handles WebSocket connections."""
    uid = str(websocket.remote_address)
    logger.info(f"Client connected: {uid}")

    loop = asyncio.get_running_loop()
    
    # Use a queue to bridge sync callbacks and async websocket sending
    message_queue = asyncio.Queue()

    def send_update_sync(segment_type, text, completed):
        status = "transforming" if completed else "listening"
        segment = {
            "id": str(uuid.uuid4()),
            "type": segment_type,
            "text": text,
            "completed": completed
        }
        response = {
            "uid": uid,
            "segments": [segment],
            "status": status
        }
        loop.call_soon_threadsafe(message_queue.put_nowait, json.dumps(response))

    def on_realtime_update(text):
        if text.strip():
            send_update_sync("inprogress", text, False)
    
    def on_final_text_callback(text):
        if text.strip():
            logger.info(f"[{uid}] Final transcription: '{text}'")
            send_update_sync("transcribed", text, True)

    recorder = AudioToTextRecorder(
        model=args.model,
        language=args.language,
        compute_type=args.compute_type,
        gpu_device_index=args.gpu_device_index,
        device=args.device,
        silero_sensitivity=args.silero_sensitivity,
        webrtc_sensitivity=args.webrtc_sensitivity,
        post_speech_silence_duration=args.post_speech_silence_duration,
        min_length_of_recording=args.min_length_of_recording,
        use_microphone=False,
        enable_realtime_transcription=True,
        realtime_model_type=args.realtime_model,
        on_realtime_transcription_update=on_realtime_update
    )
    logger.info(f"[{uid}] RealtimeSTT recorder initialized.")

    # Task to send messages from the queue to the client
    async def sender_task():
        while True:
            message = await message_queue.get()
            try:
                await websocket.send(message)
            except websockets.exceptions.ConnectionClosed:
                break

    # Task to run the blocking recorder loop
    def recorder_loop():
        logger.info(f"[{uid}] Starting recorder loop.")
        while not getattr(recorder, 'is_shutdown', False):
            recorder.text(on_final_text_callback)
        logger.info(f"[{uid}] Recorder loop finished.")

    sender = asyncio.create_task(sender_task())
    recorder_thread = threading.Thread(target=recorder_loop)
    recorder_thread.daemon = True
    recorder_thread.start()

    try:
        async for message in websocket:
            if isinstance(message, bytes):
                float32_array = np.frombuffer(message, dtype=np.float32)
                recorder.feed_audio(float32_to_int16(float32_array))
            elif isinstance(message, str):
                try:
                    data = json.loads(message)
                    if data.get("EOS"):
                        logger.info(f"[{uid}] End of stream received. Stopping recording.")
                        recorder.stop()
                except json.JSONDecodeError:
                    logger.warning(f"[{uid}] Received non-JSON text message: {message}")

    except websockets.exceptions.ConnectionClosed as e:
        logger.info(f"[{uid}] Connection closed: {e.reason} (code: {e.code})")
    finally:
        logger.info(f"[{uid}] Cleaning up for client.")
        sender.cancel()
        recorder.shutdown()
        recorder_thread.join(timeout=2)

async def main():
    """Main function to start the WebSocket server."""
    logger.info(f"Starting RealtimeSTT WebSocket server on ws://localhost:{args.port}")
    async with websockets.serve(handler, "localhost", args.port, max_size=None):
        await asyncio.Future()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="RealtimeSTT WebSocket Server")
    
    # Server configuration
    parser.add_argument("--port", type=int, default=9090, help="WebSocket server port")
    
    # RealtimeSTT configuration
    parser.add_argument("--model", type=str, required=True, help="Path to the Whisper model directory")
    parser.add_argument("--realtime-model", type=str, default="tiny", help="Model for real-time transcription")
    parser.add_argument("--language", type=str, default="en", help="Language code for transcription")
    parser.add_argument("--compute_type", type=str, default="default", help="Computation type (e.g., float16, int8)")
    parser.add_argument("--gpu_device_index", type=int, default=0, help="GPU device index to use")
    parser.add_argument("--device", type=str, default="cuda", choices=["cuda", "cpu"], help="Device to use for computation")
    parser.add_argument("--silero_sensitivity", type=float, default=0.6, help="Silero VAD sensitivity (0-1)")
    parser.add_argument("--webrtc_sensitivity", type=int, default=3, help="WebRTC VAD sensitivity (0-3)")
    parser.add_argument("--post_speech_silence_duration", type=float, default=0.4, help="Seconds of silence to wait for end of speech")
    parser.add_argument("--min_length_of_recording", type=float, default=0.4, help="Minimum seconds of recording length")

    args = parser.parse_args()
    
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Server shutting down.")