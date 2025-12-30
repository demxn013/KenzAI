"""
Voice Interface - FIXED VERSION
Fixes TTS threading issues and adds better audio handling.
"""
import sys
from pathlib import Path
from typing import Optional
import threading

_current_dir = Path(__file__).parent.parent
if str(_current_dir) not in sys.path:
    sys.path.insert(0, str(_current_dir))

from utils.logger import get_logger

logger = get_logger()

# Optional audio dependencies
try:
    import speech_recognition as sr
    SPEECH_RECOGNITION_AVAILABLE = True
except ImportError:
    SPEECH_RECOGNITION_AVAILABLE = False
    logger.warning("speech_recognition not available")

try:
    import pyttsx3
    PYTTSX3_AVAILABLE = True
except ImportError:
    PYTTSX3_AVAILABLE = False
    logger.warning("pyttsx3 not available")


class VoiceInterface:
    """Voice interface for speech recognition and TTS."""
    
    def __init__(self, config: dict):
        """Initialize voice interface."""
        self.config = config
        self.recognizer = None
        self.microphone = None
        self.tts_engine = None
        self.audio_available = False
        self._tts_lock = threading.Lock()  # Thread safety for TTS
        
        # Initialize speech recognition
        if SPEECH_RECOGNITION_AVAILABLE:
            try:
                self.recognizer = sr.Recognizer()
                
                # Configure recognizer
                audio_config = config.get('interfaces', {}).get('voice', {})
                self.recognizer.energy_threshold = audio_config.get('energy_threshold', 4000)
                self.recognizer.dynamic_energy_threshold = audio_config.get('dynamic_energy_threshold', True)
                self.recognizer.pause_threshold = audio_config.get('pause_threshold', 0.8)
                
                # Test microphone
                self.microphone = sr.Microphone()
                
                # Get default input device info
                import sounddevice as sd
                devices = sd.query_devices()
                default_input = sd.query_devices(kind='input')
                logger.info(f"Found {len(devices)} audio devices")
                logger.info(f"Default input device: {default_input['name']}")
                
                self.audio_available = True
                logger.info("Voice recognition initialized")
                
            except Exception as e:
                logger.error(f"Failed to initialize speech recognition: {e}")
                self.audio_available = False
        
        # Initialize TTS
        if PYTTSX3_AVAILABLE:
            try:
                # Create TTS engine in main thread
                self.tts_engine = pyttsx3.init()
                
                # Configure TTS
                tts_config = config.get('interfaces', {}).get('tts', {})
                rate = tts_config.get('rate', 150)
                volume = tts_config.get('volume', 0.9)
                
                self.tts_engine.setProperty('rate', rate)
                self.tts_engine.setProperty('volume', volume)
                
                # Get voices
                voices = self.tts_engine.getProperty('voices')
                voice_id = tts_config.get('voice_id')
                
                if voice_id and voice_id < len(voices):
                    self.tts_engine.setProperty('voice', voices[voice_id].id)
                    logger.info(f"Using voice: {voices[voice_id].name}")
                
                logger.info("TTS engine initialized")
                
            except Exception as e:
                logger.error(f"Failed to initialize TTS: {e}")
                self.tts_engine = None
    
    def listen(
        self,
        timeout: Optional[float] = None,
        phrase_time_limit: Optional[float] = None
    ) -> Optional[str]:
        """
        Listen for voice input and convert to text.
        
        Args:
            timeout: Max seconds to wait for phrase to start (None = infinite).
            phrase_time_limit: Max seconds for phrase after it starts (None = no limit).
        
        Returns:
            Recognized text or None.
        """
        if not self.audio_available or not self.recognizer:
            logger.warning("Audio not available for listening")
            return None
        
        try:
            with self.microphone as source:
                # Adjust for ambient noise if first time
                if not hasattr(self, '_ambient_adjusted'):
                    logger.debug("Adjusting for ambient noise...")
                    self.recognizer.adjust_for_ambient_noise(source, duration=1)
                    self._ambient_adjusted = True
                
                # Listen for audio
                logger.debug(f"Recording audio for {phrase_time_limit}s...")
                audio = self.recognizer.listen(
                    source,
                    timeout=timeout,
                    phrase_time_limit=phrase_time_limit
                )
            
            # Recognize speech
            try:
                text = self.recognizer.recognize_google(audio)
                logger.info(f"Recognized: {text}")
                return text
            except sr.UnknownValueError:
                logger.debug("Could not understand audio")
                return None
            except sr.RequestError as e:
                logger.error(f"Speech recognition service error: {e}")
                return None
            
        except sr.WaitTimeoutError:
            logger.debug("Listening timed out")
            return None
        except Exception as e:
            logger.error(f"Error during listening: {e}")
            return None
    
    def speak(self, text: str):
        """
        Speak text using TTS.
        
        Args:
            text: Text to speak.
        """
        if not self.tts_engine:
            logger.warning("TTS engine not available")
            return
        
        try:
            with self._tts_lock:  # Thread-safe TTS
                # Stop any ongoing speech
                self.tts_engine.stop()
                
                # Speak in a separate thread to avoid blocking
                def _speak_thread():
                    try:
                        self.tts_engine.say(text)
                        self.tts_engine.runAndWait()
                    except Exception as e:
                        logger.error(f"TTS error in thread: {e}")
                
                # Create and start thread
                thread = threading.Thread(target=_speak_thread, daemon=True)
                thread.start()
                thread.join(timeout=30)  # Max 30 seconds for speech
                
        except Exception as e:
            logger.error(f"Failed to speak: {e}")
    
    def cleanup(self):
        """Clean up resources."""
        if self.tts_engine:
            try:
                self.tts_engine.stop()
            except Exception:
                pass