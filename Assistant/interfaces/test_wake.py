"""
Simple Porcupine Test - Uses your existing config
"""
import sys
from pathlib import Path
import time

# Add parent to path
_current_dir = Path(__file__).parent.parent
if str(_current_dir) not in sys.path:
    sys.path.insert(0, str(_current_dir))

# Initialize logger
from utils.logger import initialize_logger, get_logger
initialize_logger(log_level="INFO")
logger = get_logger()

# Load config
from utils.helpers import load_config
config = load_config()

# Get Porcupine settings from config
daemon_config = config.get('interfaces', {}).get('daemon', {})
keyword = daemon_config.get('porcupine_keyword', 'jarvis')
access_key = daemon_config.get('porcupine_access_key')
keyword_path = daemon_config.get('porcupine_keyword_path')
sensitivity = daemon_config.get('porcupine_sensitivity', 0.5)

# Resolve keyword path if provided
if keyword_path:
    keyword_path = Path(keyword_path)
    if not keyword_path.is_absolute():
        keyword_path = Path(__file__).parent.parent / keyword_path
    keyword_path = str(keyword_path)

print("\n" + "=" * 70)
print("KENZAI PORCUPINE WAKE WORD TEST")
print("=" * 70)
print(f"\nKeyword: {keyword}")
print(f"Access Key: {access_key[:20]}..." if access_key else "Access Key: NOT SET")
print(f"Custom keyword file: {keyword_path}" if keyword_path else "Using built-in keyword")
print(f"Sensitivity: {sensitivity}")
print("\nSay 'KENZAI' to trigger wake word")
print("Press Ctrl+C to exit")
print("=" * 70 + "\n")

try:
    import pvporcupine
    import sounddevice as sd
    import numpy as np
    
    # Initialize Porcupine with your config
    if keyword_path:
        print(f"Loading custom keyword from: {keyword_path}")
        porcupine = pvporcupine.create(
            access_key=access_key,
            keyword_paths=[keyword_path],
            sensitivities=[sensitivity]
        )
    else:
        print(f"Using built-in keyword: {keyword}")
        porcupine = pvporcupine.create(
            access_key=access_key,
            keywords=[keyword],
            sensitivities=[sensitivity]
        )
    
    print("✓ Porcupine initialized successfully!\n")
    print("🎤 Listening for wake word...\n")
    
    # Audio callback
    def audio_callback(indata, frames, time_info, status):
        if status:
            print(f"Audio status: {status}")
        
        # Convert to int16
        pcm = (indata[:, 0] * 32767).astype(np.int16)
        
        # Process with Porcupine
        keyword_index = porcupine.process(pcm)
        
        if keyword_index >= 0:
            print("\n" + "🎯" * 25)
            print("   WAKE WORD DETECTED: KENZAI")
            print("🎯" * 25 + "\n")
    
    # Start audio stream
    with sd.InputStream(
        channels=1,
        samplerate=porcupine.sample_rate,
        blocksize=porcupine.frame_length,
        dtype='float32',
        callback=audio_callback
    ):
        # Keep running
        while True:
            time.sleep(0.1)

except KeyboardInterrupt:
    print("\n\n👋 Stopping...")
    if 'porcupine' in locals():
        porcupine.delete()
    print("✓ Stopped\n")

except Exception as e:
    print(f"\n❌ ERROR: {e}\n")
    import traceback
    traceback.print_exc()