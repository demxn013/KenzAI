"""
TTS Helper - Text-to-speech with callbacks for GUI animation.
Used so the GUI can show "speaking" state (Jarvis line bars) while TTS runs.
"""
import threading
from typing import Optional, Callable

try:
    import pyttsx3
    TTS_AVAILABLE = True
except ImportError:
    TTS_AVAILABLE = False

from utils.logger import get_logger

logger = get_logger()


class TTSHelper:
    """
    Speaks text with optional on_start/on_end callbacks.
    Callbacks are invoked from the TTS thread; use root.after(0, ...) in GUI.
    """
    
    def __init__(self, config: Optional[dict] = None, preferences: Optional[dict] = None):
        self.config = config or {}
        self.preferences = preferences or {}
        self._engine = None
        self._lock = threading.Lock()
        
        voice_cfg = self.config.get('interfaces', {}).get('voice', {})
        self.enabled = voice_cfg.get('enabled', True) and TTS_AVAILABLE
        
        if self.enabled and TTS_AVAILABLE:
            try:
                self._engine = pyttsx3.init()
                tts_cfg = self.config.get('interfaces', {}).get('tts', {})
                self._engine.setProperty('rate', tts_cfg.get('rate', 175))
                vol = self.preferences.get('audio', {}).get('voice_volume', 0.8)
                self._engine.setProperty('volume', vol)
                voices = self._engine.getProperty('voices')
                if voices and voice_cfg.get('tts_voice', 'male') == 'male':
                    for v in voices:
                        if 'male' in v.name.lower() or 'david' in v.name.lower():
                            self._engine.setProperty('voice', v.id)
                            break
                logger.debug("TTS helper initialized")
            except Exception as e:
                logger.warning(f"TTS init failed: {e}")
                self._engine = None
                self.enabled = False
    
    def speak(
        self,
        text: str,
        on_start: Optional[Callable[[], None]] = None,
        on_end: Optional[Callable[[], None]] = None
    ):
        """
        Speak text. Runs in a background thread.
        on_start is called when speech begins, on_end when it finishes.
        """
        if not text or not self._engine:
            if on_end:
                on_end()
            return
        
        def _run():
            try:
                if on_start:
                    on_start()
                with self._lock:
                    self._engine.say(text)
                    self._engine.runAndWait()
            except Exception as e:
                logger.warning(f"TTS speak error: {e}")
            finally:
                if on_end:
                    on_end()
        
        threading.Thread(target=_run, daemon=True).start()
    
    def is_available(self) -> bool:
        return self.enabled and self._engine is not None
