"""
KenzAI Helper Utilities - FIXED VERSION
Now properly handles environment variables and ${} substitution.
"""
import os
import re
import json
import yaml
from pathlib import Path
from typing import Dict, Any, Optional
import sys


def get_project_root() -> Path:
    """Get the project root directory (Assistant folder)."""
    return Path(__file__).parent.parent


def load_env_file(env_path: Optional[Path] = None) -> Dict[str, str]:
    """
    Load environment variables from .env file.
    
    Args:
        env_path: Path to .env file. If None, looks in project root.
    
    Returns:
        Dictionary of environment variables.
    """
    if env_path is None:
        env_path = get_project_root() / ".env"
    
    env_vars = {}
    
    if not env_path.exists():
        return env_vars
    
    try:
        with open(env_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                
                # Skip comments and empty lines
                if not line or line.startswith('#'):
                    continue
                
                # Parse KEY=VALUE
                if '=' in line:
                    key, value = line.split('=', 1)
                    key = key.strip()
                    value = value.strip()
                    
                    # Remove quotes
                    if value.startswith('"') and value.endswith('"'):
                        value = value[1:-1]
                    elif value.startswith("'") and value.endswith("'"):
                        value = value[1:-1]
                    
                    env_vars[key] = value
        
        return env_vars
    except Exception as e:
        print(f"Warning: Failed to load .env file: {e}")
        return env_vars


def substitute_env_vars(value: Any, env_vars: Dict[str, str]) -> Any:
    """
    Recursively substitute environment variables in configuration values.
    
    Supports:
    - ${VAR_NAME}
    - ${VAR_NAME:default_value}
    
    Args:
        value: Configuration value to process.
        env_vars: Dictionary of environment variables from .env file.
    
    Returns:
        Value with substituted environment variables.
    """
    if isinstance(value, str):
        # Pattern: ${VAR_NAME} or ${VAR_NAME:default}
        pattern = r'\$\{([^}:]+)(?::([^}]*))?\}'
        
        def replacer(match):
            var_name = match.group(1)
            default_value = match.group(2) if match.group(2) is not None else ""
            
            # Check .env vars first, then os.environ
            if var_name in env_vars:
                return env_vars[var_name]
            elif var_name in os.environ:
                return os.environ[var_name]
            else:
                return default_value
        
        return re.sub(pattern, replacer, value)
    
    elif isinstance(value, dict):
        return {k: substitute_env_vars(v, env_vars) for k, v in value.items()}
    
    elif isinstance(value, list):
        return [substitute_env_vars(item, env_vars) for item in value]
    
    else:
        return value


def load_config(config_path: Optional[str] = None) -> Dict[str, Any]:
    """
    Load configuration from YAML file with environment variable substitution.
    
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
    
    # Load .env file
    env_vars = load_env_file()
    
    # Load YAML config
    with open(config_path, 'r', encoding='utf-8') as f:
        config = yaml.safe_load(f)
    
    # Substitute environment variables
    config = substitute_env_vars(config, env_vars)
    
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


def create_example_env_file():
    """Create an example .env file."""
    env_example_path = get_project_root() / ".env.example"
    
    example_content = """# KenzAI Environment Variables
# Copy this to .env and fill in your values

# Porcupine Wake Word (get free key from https://console.picovoice.ai/)
PORCUPINE_ACCESS_KEY=your_porcupine_access_key_here

# Spotify Integration (optional)
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
"""
    
    try:
        with open(env_example_path, 'w', encoding='utf-8') as f:
            f.write(example_content)
        print(f"✓ Created {env_example_path}")
    except Exception as e:
        print(f"Failed to create .env.example: {e}")


if __name__ == "__main__":
    # Test
    print("Testing configuration loader...\n")
    
    # Create example .env if it doesn't exist
    if not (get_project_root() / ".env.example").exists():
        create_example_env_file()
    
    # Load config
    try:
        config = load_config()
        print("✓ Configuration loaded successfully\n")
        
        # Check access key
        access_key = config.get('interfaces', {}).get('daemon', {}).get('porcupine_access_key', '')
        
        if access_key:
            if access_key.startswith('${'):
                print(f"⚠ Access key is still a placeholder: {access_key}")
                print(f"  Solution 1: Create .env file with PORCUPINE_ACCESS_KEY=your_key")
                print(f"  Solution 2: Replace directly in config.yaml")
            else:
                print(f"✓ Access key loaded: {access_key[:20]}...")
        else:
            print("⚠ No access key found in config")
        
    except Exception as e:
        print(f"✗ Error loading config: {e}")