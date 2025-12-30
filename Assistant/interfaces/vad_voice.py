"""
VAD-Enabled Voice Interface
Voice Activity Detection for natural continuous listening.
"""
import sys
from pathlib import Path
from typing import Optional, Dict, Any, Callable
import io
import threading
import time
import queue

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
    import numpy as np
    SOUNDDEVICE_AVAILABLE = True
except ImportError:
    SOUNDDEVICE_AVAILABLE = False
    logger.warning("sounddevice not available")

try:
    import webrtcvad
    VAD_AVAILABLE = True
except ImportError:
    VAD_AVAILABLE = False
    logger.warning("webrtcvad not available - install with: pip install webrtcvad")

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


class VADVoiceInterface:
    """Voice interface with Voice Activity Detection for continuous listening."""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """
        Initialize VAD voice interface.
        
        Args:
            config: Configuration dict. If None, loads from file.
        """
        if config is None:
            config = load_config()
        
        self.config = config
        self.voice_config = config.get('interfaces', {}).get('voice', {})
        self.vad_config = self.voice_config.get('vad', {})
        
        self.enabled = self.voice_config.get('enabled', True)
        self.language = self.voice_config.get('language', 'en-US')
        self.tts_voice = self.voice_config.get('tts_voice', 'male')
        
        # VAD settings
        self.vad_aggressiveness = self.vad_config.get('aggressiveness', 2)  # 0-3
        self.silence_duration = self.vad_config.get('silence_duration', 0.9)  # seconds
        self.min_speech_duration = self.vad_config.get('min_speech_duration', 0.3)  # seconds
        
        # Audio settings (VAD requires 16kHz, 16-bit, mono)
        self.sample_rate = 16000
        self.frame_duration = 30  # ms (10, 20, or 30)
        self.frame_size = int(self.sample_rate * self.frame_duration / 1000)
        self.channels = 1
        
        # Initialize VAD
        self.vad = None
        if VAD_AVAILABLE:
            try:
                self.vad = webrtcvad.Vad(self.vad_aggressiveness)
                logger.info(f"VAD initialized (aggressiveness={self.vad_aggressiveness})")
            except Exception as e:
                logger.warning(f"Failed to initialize VAD: {e}")
                self.vad = None
        
        # Initialize recognizer
        self.recognizer = None
        self.audio_available = False
        
        if SPEECH_RECOGNITION_AVAILABLE and SOUNDDEVICE_AVAILABLE and self.enabled:
            try:
                self.recognizer = sr.Recognizer()
                
                # Test audio device
                devices = sd.query_devices()
                logger.info(f"Found {len(devices)} audio devices")
                
                default_input = sd.query_devices(kind='input')
                logger.info(f"Default input device: {default_input['name']}")
                
                self.audio_available = True
                logger.info("Voice recognition initialized")
            except Exception as e:
                logger.warning(f"Failed to initialize audio: {e}")
                self.recognizer = None
        
        # Initialize TTS
        self.tts_engine = None
        
        if TTS_AVAILABLE and self.enabled:
            try:
                self.tts_engine = pyttsx3.init()
                
                voices = self.tts_engine.getProperty('voices')
                if voices:
                    if self.tts_voice == 'male':
                        for voice in voices:
                            if 'male' in voice.name.lower() or 'david' in voice.name.lower():
                                self.tts_engine.setProperty('voice', voice.id)
                                break
                
                self.tts_engine.setProperty('rate', 150)
                self.tts_engine.setProperty('volume', 0.7)
                
                logger.info("TTS engine initialized")
            except Exception as e:
                logger.warning(f"Failed to initialize TTS: {e}")
                self.tts_engine = None
        
        # Continuous listening state
        self._listening = False
        self._listen_thread = None
        self._callback = None
    
    def _is_speech(self, audio_frame: bytes) -> bool:
        """
        Check if audio frame contains speech.
        
        Args:
            audio_frame: Raw audio bytes (16-bit PCM).
        
        Returns:
            True if speech detected.
        """
        if not self.vad:
            return True  # Assume speech if VAD not available
        
        try:
            return self.vad.is_speech(audio_frame, self.sample_rate)
        except Exception as e:
            logger.debug(f"VAD error: {e}")
            return False
    
    def start_continuous_listening(self, callback: Callable[[str], None]):
        """
        Start continuous listening with VAD.
        
        Args:
            callback: Function to call with recognized text.
        """
        if self._listening:
            logger.warning("Already listening")
            return
        
        if not self.vad:
            logger.error("VAD not available - cannot start continuous listening")
            return
        
        if not self.audio_available:
            logger.error("Audio not available")
            return
        
        self._listening = True
        self._callback = callback
        
        self._listen_thread = threading.Thread(target=self._continuous_listen_loop, daemon=True)
        self._listen_thread.start()
        
        logger.info("Started continuous listening with VAD")
    
    def _continuous_listen_loop(self):
        """Main continuous listening loop with VAD."""
        logger.info("Continuous listening loop started")
        
        # Speech detection state
        speech_frames = []
        is_speaking = False
        silence_frames = 0
        silence_threshold = int(self.silence_duration * 1000 / self.frame_duration)
        min_speech_frames = int(self.min_speech_duration * 1000 / self.frame_duration)
        
        try:
            # Audio callback
            def audio_callback(indata, frames, time_info, status):
                nonlocal speech_frames, is_speaking, silence_frames
                
                if status:
                    logger.debug(f"Audio status: {status}")
                
                if not self._listening:
                    return
                
                # Convert to int16
                audio_int16 = (indata[:, 0] * 32767).astype(np.int16)
                audio_bytes = audio_int16.tobytes()
                
                # Check if frame contains speech
                contains_speech = self._is_speech(audio_bytes)
                
                if contains_speech:
                    if not is_speaking:
                        logger.debug("Speech started")
                        is_speaking = True
                        speech_frames = []
                    
                    speech_frames.append(audio_int16)
                    silence_frames = 0
                    
                elif is_speaking:
                    # In speech, but this frame is silent
                    speech_frames.append(audio_int16)
                    silence_frames += 1
                    
                    # Check if enough silence to end speech
                    if silence_frames >= silence_threshold:
                        # Check if we have minimum speech duration
                        if len(speech_frames) >= min_speech_frames:
                            logger.debug(f"Speech ended ({len(speech_frames)} frames)")
                            
                            # Process the collected speech
                            self._process_speech(speech_frames)
                        else:
                            logger.debug("Speech too short, ignoring")
                        
                        # Reset state
                        is_speaking = False
                        speech_frames = []
                        silence_frames = 0
            
            # Open audio stream
            with sd.InputStream(
                channels=self.channels,
                samplerate=self.sample_rate,
                blocksize=self.frame_size,
                dtype='float32',
                callback=audio_callback
            ):
                logger.info("Audio stream opened for continuous listening")
                
                while self._listening:
                    time.sleep(0.1)
            
            logger.info("Audio stream closed")
            
        except Exception as e:
            logger.error(f"Error in continuous listen loop: {e}", exc_info=True)
            self._listening = False
    
    def _process_speech(self, frames: list):
        """
        Process collected speech frames.
        
        Args:
            frames: List of audio frames (numpy arrays).
        """
        try:
            # Combine frames
            audio_data = np.concatenate(frames)
            
            # Convert to bytes for speech recognition
            wav_buffer = io.BytesIO()
            sf.write(wav_buffer, audio_data, self.sample_rate, format='WAV', subtype='PCM_16')
            wav_buffer.seek(0)
            
            # Convert to AudioData
            with sf.SoundFile(wav_buffer) as sound_file:
                audio_array = sound_file.read(dtype='int16')
                audio = sr.AudioData(
                    audio_array.tobytes(),
                    sample_rate=self.sample_rate,
                    sample_width=2
                )
            
            # Recognize speech
            try:
                text = self.recognizer.recognize_google(audio, language=self.language)
                logger.info(f"Recognized: {text}")
                
                # Call callback in separate thread
                if self._callback:
                    threading.Thread(target=self._callback, args=(text,), daemon=True).start()
                    
            except sr.UnknownValueError:
                logger.debug("Could not understand audio")
            except sr.RequestError as e:
                logger.error(f"Speech recognition error: {e}")
        
        except Exception as e:
            logger.error(f"Error processing speech: {e}")
    
    def stop_listening(self):
        """Stop continuous listening."""
        if not self._listening:
            return
        
        logger.info("Stopping continuous listening...")
        self._listening = False
        
        if self._listen_thread:
            self._listen_thread.join(timeout=2.0)
        
        logger.info("Continuous listening stopped")
    
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
    
    def listen(self, timeout: float = 5.0, phrase_time_limit: float = 5.0) -> Optional[str]:
        """
        Single listen (for compatibility).
        
        Args:
            timeout: Timeout in seconds.
            phrase_time_limit: Maximum phrase length.
        
        Returns:
            Recognized text or None.
        """
        if not self.recognizer or not self.audio_available:
            logger.warning("Voice recognition not available")
            return None
        
        try:
            # Simple record for single listen
            recording = sd.rec(
                int(phrase_time_limit * self.sample_rate),
                samplerate=self.sample_rate,
                channels=self.channels,
                dtype='int16'
            )
            sd.wait()
            
            wav_buffer = io.BytesIO()
            sf.write(wav_buffer, recording, self.sample_rate, format='WAV', subtype='PCM_16')
            wav_buffer.seek(0)
            
            with sf.SoundFile(wav_buffer) as sound_file:
                audio_array = sound_file.read(dtype='int16')
                audio = sr.AudioData(
                    audio_array.tobytes(),
                    sample_rate=self.sample_rate,
                    sample_width=2
                )
            
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


def create_vad_voice_interface(config: Optional[Dict[str, Any]] = None) -> Optional[VADVoiceInterface]:
    """
    Create a VAD voice interface instance.
    
    Args:
        config: Configuration dict.
    
    Returns:
        VADVoiceInterface instance or None.
    """
    try:
        return VADVoiceInterface(config)
    except Exception as e:
        logger.error(f"Failed to create VAD voice interface: {e}")
        return None


if __name__ == "__main__":
    # Test VAD voice interface
    print("Testing VAD Voice Interface...")
    print("Speak naturally - will detect when you stop")
    print("Press Ctrl+C to exit\n")
    
    config = load_config()
    voice = create_vad_voice_interface(config)
    
    if voice and voice.audio_available and voice.vad:
        def on_speech(text):
            print(f"\n✓ You said: {text}")
            voice.speak(f"I heard: {text}")
        
        voice.start_continuous_listening(on_speech)
        
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\nStopping...")
            voice.stop_listening()
    else:
        print("VAD voice interface not available")
        print("Install: pip install webrtcvad")