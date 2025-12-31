"""
=============================================================================
PATCH INSTRUCTIONS - Apply These 3 Files
=============================================================================

This patch prevents KenzAI from auto-downloading models.
Replace these 3 files in your Assistant/ directory:

1. core/model_manager.py
2. core/assistant.py  
3. unified_kenzai_daemon.py (optional improvement)

=============================================================================
FILE 1: core/model_manager.py
=============================================================================
"""

# core/model_manager.py
"""
Model Manager - FIXED VERSION (No Auto-Download)
Handles Ollama model selection and verification.
Supports: reasoning, code, and general models.
Does NOT auto-download models - only checks if they exist.
"""
import subprocess
import sys
import time
import threading
from typing import Optional, Dict, Any, List
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
        self._available_models: Optional[List[str]] = None
        self._models_checked = False
        
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
            logger.info("✓ Ollama daemon started")
            return True
        except FileNotFoundError:
            logger.error("❌ Ollama CLI not found! Please install Ollama from: https://ollama.ai")
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
    
    def _get_available_models(self) -> List[str]:
        """
        Get list of locally available models.
        
        Returns:
            List of model names that are installed.
        """
        if self._available_models is not None:
            return self._available_models
        
        try:
            models_output = subprocess.check_output(
                ["ollama", "list"],
                text=True,
                timeout=10
            )
            
            # Parse model names from output
            models = []
            for line in models_output.strip().split('\n')[1:]:  # Skip header
                if line.strip():
                    # First column is model name
                    model_name = line.split()[0]
                    models.append(model_name)
            
            self._available_models = models
            logger.debug(f"Found {len(models)} installed models")
            return models
            
        except FileNotFoundError:
            logger.error("❌ Ollama CLI not found!")
            return []
        except subprocess.TimeoutExpired:
            logger.error("Timeout while listing models")
            return []
        except Exception as e:
            logger.error(f"Error listing models: {e}")
            return []
    
    def is_model_available(self, model_name: str) -> bool:
        """
        Check if a model is available locally (does NOT download).
        
        Args:
            model_name: Name of the model to check.
        
        Returns:
            True if model is installed, False otherwise.
        """
        available = self._get_available_models()
        return model_name in available
    
    def check_all_models(self) -> Dict[str, bool]:
        """
        Check which configured models are available (does NOT download).
        
        Returns:
            Dictionary mapping model type to availability status.
        """
        if not self.ensure_ollama_daemon():
            return {model_type: False for model_type in self.models.keys()}
        
        availability = {}
        missing_models = []
        
        for model_type, model_name in self.models.items():
            is_available = self.is_model_available(model_name)
            availability[model_type] = is_available
            
            if is_available:
                logger.info(f"✓ {model_type.capitalize()} model found: {model_name}")
            else:
                logger.warning(f"✗ {model_type.capitalize()} model NOT found: {model_name}")
                missing_models.append((model_type, model_name))
        
        if missing_models:
            logger.warning("\n" + "=" * 70)
            logger.warning("MISSING MODELS DETECTED")
            logger.warning("=" * 70)
            logger.warning("The following models are configured but not installed:\n")
            for model_type, model_name in missing_models:
                logger.warning(f"  • {model_type.capitalize()}: {model_name}")
            logger.warning("\nTo install missing models, run:")
            for model_type, model_name in missing_models:
                logger.warning(f"  ollama pull {model_name}")
            logger.warning("\nOr update config.yaml to use models you already have installed.")
            logger.warning("=" * 70 + "\n")
        
        self._models_checked = True
        return availability
    
    def ensure_all_models(self) -> bool:
        """
        Check all configured models are available (does NOT download).
        Logs warnings for missing models.
        
        Returns:
            True if all models are available, False if any are missing.
        """
        availability = self.check_all_models()
        all_available = all(availability.values())
        
        if not all_available:
            logger.warning("⚠ Not all configured models are available!")
            logger.warning("KenzAI will continue but may have reduced functionality.")
        
        return all_available
    
    def select_model(self, prompt: str) -> str:
        """
        Select appropriate model based on prompt content.
        Falls back to general model if selected model isn't available.
        
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
        
        selected_model = None
        
        # Check for reasoning first (most specific)
        if any(keyword in prompt_lower for keyword in reasoning_keywords):
            selected_model = self.models['reasoning']
            model_type = 'reasoning'
        # Then check for code
        elif any(keyword in prompt_lower for keyword in code_keywords):
            selected_model = self.models['code']
            model_type = 'code'
        # Default to general
        else:
            selected_model = self.models['general']
            model_type = 'general'
        
        # Check if selected model is available, fallback if not
        if not self.is_model_available(selected_model):
            logger.warning(f"Selected {model_type} model '{selected_model}' not available")
            
            # Try to find an available model
            for fallback_type in ['general', 'code', 'reasoning']:
                fallback_model = self.models[fallback_type]
                if self.is_model_available(fallback_model):
                    logger.info(f"Using {fallback_type} model '{fallback_model}' as fallback")
                    return fallback_model
            
            # If no models available, return the selected one anyway and let it fail gracefully
            logger.error("No models available! Returning selected model anyway.")
            return selected_model
        
        logger.debug(f"Selected {model_type} model: {selected_model}")
        return selected_model
    
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
        Switch to a different model (only if it's available).
        
        Args:
            model_name: Name of model to switch to.
        
        Returns:
            True if switch was successful, False otherwise.
        """
        if model_name == self.current_model:
            return True
        
        if not self.is_model_available(model_name):
            logger.error(f"Cannot switch to '{model_name}' - model not installed")
            logger.error(f"Install it with: ollama pull {model_name}")
            return False
        
        old_model = self.current_model
        self.current_model = model_name
        if old_model:
            logger.info(f"Switched from {old_model} to {model_name}")
        else:
            logger.info(f"Using model {model_name}")
        return True
    
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
    
    def get_installation_status(self) -> Dict[str, Dict[str, Any]]:
        """
        Get detailed installation status for all models.
        
        Returns:
            Dictionary with model info and installation status.
        """
        status = {}
        
        for model_type, model_name in self.models.items():
            status[model_type] = {
                'name': model_name,
                'installed': self.is_model_available(model_name),
                'install_command': f"ollama pull {model_name}"
            }
        
        return status
