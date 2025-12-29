"""
Model Manager
Handles Ollama model selection, loading, and management.
"""
import subprocess
import sys
import time
import threading
from typing import Optional, Dict, Any
from pathlib import Path

try:
    from utils.logger import get_logger
    from utils.helpers import load_config
except ImportError:
    from ..utils.logger import get_logger
    from ..utils.helpers import load_config

logger = get_logger()


class ModelManager:
    """Manages Ollama models and model selection."""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """
        Initialize ModelManager.
        
        Args:
            config: Configuration dict. If None, loads from file.
        """
        if config is None:
            config = load_config()
        
        self.config = config
        self.models = {
            'code': config['models']['code'],
            'general': config['models']['general']
        }
        self.current_model: Optional[str] = None
        self._daemon_started = False
    
    def ensure_ollama_daemon(self) -> bool:
        """
        Ensure Ollama daemon is running.
        
        Returns:
            True if daemon is running, False otherwise.
        """
        if self._is_daemon_running():
            return True
        
        logger.info("Starting Ollama daemon...")
        try:
            threading.Thread(
                target=lambda: subprocess.run(
                    ["ollama", "serve"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL
                ),
                daemon=True
            ).start()
            time.sleep(3)  # Give it time to start
            self._daemon_started = True
            logger.info("Ollama daemon started")
            return True
        except FileNotFoundError:
            logger.error("Ollama CLI not found! Please install Ollama.")
            return False
    
    def _is_daemon_running(self) -> bool:
        """Check if Ollama daemon is running."""
        try:
            subprocess.run(
                ["ollama", "ping"],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=2
            )
            return True
        except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
            return False
    
    def ensure_model(self, model_name: str) -> bool:
        """
        Ensure a model is available locally.
        
        Args:
            model_name: Name of the model to ensure.
        
        Returns:
            True if model is available, False otherwise.
        """
        try:
            models_output = subprocess.check_output(
                ["ollama", "list"],
                text=True,
                timeout=10
            )
            
            if model_name in models_output:
                logger.debug(f"Model {model_name} found locally")
                return True
            
            logger.info(f"Downloading model {model_name}...")
            subprocess.run(
                ["ollama", "pull", model_name],
                check=True,
                timeout=300  # 5 minute timeout for downloads
            )
            logger.info(f"Model {model_name} downloaded successfully")
            return True
            
        except FileNotFoundError:
            logger.error("Ollama CLI not found! Please install Ollama.")
            return False
        except subprocess.TimeoutExpired:
            logger.error(f"Timeout while ensuring model {model_name}")
            return False
        except subprocess.CalledProcessError as e:
            logger.error(f"Failed to ensure model {model_name}: {e}")
            return False
    
    def ensure_all_models(self) -> bool:
        """
        Ensure all configured models are available.
        
        Returns:
            True if all models are available, False otherwise.
        """
        if not self.ensure_ollama_daemon():
            return False
        
        success = True
        for model_type, model_name in self.models.items():
            if not self.ensure_model(model_name):
                success = False
        
        return success
    
    def select_model(self, prompt: str) -> str:
        """
        Select appropriate model based on prompt content.
        
        Args:
            prompt: User prompt to analyze.
        
        Returns:
            Model name to use.
        """
        prompt_lower = prompt.lower()
        
        # Code-related keywords
        code_keywords = [
            "code", "python", "javascript", "typescript", "java", "cpp", "c++",
            "program", "script", "function", "class", "import", "export",
            "syntax", "debug", "compile", "algorithm", "data structure",
            "api", "library", "framework", "package", "module"
        ]
        
        if any(keyword in prompt_lower for keyword in code_keywords):
            return self.models['code']
        
        return self.models['general']
    
    def get_model(self, model_type: str = 'general') -> str:
        """
        Get model name by type.
        
        Args:
            model_type: Type of model ('code' or 'general').
        
        Returns:
            Model name.
        """
        return self.models.get(model_type, self.models['general'])
    
    def switch_model(self, model_name: str) -> bool:
        """
        Switch to a different model.
        
        Args:
            model_name: Name of model to switch to.
        
        Returns:
            True if switch was successful, False otherwise.
        """
        if model_name == self.current_model:
            return True
        
        if self.ensure_model(model_name):
            old_model = self.current_model
            self.current_model = model_name
            if old_model:
                logger.info(f"Switched from {old_model} to {model_name}")
            else:
                logger.info(f"Using model {model_name}")
            return True
        
        return False
    
    def get_current_model(self) -> Optional[str]:
        """Get currently active model."""
        return self.current_model

