"""
Porcupine Wake Word Detection
Accurate wake word detection using Porcupine with custom keyword support.
Production-ready version for KenzAI.
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
except ImportError as e:
    PORCUPINE_AVAILABLE = False
    logger.error(f"Porcupine or sounddevice not available: {e}")


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
            sensitivity: Detection sensitivity (0.0-1.0).
            access_key: Picovoice access key (REQUIRED for Porcupine 2.0+).
            keyword_path: Path to custom .ppn keyword file.
        """
        if not PORCUPINE_AVAILABLE:
            raise ImportError(
                "Porcupine not available. Install with: "
                "pip install pvporcupine sounddevice numpy"
            )
        
        self.keyword = keyword
        self.sensitivity = max(0.0, min(1.0, sensitivity))
        self.porcupine = None
        self.is_listening = False
        self._listen_thread = None
        self._callback = None
        
        logger.info(f"Initializing Porcupine with keyword: '{keyword}'")
        logger.info(f"Sensitivity: {self.sensitivity}")
        
        if access_key:
            logger.info(f"Using access key: {access_key[:20]}...")
        else:
            logger.warning("No access key provided")
        
        try:
            if keyword_path:
                # Custom keyword
                keyword_path = Path(keyword_path)
                if not keyword_path.exists():
                    raise FileNotFoundError(f"Keyword file not found: {keyword_path}")
                
                if not access_key:
                    raise ValueError(
                        "Access key is REQUIRED for custom keywords.\n"
                        "Get free key: https://console.picovoice.ai/"
                    )
                
                logger.info(f"Loading custom keyword from: {keyword_path}")
                self.porcupine = pvporcupine.create(
                    access_key=access_key,
                    keyword_paths=[str(keyword_path)],
                    sensitivities=[self.sensitivity]
                )
                logger.info("✓ Porcupine initialized with custom keyword")
                
            else:
                # Built-in keyword
                logger.info(f"Using built-in keyword: '{keyword}'")
                
                if access_key:
                    try:
                        logger.debug("Attempting Porcupine 2.x initialization...")
                        self.porcupine = pvporcupine.create(
                            access_key=access_key,
                            keywords=[keyword],
                            sensitivities=[self.sensitivity]
                        )
                        logger.info("✓ Porcupine 2.x initialized successfully")
                    except Exception as e:
                        logger.error(f"Porcupine 2.x initialization failed: {e}")
                        raise
                else:
                    # Try without access key (Porcupine 1.x fallback)
                    try:
                        logger.debug("Attempting Porcupine 1.x initialization...")
                        self.porcupine = pvporcupine.create(
                            keywords=[keyword],
                            sensitivities=[self.sensitivity]
                        )
                        logger.info("✓ Porcupine 1.x initialized successfully")
                    except TypeError as e:
                        if "access_key" in str(e):
                            raise ValueError(
                                "Porcupine 2.0+ requires an access_key.\n"
                                "Get free key: https://console.picovoice.ai/"
                            )
                        raise
            
            self.sample_rate = self.porcupine.sample_rate
            self.frame_length = self.porcupine.frame_length
            
            logger.info(f"Sample rate: {self.sample_rate} Hz")
            logger.info(f"Frame length: {self.frame_length} samples")
            
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
        
        self._listen_thread = threading.Thread(target=self._listen_loop, daemon=True)
        self._listen_thread.start()
        
        logger.info(f"Started listening for wake word: '{self.keyword}'")
    
    def _listen_loop(self):
        """Main listening loop (runs in background thread)."""
        try:
            def audio_callback(indata, frames, time_info, status):
                if status:
                    logger.debug(f"Audio status: {status}")
                
                if not self.is_listening:
                    return
                
                # Convert float32 to int16
                pcm = (indata[:, 0] * 32767).astype(np.int16)
                
                try:
                    keyword_index = self.porcupine.process(pcm)
                    
                    if keyword_index >= 0:
                        logger.info(f"✓ Wake word '{self.keyword}' detected!")
                        
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
        access_key: Picovoice access key.
        keyword_path: Path to custom .ppn file.
    
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
    # Test wake word detection with config
    print("\n" + "=" * 70)
    print("PORCUPINE WAKE WORD TEST")
    print("=" * 70)
    
    # Initialize logger for test
    from utils.logger import initialize_logger
    initialize_logger(log_level="INFO")
    
    # Load config
    try:
        from utils.helpers import load_config
        config = load_config()
        
        daemon_config = config.get('interfaces', {}).get('daemon', {})
        keyword = daemon_config.get('porcupine_keyword', 'jarvis')
        access_key = daemon_config.get('porcupine_access_key')
        keyword_path = daemon_config.get('porcupine_keyword_path')
        sensitivity = daemon_config.get('porcupine_sensitivity', 0.5)
        
        # Resolve keyword path if provided
        if keyword_path:
            keyword_path = Path(keyword_path)
            if not keyword_path.is_absolute():
                keyword_path = Path(__file__).parent.parent / keyword_path
            keyword_path = str(keyword_path)
        
        print(f"\nConfiguration loaded:")
        print(f"  Keyword: {keyword}")
        print(f"  Access Key: {access_key[:20]}..." if access_key else "  Access Key: NOT SET")
        print(f"  Custom file: {keyword_path}" if keyword_path else "  Using built-in keyword")
        print(f"  Sensitivity: {sensitivity}")
        
    except Exception as e:
        print(f"\n⚠ Could not load config: {e}")
        print("Using defaults...")
        keyword = "jarvis"
        access_key = None
        keyword_path = None
        sensitivity = 0.5
    
    print(f"\nSay '{keyword.upper()}' to trigger wake word")
    print("Press Ctrl+C to exit")
    print("=" * 70 + "\n")
    
    def on_wake():
        print("\n" + "🎯" * 25)
        print(f"   WAKE WORD DETECTED: {keyword.upper()}")
        print("🎯" * 25 + "\n")
    
    try:
        wake = create_porcupine_wake_word(
            keyword=keyword,
            sensitivity=sensitivity,
            access_key=access_key,
            keyword_path=keyword_path
        )
        
        if wake:
            print("✓ Porcupine initialized successfully!")
            print("🎤 Listening...\n")
            
            wake.start_listening(on_wake)
            
            # Keep running
            while True:
                time.sleep(1)
        else:
            print("❌ Failed to initialize Porcupine")
            
    except KeyboardInterrupt:
        print("\n\n👋 Stopping...")
        if 'wake' in locals() and wake:
            wake.cleanup()
        print("✓ Stopped\n")
        
    except Exception as e:
        print(f"\n❌ ERROR: {e}\n")
        import traceback
        traceback.print_exc()