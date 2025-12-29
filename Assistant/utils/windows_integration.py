"""
Windows Integration Utilities
Handles Windows registry operations for startup, system tray, and Windows-specific features.
"""
import os
import sys
import subprocess
from pathlib import Path
from typing import Optional
import winreg


def is_windows() -> bool:
    """Check if running on Windows."""
    return sys.platform == 'win32'


def require_windows():
    """Raise error if not running on Windows."""
    if not is_windows():
        raise RuntimeError("Windows integration functions require Windows OS")


class WindowsStartupManager:
    """Manages Windows startup registry entries."""
    
    REGISTRY_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
    APP_NAME = "KenzAI"
    
    @staticmethod
    def get_startup_path() -> Optional[Path]:
        """
        Get the path to the executable/script that should run on startup.
        
        Returns:
            Path to the startup script, or None if not set.
        """
        require_windows()
        
        try:
            key = winreg.OpenKey(
                winreg.HKEY_CURRENT_USER,
                WindowsStartupManager.REGISTRY_KEY,
                0,
                winreg.KEY_READ
            )
            
            try:
                value, _ = winreg.QueryValueEx(key, WindowsStartupManager.APP_NAME)
                return Path(value)
            except FileNotFoundError:
                return None
            finally:
                winreg.CloseKey(key)
        except Exception:
            return None
    
    @staticmethod
    def is_startup_enabled() -> bool:
        """Check if KenzAI is set to start with Windows."""
        return WindowsStartupManager.get_startup_path() is not None
    
    @staticmethod
    def enable_startup(script_path: Optional[Path] = None):
        """
        Enable KenzAI to start with Windows.
        
        Args:
            script_path: Path to the script to run. If None, uses current script.
        """
        require_windows()
        
        if script_path is None:
            # Default to kenzai_daemon.py in the Assistant folder
            script_path = Path(__file__).parent.parent / "kenzai_daemon.py"
        
        script_path = Path(script_path).resolve()
        
        if not script_path.exists():
            raise FileNotFoundError(f"Startup script not found: {script_path}")
        
        # Get Python executable
        python_exe = sys.executable
        if not python_exe:
            raise RuntimeError("Could not determine Python executable path")
        
        # Create command: python.exe "path\to\kenzai_daemon.py"
        command = f'"{python_exe}" "{script_path}"'
        
        try:
            key = winreg.OpenKey(
                winreg.HKEY_CURRENT_USER,
                WindowsStartupManager.REGISTRY_KEY,
                0,
                winreg.KEY_WRITE
            )
            
            try:
                winreg.SetValueEx(
                    key,
                    WindowsStartupManager.APP_NAME,
                    0,
                    winreg.REG_SZ,
                    command
                )
            finally:
                winreg.CloseKey(key)
        except Exception as e:
            raise RuntimeError(f"Failed to enable startup: {e}")
    
    @staticmethod
    def disable_startup():
        """Disable KenzAI from starting with Windows."""
        require_windows()
        
        try:
            key = winreg.OpenKey(
                winreg.HKEY_CURRENT_USER,
                WindowsStartupManager.REGISTRY_KEY,
                0,
                winreg.KEY_WRITE
            )
            
            try:
                winreg.DeleteValue(key, WindowsStartupManager.APP_NAME)
            except FileNotFoundError:
                pass  # Already disabled
            finally:
                winreg.CloseKey(key)
        except Exception as e:
            raise RuntimeError(f"Failed to disable startup: {e}")
    
    @staticmethod
    def toggle_startup(script_path: Optional[Path] = None) -> bool:
        """
        Toggle startup status.
        
        Args:
            script_path: Path to script (only used when enabling).
        
        Returns:
            True if now enabled, False if now disabled.
        """
        if WindowsStartupManager.is_startup_enabled():
            WindowsStartupManager.disable_startup()
            return False
        else:
            WindowsStartupManager.enable_startup(script_path)
            return True


def get_system_volume() -> float:
    """
    Get current system volume (0.0 to 1.0).
    
    Returns:
        Volume level from 0.0 to 1.0.
    """
    require_windows()
    
    try:
        import ctypes
        from ctypes import wintypes
        
        winmm = ctypes.windll.winmm
        volume = wintypes.DWORD()
        winmm.waveOutGetVolume(0, ctypes.byref(volume))
        
        # Volume is a DWORD where low word is left, high word is right
        vol_value = volume.value & 0xFFFF
        return vol_value / 65535.0
    except Exception:
        return 0.5  # Default on error


def set_system_volume(volume: float):
    """
    Set system volume.
    
    Args:
        volume: Volume level from 0.0 to 1.0.
    """
    require_windows()
    
    volume = max(0.0, min(1.0, volume))  # Clamp to 0.0-1.0
    
    try:
        import ctypes
        from ctypes import wintypes
        
        winmm = ctypes.windll.winmm
        
        # Convert to DWORD (0-65535)
        vol_value = int(volume * 65535)
        # Set both channels to same value
        vol_dword = (vol_value << 16) | vol_value
        
        winmm.waveOutSetVolume(0, vol_dword)
    except Exception:
        pass  # Silently fail if volume control unavailable


def play_sound(file_path: Path, volume: Optional[float] = None):
    """
    Play a sound file using Windows API.
    
    Args:
        file_path: Path to sound file (.wav).
        volume: Optional volume override (0.0 to 1.0). If None, uses system volume.
    """
    require_windows()
    
    if not file_path.exists():
        return
    
    try:
        import winsound
        
        # Save current volume if overriding
        original_volume = None
        if volume is not None:
            original_volume = get_system_volume()
            set_system_volume(volume)
        
        try:
            winsound.PlaySound(str(file_path), winsound.SND_FILENAME | winsound.SND_ASYNC)
        finally:
            # Restore original volume if we changed it
            if original_volume is not None:
                set_system_volume(original_volume)
    except Exception:
        pass  # Silently fail if sound playback unavailable


def is_admin() -> bool:
    """
    Check if running with administrator privileges.
    
    Returns:
        True if running as admin, False otherwise.
    """
    require_windows()
    
    try:
        import ctypes
        return ctypes.windll.shell32.IsUserAnAdmin() != 0
    except Exception:
        return False


def get_screen_resolution() -> tuple[int, int]:
    """
    Get primary screen resolution.
    
    Returns:
        Tuple of (width, height).
    """
    require_windows()
    
    try:
        import ctypes
        user32 = ctypes.windll.user32
        width = user32.GetSystemMetrics(0)  # SM_CXSCREEN
        height = user32.GetSystemMetrics(1)  # SM_CYSCREEN
        return (width, height)
    except Exception:
        return (1920, 1080)  # Default fallback

