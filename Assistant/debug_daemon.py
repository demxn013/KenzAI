"""
KenzAI Daemon - DEBUG VERSION
Run this to see exactly where it's failing.
"""
import sys
import time
from pathlib import Path

_current_dir = Path(__file__).parent
if str(_current_dir) not in sys.path:
    sys.path.insert(0, str(_current_dir))

from utils.logger import initialize_logger, get_logger
from utils.helpers import load_config, load_user_preferences

# Initialize with DEBUG level
config = load_config()
log_config = config.get('logging', {})
initialize_logger(log_level="DEBUG", log_file=log_config.get('file'))
logger = get_logger()

print("\n" + "=" * 70)
print("KENZAI DAEMON DEBUG TEST")
print("=" * 70)

# Step 1: Check wake word initialization
print("\n[1] Testing Porcupine Wake Word...")
try:
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
    
    wake = PorcupineWakeWord(
        keyword=keyword,
        sensitivity=sensitivity,
        access_key=access_key,
        keyword_path=keyword_path
    )
    print(f"✓ Wake word initialized: '{keyword}'")
    
except Exception as e:
    print(f"❌ Failed to initialize wake word: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

# Step 2: Check voice interface
print("\n[2] Testing Voice Interface...")
try:
    from interfaces.voice import VoiceInterface
    
    voice = VoiceInterface(config)
    
    if voice.audio_available:
        print("✓ Voice interface initialized")
        print(f"  Audio available: {voice.audio_available}")
        print(f"  TTS available: {voice.tts_engine is not None}")
    else:
        print("⚠ Voice interface created but audio not available")
        
except Exception as e:
    print(f"❌ Failed to initialize voice: {e}")
    import traceback
    traceback.print_exc()
    voice = None

# Step 3: Check assistant initialization
print("\n[3] Testing Assistant Initialization...")
try:
    from core import KenzAIAssistant
    
    assistant = KenzAIAssistant(config)
    print("✓ Assistant initialized")
    
    # Test a simple query
    print("\n[4] Testing Assistant Query...")
    test_response = assistant.process_query("Hello")
    print(f"✓ Assistant responded: {test_response[:50]}...")
    
except Exception as e:
    print(f"❌ Failed to initialize assistant: {e}")
    import traceback
    traceback.print_exc()
    assistant = None

# Step 5: Test complete wake-to-command flow
print("\n" + "=" * 70)
print("INTERACTIVE WAKE WORD TEST")
print("=" * 70)
print("\nThis will test the complete flow:")
print("1. Say 'KENZAI' to trigger wake word")
print("2. System will speak greeting")
print("3. System will listen for your command")
print("4. System will process and respond")
print("\nPress Ctrl+C to exit")
print("=" * 70 + "\n")

wake_detected = False

def on_wake_word():
    """Handle wake word detection."""
    global wake_detected
    wake_detected = True
    
    print("\n" + "🎯" * 35)
    print("WAKE WORD DETECTED!")
    print("🎯" * 35)
    
    try:
        # Speak greeting
        greeting = assistant.get_greeting()
        print(f"\n[GREETING] {greeting}")
        
        if voice and voice.tts_engine:
            print("[TTS] Speaking greeting...")
            voice.speak(greeting)
        
        # Listen for command
        print("\n[LISTENING] Waiting for your command...")
        print("(Speak within 10 seconds)")
        
        command = voice.listen(timeout=10.0, phrase_time_limit=10.0)
        
        if command:
            print(f"\n[COMMAND] You said: {command}")
            
            # Process command
            print("[PROCESSING] Querying assistant...")
            response = assistant.process_query(command)
            
            print(f"\n[RESPONSE] {response}")
            
            # Speak response
            if voice and voice.tts_engine:
                print("[TTS] Speaking response...")
                voice.speak(response)
            
        else:
            print("\n⚠ No command detected")
            if voice and voice.tts_engine:
                voice.speak("I didn't hear a command, your Highness")
        
    except Exception as e:
        print(f"\n❌ Error in wake word handler: {e}")
        import traceback
        traceback.print_exc()
    
    # Reset for next wake word
    wake_detected = False
    print("\n" + "=" * 70)
    print("Listening for wake word again...")
    print("=" * 70 + "\n")

# Start listening
try:
    if assistant and voice and voice.audio_available:
        wake.start_listening(on_wake_word)
        
        # Keep running
        while True:
            time.sleep(0.5)
    else:
        print("\n❌ Cannot start - missing components:")
        if not assistant:
            print("  - Assistant not initialized")
        if not voice:
            print("  - Voice interface not initialized")
        elif not voice.audio_available:
            print("  - Audio not available")
        
except KeyboardInterrupt:
    print("\n\n👋 Stopping...")
    wake.cleanup()
    print("✓ Stopped\n")
    
except Exception as e:
    print(f"\n❌ ERROR: {e}\n")
    import traceback
    traceback.print_exc()