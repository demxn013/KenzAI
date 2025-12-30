"""
KenzAI Unified Daemon - FIXED VERSION
Fixes VAD continuous listening startup and adds better error handling.
Single file for all daemon functionality with proper wake/sleep modes.
Supports both Porcupine wake word and VAD continuous listening.
"""
import sys
import time
import signal
import threading
from pathlib import Path
from typing import Optional, Callable
from enum import Enum

_current_dir = Path(__file__).parent
if str(_current_dir) not in sys.path:
    sys.path.insert(0, str(_current_dir))

from utils.logger import initialize_logger, get_logger
from utils.helpers import load_config, load_user_preferences, save_user_preferences
from utils.windows_integration import WindowsStartupManager, is_windows

# Optional imports
try:
    import pystray
    from PIL import Image, ImageDraw
    SYSTRAY_AVAILABLE = True
except ImportError:
    SYSTRAY_AVAILABLE = False

try:
    from interfaces.porcupine_wake import PorcupineWakeWord
    PORCUPINE_AVAILABLE = True
except ImportError:
    PORCUPINE_AVAILABLE = False

try:
    from interfaces.vad_voice import VADVoiceInterface
    VAD_AVAILABLE = True
except ImportError:
    VAD_AVAILABLE = False
    # Fallback to regular voice
    try:
        from interfaces.voice import VoiceInterface
        VOICE_AVAILABLE = True
    except ImportError:
        VOICE_AVAILABLE = False


class DaemonMode(Enum):
    """Daemon operation modes."""
    SLEEP = "sleep"      # Listening for wake word only (low resource)
    AWAKE = "awake"      # Fully active, processing commands


class SystemTrayIcon:
    """System tray icon with context menu."""
    
    def __init__(self, daemon, logger):
        self.daemon = daemon
        self.logger = logger
        self.icon = None
    
    def create_icon_image(self, awake: bool = False) -> Image.Image:
        """Create icon image based on state."""
        size = 64
        image = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)
        
        if awake:
            # Bright blue glow when awake
            color = (100, 200, 255, 255)
            fill = (50, 150, 255, 200)
        else:
            # Dim gray when sleeping
            color = (80, 80, 80, 200)
            fill = (40, 40, 40, 150)
        
        margin = 8
        draw.ellipse(
            [margin, margin, size - margin, size - margin],
            fill=fill,
            outline=color,
            width=3
        )
        
        # Add inner circle for depth
        inner_margin = 16
        draw.ellipse(
            [inner_margin, inner_margin, size - inner_margin, size - inner_margin],
            outline=color,
            width=2
        )
        
        return image
    
    def create_menu(self) -> pystray.Menu:
        """Create context menu."""
        return pystray.Menu(
            pystray.MenuItem(
                "Wake Up",
                self._manual_wake,
                default=True,
                visible=lambda item: self.daemon.mode == DaemonMode.SLEEP
            ),
            pystray.MenuItem(
                "Go to Sleep",
                self._manual_sleep,
                visible=lambda item: self.daemon.mode == DaemonMode.AWAKE
            ),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem(
                "Settings",
                pystray.Menu(
                    pystray.MenuItem(
                        "Start with Windows",
                        self._toggle_startup,
                        checked=lambda item: self._is_startup_enabled(),
                        enabled=lambda item: is_windows()
                    ),
                    pystray.MenuItem(
                        "Show GUI",
                        self._show_gui,
                        visible=lambda item: self.daemon.mode == DaemonMode.AWAKE
                    )
                )
            ),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Exit", self._exit)
        )
    
    def _is_startup_enabled(self) -> bool:
        """Check if startup is enabled."""
        try:
            return WindowsStartupManager.is_startup_enabled() if is_windows() else False
        except Exception:
            return False
    
    def _manual_wake(self, icon, item):
        """Manually wake KenzAI."""
        self.daemon.wake_up()
    
    def _manual_sleep(self, icon, item):
        """Manually put KenzAI to sleep."""
        self.daemon.go_to_sleep()
    
    def _toggle_startup(self, icon, item):
        """Toggle Windows startup."""
        if is_windows():
            try:
                enabled = WindowsStartupManager.toggle_startup()
                self.logger.info(f"Start with Windows: {'enabled' if enabled else 'disabled'}")
            except Exception as e:
                self.logger.error(f"Failed to toggle startup: {e}")
    
    def _show_gui(self, icon, item):
        """Show GUI interface."""
        self.daemon.show_gui()
    
    def _exit(self, icon, item):
        """Exit daemon."""
        self.daemon.shutdown()
    
    def start(self):
        """Start system tray icon."""
        if not SYSTRAY_AVAILABLE:
            self.logger.warning("System tray not available (install: pip install pystray pillow)")
            return
        
        try:
            image = self.create_icon_image(awake=False)
            menu = self.create_menu()
            
            self.icon = pystray.Icon("KenzAI", image, "KenzAI Assistant", menu)
            
            # Run in separate thread
            threading.Thread(target=self.icon.run, daemon=False).start()
            
            self.logger.info("System tray icon started")
        except Exception as e:
            self.logger.error(f"Failed to start system tray: {e}")
    
    def update_state(self, awake: bool):
        """Update icon to reflect current state."""
        if self.icon:
            self.icon.icon = self.create_icon_image(awake=awake)
            self.icon.menu = self.create_menu()
    
    def stop(self):
        """Stop system tray icon."""
        if self.icon:
            self.icon.stop()


class KenzAIUnifiedDaemon:
    """Unified KenzAI daemon with wake/sleep modes."""
    
    def __init__(self):
        """Initialize daemon."""
        self.config = load_config()
        self.preferences = load_user_preferences()
        
        # Initialize logging
        log_config = self.config.get('logging', {})
        initialize_logger(
            log_level=log_config.get('level', 'INFO'),
            log_file=log_config.get('file')
        )
        self.logger = get_logger()
        
        self.mode = DaemonMode.SLEEP
        self.assistant = None
        self.wake_listener = None
        self.voice_interface = None
        self.vad_interface = None
        self._running = True
        self._command_lock = threading.Lock()  # Prevent concurrent command processing
        
        # Initialize wake word detector
        self._init_wake_word()
        
        # Initialize voice interfaces
        self._init_voice()
        
        # System tray
        self.tray_icon = SystemTrayIcon(self, self.logger)
        
        # Signal handlers
        signal.signal(signal.SIGINT, self._signal_handler)
        if hasattr(signal, 'SIGTERM'):
            signal.signal(signal.SIGTERM, self._signal_handler)
        
        self.logger.info("KenzAI Unified Daemon initialized")
    
    def _init_wake_word(self):
        """Initialize Porcupine wake word detector."""
        if not PORCUPINE_AVAILABLE:
            self.logger.error("Porcupine not available! Install: pip install pvporcupine")
            return
        
        daemon_config = self.config.get('interfaces', {}).get('daemon', {})
        keyword = daemon_config.get('porcupine_keyword', 'jarvis')
        sensitivity = daemon_config.get('porcupine_sensitivity', 1.0)
        access_key = daemon_config.get('porcupine_access_key')
        keyword_path = daemon_config.get('porcupine_keyword_path')
        
        # Resolve keyword path if provided
        if keyword_path:
            keyword_path = Path(keyword_path)
            if not keyword_path.is_absolute():
                keyword_path = Path(__file__).parent / keyword_path
            keyword_path = str(keyword_path)
        
        try:
            self.wake_listener = PorcupineWakeWord(
                keyword=keyword,
                sensitivity=sensitivity,
                access_key=access_key,
                keyword_path=keyword_path
            )
            self.logger.info(f"✓ Wake word '{keyword}' initialized")
        except Exception as e:
            self.logger.error(f"Failed to initialize wake word: {e}")
            self.wake_listener = None
    
    def _init_voice(self):
        """Initialize voice interfaces."""
        # Try VAD interface first (for continuous listening)
        if VAD_AVAILABLE:
            try:
                self.vad_interface = VADVoiceInterface(self.config)
                if self.vad_interface.audio_available and self.vad_interface.vad:
                    self.logger.info("✓ VAD voice interface initialized")
                else:
                    self.logger.warning("VAD available but audio/VAD not working")
                    self.vad_interface = None
            except Exception as e:
                self.logger.error(f"Failed to initialize VAD: {e}")
                self.vad_interface = None
        
        # Fallback to regular voice interface (for single commands)
        if not self.vad_interface and VOICE_AVAILABLE:
            try:
                from interfaces.voice import VoiceInterface
                self.voice_interface = VoiceInterface(self.config)
                self.logger.info("✓ Voice interface initialized (non-VAD)")
            except Exception as e:
                self.logger.error(f"Failed to initialize voice: {e}")
    
    def _signal_handler(self, signum, frame):
        """Handle shutdown signals."""
        self.logger.info("\nShutdown signal received")
        self.shutdown()
        sys.exit(0)
    
    def start(self):
        """Start the daemon in sleep mode."""
        self.logger.info("\n" + "=" * 70)
        self.logger.info("KENZAI UNIFIED DAEMON")
        self.logger.info("=" * 70)
        
        # Setup Windows startup if configured
        if is_windows() and self.preferences.get('daemon', {}).get('start_with_windows', False):
            try:
                if not WindowsStartupManager.is_startup_enabled():
                    WindowsStartupManager.enable_startup()
                    self.logger.info("✓ Enabled Windows startup")
            except Exception as e:
                self.logger.warning(f"Could not enable startup: {e}")
        
        # Start system tray
        self.tray_icon.start()
        
        # Enter sleep mode (listening for wake word)
        self._enter_sleep_mode()
        
        # Main loop
        try:
            while self._running:
                time.sleep(1)
        except KeyboardInterrupt:
            self.shutdown()
    
    def _enter_sleep_mode(self):
        """Enter sleep mode (low resource, wake word only)."""
        self.mode = DaemonMode.SLEEP
        self.tray_icon.update_state(awake=False)
        
        self.logger.info("\n" + "💤" * 35)
        self.logger.info("SLEEP MODE - Listening for wake word")
        self.logger.info("Say 'KENZAI' to wake up")
        self.logger.info("💤" * 35 + "\n")
        
        # Stop VAD if running
        if self.vad_interface and hasattr(self.vad_interface, '_listening'):
            if self.vad_interface._listening:
                self.logger.debug("Stopping VAD...")
                self.vad_interface.stop_listening()
        
        # Start wake word detection
        if self.wake_listener:
            self.wake_listener.start_listening(self.wake_up)
        else:
            self.logger.warning("Wake word not available - use system tray to wake manually")
    
    def wake_up(self):
        """Wake up from sleep mode."""
        if self.mode == DaemonMode.AWAKE:
            self.logger.debug("Already awake")
            return
        
        self.logger.info("\n" + "🌟" * 35)
        self.logger.info("WAKING UP...")
        self.logger.info("🌟" * 35 + "\n")
        
        # Stop wake word detection
        if self.wake_listener:
            self.wake_listener.stop_listening()
        
        # Change mode
        self.mode = DaemonMode.AWAKE
        self.tray_icon.update_state(awake=True)
        
        # Initialize assistant if needed
        if self.assistant is None:
            try:
                self.logger.info("Initializing KenzAI core...")
                from core import KenzAIAssistant
                self.assistant = KenzAIAssistant(self.config)
                self.logger.info("✓ Assistant initialized")
            except Exception as e:
                self.logger.error(f"Failed to initialize assistant: {e}")
                self._enter_sleep_mode()
                return
        
        # Speak greeting
        greeting = self.assistant.get_greeting()
        self.logger.info(f"Greeting: {greeting}")
        
        voice = self.vad_interface or self.voice_interface
        if voice and hasattr(voice, 'tts_engine') and voice.tts_engine:
            try:
                voice.speak(greeting)
            except Exception as e:
                self.logger.error(f"Failed to speak greeting: {e}")
        
        # Wait for greeting to finish
        time.sleep(2)
        
        self.logger.info("\n" + "=" * 70)
        self.logger.info("AWAKE MODE - Continuously listening")
        self.logger.info("Say 'go to sleep' or 'goodbye' to return to sleep mode")
        self.logger.info("=" * 70 + "\n")
        
        # Start continuous listening with VAD
        if self.vad_interface and self.vad_interface.vad:
            try:
                self.logger.info("Starting VAD continuous listening...")
                self.vad_interface.start_continuous_listening(self._handle_command)
                self.logger.info("✓ VAD listening started")
            except Exception as e:
                self.logger.error(f"Failed to start VAD listening: {e}")
                self.logger.warning("Falling back to command loop...")
                threading.Thread(target=self._command_loop, daemon=True).start()
        else:
            self.logger.warning("VAD not available - starting command loop")
            threading.Thread(target=self._command_loop, daemon=True).start()
    
    def _handle_command(self, text: str):
        """Handle voice command (called by VAD)."""
        if self.mode != DaemonMode.AWAKE:
            return
        
        # Prevent concurrent command processing
        if not self._command_lock.acquire(blocking=False):
            self.logger.debug("Command already being processed, skipping...")
            return
        
        try:
            self.logger.info(f"\n💬 You: {text}")
            
            # Check for sleep commands
            sleep_phrases = [
                'go to sleep', 'goodbye', 'rest', 'dismiss',
                'that is all', 'you may leave', 'sleep now',
                'go back to sleep', 'return to sleep'
            ]
            
            if any(phrase in text.lower() for phrase in sleep_phrases):
                response = "Rest well, your Highness. I shall await your call."
                self.logger.info(f"🎙️ KenzAI: {response}\n")
                
                voice = self.vad_interface or self.voice_interface
                if voice:
                    voice.speak(response)
                
                time.sleep(2)
                self.go_to_sleep()
                return
            
            # Process command
            try:
                self.logger.info("🤔 Processing...")
                response = self.assistant.process_query(text)
                self.logger.info(f"🎙️ KenzAI: {response}\n")
                
                # Speak response
                voice = self.vad_interface or self.voice_interface
                if voice:
                    voice.speak(response)
            
            except Exception as e:
                self.logger.error(f"Error processing command: {e}", exc_info=True)
                error_msg = "I apologize, but I encountered an error."
                
                voice = self.vad_interface or self.voice_interface
                if voice:
                    voice.speak(error_msg)
        
        finally:
            self._command_lock.release()
    
    def _command_loop(self):
        """Fallback command loop (non-VAD)."""
        consecutive_failures = 0
        max_failures = 3
        
        self.logger.info("📢 Command loop started (listening for single commands)")
        
        while self.mode == DaemonMode.AWAKE:
            try:
                if not self.voice_interface or not self.voice_interface.audio_available:
                    self.logger.error("Voice interface not available")
                    break
                
                self.logger.info("\n🎤 Listening...")
                command = self.voice_interface.listen(timeout=10.0, phrase_time_limit=10.0)
                
                if command:
                    consecutive_failures = 0
                    self._handle_command(command)
                else:
                    consecutive_failures += 1
                    self.logger.debug(f"No input ({consecutive_failures}/{max_failures})")
                    if consecutive_failures >= max_failures:
                        self.logger.info("No activity - returning to sleep mode")
                        self.go_to_sleep()
                        break
            
            except Exception as e:
                self.logger.error(f"Error in command loop: {e}")
                consecutive_failures += 1
                if consecutive_failures >= max_failures:
                    self.go_to_sleep()
                    break
    
    def go_to_sleep(self):
        """Return to sleep mode."""
        if self.mode == DaemonMode.SLEEP:
            return
        
        self.logger.info("\n💤 Returning to sleep mode...")
        
        # Get farewell
        if self.assistant:
            try:
                farewell = self.assistant.get_shutdown_greeting()
                self.logger.info(farewell)
            except Exception as e:
                self.logger.error(f"Failed to get farewell: {e}")
        
        # Enter sleep mode
        self._enter_sleep_mode()
    
    def show_gui(self):
        """Show GUI interface."""
        if self.mode == DaemonMode.SLEEP:
            self.wake_up()
        
        try:
            self.logger.info("Launching GUI...")
            from interfaces.gui import launch_gui
            
            gui_thread = threading.Thread(
                target=launch_gui,
                args=(self.assistant, self.config, self.preferences),
                daemon=True
            )
            gui_thread.start()
        except ImportError:
            self.logger.error("GUI not available")
    
    def shutdown(self):
        """Shutdown daemon."""
        self.logger.info("\n" + "=" * 70)
        self.logger.info("SHUTTING DOWN...")
        self.logger.info("=" * 70 + "\n")
        
        self._running = False
        
        # Stop wake word listener
        if self.wake_listener:
            try:
                self.wake_listener.cleanup()
            except Exception as e:
                self.logger.error(f"Error stopping wake listener: {e}")
        
        # Stop VAD
        if self.vad_interface and hasattr(self.vad_interface, 'stop_listening'):
            try:
                self.vad_interface.stop_listening()
            except Exception as e:
                self.logger.error(f"Error stopping VAD: {e}")
        
        # Stop system tray
        try:
            self.tray_icon.stop()
        except Exception as e:
            self.logger.error(f"Error stopping tray: {e}")
        
        if self.assistant:
            try:
                farewell = self.assistant.get_shutdown_greeting()
                self.logger.info(farewell)
            except Exception as e:
                self.logger.error(f"Error getting farewell: {e}")
        
        self.logger.info("✓ Daemon stopped\n")


def main():
    """Main entry point."""
    try:
        daemon = KenzAIUnifiedDaemon()
        daemon.start()
    except Exception as e:
        logger = get_logger()
        logger.critical(f"Fatal error: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()