"""
Porcupine Wake Word Detection
More accurate wake word detection using Porcupine.
"""
import sys
from pathlib import Path
from typing import Callable, Optional
import struct

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


class PorcupineWakeWord:
    """Offline wake word detection using Porcupine."""
    
    def __init__(self, wake_words: list = None):
        """
        Initialize Porcupine.
        
        Args:
            wake_words: List of wake words. Default: ['jarvis']
        """
        if not PORCUPINE_AVAILABLE:
            raise ImportError("Porcupine not available. Install with: pip install pvporcupine")
        
        if wake_words is None:
            # Use built-in wake words that sound similar to "kenzai"
            # Available: alexa, americano, blueberry, bumblebee, computer, grapefruit,
            #            grasshopper, hey google, hey siri, jarvis, ok google, picovoice, porcupine, terminator
            wake_words = ['jarvis']  # Closest to a custom AI name
        
        self.porcupine = pvporcupine.create(keywords=wake_words)
        self.sample_rate = self.porcupine.sample_rate
        self.frame_length = self.porcupine.frame_length
        
        logger.info(f"Porcupine initialized with wake words: {wake_words}")
        logger.info(f"Say one of these words to wake KenzAI")
    
    def start_listening(self, callback: Callable):
        """
        Start listening for wake word.
        
        Args:
            callback: Function to call when wake word detected.
        """
        import threading
        
        def audio_callback(indata, frames, time, status):
            if status:
                logger.warning(f"Audio callback status: {status}")
            
            # Convert to int16
            pcm = (indata[:, 0] * 32767).astype(np.int16)
            
            # Process frame
            keyword_index = self.porcupine.process(pcm)
            
            if keyword_index >= 0:
                logger.info("Wake word detected!")
                callback()
        
        self.stream = sd.InputStream(
            channels=1,
            samplerate=self.sample_rate,
            blocksize=self.frame_length,
            dtype='float32',
            callback=audio_callback
        )
        
        self.stream.start()
        logger.info("Porcupine listening started")
    
    def stop_listening(self):
        """Stop listening."""
        if hasattr(self, 'stream'):
            self.stream.stop()
            self.stream.close()
        self.porcupine.delete()
        logger.info("Porcupine stopped")