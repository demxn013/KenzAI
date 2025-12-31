"""
VAD-Enabled Voice Interface - 100% LOCAL VERSION
Works completely offline with Vosk or Whisper for speech recognition.
No internet required!
"""
import sys
from pathlib import Path
from typing import Optional, Dict, Any, Callable
import io
import threading
import time
import queue
import json

_current_dir = Path(__file__).parent.parent
if str(_current_dir) not in sys.path:
    sys.path.insert(0, str(_current_dir))

from utils.logger import get_logger
from utils.helpers import load_config

logger = get_logger()

# Required imports
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
    logger.warning("webrtcvad not available - install: pip install webrtcvad")

try:
    import pyttsx3
    TTS_AVAILABLE = True
except ImportError:
    TTS_AVAILABLE = False
    logger.warning("pyttsx3 not available")

# Local speech recognition options
VOSK_AVAILABLE = False
WHISPER_AVAILABLE = False

try:
    from vosk import Model, KaldiRecognizer
    VOSK_AVAILABLE = True
    logger.info("✓ Vosk available for offline speech recognition")
except ImportError:
    logger.warning("Vosk not available - install: pip install vosk")

try:
    import whisper
    WHISPER_AVAILABLE = True
    logger.info("✓ Whisper available for offline speech recognition")
except ImportError:
    logger.debug("Whisper not available")


class VADVoiceInterface:
    """Voice interface with Voice Activity Detection - 100% LOCAL."""
    
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
        
        self.enabled = self.voice_config.get('enabled', True)
        self.language = self.voice_config.get('language', 'en-US')
        self.tts_voice = self.voice_config.get('tts_voice', 'male')
        
        # VAD settings - ULTRA-RESPONSIVE
        self.vad_aggressiveness = self.voice_config.get('vad_aggressiveness', 2)
        self.silence_duration = self.voice_config.get('silence_duration', 0.4)
        self.min_speech_duration = self.voice_config.get('min_speech_duration', 0.2)
        
        # Audio settings (VAD requires 16kHz, 16-bit, mono)
        self.sample_rate = 16000
        self.frame_duration = 30  # ms
        self.frame_size = int(self.sample_rate * self.frame_duration / 1000)
        self.channels = 1
        
        # Initialize VAD
        self.vad = None
        if VAD_AVAILABLE:
            try:
                self.vad = webrtcvad.Vad(self.vad_aggressiveness)
                logger.info(f"VAD initialized (aggressiveness={self.vad_aggressiveness}, silence={self.silence_duration}s)")
            except Exception as e:
                logger.warning(f"Failed to initialize VAD: {e}")
                self.vad = None
        
        # Initialize LOCAL speech recognition
        self.recognizer = None
        self.recognizer_type = None
        self.audio_available = False
        
        if SOUNDDEVICE_AVAILABLE and self.enabled:
            try:
                # Test audio device
                devices = sd.query_devices()
                logger.info(f"Found {len(devices)} audio devices")
                
                default_input = sd.query_devices(kind='input')
                logger.info(f"Default input device: {default_input['name']}")
                
                self.audio_available = True
                
                # Initialize speech recognition (Vosk first, then Whisper)
                if VOSK_AVAILABLE:
                    self._init_vosk()
                elif WHISPER_AVAILABLE:
                    self._init_whisper()
                else:
                    logger.error("No offline speech recognition available!")
                    logger.error("Install one: pip install vosk  OR  pip install openai-whisper")
                    self.audio_available = False
                
            except Exception as e:
                logger.warning(f"Failed to initialize audio: {e}")
                self.audio_available = False
        
        # Initialize TTS
        self.tts_engine = None
        self._tts_lock = threading.Lock()
        self._tts_busy = False
        
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
                
                self.tts_engine.setProperty('rate', 175)
                self.tts_engine.setProperty('volume', 0.8)
                
                logger.info("TTS engine initialized")
            except Exception as e:
                logger.warning(f"Failed to initialize TTS: {e}")
                self.tts_engine = None
        
        # Continuous listening state
        self._listening = False
        self._listen_thread = None
        self._callback = None
        self._audio_stream = None
        self._speech_queue = queue.Queue()
        self._last_speech_time = 0
        self._min_speech_interval = 0.2
    
    def _init_vosk(self):
        """Initialize Vosk speech recognition."""
        try:
            # Look for Vosk model
            model_paths = [
                Path(__file__).parent.parent / "models" / "vosk",
                Path.home() / ".cache" / "vosk",
                Path("vosk-model"),
            ]
            
            model_path = None
            for path in model_paths:
                if path.exists() and any(path.iterdir()):
                    # Find first subdirectory (the model)
                    for subdir in path.iterdir():
                        if subdir.is_dir():
                            model_path = subdir
                            break
                    if model_path:
                        break
            
            if not model_path:
                logger.error("Vosk model not found!")
                logger.error("Download from: https://alphacephei.com/vosk/models")
                logger.error("Extract to: models/vosk/")
                return
            
            logger.info(f"Loading Vosk model from: {model_path}")
            self.recognizer = Model(str(model_path))
            self.recognizer_type = "vosk"
            logger.info("✓ Vosk speech recognition initialized (OFFLINE)")
            
        except Exception as e:
            logger.error(f"Failed to initialize Vosk: {e}")
            self.recognizer = None
    
    def _init_whisper(self):
        """Initialize Whisper speech recognition."""
        try:
            # Load Whisper model
            model_size = self.voice_config.get('whisper_model', 'base')  # tiny, base, small, medium
            logger.info(f"Loading Whisper model: {model_size}")
            self.recognizer = whisper.load_model(model_size)
            self.recognizer_type = "whisper"
            logger.info("✓ Whisper speech recognition initialized (OFFLINE)")
            
        except Exception as e:
            logger.error(f"Failed to initialize Whisper: {e}")
            self.recognizer = None
    
    def _is_speech(self, audio_frame: bytes) -> bool:
        """Check if audio frame contains speech."""
        if not self.vad:
            return True
        
        try:
            return self.vad.is_speech(audio_frame, self.sample_rate)
        except Exception as e:
            logger.debug(f"VAD error: {e}")
            return False
    
    def start_continuous_listening(self, callback: Callable[[str], None]):
        """Start continuous listening with VAD."""
        if self._listening:
            logger.warning("Already listening")
            return
        
        if not self.vad:
            logger.error("VAD not available")
            return
        
        if not self.audio_available or not self.recognizer:
            logger.error("Audio or speech recognition not available")
            return
        
        logger.info("Starting VAD continuous listening...")
        
        self._listening = True
        self._callback = callback
        
        # Start processing thread
        self._listen_thread = threading.Thread(target=self._processing_loop, daemon=True)
        self._listen_thread.start()
        
        # Start audio capture thread
        self._capture_thread = threading.Thread(target=self._audio_capture_loop, daemon=True)
        self._capture_thread.start()
        
        logger.info("✓ VAD continuous listening started")
    
    def _audio_capture_loop(self):
        """Audio capture loop - runs in separate thread."""
        logger.info("Audio capture loop started")
        
        # Speech detection state
        speech_frames = []
        is_speaking = False
        silence_frames = 0
        silence_threshold = int(self.silence_duration * 1000 / self.frame_duration)
        min_speech_frames = int(self.min_speech_duration * 1000 / self.frame_duration)
        
        logger.debug(f"Silence threshold: {silence_threshold} frames, Min speech: {min_speech_frames} frames")
        
        try:
            def audio_callback(indata, frames, time_info, status):
                nonlocal speech_frames, is_speaking, silence_frames
                
                if status:
                    logger.debug(f"Audio status: {status}")
                
                if not self._listening:
                    raise sd.CallbackStop()
                
                # Convert to int16
                audio_int16 = (indata[:, 0] * 32767).astype(np.int16)
                audio_bytes = audio_int16.tobytes()
                
                # Check if frame contains speech
                contains_speech = self._is_speech(audio_bytes)
                
                if contains_speech:
                    if not is_speaking:
                        logger.debug("🎤 Speech started")
                        is_speaking = True
                        speech_frames = []
                    
                    speech_frames.append(audio_int16)
                    silence_frames = 0
                    
                elif is_speaking:
                    speech_frames.append(audio_int16)
                    silence_frames += 1
                    
                    if silence_frames >= silence_threshold:
                        if len(speech_frames) >= min_speech_frames:
                            now = time.time()
                            if now - self._last_speech_time >= self._min_speech_interval:
                                logger.debug(f"🎤 Speech ended ({len(speech_frames)} frames, {len(speech_frames) * self.frame_duration / 1000:.1f}s)")
                                self._speech_queue.put(speech_frames.copy())
                                self._last_speech_time = now
                        
                        is_speaking = False
                        speech_frames = []
                        silence_frames = 0
            
            # Open audio stream
            self._audio_stream = sd.InputStream(
                channels=self.channels,
                samplerate=self.sample_rate,
                blocksize=self.frame_size,
                dtype='float32',
                callback=audio_callback
            )
            
            with self._audio_stream:
                logger.info("🎙️ Audio stream opened, listening for speech...")
                
                while self._listening:
                    time.sleep(0.1)
            
            logger.info("Audio stream closed")
            
        except Exception as e:
            logger.error(f"Error in audio capture loop: {e}", exc_info=True)
            self._listening = False
    
    def _processing_loop(self):
        """Speech processing loop - runs in separate thread."""
        logger.info("Speech processing loop started")
        
        while self._listening:
            try:
                try:
                    frames = self._speech_queue.get(timeout=1.0)
                except queue.Empty:
                    continue
                
                self._process_speech(frames)
                
            except Exception as e:
                logger.error(f"Error in processing loop: {e}", exc_info=True)
        
        logger.info("Speech processing loop stopped")
    
    def _process_speech(self, frames: list):
        """Process collected speech frames."""
        try:
            start_time = time.time()
            logger.debug("Processing speech...")
            
            # Combine frames
            audio_data = np.concatenate(frames)
            
            # Recognize speech based on type
            if self.recognizer_type == "vosk":
                text = self._recognize_vosk(audio_data)
            elif self.recognizer_type == "whisper":
                text = self._recognize_whisper(audio_data)
            else:
                logger.error("No recognizer available")
                return
            
            if text:
                processing_time = time.time() - start_time
                logger.info(f"✓ Recognized: {text} (took {processing_time:.1f}s)")
                
                if self._callback:
                    try:
                        self._callback(text)
                    except Exception as e:
                        logger.error(f"Error in callback: {e}", exc_info=True)
        
        except Exception as e:
            logger.error(f"Error processing speech: {e}", exc_info=True)
    
    def _recognize_vosk(self, audio_data: np.ndarray) -> Optional[str]:
        """Recognize speech using Vosk."""
        try:
            # Create recognizer for this audio
            rec = KaldiRecognizer(self.recognizer, self.sample_rate)
            rec.SetWords(True)
            
            # Convert to bytes
            audio_bytes = audio_data.tobytes()
            
            # Process audio
            if rec.AcceptWaveform(audio_bytes):
                result = json.loads(rec.Result())
            else:
                result = json.loads(rec.FinalResult())
            
            text = result.get('text', '').strip()
            return text if text else None
            
        except Exception as e:
            logger.error(f"Vosk recognition error: {e}")
            return None
    
    def _recognize_whisper(self, audio_data: np.ndarray) -> Optional[str]:
        """Recognize speech using Whisper."""
        try:
            # Whisper expects float32 in range [-1, 1]
            audio_float = audio_data.astype(np.float32) / 32768.0
            
            # Transcribe
            result = self.recognizer.transcribe(
                audio_float,
                language='en',
                fp16=False
            )
            
            text = result.get('text', '').strip()
            return text if text else None
            
        except Exception as e:
            logger.error(f"Whisper recognition error: {e}")
            return None
    
    def stop_listening(self):
        """Stop continuous listening."""
        if not self._listening:
            return
        
        logger.info("Stopping continuous listening...")
        self._listening = False
        
        if self._audio_stream:
            try:
                self._audio_stream.stop()
                self._audio_stream.close()
            except Exception as e:
                logger.debug(f"Error stopping audio stream: {e}")
            self._audio_stream = None
        
        if self._capture_thread:
            self._capture_thread.join(timeout=2.0)
        if self._listen_thread:
            self._listen_thread.join(timeout=2.0)
        
        while not self._speech_queue.empty():
            try:
                self._speech_queue.get_nowait()
            except queue.Empty:
                break
        
        logger.info("✓ Continuous listening stopped")
    
    def speak(self, text: str):
        """Speak text using TTS."""
        if not self.tts_engine:
            logger.debug(f"Would speak: {text}")
            return
        
        if self._tts_busy:
            logger.debug("TTS busy, skipping...")
            return
        
        def _speak_in_thread():
            if not self._tts_lock.acquire(blocking=False):
                return
            
            self._tts_busy = True
            try:
                self.tts_engine.say(text)
                self.tts_engine.runAndWait()
                logger.debug(f"Spoke: {text[:50]}...")
            except Exception as e:
                logger.error(f"TTS error: {e}")
            finally:
                self._tts_busy = False
                self._tts_lock.release()
        
        threading.Thread(target=_speak_in_thread, daemon=True).start()


def create_vad_voice_interface(config: Optional[Dict[str, Any]] = None) -> Optional[VADVoiceInterface]:
    """Create a VAD voice interface instance."""
    try:
        return VADVoiceInterface(config)
    except Exception as e:
        logger.error(f"Failed to create VAD voice interface: {e}")
        return None


if __name__ == "__main__":
    print("Testing 100% LOCAL VAD Voice Interface...")
    print("No internet required!")
    print("Press Ctrl+C to exit\n")
    
    config = load_config()
    voice = create_vad_voice_interface(config)
    
    if voice and voice.audio_available and voice.vad and voice.recognizer:
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
        print("❌ VAD voice interface not fully available")
        print("\nMissing components:")
        if not voice or not voice.audio_available:
            print("  - Audio devices")
        if not voice or not voice.vad:
            print("  - VAD (install: pip install webrtcvad)")
        if not voice or not voice.recognizer:
            print("  - Speech recognition (install: pip install vosk)")