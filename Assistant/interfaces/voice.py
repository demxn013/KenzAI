"""
KenzAI Voice Interface
Handles voice input/output for KenzAI using sounddevice.
"""
import sys
from pathlib import Path
from typing import Optional, Dict, Any, Callable
import io
import numpy as np

# Setup imports
_current_dir = Path(__file__).parent.parent
if str(_current_dir) not in sys.path:
    sys.path.insert(0, str(_current_dir))

from utils.logger import get_logger
from utils.helpers import load_config

logger = get_logger()

# Optional imports
try:
    import sounddevice as sd
    import soundfile as sf
    SOUNDDEVICE_AVAILABLE = True
except ImportError:
    SOUNDDEVICE_AVAILABLE = False
    logger.warning("sounddevice not available")

try:
    import speech_recognition as sr
    SPEECH_RECOGNITION_AVAILABLE = True
except ImportError:
    SPEECH_RECOGNITION_AVAILABLE = False
    logger.warning("SpeechRecognition not available")

try:
    import pyttsx3
    TTS_AVAILABLE = True
except ImportError:
    TTS_AVAILABLE = False
    logger.warning("pyttsx3 not available")


class VoiceInterface:
    """Voice input/output interface using sounddevice."""
    
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
        
        # Audio settings
        self.sample_rate = 16000
        self.channels = 1
        
        # Initialize recognizer
        self.recognizer = None
        self.audio_available = False
        
        if SPEECH_RECOGNITION_AVAILABLE and SOUNDDEVICE_AVAILABLE and self.enabled:
            try:
                self.recognizer = sr.Recognizer()
                
                # Test audio device
                devices = sd.query_devices()
                logger.info(f"Found {len(devices)} audio devices")
                
                # Get default input device
                default_input = sd.query_devices(kind='input')
                logger.info(f"Default input device: {default_input['name']}")
                
                self.audio_available = True
                logger.info("Voice recognition initialized with sounddevice")
            except Exception as e:
                logger.warning(f"Failed to initialize audio: {e}")
                self.recognizer = None
        else:
            missing = []
            if not SPEECH_RECOGNITION_AVAILABLE:
                missing.append("SpeechRecognition")
            if not SOUNDDEVICE_AVAILABLE:
                missing.append("sounddevice")
            if missing:
                logger.warning(f"Missing packages for voice: {', '.join(missing)}")
        
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
    
    def record_audio(self, duration: float = 5.0) -> Optional[bytes]:
        """
        Record audio using sounddevice.
        
        Args:
            duration: Recording duration in seconds.
        
        Returns:
            Audio data as bytes (WAV format) or None.
        """
        if not SOUNDDEVICE_AVAILABLE or not self.audio_available:
            logger.warning("Audio recording not available")
            return None
        
        try:
            logger.debug(f"Recording audio for {duration}s...")
            
            # Record audio
            recording = sd.rec(
                int(duration * self.sample_rate),
                samplerate=self.sample_rate,
                channels=self.channels,
                dtype='int16'
            )
            sd.wait()  # Wait for recording to finish
            
            # Convert to WAV bytes
            wav_buffer = io.BytesIO()
            sf.write(wav_buffer, recording, self.sample_rate, format='WAV', subtype='PCM_16')
            wav_buffer.seek(0)
            
            return wav_buffer.read()
            
        except Exception as e:
            logger.error(f"Error recording audio: {e}")
            return None
    
    def listen(self, timeout: float = 5.0, phrase_time_limit: float = 5.0) -> Optional[str]:
        """
        Listen for voice input.
        
        Args:
            timeout: Timeout in seconds.
            phrase_time_limit: Maximum phrase length in seconds.
        
        Returns:
            Recognized text or None.
        """
        if not self.recognizer or not self.audio_available:
            logger.warning("Voice recognition not available")
            return None
        
        try:
            # Record audio
            audio_data = self.record_audio(duration=phrase_time_limit)
            if not audio_data:
                return None
            
            # Convert to AudioData format for speech_recognition
            audio_buffer = io.BytesIO(audio_data)
            with sf.SoundFile(audio_buffer) as sound_file:
                audio_array = sound_file.read(dtype='int16')
                audio = sr.AudioData(
                    audio_array.tobytes(),
                    sample_rate=self.sample_rate,
                    sample_width=2  # 16-bit = 2 bytes
                )
            
            # Recognize speech
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
                
        except Exception as e:
            logger.error(f"Error listening: {e}")
            return None
    
    def listen_continuous(self, callback: Callable[[str], None], chunk_duration: float = 3.0):
        """
        Continuously listen for speech.
        
        Args:
            callback: Function to call with recognized text.
            chunk_duration: Duration of each recording chunk.
        """
        if not self.audio_available:
            logger.warning("Cannot start continuous listening: audio not available")
            return
        
        import threading
        
        def listen_loop():
            logger.info("Starting continuous listening...")
            
            while True:
                try:
                    text = self.listen(phrase_time_limit=chunk_duration)
                    if text:
                        callback(text)
                except Exception as e:
                    logger.error(f"Error in continuous listening: {e}")
                    import time
                    time.sleep(1)
        
        thread = threading.Thread(target=listen_loop, daemon=True)
        thread.start()
        return thread
    
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
        if not self.recognizer or not self.audio_available:
            logger.warning("Cannot start continuous listening: audio not available")
            return
        
        def wake_word_callback(text: str):
            if self.wake_word.lower() in text.lower():
                logger.info(f"Wake word detected: {text}")
                callback(text)
        
        return self.listen_continuous(wake_word_callback, chunk_duration=3.0)


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
    
    if voice and voice.audio_available:
        print("Voice interface ready. Say something...")
        text = voice.listen()
        if text:
            print(f"You said: {text}")
            voice.speak(f"I heard you say: {text}")
    else:
        print("Voice interface not available")