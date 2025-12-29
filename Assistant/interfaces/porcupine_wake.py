"""
Porcupine Wake Word Detection
Accurate wake word detection using Porcupine with custom keyword support.
"""
import sys
from pathlib import Path
from typing import Callable, Optional
import threading
import time

_current_dir = Path(__file__).parent.parent
if str(_current_dir) not in sys.path:
    sys.path.insert(0, str(_current_dir))

from utils.logger import get_logger

logger = get_logger()

try:
    import pvporcupine
    import sounddevice as sd
    import numpy as np
    PORCUPINE_AVAILABLE = True
except ImportError:
    PORCUPINE_AVAILABLE = False
    logger.error("Porcupine or sounddevice not available")


class PorcupineWakeWord:
    """Offline wake word detection using Porcupine."""
    
    def __init__(
        self,
        keyword: str = "jarvis",
        sensitivity: float = 0.5,
        access_key: Optional[str] = None,
        keyword_path: Optional[str] = None
    ):
        """
        Initialize Porcupine.
        
        Args:
            keyword: Built-in keyword name OR custom keyword if keyword_path provided.
                    Built-in options: alexa, americano, blueberry, bumblebee, computer,
                    grapefruit, grasshopper, hey google, hey siri, jarvis, ok google,
                    picovoice, porcupine, terminator
            sensitivity: Detection sensitivity (0.0-1.0). Higher = more sensitive but more false positives.
            access_key: Picovoice access key (required for custom keywords).
            keyword_path: Path to custom .ppn keyword file (for "kenzai").
        
        Raises:
            ImportError: If required packages not available.
            RuntimeError: If Porcupine initialization fails.
        """
        if not PORCUPINE_AVAILABLE:
            raise ImportError(
                "Porcupine not available. Install with: "
                "pip install pvporcupine sounddevice numpy"
            )
        
        self.keyword = keyword
        self.sensitivity = max(0.0, min(1.0, sensitivity))
        self.porcupine = None
        self.stream = None
        self.is_listening = False
        self._listen_thread = None
        self._callback = None
        
        try:
            # Initialize Porcupine
            if keyword_path:
                # Custom keyword file
                keyword_path = Path(keyword_path)
                if not keyword_path.exists():
                    raise FileNotFoundError(f"Keyword file not found: {keyword_path}")
                
                if not access_key:
                    raise ValueError("access_key required for custom keywords")
                
                self.porcupine = pvporcupine.create(
                    access_key=access_key,
                    keyword_paths=[str(keyword_path)],
                    sensitivities=[self.sensitivity]
                )
                logger.info(f"Porcupine initialized with custom keyword: {keyword}")
            else:
                # Built-in keyword
                self.porcupine = pvporcupine.create(
                    keywords=[keyword],
                    sensitivities=[self.sensitivity]
                )
                logger.info(f"Porcupine initialized with built-in keyword: '{keyword}'")
            
            self.sample_rate = self.porcupine.sample_rate
            self.frame_length = self.porcupine.frame_length
            
            logger.info(f"Sample rate: {self.sample_rate} Hz, Frame length: {self.frame_length}")
            
        except Exception as e:
            logger.error(f"Failed to initialize Porcupine: {e}")
            raise RuntimeError(f"Porcupine initialization failed: {e}")
    
    def start_listening(self, callback: Callable[[], None]):
        """
        Start listening for wake word in background thread.
        
        Args:
            callback: Function to call when wake word detected (no arguments).
        """
        if self.is_listening:
            logger.warning("Already listening")
            return
        
        self._callback = callback
        self.is_listening = True
        
        # Start listening in background thread
        self._listen_thread = threading.Thread(target=self._listen_loop, daemon=True)
        self._listen_thread.start()
        
        logger.info(f"Started listening for wake word: '{self.keyword}'")
    
    def _listen_loop(self):
        """Main listening loop (runs in background thread)."""
        try:
            # Audio callback for sounddevice
            def audio_callback(indata, frames, time_info, status):
                if status:
                    logger.debug(f"Audio status: {status}")
                
                if not self.is_listening:
                    return
                
                # Convert float32 to int16
                pcm = (indata[:, 0] * 32767).astype(np.int16)
                
                # Process audio frame with Porcupine
                try:
                    keyword_index = self.porcupine.process(pcm)
                    
                    if keyword_index >= 0:
                        logger.info(f"✓ Wake word '{self.keyword}' detected!")
                        
                        # Call callback in separate thread to avoid blocking audio
                        if self._callback:
                            threading.Thread(target=self._callback, daemon=True).start()
                        
                except Exception as e:
                    logger.error(f"Error processing audio: {e}")
            
            # Open audio stream
            with sd.InputStream(
                channels=1,
                samplerate=self.sample_rate,
                blocksize=self.frame_length,
                dtype='float32',
                callback=audio_callback
            ):
                logger.info("Audio stream opened, listening...")
                
                # Keep thread alive while listening
                while self.is_listening:
                    time.sleep(0.1)
            
            logger.info("Audio stream closed")
            
        except Exception as e:
            logger.error(f"Error in listen loop: {e}", exc_info=True)
            self.is_listening = False
    
    def stop_listening(self):
        """Stop listening for wake word."""
        if not self.is_listening:
            return
        
        logger.info("Stopping wake word detection...")
        self.is_listening = False
        
        # Wait for thread to finish
        if self._listen_thread:
            self._listen_thread.join(timeout=2.0)
        
        logger.info("Wake word detection stopped")
    
    def cleanup(self):
        """Clean up resources."""
        self.stop_listening()
        
        if self.porcupine:
            self.porcupine.delete()
            self.porcupine = None
            logger.debug("Porcupine resources cleaned up")
    
    def __del__(self):
        """Destructor to ensure cleanup."""
        self.cleanup()


def create_porcupine_wake_word(
    keyword: str = "jarvis",
    sensitivity: float = 0.5,
    access_key: Optional[str] = None,
    keyword_path: Optional[str] = None
) -> Optional[PorcupineWakeWord]:
    """
    Factory function to create PorcupineWakeWord instance.
    
    Args:
        keyword: Keyword to detect.
        sensitivity: Detection sensitivity (0.0-1.0).
        access_key: Picovoice access key (for custom keywords).
        keyword_path: Path to custom .ppn file (for custom keywords).
    
    Returns:
        PorcupineWakeWord instance or None on failure.
    """
    try:
        return PorcupineWakeWord(
            keyword=keyword,
            sensitivity=sensitivity,
            access_key=access_key,
            keyword_path=keyword_path
        )
    except Exception as e:
        logger.error(f"Failed to create Porcupine wake word: {e}")
        return None


if __name__ == "__main__":
    # Test wake word detection
    print("Testing Porcupine wake word detection...")
    print("Say 'jarvis' to test (Ctrl+C to exit)")
    
    def on_wake():
        print("\n*** WAKE WORD DETECTED! ***\n")
    
    wake = create_porcupine_wake_word(keyword="jarvis", sensitivity=0.5)
    
    if wake:
        wake.start_listening(on_wake)
        
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\nStopping...")
            wake.cleanup()
    else:
        print("Failed to initialize Porcupine")