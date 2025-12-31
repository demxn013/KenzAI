"""
Model Manager - UPDATED FOR 3 MODEL TYPES
Handles Ollama model selection, loading, and management.
Supports: reasoning, code, and general models.
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
    """Manages Ollama models with 3 model types: reasoning, code, general."""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """
        Initialize ModelManager.
        
        Args:
            config: Configuration dict. If None, loads from file.
        """
        if config is None:
            config = load_config()
        
        self.config = config
        models_config = config.get('models', {})
        
        # Support 3 model types
        self.models = {
            'reasoning': models_config.get('reasoning', 'deepseek-r1:14b'),
            'code': models_config.get('code', 'deepseek-coder:6.7b'),
            'general': models_config.get('general', 'deepseek-v2:16b-lite-chat-q4_0')
        }
        
        self.current_model: Optional[str] = None
        self._daemon_started = False
        
        logger.info(f"Model Manager initialized with 3 types:")
        logger.info(f"  Reasoning: {self.models['reasoning']}")
        logger.info(f"  Code: {self.models['code']}")
        logger.info(f"  General: {self.models['general']}")
    
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
                ["ollama", "list"],
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
            logger.info(f"Ensuring {model_type} model: {model_name}")
            if not self.ensure_model(model_name):
                logger.error(f"Failed to ensure {model_type} model")
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
        
        # Reasoning keywords - for complex problems, step-by-step thinking
        reasoning_keywords = [
            'why', 'explain', 'how does', 'what if', 'analyze', 'compare',
            'evaluate', 'reasoning', 'logic', 'prove', 'deduce', 'infer',
            'step by step', 'think through', 'problem solving', 'strategy',
            'pros and cons', 'advantages', 'disadvantages', 'trade-off',
            'complex', 'intricate', 'elaborate', 'comprehensive analysis'
        ]
        
        # Code-related keywords
        code_keywords = [
            'code', 'python', 'javascript', 'typescript', 'java', 'cpp', 'c++',
            'program', 'script', 'function', 'class', 'import', 'export',
            'syntax', 'debug', 'compile', 'algorithm', 'data structure',
            'api', 'library', 'framework', 'package', 'module', 'bug',
            'error', 'exception', 'refactor', 'optimize code', 'implement'
        ]
        
        # Check for reasoning first (most specific)
        if any(keyword in prompt_lower for keyword in reasoning_keywords):
            logger.debug(f"Selected reasoning model for: {prompt[:50]}...")
            return self.models['reasoning']
        
        # Then check for code
        if any(keyword in prompt_lower for keyword in code_keywords):
            logger.debug(f"Selected code model for: {prompt[:50]}...")
            return self.models['code']
        
        # Default to general
        logger.debug(f"Selected general model for: {prompt[:50]}...")
        return self.models['general']
    
    def get_model(self, model_type: str = 'general') -> str:
        """
        Get model name by type.
        
        Args:
            model_type: Type of model ('reasoning', 'code', or 'general').
        
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
    
    def get_model_info(self) -> Dict[str, str]:
        """
        Get information about all configured models.
        
        Returns:
            Dictionary with model type -> model name mappings.
        """
        return self.models.copy()