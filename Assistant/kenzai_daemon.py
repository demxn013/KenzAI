"""
KenzAI Daemon - FIXED VERSION
Background service that listens for wake phrase and processes voice commands.
"""
import sys
import time
import signal
import threading
from pathlib import Path
from typing import Optional

# Setup imports
_current_dir = Path(__file__).parent
if str(_current_dir) not in sys.path:
    sys.path.insert(0, str(_current_dir))

from utils.logger import initialize_logger, get_logger
from utils.helpers import load_config, load_user_preferences
from utils.windows_integration import WindowsStartupManager, is_windows

# Optional imports
try:
    import pystray
    from PIL import Image, ImageDraw
    PILLOW_AVAILABLE = True
except ImportError:
    PILLOW_AVAILABLE = False

# Import Porcupine wake word
try:
    from interfaces.porcupine_wake import PorcupineWakeWord
    PORCUPINE_AVAILABLE = True
except ImportError:
    PORCUPINE_AVAILABLE = False

# Import voice interface
try:
    from interfaces.voice import VoiceInterface
    VOICE_AVAILABLE = True
except ImportError:
    VOICE_AVAILABLE = False


class SystemTrayIcon:
    """System tray icon and menu."""
    
    def __init__(self, daemon, logger):
        """
        Initialize system tray icon.
        
        Args:
            daemon: KenzAIDaemon instance.
            logger: Logger instance.
        """
        self.daemon = daemon
        self.logger = logger
        self.icon = None
        self.is_dormant = True
    
    def create_icon_image(self, active: bool = False) -> Image.Image:
        """Create icon image."""
        size = 32
        image = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)
        
        if active:
            color = (100, 150, 255, 255)
            fill = (50, 100, 200, 200)
        else:
            color = (30, 30, 30, 200)
            fill = (20, 20, 20, 150)
        
        margin = 4
        draw.ellipse(
            [margin, margin, size - margin, size - margin],
            fill=fill,
            outline=color,
            width=2
        )
        
        return image
    
    def create_menu(self) -> pystray.Menu:
        """Create system tray menu."""
        return pystray.Menu(
            pystray.MenuItem(
                "Awaken KenzAI",
                self._awaken_kenzai,
                default=True,
                visible=lambda item: self.is_dormant
            ),
            pystray.MenuItem(
                "Show GUI",
                self._show_gui,
                visible=lambda item: not self.is_dormant
            ),
            pystray.MenuItem(
                "Rest",
                self._rest,
                visible=lambda item: not self.is_dormant
            ),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem(
                "Settings",
                pystray.Menu(
                    pystray.MenuItem(
                        "Start with Windows",
                        self._toggle_startup,
                        checked=lambda item: WindowsStartupManager.is_startup_enabled() if is_windows() else False,
                        enabled=lambda item: is_windows()
                    ),
                    pystray.MenuItem(
                        "Animation Effects",
                        self._toggle_animations,
                        checked=lambda item: self.daemon.config.get('startup', {}).get('animation_enabled', True)
                    ),
                )
            ),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem(
                "Dismiss",
                self._dismiss
            )
        )
    
    def _awaken_kenzai(self, icon, item):
        """Awaken KenzAI."""
        self.daemon.awaken()
    
    def _show_gui(self, icon, item):
        """Show GUI."""
        self.daemon.show_gui()
    
    def _rest(self, icon, item):
        """Put KenzAI to rest."""
        self.daemon.rest()
    
    def _toggle_startup(self, icon, item):
        """Toggle Windows startup."""
        if is_windows():
            enabled = WindowsStartupManager.toggle_startup()
            self.logger.info(f"Start with Windows: {'enabled' if enabled else 'disabled'}")
    
    def _toggle_animations(self, icon, item):
        """Toggle animation effects."""
        self.logger.info("Animation toggle (config update not implemented)")
    
    def _dismiss(self, icon, item):
        """Dismiss/exit daemon."""
        self.daemon.shutdown()
    
    def start(self):
        """Start system tray icon."""
        if not PILLOW_AVAILABLE:
            self.logger.warning("Pillow not available. System tray icon disabled.")
            return
        
        try:
            image = self.create_icon_image(active=False)
            menu = self.create_menu()
            
            self.icon = pystray.Icon("KenzAI", image, "KenzAI Shadow Daemon", menu)
            
            thread = threading.Thread(target=self.icon.run, daemon=False)
            thread.start()
            
            self.logger.info("System tray icon started")
        except Exception as e:
            self.logger.error(f"Failed to start system tray icon: {e}")
    
    def update_icon(self, active: bool):
        """Update icon appearance."""
        if self.icon:
            self.is_dormant = not active
            image = self.create_icon_image(active=active)
            self.icon.icon = image
    
    def stop(self):
        """Stop system tray icon."""
        if self.icon:
            self.icon.stop()


class KenzAIDaemon:
    """Main daemon class."""
    
    def __init__(self):
        """Initialize KenzAI daemon."""
        self.config = load_config()
        self.preferences = load_user_preferences()
        
        log_config = self.config.get('logging', {})
        initialize_logger(
            log_level=log_config.get('level', 'INFO'),
            log_file=log_config.get('file')
        )
        self.logger = get_logger()
        
        self.is_active = False
        self.assistant = None
        self.voice_interface = None
        self._command_listening = False
        
        # Get Porcupine configuration
        daemon_config = self.config.get('interfaces', {}).get('daemon', {})
        porcupine_keyword = daemon_config.get('porcupine_keyword', 'jarvis')
        porcupine_sensitivity = daemon_config.get('porcupine_sensitivity', 0.5)
        porcupine_access_key = daemon_config.get('porcupine_access_key')
        porcupine_keyword_path = daemon_config.get('porcupine_keyword_path')
        
        # Initialize Porcupine wake word detector
        self.wake_listener = None
        if PORCUPINE_AVAILABLE:
            try:
                # If keyword_path is provided, resolve it
                if porcupine_keyword_path:
                    keyword_path = Path(porcupine_keyword_path)
                    if not keyword_path.is_absolute():
                        keyword_path = Path(__file__).parent / keyword_path
                else:
                    keyword_path = None
                
                self.wake_listener = PorcupineWakeWord(
                    keyword=porcupine_keyword,
                    sensitivity=porcupine_sensitivity,
                    access_key=porcupine_access_key,
                    keyword_path=str(keyword_path) if keyword_path else None
                )
                
                self.logger.info(f"Porcupine wake word initialized: '{porcupine_keyword}'")
                
            except Exception as e:
                self.logger.error(f"Failed to initialize Porcupine: {e}")
                self.logger.error("Wake word detection will not be available")
                self.wake_listener = None
        else:
            self.logger.error("Porcupine not available! Install with: pip install pvporcupine sounddevice numpy")
        
        # Initialize voice interface
        if VOICE_AVAILABLE:
            try:
                self.voice_interface = VoiceInterface(self.config)
                self.logger.info("Voice interface initialized")
            except Exception as e:
                self.logger.error(f"Failed to initialize voice interface: {e}")
                self.voice_interface = None
        
        self.tray_icon = SystemTrayIcon(self, self.logger)
        
        signal.signal(signal.SIGINT, self._signal_handler)
        if hasattr(signal, 'SIGTERM'):
            signal.signal(signal.SIGTERM, self._signal_handler)
        
        self.logger.info("KenzAI daemon initialized")
    
    def _signal_handler(self, signum, frame):
        """Handle shutdown signals."""
        self.logger.info("Shutdown signal received")
        self.shutdown()
        sys.exit(0)
    
    def start(self):
        """Start the daemon."""
        self.logger.info("Starting KenzAI daemon...")
        
        # Setup Windows startup if enabled
        if is_windows() and self.preferences.get('daemon', {}).get('start_with_windows', False):
            try:
                if not WindowsStartupManager.is_startup_enabled():
                    WindowsStartupManager.enable_startup()
                    self.logger.info("Enabled Windows startup")
            except Exception as e:
                self.logger.warning(f"Failed to setup Windows startup: {e}")
        
        # Start system tray
        self.tray_icon.start()
        
        # Start wake word detection
        if self.wake_listener:
            try:
                self.wake_listener.start_listening(self.awaken)
                self.logger.info("KenzAI daemon running. Listening for wake word...")
            except Exception as e:
                self.logger.error(f"Failed to start wake word detection: {e}")
                self.logger.warning("Use system tray to awaken manually.")
        else:
            self.logger.warning("Wake word detection not available. Use system tray to awaken manually.")
        
        # Keep daemon running
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            self.shutdown()
    
    def awaken(self):
        """Awaken KenzAI - initialize assistant and start listening for commands."""
        if self.is_active:
            self.logger.debug("Already active")
            return
        
        self.logger.info("🌟 Awakening KenzAI...")
        self.is_active = True
        self.tray_icon.update_icon(active=True)
        
        try:
            # Initialize full assistant if not already done
            if self.assistant is None:
                from core import KenzAIAssistant
                self.assistant = KenzAIAssistant(self.config)
                self.logger.info("KenzAI Assistant initialized")
            
            # Get and speak greeting
            greeting = self.assistant.get_greeting()
            self.logger.info(f"Greeting: {greeting}")
            
            if self.voice_interface and self.voice_interface.tts_engine:
                self.voice_interface.speak(greeting)
            else:
                print(f"\n{greeting}\n")
            
            # Launch GUI in background if enabled
            gui_enabled = self.config.get('interfaces', {}).get('gui', {}).get('enabled', True)
            if gui_enabled:
                try:
                    from interfaces.gui import launch_gui
                    gui_thread = threading.Thread(
                        target=launch_gui,
                        args=(self.assistant, self.config, self.preferences),
                        daemon=True
                    )
                    gui_thread.start()
                    self.logger.info("GUI launched")
                except ImportError:
                    self.logger.warning("GUI module not available")
            
            # Start listening for voice commands
            self._start_command_listening()
            
        except Exception as e:
            self.logger.error(f"Failed to awaken: {e}", exc_info=True)
            self.is_active = False
            self.tray_icon.update_icon(active=False)
    
    def _start_command_listening(self):
        """Start listening for voice commands after wake word."""
        if self._command_listening:
            return
        
        if not self.voice_interface or not self.voice_interface.audio_available:
            self.logger.warning("Voice interface not available for commands")
            return
        
        self._command_listening = True
        
        # Start command loop in background thread
        command_thread = threading.Thread(target=self._command_loop, daemon=True)
        command_thread.start()
        
        self.logger.info("Started listening for voice commands")
    
    def _command_loop(self):
        """Main command listening loop."""
        consecutive_failures = 0
        max_failures = 3
        
        self.logger.info("🎤 Ready for commands. Speak now...")
        
        while self._command_listening and self.is_active:
            try:
                # Listen for command
                self.logger.debug("Listening for command...")
                command = self.voice_interface.listen(timeout=10.0, phrase_time_limit=10.0)
                
                if command:
                    consecutive_failures = 0
                    self.logger.info(f"Command received: {command}")
                    
                    # Check for exit commands
                    if any(word in command.lower() for word in ['goodbye', 'go to sleep', 'rest', 'dismiss']):
                        self.voice_interface.speak("Rest well, your Highness")
                        self.rest()
                        break
                    
                    # Process command with assistant
                    try:
                        response = self.assistant.process_query(command)
                        self.logger.info(f"Response: {response}")
                        
                        # Speak response
                        self.voice_interface.speak(response)
                        
                    except Exception as e:
                        self.logger.error(f"Error processing command: {e}")
                        self.voice_interface.speak("I apologize, but I encountered an error processing that request.")
                
                else:
                    # No command detected
                    consecutive_failures += 1
                    self.logger.debug(f"No command detected ({consecutive_failures}/{max_failures})")
                    
                    if consecutive_failures >= max_failures:
                        self.logger.info("No commands detected, returning to dormant state")
                        self.voice_interface.speak("I'll be here if you need me, your Highness")
                        self.rest()
                        break
                
            except Exception as e:
                self.logger.error(f"Error in command loop: {e}", exc_info=True)
                consecutive_failures += 1
                
                if consecutive_failures >= max_failures:
                    self.logger.error("Too many errors, returning to dormant state")
                    self.rest()
                    break
        
        self.logger.info("Command listening stopped")
    
    def show_gui(self):
        """Show GUI interface."""
        if not self.is_active:
            self.awaken()
        self.logger.info("Showing GUI...")
    
    def rest(self):
        """Put KenzAI to rest (dormant state)."""
        if not self.is_active:
            return
        
        self.logger.info("💤 KenzAI resting...")
        self._command_listening = False
        self.is_active = False
        self.tray_icon.update_icon(active=False)
        
        # Get shutdown greeting
        if self.assistant:
            shutdown_greeting = self.assistant.get_shutdown_greeting()
            self.logger.info(shutdown_greeting)
    
    def shutdown(self):
        """Shutdown the daemon."""
        self.logger.info("Shutting down KenzAI daemon...")
        
        # Stop command listening
        self._command_listening = False
        
        # Stop wake word listener
        if self.wake_listener:
            try:
                self.wake_listener.cleanup()
                self.logger.info("Wake phrase listener stopped")
            except Exception as e:
                self.logger.error(f"Error stopping wake listener: {e}")
        
        # Stop system tray
        self.tray_icon.stop()
        
        self.logger.info("KenzAI daemon stopped")


def main():
    """Main entry point for daemon."""
    try:
        daemon = KenzAIDaemon()
        daemon.start()
    except Exception as e:
        logger = get_logger()
        logger.critical(f"Fatal error in daemon: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()