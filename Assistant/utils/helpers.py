"""
KenzAI Helper Utilities
Config loading, path utilities, and common helper functions.
"""
import os
import json
import yaml
from pathlib import Path
from typing import Dict, Any, Optional
import sys


def get_project_root() -> Path:
    """Get the project root directory (Assistant folder)."""
    # This file is in Assistant/utils/, so go up two levels
    return Path(__file__).parent.parent


def load_config(config_path: Optional[str] = None) -> Dict[str, Any]:
    """
    Load configuration from YAML file.
    
    Args:
        config_path: Path to config.yaml. If None, uses default location.
    
    Returns:
        Dictionary containing configuration.
    """
    if config_path is None:
        config_path = get_project_root() / "config" / "config.yaml"
    else:
        config_path = Path(config_path)
    
    if not config_path.exists():
        raise FileNotFoundError(f"Config file not found: {config_path}")
    
    with open(config_path, 'r', encoding='utf-8') as f:
        config = yaml.safe_load(f)
    
    # Resolve relative paths
    if 'memory' in config and 'base_path' in config['memory']:
        base_path = config['memory']['base_path']
        if not os.path.isabs(base_path):
            config['memory']['base_path'] = str(get_project_root() / base_path)
    
    # Resolve log file path
    if 'logging' in config and 'file' in config['logging']:
        log_file = config['logging']['file']
        if not os.path.isabs(log_file):
            config['logging']['file'] = str(get_project_root() / log_file)
    
    return config


def load_user_preferences(prefs_path: Optional[str] = None) -> Dict[str, Any]:
    """
    Load user preferences from JSON file.
    
    Args:
        prefs_path: Path to user_preferences.json. If None, uses default location.
    
    Returns:
        Dictionary containing user preferences. Returns defaults if file doesn't exist.
    """
    if prefs_path is None:
        prefs_path = get_project_root() / "config" / "user_preferences.json"
    else:
        prefs_path = Path(prefs_path)
    
    # Default preferences
    defaults = {
        "gui": {
            "last_appearance": "circle",
            "position": {"x": 1200, "y": 100},
            "size": {"width": 400, "height": 400},
            "opacity": 0.9,
            "always_on_top": True,
            "locked": False,
            "snap_to_edges": True
        },
        "daemon": {
            "start_with_windows": True,
            "last_greeting_index": 0
        },
        "audio": {
            "startup_volume": 0.5,
            "voice_volume": 0.7
        }
    }
    
    if not prefs_path.exists():
        return defaults
    
    try:
        with open(prefs_path, 'r', encoding='utf-8') as f:
            prefs = json.load(f)
        # Merge with defaults to ensure all keys exist
        return _deep_merge(defaults, prefs)
    except (json.JSONDecodeError, IOError):
        return defaults


def save_user_preferences(preferences: Dict[str, Any], prefs_path: Optional[str] = None):
    """
    Save user preferences to JSON file.
    
    Args:
        preferences: Dictionary containing user preferences.
        prefs_path: Path to user_preferences.json. If None, uses default location.
    """
    if prefs_path is None:
        prefs_path = get_project_root() / "config" / "user_preferences.json"
    else:
        prefs_path = Path(prefs_path)
    
    # Ensure directory exists
    prefs_path.parent.mkdir(parents=True, exist_ok=True)
    
    with open(prefs_path, 'w', encoding='utf-8') as f:
        json.dump(preferences, f, indent=2, ensure_ascii=False)


def _deep_merge(base: Dict, update: Dict) -> Dict:
    """Deep merge two dictionaries."""
    result = base.copy()
    for key, value in update.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def ensure_directory(path: str) -> Path:
    """
    Ensure a directory exists, creating it if necessary.
    
    Args:
        path: Directory path (can be relative or absolute).
    
    Returns:
        Path object to the directory.
    """
    dir_path = Path(path)
    if not dir_path.is_absolute():
        dir_path = get_project_root() / dir_path
    
    dir_path.mkdir(parents=True, exist_ok=True)
    return dir_path


def expand_path(path: str, base: Optional[Path] = None) -> Path:
    """
    Expand a path (resolve relative paths, environment variables, etc.).
    
    Args:
        path: Path to expand.
        base: Base path for relative resolution. If None, uses project root.
    
    Returns:
        Expanded Path object.
    """
    if base is None:
        base = get_project_root()
    
    # Expand environment variables
    expanded = os.path.expandvars(os.path.expanduser(path))
    
    # Make absolute if relative
    path_obj = Path(expanded)
    if not path_obj.is_absolute():
        path_obj = base / path_obj
    
    return path_obj.resolve()


def get_memory_path(topic: str, config: Optional[Dict[str, Any]] = None) -> Path:
    """
    Get the database path for a given topic.
    
    Args:
        topic: Topic name (e.g., "general", "yazanaki").
        config: Configuration dict. If None, loads from file.
    
    Returns:
        Path to the topic's database file.
    """
    if config is None:
        config = load_config()
    
    base_path = Path(config['memory']['base_path'])
    device_id = config.get('device', {}).get('id', 'local_owner')
    
    # Database path: memory/{device_id}/{topic}.db
    db_path = base_path / device_id / f"{topic}.db"
    db_path.parent.mkdir(parents=True, exist_ok=True)
    
    return db_path


def is_windows() -> bool:
    """Check if running on Windows."""
    return sys.platform == 'win32'


def get_system_volume() -> float:
    """
    Get current system volume (0.0 to 1.0).
    Windows-specific implementation.
    """
    if not is_windows():
        return 0.5  # Default for non-Windows
    
    try:
        import ctypes
        from ctypes import wintypes
        
        # Windows API to get system volume
        winmm = ctypes.windll.winmm
        volume = wintypes.DWORD()
        winmm.waveOutGetVolume(0, ctypes.byref(volume))
        
        # Volume is a DWORD where low word is left, high word is right
        # Both are 0-65535, so we take one channel and normalize
        vol_value = volume.value & 0xFFFF
        return vol_value / 65535.0
    except Exception:
        return 0.5  # Default on error


def format_time_aware_greeting_time() -> str:
    """
    Get current time period for greeting selection.
    
    Returns:
        One of: "morning", "afternoon", "evening", "night"
    """
    from datetime import datetime
    hour = datetime.now().hour
    
    if 5 <= hour < 12:
        return "morning"
    elif 12 <= hour < 18:
        return "afternoon"
    elif 18 <= hour < 22:
        return "evening"
    else:
        return "night"

