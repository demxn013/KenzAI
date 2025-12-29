"""
KenzAI Voice Interface
Handles voice input/output for KenzAI.
"""
import sys
from pathlib import Path
from typing import Optional, Dict, Any, Callable

# Setup imports
_current_dir = Path(__file__).parent.parent
if str(_current_dir) not in sys.path:
    sys.path.insert(0, str(_current_dir))

from utils.logger import get_logger
from utils.helpers import load_config

logger = get_logger()

# Optional imports
try:
    import speech_recognition as sr
    SPEECH_RECOGNITION_AVAILABLE = True
except ImportError:
    SPEECH_RECOGNITION_AVAILABLE = False

try:
    import pyttsx3
    TTS_AVAILABLE = True
except ImportError:
    TTS_AVAILABLE = False


class VoiceInterface:
    """Voice input/output interface."""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """
        Initialize voice interface.
        
        Args:
            config: Configuration dict. If None, loads from file.
        """
        if config is None:
            config = load_config()
        
        self.config = config
        self.voice_config = config.get('interfaces', {}).get('voice', {})
        self.enabled = self.voice_config.get('enabled', True)
        self.wake_word = self.voice_config.get('wake_word', 'kenzai')
        self.language = self.voice_config.get('language', 'en-US')
        self.tts_voice = self.voice_config.get('tts_voice', 'male')
        
        # Initialize recognizer
        self.recognizer = None
        self.microphone = None
        
        if SPEECH_RECOGNITION_AVAILABLE and self.enabled:
            try:
                self.recognizer = sr.Recognizer()
                self.microphone = sr.Microphone()
                
                # Adjust for ambient noise
                with self.microphone as source:
                    self.recognizer.adjust_for_ambient_noise(source, duration=1)
                
                logger.info("Voice recognition initialized")
            except Exception as e:
                logger.warning(f"Failed to initialize microphone: {e}")
                self.recognizer = None
        
        # Initialize TTS
        self.tts_engine = None
        
        if TTS_AVAILABLE and self.enabled:
            try:
                self.tts_engine = pyttsx3.init()
                
                # Set voice properties
                voices = self.tts_engine.getProperty('voices')
                if voices:
                    if self.tts_voice == 'male':
                        for voice in voices:
                            if 'male' in voice.name.lower() or 'david' in voice.name.lower():
                                self.tts_engine.setProperty('voice', voice.id)
                                break
                
                # Set speech properties
                self.tts_engine.setProperty('rate', 150)
                self.tts_engine.setProperty('volume', 0.7)
                
                logger.info("TTS engine initialized")
            except Exception as e:
                logger.warning(f"Failed to initialize TTS: {e}")
                self.tts_engine = None
    
    def listen(self, timeout: float = 5.0, phrase_time_limit: float = 5.0) -> Optional[str]:
        """
        Listen for voice input.
        
        Args:
            timeout: Timeout in seconds.
            phrase_time_limit: Maximum phrase length in seconds.
        
        Returns:
            Recognized text or None.
        """
        if not self.recognizer or not self.microphone:
            logger.warning("Microphone not available")
            return None
        
        try:
            with self.microphone as source:
                logger.debug("Listening...")
                audio = self.recognizer.listen(source, timeout=timeout, phrase_time_limit=phrase_time_limit)
            
            try:
                text = self.recognizer.recognize_google(audio, language=self.language)
                logger.info(f"Recognized: {text}")
                return text
            except sr.UnknownValueError:
                logger.debug("Could not understand audio")
                return None
            except sr.RequestError as e:
                logger.error(f"Speech recognition error: {e}")
                return None
        except sr.WaitTimeoutError:
            logger.debug("Listening timeout")
            return None
        except Exception as e:
            logger.error(f"Error listening: {e}")
            return None
    
    def speak(self, text: str):
        """
        Speak text using TTS.
        
        Args:
            text: Text to speak.
        """
        if not self.tts_engine:
            logger.debug(f"Would speak: {text}")
            return
        
        try:
            self.tts_engine.say(text)
            self.tts_engine.runAndWait()
            logger.debug(f"Spoke: {text}")
        except Exception as e:
            logger.error(f"Failed to speak: {e}")
    
    def start_continuous_listening(self, callback: Callable[[str], None]):
        """
        Start continuous listening for wake word.
        
        Args:
            callback: Function to call when wake word is detected.
        """
        if not self.recognizer or not self.microphone:
            logger.warning("Cannot start continuous listening: microphone not available")
            return
        
        import threading
        
        def listen_loop():
            logger.info(f"Starting continuous listening for wake word: '{self.wake_word}'")
            while True:
                try:
                    text = self.listen(timeout=1.0, phrase_time_limit=3.0)
                    if text and self.wake_word.lower() in text.lower():
                        logger.info(f"Wake word detected: {text}")
                        callback(text)
                except Exception as e:
                    logger.error(f"Error in continuous listening: {e}")
        
        thread = threading.Thread(target=listen_loop, daemon=True)
        thread.start()
        return thread


def create_voice_interface(config: Optional[Dict[str, Any]] = None) -> Optional[VoiceInterface]:
    """
    Create a voice interface instance.
    
    Args:
        config: Configuration dict. If None, loads from file.
    
    Returns:
        VoiceInterface instance or None if not available.
    """
    try:
        return VoiceInterface(config)
    except Exception as e:
        logger.error(f"Failed to create voice interface: {e}")
        return None


if __name__ == "__main__":
    # Test voice interface
    config = load_config()
    voice = create_voice_interface(config)
    
    if voice:
        print("Voice interface ready. Say something...")
        text = voice.listen()
        if text:
            print(f"You said: {text}")
            voice.speak(f"I heard you say: {text}")
    else:
        print("Voice interface not available")

