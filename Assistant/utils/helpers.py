"""
Secure Configuration Loader
Loads config from YAML with environment variable substitution and .env file support.
"""
import os
import re
import yaml
from pathlib import Path
from typing import Dict, Any, Optional


def load_env_file(env_path: Optional[Path] = None) -> Dict[str, str]:
    """
    Load environment variables from .env file.
    
    Args:
        env_path: Path to .env file. If None, looks in project root.
    
    Returns:
        Dictionary of environment variables.
    """
    if env_path is None:
        # Look for .env in project root
        project_root = Path(__file__).parent.parent
        env_path = project_root / ".env"
    
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
                    
                    # Remove quotes if present
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
    
    Supports formats:
    - ${VAR_NAME}
    - ${VAR_NAME:default_value}
    - $VAR_NAME (simple format)
    
    Args:
        value: Configuration value to process.
        env_vars: Dictionary of environment variables.
    
    Returns:
        Value with substituted environment variables.
    """
    if isinstance(value, str):
        # Pattern: ${VAR_NAME} or ${VAR_NAME:default}
        pattern = r'\$\{([^}:]+)(?::([^}]*))?\}'
        
        def replacer(match):
            var_name = match.group(1)
            default_value = match.group(2) if match.group(2) is not None else ""
            
            # Check custom env_vars first, then os.environ
            if var_name in env_vars:
                return env_vars[var_name]
            elif var_name in os.environ:
                return os.environ[var_name]
            else:
                return default_value
        
        value = re.sub(pattern, replacer, value)
        
        # Also handle simple $VAR format
        simple_pattern = r'\$([A-Z_][A-Z0-9_]*)'
        
        def simple_replacer(match):
            var_name = match.group(1)
            if var_name in env_vars:
                return env_vars[var_name]
            elif var_name in os.environ:
                return os.environ[var_name]
            return match.group(0)  # Return original if not found
        
        value = re.sub(simple_pattern, simple_replacer, value)
        
        return value
    
    elif isinstance(value, dict):
        return {k: substitute_env_vars(v, env_vars) for k, v in value.items()}
    
    elif isinstance(value, list):
        return [substitute_env_vars(item, env_vars) for item in value]
    
    else:
        return value


def load_config_secure(config_path: Optional[Path] = None) -> Dict[str, Any]:
    """
    Load configuration securely with environment variable substitution.
    
    Args:
        config_path: Path to config.yaml. If None, uses default location.
    
    Returns:
        Configuration dictionary with all environment variables substituted.
    
    Example .env file:
        # Porcupine Access Key
        PORCUPINE_ACCESS_KEY=your_key_here
        
        # Spotify Integration
        SPOTIFY_CLIENT_ID=your_spotify_client_id
        SPOTIFY_CLIENT_SECRET=your_spotify_secret
        
        # OpenAI API (if using in future)
        OPENAI_API_KEY=sk-...
    
    Example config.yaml:
        interfaces:
          daemon:
            porcupine_access_key: "${PORCUPINE_ACCESS_KEY}"
        
        integrations:
          spotify:
            client_id: "${SPOTIFY_CLIENT_ID}"
            client_secret: "${SPOTIFY_CLIENT_SECRET}"
    """
    if config_path is None:
        project_root = Path(__file__).parent.parent
        config_path = project_root / "config" / "config.yaml"
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
    
    # Resolve relative paths (same as before)
    project_root = Path(__file__).parent.parent
    
    if 'memory' in config and 'base_path' in config['memory']:
        base_path = config['memory']['base_path']
        if not os.path.isabs(base_path):
            config['memory']['base_path'] = str(project_root / base_path)
    
    if 'logging' in config and 'file' in config['logging']:
        log_file = config['logging']['file']
        if not os.path.isabs(log_file):
            config['logging']['file'] = str(project_root / log_file)
    
    return config


def create_example_env_file(output_path: Optional[Path] = None):
    """
    Create an example .env file with placeholders.
    
    Args:
        output_path: Where to save .env.example. If None, uses project root.
    """
    if output_path is None:
        project_root = Path(__file__).parent.parent
        output_path = project_root / ".env.example"
    
    example_content = """# KenzAI Environment Variables
# Copy this file to .env and fill in your actual values

# Porcupine Wake Word (get free key from https://console.picovoice.ai/)
PORCUPINE_ACCESS_KEY=your_porcupine_access_key_here

# Spotify Integration (optional)
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret

# Future integrations (placeholders)
# OPENAI_API_KEY=sk-...
# ANTHROPIC_API_KEY=sk-ant-...
"""
    
    try:
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(example_content)
        print(f"Created example .env file at: {output_path}")
    except Exception as e:
        print(f"Failed to create .env.example: {e}")


if __name__ == "__main__":
    # Test configuration loading
    print("Testing secure configuration loader...")
    
    # Create example .env file
    create_example_env_file()
    
    # Try to load config
    try:
        config = load_config_secure()
        print("\n✓ Configuration loaded successfully")
        
        # Check if environment variables were substituted
        porcupine_key = config.get('interfaces', {}).get('daemon', {}).get('porcupine_access_key', '')
        if porcupine_key and not porcupine_key.startswith('${'):
            print(f"✓ Porcupine key loaded: {porcupine_key[:20]}...")
        else:
            print("⚠ Porcupine key not set (add to .env file)")
        
    except Exception as e:
        print(f"✗ Failed to load config: {e}")