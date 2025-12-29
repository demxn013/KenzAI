"""
Porcupine Wake Word Detection - COMPLETE WORKING VERSION
This version works standalone and shows detailed error messages.
"""
import sys
import os
from pathlib import Path
from typing import Callable, Optional
import threading
import time

# Add parent directory to path
_current_dir = Path(__file__).parent.parent
if str(_current_dir) not in sys.path:
    sys.path.insert(0, str(_current_dir))

# Initialize logger BEFORE importing other modules
from utils.logger import initialize_logger, get_logger
initialize_logger(log_level="DEBUG")
logger = get_logger()

try:
    import pvporcupine
    import sounddevice as sd
    import numpy as np
    PORCUPINE_AVAILABLE = True
    logger.info(f"Porcupine version: {pvporcupine.__version__}")
except ImportError as e:
    PORCUPINE_AVAILABLE = False
    logger.error(f"Required packages not available: {e}")
    print(f"\n❌ Missing packages. Install with:")
    print(f"   pip install pvporcupine sounddevice numpy")
    sys.exit(1)


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
            keyword: Built-in keyword name.
            sensitivity: Detection sensitivity (0.0-1.0).
            access_key: Picovoice access key (REQUIRED for Porcupine 2.0+).
            keyword_path: Path to custom .ppn keyword file.
        """
        if not PORCUPINE_AVAILABLE:
            raise ImportError("Porcupine not available")
        
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
            # Try different initialization methods based on what's available
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
                logger.info(f"✓ Porcupine initialized with custom keyword")
                
            else:
                # Built-in keyword
                logger.info(f"Using built-in keyword: '{keyword}'")
                
                # Try WITH access key first (Porcupine 2.x)
                if access_key:
                    try:
                        logger.debug("Attempting Porcupine 2.x initialization (with access_key)...")
                        self.porcupine = pvporcupine.create(
                            access_key=access_key,
                            keywords=[keyword],
                            sensitivities=[self.sensitivity]
                        )
                        logger.info(f"✓ Porcupine 2.x initialized successfully")
                    except Exception as e:
                        logger.error(f"Porcupine 2.x initialization failed: {e}")
                        raise
                else:
                    # Try WITHOUT access key (Porcupine 1.x fallback)
                    try:
                        logger.debug("Attempting Porcupine 1.x initialization (no access_key)...")
                        self.porcupine = pvporcupine.create(
                            keywords=[keyword],
                            sensitivities=[self.sensitivity]
                        )
                        logger.info(f"✓ Porcupine 1.x initialized successfully")
                    except TypeError as e:
                        if "access_key" in str(e):
                            raise ValueError(
                                "Porcupine 2.0+ requires an access_key.\n"
                                "Get free key: https://console.picovoice.ai/\n\n"
                                "Then either:\n"
                                "1. Pass it directly: PorcupineWakeWord(access_key='YOUR_KEY')\n"
                                "2. Add to config.yaml: interfaces.daemon.porcupine_access_key\n"
                                "3. Set environment: export PORCUPINE_ACCESS_KEY=YOUR_KEY"
                            )
                        raise
            
            self.sample_rate = self.porcupine.sample_rate
            self.frame_length = self.porcupine.frame_length
            
            logger.info(f"Sample rate: {self.sample_rate} Hz")
            logger.info(f"Frame length: {self.frame_length} samples")
            
        except Exception as e:
            logger.error(f"Failed to initialize Porcupine: {e}")
            logger.error("Full error:", exc_info=True)
            raise RuntimeError(f"Porcupine initialization failed: {e}")
    
    def start_listening(self, callback: Callable[[], None]):
        """Start listening for wake word."""
        if self.is_listening:
            logger.warning("Already listening")
            return
        
        self._callback = callback
        self.is_listening = True
        
        self._listen_thread = threading.Thread(target=self._listen_loop, daemon=True)
        self._listen_thread.start()
        
        logger.info(f"✓ Started listening for: '{self.keyword}'")
    
    def _listen_loop(self):
        """Main listening loop."""
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
                        logger.info(f"🎯 WAKE WORD DETECTED: '{self.keyword}'")
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
                logger.info("🎤 Audio stream opened - listening...")
                
                while self.is_listening:
                    time.sleep(0.1)
            
            logger.info("Audio stream closed")
            
        except Exception as e:
            logger.error(f"Error in listen loop: {e}", exc_info=True)
            self.is_listening = False
    
    def stop_listening(self):
        """Stop listening."""
        if not self.is_listening:
            return
        
        logger.info("Stopping wake word detection...")
        self.is_listening = False
        
        if self._listen_thread:
            self._listen_thread.join(timeout=2.0)
        
        logger.info("✓ Wake word detection stopped")
    
    def cleanup(self):
        """Clean up resources."""
        self.stop_listening()
        
        if self.porcupine:
            self.porcupine.delete()
            self.porcupine = None
            logger.debug("Porcupine resources cleaned up")
    
    def __del__(self):
        """Destructor."""
        self.cleanup()


def load_access_key_from_config() -> Optional[str]:
    """Try to load access key from config.yaml."""
    try:
        from utils.helpers import load_config
        config = load_config()
        access_key = config.get('interfaces', {}).get('daemon', {}).get('porcupine_access_key')
        
        if access_key:
            # Check if it's a placeholder
            if access_key.startswith('${'):
                logger.warning(f"Access key in config is a placeholder: {access_key}")
                logger.warning("Replace with actual key or set environment variable")
                return None
            
            logger.info("✓ Loaded access key from config.yaml")
            return access_key
        else:
            logger.warning("No access key found in config.yaml")
            return None
            
    except Exception as e:
        logger.error(f"Failed to load config: {e}")
        return None


def load_access_key_from_env() -> Optional[str]:
    """Try to load access key from environment."""
    access_key = os.environ.get('PORCUPINE_ACCESS_KEY')
    
    if access_key:
        logger.info("✓ Loaded access key from environment variable")
        return access_key
    else:
        logger.debug("No PORCUPINE_ACCESS_KEY in environment")
        return None


def get_access_key() -> Optional[str]:
    """Get access key from config or environment."""
    # Try environment first
    key = load_access_key_from_env()
    if key:
        return key
    
    # Then try config
    key = load_access_key_from_config()
    if key:
        return key
    
    return None


if __name__ == "__main__":
    print("\n" + "=" * 70)
    print("PORCUPINE WAKE WORD TEST")
    print("=" * 70)
    
    print("\n📋 Checking system...")
    
    # Check audio devices
    try:
        devices = sd.query_devices()
        print(f"✓ Found {len(devices)} audio devices")
        default_input = sd.query_devices(kind='input')
        print(f"✓ Default input: {default_input['name']}")
    except Exception as e:
        print(f"❌ Audio error: {e}")
    
    # Get access key
    print("\n🔑 Loading access key...")
    access_key = get_access_key()
    
    if not access_key:
        print("\n" + "⚠" * 35)
        print("WARNING: No access key found!")
        print("⚠" * 35)
        print("\nPorcupine 2.0+ requires an access key.")
        print("\nGet FREE key from: https://console.picovoice.ai/")
        print("\nThen either:")
        print("  1. Set environment: export PORCUPINE_ACCESS_KEY=your_key")
        print("  2. Edit config.yaml: interfaces.daemon.porcupine_access_key")
        print("  3. Pass directly: PorcupineWakeWord(access_key='your_key')")
        print("\nAttempting to initialize without key (will only work for Porcupine 1.x)...")
        print()
    
    # Test wake word
    print("\n🎤 Initializing Porcupine...")
    print("Say 'JARVIS' to test")
    print("Press Ctrl+C to exit")
    print("=" * 70 + "\n")
    
    def on_wake():
        print("\n" + "🎯" * 20)
        print("   WAKE WORD DETECTED!")
        print("🎯" * 20 + "\n")
    
    try:
        wake = PorcupineWakeWord(
            keyword="jarvis",
            sensitivity=0.5,
            access_key=access_key
        )
        
        print("\n✓ Porcupine initialized successfully!")
        print("🎤 Listening for 'jarvis'...\n")
        
        wake.start_listening(on_wake)
        
        # Keep running
        while True:
            time.sleep(1)
            
    except KeyboardInterrupt:
        print("\n\n👋 Stopping...")
        if 'wake' in locals():
            wake.cleanup()
        print("✓ Stopped\n")
        
    except Exception as e:
        print(f"\n❌ ERROR: {e}\n")
        logger.error("Full traceback:", exc_info=True)
        print("\n💡 Troubleshooting:")
        print("  1. Check that you have a valid access key")
        print("  2. Verify pvporcupine is installed: pip install pvporcupine")
        print("  3. Get key from: https://console.picovoice.ai/")
        print()