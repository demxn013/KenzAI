"""
VAD-Enabled Voice Interface - 100% LOCAL with Vosk
FIXED: Thread safety issue when stopping from callback thread.
Works completely offline with Vosk for speech recognition.
No internet required! No OpenAI! No cloud services!

Vosk Setup:
1. Download model: https://alphacephei.com/vosk/models
2. Recommended: vosk-model-small-en-us-0.15 (40MB, fast) 
   OR vosk-model-en-us-0.22 (1.8GB, more accurate)
3. Extract to: Assistant/models/vosk/
4. Structure should be: Assistant/models/vosk/vosk-model-small-en-us-0.15/
"""
import sys
from pathlib import Path
from typing import Optional, Dict, Any, Callable
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
    logger.warning("sounddevice not available - install: pip install sounddevice soundfile numpy")

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
    logger.warning("pyttsx3 not available - install: pip install pyttsx3")

# Vosk for 100% LOCAL speech recognition
try:
    from vosk import Model, KaldiRecognizer
    VOSK_AVAILABLE = True
    logger.info("✓ Vosk available for 100% offline speech recognition")
except ImportError:
    VOSK_AVAILABLE = False
    logger.error("❌ Vosk not available - install: pip install vosk")
    logger.error("Download model: https://alphacephei.com/vosk/models")


class VADVoiceInterface:
    """Voice interface with Voice Activity Detection - 100% LOCAL with Vosk only."""
    
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
        
        # VAD settings
        self.vad_aggressiveness = self.voice_config.get('vad_aggressiveness', 2)
        self.silence_duration = self.voice_config.get('silence_duration', 0.4)
        self.min_speech_duration = self.voice_config.get('min_speech_duration', 0.2)
        self.min_energy_threshold = self.voice_config.get('min_energy_threshold', 300)
        
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
                logger.info(f"✓ VAD initialized (aggressiveness={self.vad_aggressiveness}, silence={self.silence_duration}s)")
            except Exception as e:
                logger.warning(f"Failed to initialize VAD: {e}")
                self.vad = None
        else:
            logger.error("❌ VAD not available! Install: pip install webrtcvad")
        
        # Initialize Vosk speech recognition (100% LOCAL)
        self.recognizer = None
        self.audio_available = False
        
        if SOUNDDEVICE_AVAILABLE and self.enabled:
            try:
                # Test audio device
                devices = sd.query_devices()
                logger.info(f"Found {len(devices)} audio devices")
                
                default_input = sd.query_devices(kind='input')
                logger.info(f"Default input device: {default_input['name']}")
                
                self.audio_available = True
                
                # Initialize Vosk
                if VOSK_AVAILABLE:
                    self._init_vosk()
                else:
                    logger.error("❌ Vosk not available!")
                    logger.error("Install: pip install vosk")
                    logger.error("Download model: https://alphacephei.com/vosk/models")
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
                
                logger.info("✓ TTS engine initialized")
            except Exception as e:
                logger.warning(f"Failed to initialize TTS: {e}")
                self.tts_engine = None
        
        # Continuous listening state
        self._listening = False
        self._listen_thread = None
        self._capture_thread = None
        self._callback = None
        self._audio_stream = None
        self._speech_queue = queue.Queue()
        self._last_speech_time = 0
        self._min_speech_interval = 0.2
        
        # FIXED: Flag to prevent thread join deadlock
        self._stopping = False
        
        # Debug mode - logs energy levels when detecting false triggers
        self._debug_mode = self.voice_config.get('debug_vad', False)
        
        # Log all config values
        logger.info(f"VAD Configuration:")
        logger.info(f"  Aggressiveness: {self.vad_aggressiveness}")
        logger.info(f"  Silence duration: {self.silence_duration}s")
        logger.info(f"  Min speech duration: {self.min_speech_duration}s")
        logger.info(f"  Min energy threshold: {self.min_energy_threshold}")
        logger.info(f"  Debug mode: {self._debug_mode}")
        
        # Energy tracking for adaptive threshold
        self._energy_samples = []
        self._max_samples = 100
        
        # Log final status
        if self.audio_available and self.vad and self.recognizer:
            logger.info(f"✓ VAD Voice Interface ready (Vosk, 100% offline)")
        else:
            logger.warning("⚠ VAD Voice Interface incomplete - check logs above")
    
    def _init_vosk(self):
        """Initialize Vosk speech recognition - 100% LOCAL."""
        try:
            # Get model path from config
            model_path_config = self.voice_config.get('vosk_model_path', './models/vosk')
            model_path_config = Path(model_path_config)
            
            if not model_path_config.is_absolute():
                model_path_config = Path(__file__).parent.parent / model_path_config
            
            # Look for Vosk model in multiple locations
            model_paths = [
                model_path_config,
                Path(__file__).parent.parent / "models" / "vosk",
                Path.home() / ".cache" / "vosk",
                Path("vosk-model"),
            ]
            
            model_path = None
            for path in model_paths:
                if path.exists():
                    # Find first subdirectory (the model)
                    for subdir in path.iterdir():
                        if subdir.is_dir() and (subdir / "am").exists():  # Check for model structure
                            model_path = subdir
                            break
                    if model_path:
                        break
            
            if not model_path:
                logger.error("❌ Vosk model not found!")
                logger.error("")
                logger.error("Setup instructions:")
                logger.error("1. Download model from: https://alphacephei.com/vosk/models")
                logger.error("   Recommended for English:")
                logger.error("   - vosk-model-small-en-us-0.15 (40MB, fast)")
                logger.error("   - vosk-model-en-us-0.22 (1.8GB, accurate)")
                logger.error("")
                logger.error(f"2. Extract to: {model_paths[1]}/")
                logger.error(f"   Example: {model_paths[1]}/vosk-model-small-en-us-0.15/")
                logger.error("")
                logger.error("3. Make sure the extracted folder contains 'am', 'conf', 'graph' subfolders")
                logger.error("4. Restart KenzAI")
                return
            
            logger.info(f"Loading Vosk model from: {model_path}")
            self.recognizer = Model(str(model_path))
            logger.info("✓ Vosk speech recognition initialized (100% OFFLINE)")
            
        except Exception as e:
            logger.error(f"Failed to initialize Vosk: {e}")
            self.recognizer = None
    
    def _is_speech(self, audio_frame: bytes, audio_int16: np.ndarray = None) -> bool:
        """
        Check if audio frame contains speech.
        Now with energy threshold check to filter weak signals.
        """
        if not self.vad:
            return True
        
        try:
            # First check: Energy threshold (loudness check)
            energy = 0
            if audio_int16 is not None:
                # Calculate RMS (root mean square) energy
                energy = np.sqrt(np.mean(audio_int16.astype(np.float32) ** 2))
                
                # Track energy samples for adaptive threshold
                self._energy_samples.append(energy)
                if len(self._energy_samples) > self._max_samples:
                    self._energy_samples.pop(0)
                
                # ALWAYS log in debug mode, regardless of speech detection
                if self._debug_mode:
                    avg_energy = np.mean(self._energy_samples) if self._energy_samples else 0
                    logger.debug(f"🔊 Energy: {energy:.0f} | Avg: {avg_energy:.0f} | Threshold: {self.min_energy_threshold}")
                
                # If too quiet, not speech
                if energy < self.min_energy_threshold:
                    if self._debug_mode:
                        logger.debug(f"❌ REJECTED - Too quiet ({energy:.0f} < {self.min_energy_threshold})")
                    return False
            
            # Second check: VAD algorithm
            is_speech = self.vad.is_speech(audio_frame, self.sample_rate)
            
            if self._debug_mode:
                if is_speech:
                    logger.debug(f"✅ VAD DETECTED SPEECH (energy: {energy:.0f})")
                else:
                    logger.debug(f"⚪ VAD says no speech (energy: {energy:.0f})")
            
            return is_speech
        except Exception as e:
            logger.error(f"VAD error: {e}", exc_info=True)
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
        self._stopping = False
        self._callback = callback
        
        # Start processing thread
        self._listen_thread = threading.Thread(target=self._processing_loop, daemon=True)
        self._listen_thread.start()
        
        # Start audio capture thread
        self._capture_thread = threading.Thread(target=self._audio_capture_loop, daemon=True)
        self._capture_thread.start()
        
        logger.info("✓ VAD continuous listening started (100% offline)")
    
    def _audio_capture_loop(self):
        """Audio capture loop - runs in separate thread."""
        logger.info("Audio capture loop started")
        
        # Speech detection state
        speech_frames = []
        is_speaking = False
        silence_frames = 0
        silence_threshold = int(self.silence_duration * 1000 / self.frame_duration)
        min_speech_frames = int(self.min_speech_duration * 1000 / self.frame_duration)
        
        # STRICTER: Require multiple consecutive speech frames before triggering
        consecutive_speech_frames = 0
        min_consecutive_speech = 3  # Must detect speech in 3 frames in a row
        
        logger.debug(f"Silence threshold: {silence_threshold} frames")
        logger.debug(f"Min speech: {min_speech_frames} frames")
        logger.debug(f"Min consecutive speech: {min_consecutive_speech} frames")
        
        try:
            def audio_callback(indata, frames, time_info, status):
                nonlocal speech_frames, is_speaking, silence_frames, consecutive_speech_frames
                
                if status:
                    logger.debug(f"Audio status: {status}")
                
                if not self._listening:
                    raise sd.CallbackStop()
                
                # Convert to int16
                audio_int16 = (indata[:, 0] * 32767).astype(np.int16)
                audio_bytes = audio_int16.tobytes()
                
                # Check if frame contains speech (with energy check)
                contains_speech = self._is_speech(audio_bytes, audio_int16)
                
                if contains_speech:
                    consecutive_speech_frames += 1
                    
                    # Only start speaking after enough consecutive frames
                    if not is_speaking and consecutive_speech_frames >= min_consecutive_speech:
                        logger.info(f"🎤 SPEECH STARTED (after {consecutive_speech_frames} consecutive frames)")
                        is_speaking = True
                        speech_frames = []
                    
                    if is_speaking:
                        speech_frames.append(audio_int16)
                        silence_frames = 0
                    
                else:
                    # Reset consecutive counter
                    consecutive_speech_frames = 0
                    
                    if is_speaking:
                        speech_frames.append(audio_int16)
                        silence_frames += 1
                        
                        if silence_frames >= silence_threshold:
                            if len(speech_frames) >= min_speech_frames:
                                now = time.time()
                                if now - self._last_speech_time >= self._min_speech_interval:
                                    duration = len(speech_frames) * self.frame_duration / 1000
                                    logger.info(f"🎤 SPEECH ENDED ({len(speech_frames)} frames, {duration:.1f}s)")
                                    self._speech_queue.put(speech_frames.copy())
                                    self._last_speech_time = now
                            else:
                                if self._debug_mode:
                                    logger.debug(f"⚠️ Speech too short, ignoring ({len(speech_frames)} < {min_speech_frames} frames)")
                            
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
            logger.debug("Processing speech with Vosk...")
            
            # Combine frames
            audio_data = np.concatenate(frames)
            
            # Recognize speech with Vosk
            text = self._recognize_vosk(audio_data)
            
            if text:
                processing_time = time.time() - start_time
                logger.info(f"✓ Recognized: {text} (took {processing_time:.1f}s)")
                
                if self._callback:
                    try:
                        self._callback(text)
                    except Exception as e:
                        logger.error(f"Error in callback: {e}", exc_info=True)
            else:
                logger.debug("No text recognized")
        
        except Exception as e:
            logger.error(f"Error processing speech: {e}", exc_info=True)
    
    def _recognize_vosk(self, audio_data: np.ndarray) -> Optional[str]:
        """Recognize speech using Vosk - 100% LOCAL."""
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
    
    def stop_listening(self):
        """Stop continuous listening - FIXED: Thread-safe."""
        if not self._listening:
            return
        
        # Show energy stats if debug mode
        if self._debug_mode and self._energy_samples:
            logger.info("\n" + "="*70)
            logger.info("ENERGY STATISTICS")
            logger.info("="*70)
            logger.info(f"Samples collected: {len(self._energy_samples)}")
            logger.info(f"Min energy: {np.min(self._energy_samples):.0f}")
            logger.info(f"Max energy: {np.max(self._energy_samples):.0f}")
            logger.info(f"Average energy: {np.mean(self._energy_samples):.0f}")
            logger.info(f"Current threshold: {self.min_energy_threshold}")
            logger.info("")
            logger.info("Recommended threshold: Set to 150-200 above average")
            logger.info(f"Suggested value: {int(np.mean(self._energy_samples) + 200)}")
            logger.info("="*70 + "\n")
        
        # FIXED: Check if we're being called from a processing thread
        current_thread = threading.current_thread()
        is_processing_thread = (
            current_thread == self._listen_thread or 
            current_thread == self._capture_thread
        )
        
        if is_processing_thread:
            # We're stopping from within our own thread - don't join, just signal stop
            logger.info("Stopping continuous listening (from processing thread)...")
            self._listening = False
            self._stopping = True
            
            # Close audio stream if it exists
            if self._audio_stream:
                try:
                    self._audio_stream.stop()
                    self._audio_stream.close()
                except Exception as e:
                    logger.debug(f"Error stopping audio stream: {e}")
                self._audio_stream = None
            
            # Clear queue without blocking
            while not self._speech_queue.empty():
                try:
                    self._speech_queue.get_nowait()
                except queue.Empty:
                    break
            
            logger.info("✓ Continuous listening stopped (cleanup deferred to main thread)")
            
        else:
            # Called from external thread - safe to join
            logger.info("Stopping continuous listening...")
            self._listening = False
            
            if self._audio_stream:
                try:
                    self._audio_stream.stop()
                    self._audio_stream.close()
                except Exception as e:
                    logger.debug(f"Error stopping audio stream: {e}")
                self._audio_stream = None
            
            # Wait for threads to finish
            if self._capture_thread and self._capture_thread.is_alive():
                self._capture_thread.join(timeout=2.0)
            if self._listen_thread and self._listen_thread.is_alive():
                self._listen_thread.join(timeout=2.0)
            
            # Clear queue
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
    from utils.logger import initialize_logger
    
    initialize_logger(log_level="INFO")
    
    print("\n" + "=" * 70)
    print("Testing 100% LOCAL VAD Voice Interface with Vosk")
    print("No internet required! No OpenAI! No cloud services!")
    print("=" * 70)
    print("\nPress Ctrl+C to exit\n")
    
    config = load_config()
    voice = create_vad_voice_interface(config)
    
    if voice and voice.audio_available and voice.vad and voice.recognizer:
        print("✓ Using Vosk for 100% offline speech recognition")
        print("✓ Listening for speech...\n")
        
        def on_speech(text):
            print(f"\n{'='*70}")
            print(f"✓ You said: {text}")
            print(f"{'='*70}\n")
            voice.speak(f"I heard: {text}")
        
        voice.start_continuous_listening(on_speech)
        
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\n\nStopping...")
            voice.stop_listening()
            print("✓ Stopped\n")
    else:
        print("\n❌ VAD voice interface not fully available")
        print("\nMissing components:")
        if not voice or not voice.audio_available:
            print("  ❌ Audio devices or sounddevice")
            print("     Install: pip install sounddevice soundfile numpy")
        if not voice or not voice.vad:
            print("  ❌ VAD (Voice Activity Detection)")
            print("     Install: pip install webrtcvad")
        if not voice or not voice.recognizer:
            print("  ❌ Vosk speech recognition")
            print("     Install: pip install vosk")
            print("     Download model: https://alphacephei.com/vosk/models")
            print("     Extract to: ./models/vosk/")
        print()