"""
KenzAI Daemon
Background service that listens for wake phrase and manages system tray.
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
        self.full_system = None
        
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
                
                # FIXED: Pass keyword (singular), not keywords (list)
                self.wake_listener = PorcupineWakeWord(
                    keyword=porcupine_keyword,  # ✅ Fixed: singular keyword
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
        """Awaken KenzAI - trigger launcher and full system."""
        if self.is_active:
            self.logger.debug("Already active")
            return
        
        self.logger.info("Awakening KenzAI...")
        self.is_active = True
        self.tray_icon.update_icon(active=True)
        
        try:
            from launcher import launch_kenzai
            launch_kenzai(self.config, self.preferences)
        except ImportError:
            self.logger.warning("Launcher not available. Starting full system directly...")
            self._start_full_system()
    
    def _start_full_system(self):
        """Start the full KenzAI system."""
        try:
            from core import KenzAIAssistant
            self.full_system = KenzAIAssistant(self.config)
            self.logger.info("Full KenzAI system started")
        except Exception as e:
            self.logger.error(f"Failed to start full system: {e}")
    
    def show_gui(self):
        """Show GUI interface."""
        if not self.is_active:
            self.awaken()
        self.logger.info("Showing GUI...")
    
    def rest(self):
        """Put KenzAI to rest (dormant state)."""
        if not self.is_active:
            return
        
        self.logger.info("KenzAI resting...")
        self.is_active = False
        self.tray_icon.update_icon(active=False)
    
    def shutdown(self):
        """Shutdown the daemon."""
        self.logger.info("Shutting down KenzAI daemon...")
        
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