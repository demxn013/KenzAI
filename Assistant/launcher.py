"""
KenzAI Launcher
Handles shadow animation sequence and greeting on awakening.
"""
import sys
import time
import threading
from pathlib import Path
from typing import Optional, Dict, Any

# Setup imports
_current_dir = Path(__file__).parent
if str(_current_dir) not in sys.path:
    sys.path.insert(0, str(_current_dir))

from utils.logger import get_logger
from utils.helpers import load_config, load_user_preferences
from utils.windows_integration import play_sound, get_screen_resolution, is_windows
from core import KenzAIAssistant, GreetingSystem

logger = get_logger()

# Optional imports
try:
    import pyttsx3
    TTS_AVAILABLE = True
except ImportError:
    TTS_AVAILABLE = False


class ShadowAnimation:
    """Handles the shadow animation sequence."""
    
    def __init__(self, config: Dict[str, Any], preferences: Dict[str, Any]):
        """
        Initialize shadow animation.
        
        Args:
            config: Configuration dict.
            preferences: User preferences dict.
        """
        self.config = config
        self.preferences = preferences
        self.startup_config = config.get('startup', {})
        self.animation_enabled = self.startup_config.get('animation_enabled', True)
        self.animation_duration = self.startup_config.get('animation_duration', 6.0)
        self.sound_enabled = self.startup_config.get('sound_enabled', True)
        self.sound_volume = self.preferences.get('audio', {}).get('startup_volume', 0.5)
    
    def play_shadow_drop_sound(self):
        """Play shadow drop sound effect."""
        if not self.sound_enabled:
            return
        
        # Look for shadow_drop.wav in assets/sounds/
        assets_dir = Path(__file__).parent / "assets" / "sounds"
        sound_file = assets_dir / "shadow_drop.wav"
        
        if sound_file.exists() and is_windows():
            try:
                play_sound(sound_file, self.sound_volume)
                logger.debug("Played shadow drop sound")
            except Exception as e:
                logger.warning(f"Failed to play sound: {e}")
        else:
            logger.debug("Shadow drop sound file not found or not on Windows")
    
    def run_animation(self):
        """
        Run the full shadow animation sequence.
        
        Returns:
            True if animation completed, False if disabled.
        """
        if not self.animation_enabled:
            logger.debug("Animation disabled")
            return False
        
        logger.info("Starting shadow animation sequence...")
        
        # Animation phases (total ~6 seconds)
        phases = [
            (0.5, "Screen edges darken"),
            (1.0, "Shadow wisps appear"),
            (1.5, "Wisps converge, splash effect"),
            (0.0, "Shadow drop sound"),  # Sound plays during convergence
            (2.0, "Particles twirl and form GUI"),
            (1.0, "GUI materializes")
        ]
        
        total_time = 0.0
        for duration, phase_name in phases:
            if phase_name == "Shadow drop sound":
                # Play sound during convergence phase
                self.play_shadow_drop_sound()
            else:
                logger.debug(f"Animation phase: {phase_name} ({duration}s)")
                time.sleep(duration)
                total_time += duration
        
        logger.info("Shadow animation sequence completed")
        return True


class VoiceGreeting:
    """Handles voice greeting with TTS."""
    
    def __init__(self, config: Dict[str, Any], preferences: Optional[Dict[str, Any]] = None):
        """
        Initialize voice greeting.
        
        Args:
            config: Configuration dict.
            preferences: User preferences dict.
        """
        self.config = config
        self.preferences = preferences or {}
        self.voice_config = config.get('interfaces', {}).get('voice', {})
        self.enabled = self.voice_config.get('enabled', True)
        self.tts_voice = self.voice_config.get('tts_voice', 'male')
        self.engine = None
        
        if TTS_AVAILABLE and self.enabled:
            try:
                self.engine = pyttsx3.init()
                
                # Set voice properties
                voices = self.engine.getProperty('voices')
                if voices:
                    # Try to find a male voice if requested
                    if self.tts_voice == 'male':
                        for voice in voices:
                            if 'male' in voice.name.lower() or 'david' in voice.name.lower():
                                self.engine.setProperty('voice', voice.id)
                                break
                
                # Set speech rate and volume
                self.engine.setProperty('rate', 150)  # Slightly slower for formal tone
                self.engine.setProperty('volume', self.preferences.get('audio', {}).get('voice_volume', 0.7))
                
                logger.debug("TTS engine initialized")
            except Exception as e:
                logger.warning(f"Failed to initialize TTS: {e}")
                self.engine = None
        else:
            if not TTS_AVAILABLE:
                logger.debug("TTS not available")
    
    def speak(self, text: str):
        """
        Speak text using TTS.
        
        Args:
            text: Text to speak.
        """
        if not self.enabled or not self.engine:
            logger.debug(f"Would speak: {text}")
            return
        
        try:
            # Add slight echo/reverb effect by speaking twice with delay (simple approach)
            self.engine.say(text)
            self.engine.runAndWait()
            logger.debug(f"Spoke greeting: {text}")
        except Exception as e:
            logger.warning(f"Failed to speak: {e}")


def launch_kenzai(config: Optional[Dict[str, Any]] = None, preferences: Optional[Dict[str, Any]] = None):
    """
    Launch KenzAI with shadow animation and greeting.
    
    Args:
        config: Configuration dict. If None, loads from file.
        preferences: User preferences dict. If None, loads from file.
    
    Returns:
        KenzAIAssistant instance.
    """
    if config is None:
        from utils.helpers import load_config
        config = load_config()
    
    if preferences is None:
        from utils.helpers import load_user_preferences
        preferences = load_user_preferences()
    
    logger.info("Launching KenzAI...")
    
    # Run shadow animation
    animation = ShadowAnimation(config, preferences)
    animation_thread = threading.Thread(target=animation.run_animation, daemon=True)
    animation_thread.start()
    
    # Wait a bit for animation to start
    time.sleep(0.5)
    
    # Initialize assistant
    assistant = KenzAIAssistant(config)
    
    # Get and speak greeting
    greeting = assistant.get_greeting()
    logger.info(f"Greeting: {greeting}")
    
    # Speak greeting with voice
    voice = VoiceGreeting(config, preferences)
    voice.speak(greeting)
    
    # Wait for animation to complete
    animation_thread.join(timeout=6.0)
    
    # Launch GUI (if enabled)
    gui_enabled = config.get('interfaces', {}).get('gui', {}).get('enabled', True)
    if gui_enabled:
        try:
            from interfaces.gui import launch_gui
            gui_thread = threading.Thread(
                target=launch_gui,
                args=(assistant, config, preferences),
                daemon=True
            )
            gui_thread.start()
            logger.info("GUI launched")
        except ImportError:
            logger.warning("GUI module not available")
    
    logger.info("KenzAI launch sequence completed")
    return assistant


if __name__ == "__main__":
    # Test launcher
    assistant = launch_kenzai()
    print(f"\nKenzAI is ready! Greeting: {assistant.get_greeting()}\n")
    
    # Keep running
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nShutting down...")

