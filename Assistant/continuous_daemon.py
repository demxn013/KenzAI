"""
KenzAI Continuous Listening Daemon
Wake once, then continuously listens using VAD until dismissed.
"""
import sys
import time
import signal
from pathlib import Path

_current_dir = Path(__file__).parent
if str(_current_dir) not in sys.path:
    sys.path.insert(0, str(_current_dir))

from utils.logger import initialize_logger, get_logger
from utils.helpers import load_config, load_user_preferences

config = load_config()
log_config = config.get('logging', {})
initialize_logger(log_level="INFO", log_file=log_config.get('file'))
logger = get_logger()

print("\n" + "=" * 70)
print("KENZAI - CONTINUOUS LISTENING MODE")
print("=" * 70)
print("\n✨ Features:")
print("  • Say 'KENZAI' once to wake up")
print("  • Then talk naturally - detects when you stop speaking")
print("  • Stays active until you say 'goodbye' or 'go to sleep'")
print("  • Won't respond to background conversations")
print("=" * 70)

# Initialize components
print("\n[1] Initializing wake word detection...")
from interfaces.porcupine_wake import PorcupineWakeWord

daemon_config = config.get('interfaces', {}).get('daemon', {})
keyword = daemon_config.get('porcupine_keyword', 'jarvis')
access_key = daemon_config.get('porcupine_access_key')
keyword_path = daemon_config.get('porcupine_keyword_path')
sensitivity = daemon_config.get('porcupine_sensitivity', 0.5)

if keyword_path:
    keyword_path = Path(keyword_path)
    if not keyword_path.is_absolute():
        keyword_path = Path(__file__).parent / keyword_path
    keyword_path = str(keyword_path)

wake_word = PorcupineWakeWord(
    keyword=keyword,
    sensitivity=sensitivity,
    access_key=access_key,
    keyword_path=keyword_path
)
print(f"✓ Wake word ready: '{keyword}'")

print("\n[2] Initializing VAD voice interface...")
try:
    from interfaces.vad_voice import VADVoiceInterface
    voice = VADVoiceInterface(config)
    print("✓ VAD voice interface ready")
except ImportError:
    print("⚠ VAD not available - falling back to standard voice")
    from interfaces.voice import VoiceInterface
    voice = VoiceInterface(config)

print("\n[3] Initializing assistant...")
from core import KenzAIAssistant
assistant = KenzAIAssistant(config)
print("✓ Assistant ready")

# State management
is_active = False
is_processing = False

def handle_speech(text: str):
    """Handle recognized speech during active mode."""
    global is_active, is_processing
    
    if not is_active or is_processing:
        return
    
    is_processing = True
    
    try:
        print(f"\n💬 [YOU] {text}")
        
        # Check for sleep commands
        sleep_commands = [
            'goodbye', 'go to sleep', 'rest', 'dismiss', 
            'that is all', 'sleep', 'stop listening'
        ]
        
        if any(cmd in text.lower() for cmd in sleep_commands):
            print("[KENZAI] Rest well, your Highness. I shall await your call.\n")
            voice.speak("Rest well, your Highness. I shall await your call.")
            go_to_sleep()
            return
        
        # Process command
        print("🤔 [PROCESSING]...", end='', flush=True)
        response = assistant.process_query(text)
        print(f"\r🎙️ [KENZAI] {response}\n")
        
        # Speak response
        voice.speak(response)
        
    except Exception as e:
        logger.error(f"Error handling speech: {e}", exc_info=True)
        print(f"❌ Error: {e}\n")
    finally:
        is_processing = False

def wake_up():
    """Wake up KenzAI and start continuous listening."""
    global is_active
    
    if is_active:
        return
    
    print("\n" + "🌟" * 35)
    print("KENZAI AWAKENING...")
    print("🌟" * 35)
    
    # Stop wake word detection
    wake_word.stop_listening()
    is_active = True
    
    # Speak greeting
    greeting = assistant.get_greeting()
    print(f"\n🎙️ [KENZAI] {greeting}")
    voice.speak(greeting)
    
    # Wait for greeting to finish
    time.sleep(2)
    
    print("\n" + "=" * 70)
    print("✅ ACTIVE - Continuously listening (detects when you stop speaking)")
    print("💡 Say 'goodbye' or 'go to sleep' to return to dormant mode")
    print("=" * 70 + "\n")
    
    # Start continuous VAD listening
    if hasattr(voice, 'start_continuous_listening'):
        voice.start_continuous_listening(handle_speech)
    else:
        print("⚠ VAD not available - install webrtcvad for continuous listening")
        print("  pip install webrtcvad")

def go_to_sleep():
    """Put KenzAI to sleep and return to wake word mode."""
    global is_active
    
    if not is_active:
        return
    
    print("\n💤 Returning to dormant mode...")
    
    is_active = False
    
    # Stop continuous listening
    if hasattr(voice, 'stop_listening'):
        voice.stop_listening()
    
    # Wait a moment
    time.sleep(1)
    
    print("\n" + "=" * 70)
    print("😴 DORMANT - Say 'KENZAI' to wake")
    print("=" * 70 + "\n")
    
    # Resume wake word detection
    wake_word.start_listening(wake_up)

def signal_handler(sig, frame):
    """Handle shutdown signals."""
    print("\n\n👋 Shutting down...")
    
    if is_active:
        voice.stop_listening()
    
    wake_word.cleanup()
    print("✓ Stopped\n")
    sys.exit(0)

# Setup signal handlers
signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

# Start in dormant mode
print("\n" + "=" * 70)
print("😴 DORMANT - Say 'KENZAI' to wake")
print("=" * 70 + "\n")

wake_word.start_listening(wake_up)

# Keep daemon running
try:
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    signal_handler(None, None)