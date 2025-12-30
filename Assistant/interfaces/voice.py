"""
Voice Interface with Voice Activity Detection (VAD)
Continuously listens and detects when you stop talking.
"""
import sys
from pathlib import Path
from typing import Optional, Callable
import threading
import queue
import time

_current_dir = Path(__file__).parent.parent
if str(_current_dir) not in sys.path:
    sys.path.insert(0, str(_current_dir))

from utils.logger import get_logger

logger = get_logger()

try:
    import webrtcvad
    VAD_AVAILABLE = True
except ImportError:
    VAD_AVAILABLE = False
    logger.warning("webrtcvad not available - install with: pip install webrtcvad")

try:
    import sounddevice as sd
    import numpy as np
    AUDIO_AVAILABLE = True
except ImportError:
    AUDIO_AVAILABLE = False

try:
    import speech_recognition as sr
    SR_AVAILABLE = True
except ImportError:
    SR_AVAILABLE = False

try:
    import pyttsx3
    TTS_AVAILABLE = True
except ImportError:
    TTS_AVAILABLE = False


class VADVoiceInterface:
    """
    Voice interface with Voice Activity Detection.
    Continuously listens and detects when speech starts/stops.
    """
    
    def __init__(self, config: dict):
        """Initialize VAD voice interface."""
        self.config = config
        self.vad = None
        self.recognizer = None
        self.tts_engine = None
        self.is_listening = False
        self._listen_thread = None
        self._audio_queue = queue.Queue()
        self._speech_callback = None
        self._tts_lock = threading.Lock()
        
        # VAD settings
        voice_config = config.get('interfaces', {}).get('voice', {})
        self.sample_rate = 16000  # VAD requires 8000, 16000, 32000, or 48000
        self.frame_duration = 30  # ms (10, 20, or 30)
        self.frame_size = int(self.sample_rate * self.frame_duration / 1000)
        self.vad_aggressiveness = voice_config.get('vad_aggressiveness', 2)  # 0-3, higher = more aggressive
        self.silence_duration = voice_config.get('silence_duration', 1.0)  # Seconds of silence to consider speech ended
        self.min_speech_duration = voice_config.get('min_speech_duration', 0.3)  # Min seconds to be considered speech
        
        # Initialize VAD
        if VAD_AVAILABLE:
            try:
                self.vad = webrtcvad.Vad(self.vad_aggressiveness)
                logger.info(f"VAD initialized (aggressiveness: {self.vad_aggressiveness})")
            except Exception as e:
                logger.error(f"Failed to initialize VAD: {e}")
                self.vad = None
        
        # Initialize speech recognizer
        if SR_AVAILABLE:
            try:
                self.recognizer = sr.Recognizer()
                self.recognizer.energy_threshold = voice_config.get('energy_threshold', 3000)
                self.recognizer.dynamic_energy_threshold = False  # VAD handles this
                logger.info("Speech recognizer initialized")
            except Exception as e:
                logger.error(f"Failed to initialize speech recognizer: {e}")
        
        # Initialize TTS
        if TTS_AVAILABLE:
            try:
                self.tts_engine = pyttsx3.init()
                
                tts_config = config.get('interfaces', {}).get('tts', {})
                self.tts_engine.setProperty('rate', tts_config.get('rate', 175))
                self.tts_engine.setProperty('volume', tts_config.get('volume', 0.9))
                
                logger.info("TTS engine initialized")
            except Exception as e:
                logger.error(f"Failed to initialize TTS: {e}")
                self.tts_engine = None
    
    def start_continuous_listening(self, on_speech: Callable[[str], None]):
        """
        Start continuous listening with VAD.
        Calls on_speech callback when complete speech is detected.
        
        Args:
            on_speech: Callback function that receives recognized text.
        """
        if not VAD_AVAILABLE or not AUDIO_AVAILABLE:
            logger.error("VAD or audio not available")
            return False
        
        if self.is_listening:
            logger.warning("Already listening")
            return False
        
        self._speech_callback = on_speech
        self.is_listening = True
        
        # Start listening thread
        self._listen_thread = threading.Thread(target=self._vad_listen_loop, daemon=True)
        self._listen_thread.start()
        
        logger.info("Started continuous VAD listening")
        return True
    
    def _vad_listen_loop(self):
        """Main VAD listening loop - runs continuously."""
        logger.info("VAD listening loop started")
        
        speech_frames = []
        is_speaking = False
        silence_start = None
        speech_start_time = None
        
        try:
            def audio_callback(indata, frames, time_info, status):
                """Process audio frames in real-time."""
                if status:
                    logger.debug(f"Audio status: {status}")
                
                if not self.is_listening:
                    return
                
                # Put audio in queue for VAD processing
                self._audio_queue.put(indata.copy())
            
            # Start audio stream
            with sd.InputStream(
                samplerate=self.sample_rate,
                channels=1,
                dtype='int16',
                blocksize=self.frame_size,
                callback=audio_callback
            ):
                logger.info(f"🎤 Continuous listening active (sample_rate={self.sample_rate}, frame_size={self.frame_size})")
                
                while self.is_listening:
                    try:
                        # Get audio frame from queue
                        frame = self._audio_queue.get(timeout=0.1)
                        
                        # Convert to bytes for VAD
                        frame_bytes = frame.tobytes()
                        
                        # Check if frame contains speech
                        try:
                            is_speech = self.vad.is_speech(frame_bytes, self.sample_rate)
                        except Exception as e:
                            logger.debug(f"VAD error: {e}")
                            continue
                        
                        if is_speech:
                            if not is_speaking:
                                # Speech started
                                logger.debug("🗣️ Speech detected - recording...")
                                is_speaking = True
                                speech_start_time = time.time()
                                speech_frames = []
                            
                            # Add frame to speech buffer
                            speech_frames.append(frame)
                            silence_start = None
                            
                        else:
                            # Silence detected
                            if is_speaking:
                                if silence_start is None:
                                    silence_start = time.time()
                                
                                # Add frame to buffer (include trailing silence)
                                speech_frames.append(frame)
                                
                                # Check if silence duration exceeded
                                silence_duration = time.time() - silence_start
                                if silence_duration >= self.silence_duration:
                                    # Speech ended - process it
                                    speech_duration = time.time() - speech_start_time
                                    
                                    if speech_duration >= self.min_speech_duration:
                                        logger.info(f"✓ Speech ended ({speech_duration:.1f}s) - processing...")
                                        self._process_speech(speech_frames)
                                    else:
                                        logger.debug(f"Speech too short ({speech_duration:.1f}s) - ignoring")
                                    
                                    # Reset
                                    is_speaking = False
                                    speech_frames = []
                                    silence_start = None
                    
                    except queue.Empty:
                        continue
                    except Exception as e:
                        logger.error(f"Error processing frame: {e}")
            
        except Exception as e:
            logger.error(f"Error in VAD listen loop: {e}", exc_info=True)
        finally:
            self.is_listening = False
            logger.info("VAD listening loop stopped")
    
    def _process_speech(self, frames):
        """Process captured speech frames and recognize text."""
        try:
            # Combine frames into single audio
            audio_data = np.concatenate(frames)
            
            # Convert to audio data for speech recognition
            audio = sr.AudioData(
                audio_data.tobytes(),
                sample_rate=self.sample_rate,
                sample_width=2  # 16-bit = 2 bytes
            )
            
            # Recognize speech
            try:
                text = self.recognizer.recognize_google(audio)
                logger.info(f"Recognized: {text}")
                
                # Call callback with recognized text
                if self._speech_callback:
                    # Run callback in separate thread to not block listening
                    threading.Thread(
                        target=self._speech_callback,
                        args=(text,),
                        daemon=True
                    ).start()
                
            except sr.UnknownValueError:
                logger.debug("Could not understand speech")
            except sr.RequestError as e:
                logger.error(f"Speech recognition error: {e}")
            
        except Exception as e:
            logger.error(f"Error processing speech: {e}", exc_info=True)
    
    def stop_listening(self):
        """Stop continuous listening."""
        if not self.is_listening:
            return
        
        logger.info("Stopping continuous listening...")
        self.is_listening = False
        
        if self._listen_thread:
            self._listen_thread.join(timeout=2.0)
        
        logger.info("Continuous listening stopped")
    
    def speak(self, text: str):
        """Speak text using TTS."""
        if not self.tts_engine:
            logger.warning("TTS not available")
            return
        
        try:
            with self._tts_lock:
                # Stop any ongoing speech
                try:
                    self.tts_engine.stop()
                except Exception:
                    pass
                
                # Speak in thread
                def _speak():
                    try:
                        self.tts_engine.say(text)
                        self.tts_engine.runAndWait()
                    except Exception as e:
                        logger.error(f"TTS error: {e}")
                
                thread = threading.Thread(target=_speak, daemon=True)
                thread.start()
                thread.join(timeout=60)  # Max 60 seconds
                
        except Exception as e:
            logger.error(f"Failed to speak: {e}")
    
    def cleanup(self):
        """Clean up resources."""
        self.stop_listening()
        
        # Clear queue
        while not self._audio_queue.empty():
            try:
                self._audio_queue.get_nowait()
            except queue.Empty:
                break
        
        if self.tts_engine:
            try:
                self.tts_engine.stop()
            except Exception:
                pass
    
    def __del__(self):
        """Destructor."""
        self.cleanup()