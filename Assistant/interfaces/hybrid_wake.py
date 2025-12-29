"""
Hybrid Wake Word System
Uses Porcupine for fast detection + speech recognition for verification.
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
    PORCUPINE_AVAILABLE = True
except ImportError:
    PORCUPINE_AVAILABLE = False
    logger.error("Porcupine not available")

try:
    from interfaces.voice import VoiceInterface
    VOICE_AVAILABLE = True
except ImportError:
    VOICE_AVAILABLE = False
    logger.error("Voice interface not available")


class HybridWakeWord:
    """
    Hybrid wake word detection system.
    
    Uses Porcupine for fast, offline detection of trigger word (e.g., "Jarvis"),
    then uses speech recognition to verify the actual wake phrase (e.g., "KenzAI").
    """
    
    def __init__(self, porcupine_keyword: str = 'jarvis', 
                 verify_keyword: str = 'kenzai',
                 sensitivity: float = 0.5,
                 verification_timeout: float = 3.0):
        """
        Initialize hybrid wake word system.
        
        Args:
            porcupine_keyword: Built-in Porcupine keyword for fast detection.
            verify_keyword: Keyword to verify after Porcupine triggers.
            sensitivity: Porcupine sensitivity (0-1).
            verification_timeout: How long to listen for verification.
        """
        if not PORCUPINE_AVAILABLE:
            raise ImportError("Porcupine required. Install: pip install pvporcupine")
        
        if not VOICE_AVAILABLE:
            raise ImportError("Voice interface required")
        
        self.porcupine_keyword = porcupine_keyword
        self.verify_keyword = verify_keyword.lower()
        self.verification_timeout = verification_timeout
        self.is_listening = False
        self.callback = None
        
        # Initialize Porcupine
        try:
            self.porcupine = pvporcupine.create(
                keywords=[porcupine_keyword],
                sensitivities=[sensitivity]
            )
            logger.info(f"Porcupine initialized: trigger='{porcupine_keyword}', verify='{verify_keyword}'")
        except Exception as e:
            logger.error(f"Failed to initialize Porcupine: {e}")
            raise
        
        # Initialize voice interface for verification
        from utils.helpers import load_config
        config = load_config()
        self.voice = VoiceInterface(config)
        
        if not self.voice.audio_available:
            raise RuntimeError("Voice interface audio not available")
        
        self.sample_rate = self.porcupine.sample_rate
        self.frame_length = self.porcupine.frame_length
        self.stream = None
        
        logger.info(f"Hybrid wake word ready: Say '{porcupine_keyword}' then '{verify_keyword}'")
    
    def _verify_wake_phrase(self) -> bool:
        """
        Verify that the user said the actual wake phrase.
        
        Returns:
            True if wake phrase verified.
        """
        logger.info(f"Trigger detected, listening for '{self.verify_keyword}'...")
        
        # Listen for verification
        text = self.voice.listen(
            timeout=self.verification_timeout,
            phrase_time_limit=self.verification_timeout
        )
        
        if not text:
            logger.debug("No speech detected during verification")
            return False
        
        text_lower = text.lower()
        
        # Check for exact match or common variations
        variations = [
            self.verify_keyword,
            'kenzie', 'kenzi', 'enzai', 'kensai'
        ]
        
        if any(var in text_lower for var in variations):
            logger.info(f"✓ Wake phrase verified: '{text}'")
            return True
        else:
            logger.debug(f"✗ Verification failed: heard '{text}'")
            return False