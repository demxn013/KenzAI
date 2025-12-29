"""
KenzAI - Main Entry Point
Refactored to use modular architecture.
"""
import sys
import time
import signal
from pathlib import Path

# Setup imports - add current directory to path
_current_dir = Path(__file__).parent
if str(_current_dir) not in sys.path:
    sys.path.insert(0, str(_current_dir))

# Import modules
from utils.logger import initialize_logger, get_logger
from utils.helpers import load_config
from core import KenzAIAssistant

# Optional imports (may not be available)
try:
    import keyboard
    KEYBOARD_AVAILABLE = True
except ImportError:
    KEYBOARD_AVAILABLE = False

try:
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler
    WATCHDOG_AVAILABLE = True
except ImportError:
    WATCHDOG_AVAILABLE = False


class FileWatcher:
    """Optional file system watcher."""
    
    def __init__(self, folders, logger):
        """
        Initialize file watcher.
        
        Args:
            folders: List of folders to watch.
            logger: Logger instance.
        """
        self.folders = folders
        self.logger = logger
        self.observer = None
    
    def start(self):
        """Start watching folders."""
        if not WATCHDOG_AVAILABLE:
            self.logger.warning("Watchdog not available. File watching disabled.")
            return
        
        if not self.folders:
            return
        
        class WatchHandler(FileSystemEventHandler):
            def __init__(self, logger):
                self.logger = logger
            
            def on_modified(self, event):
                if event.is_directory:
                    return
                self.logger.debug(f"Detected change in {event.src_path}")
        
        self.observer = Observer()
        handler = WatchHandler(self.logger)
        
        for folder in self.folders:
            folder_path = Path(folder)
            if folder_path.exists():
                self.observer.schedule(handler, str(folder_path), recursive=True)
                self.logger.info(f"Watching folder: {folder}")
            else:
                self.logger.warning(f"Folder does not exist: {folder}")
        
        if self.observer.scheduled:
            self.observer.start()
            self.logger.info("File watcher started")
    
    def stop(self):
        """Stop watching folders."""
        if self.observer:
            self.observer.stop()
            self.observer.join()
            self.logger.info("File watcher stopped")


class KenzAIMain:
    """Main KenzAI application."""
    
    def __init__(self):
        """Initialize KenzAI."""
        # Load configuration
        self.config = load_config()
        
        # Initialize logger
        log_config = self.config.get('logging', {})
        initialize_logger(
            log_level=log_config.get('level', 'INFO'),
            log_file=log_config.get('file')
        )
        self.logger = get_logger()
        
        # Initialize assistant
        self.logger.info("Initializing KenzAI...")
        self.assistant = KenzAIAssistant(self.config)
        
        # Initialize file watcher (if enabled)
        self.file_watcher = None
        integrations = self.config.get('integrations', {})
        file_system = integrations.get('file_system', {})
        
        if file_system.get('enabled', False):
            watched_folders = file_system.get('whitelist_folders', [])
            if watched_folders:
                self.file_watcher = FileWatcher(watched_folders, self.logger)
                self.file_watcher.start()
        
        # Setup hotkey (if enabled and available)
        self.hotkey_enabled = False
        if KEYBOARD_AVAILABLE:
            try:
                hotkey = self.config.get('hotkey', 'ctrl+shift+j')
                keyboard.add_hotkey(hotkey, self._hotkey_handler)
                self.hotkey_enabled = True
                self.logger.info(f"Hotkey enabled: {hotkey}")
            except Exception as e:
                self.logger.warning(f"Failed to register hotkey: {e}")
        else:
            self.logger.info("Keyboard module not available. Hotkey disabled.")
        
        # Setup signal handlers for graceful shutdown
        signal.signal(signal.SIGINT, self._signal_handler)
        if hasattr(signal, 'SIGTERM'):
            signal.signal(signal.SIGTERM, self._signal_handler)
        
        self.logger.info("KenzAI initialized successfully")
        self.logger.info(f"Models: CODE='{self.assistant.model_manager.models['code']}', "
                        f"GENERAL='{self.assistant.model_manager.models['general']}'")
    
    def _hotkey_handler(self):
        """Handle hotkey press."""
        try:
            print("\n[KenzAI] Hotkey triggered. Type your prompt:")
            user_input = input(">>> ")
            
            if user_input.strip():
                reply = self.assistant.process_query(user_input)
                print(f"[KenzAI] {reply}")
        except Exception as e:
            self.logger.error(f"Error in hotkey handler: {e}")
    
    def _signal_handler(self, signum, frame):
        """Handle shutdown signals."""
        self.logger.info("Shutdown signal received. Gracefully shutting down...")
        self.shutdown()
        sys.exit(0)
    
    def shutdown(self):
        """Gracefully shutdown KenzAI."""
        self.logger.info("Shutting down KenzAI...")
        
        # Stop file watcher
        if self.file_watcher:
            self.file_watcher.stop()
        
        # Remove hotkey
        if self.hotkey_enabled and KEYBOARD_AVAILABLE:
            try:
                keyboard.unhook_all()
            except Exception:
                pass
        
        shutdown_greeting = self.assistant.get_shutdown_greeting()
        self.logger.info(shutdown_greeting)
    
    def run_interactive(self):
        """Run in interactive mode."""
        self.logger.info("KenzAI interactive mode. Type 'exit' or 'quit' to stop.")
        print(f"\n{self.assistant.get_greeting()}\n")
        
        try:
            while True:
                try:
                    user_input = input("You: ").strip()
                    
                    if not user_input:
                        continue
                    
                    if user_input.lower() in ['exit', 'quit', 'q']:
                        break
                    
                    # Process query
                    response = self.assistant.process_query(user_input)
                    print(f"KenzAI: {response}\n")
                    
                except EOFError:
                    break
                except KeyboardInterrupt:
                    break
        finally:
            self.shutdown()
    
    def run_daemon(self):
        """Run as daemon (background service)."""
        self.logger.info("KenzAI daemon mode. Running in background...")
        print("KenzAI is running in daemon mode.")
        print("Press Ctrl+C to stop.")
        
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            self.shutdown()


def main():
    """Main entry point."""
    try:
        app = KenzAIMain()
        
        # Determine mode (interactive or daemon)
        # For now, default to interactive. Daemon mode will be handled by kenzai_daemon.py
        app.run_interactive()
        
    except KeyboardInterrupt:
        print("\nShutting down...")
        sys.exit(0)
    except Exception as e:
        logger = get_logger()
        logger.critical(f"Fatal error: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
