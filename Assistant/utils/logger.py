"""
KenzAI Logging System
Provides centralized logging with file and console output.
FIXED: Added exc_info parameter support to all logging methods.
"""
import logging
import os
import sys
from pathlib import Path
from logging.handlers import RotatingFileHandler
from typing import Optional


class KenzAILogger:
    """Centralized logger for KenzAI with file and console handlers."""
    
    _instance: Optional['KenzAILogger'] = None
    _initialized = False
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        self.logger = None
        self._log_file = None
    
    def initialize(self, log_level: str = "INFO", log_file: Optional[str] = None):
        """
        Initialize the logger.
        
        Args:
            log_level: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
            log_file: Path to log file. If None, uses default location.
        """
        if self.logger is not None:
            return  # Already initialized
        
        # Create logger
        self.logger = logging.getLogger("KenzAI")
        self.logger.setLevel(getattr(logging, log_level.upper(), logging.INFO))
        
        # Prevent duplicate handlers
        if self.logger.handlers:
            return
        
        # Console handler with formatting
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setLevel(logging.DEBUG)
        console_format = logging.Formatter(
            '[%(asctime)s] [%(levelname)-8s] %(message)s',
            datefmt='%H:%M:%S'
        )
        console_handler.setFormatter(console_format)
        self.logger.addHandler(console_handler)
        
        # File handler (if log_file specified)
        if log_file:
            self._log_file = Path(log_file)
            self._log_file.parent.mkdir(parents=True, exist_ok=True)
            
            # Rotating file handler (10MB max, 5 backups)
            file_handler = RotatingFileHandler(
                self._log_file,
                maxBytes=10 * 1024 * 1024,  # 10MB
                backupCount=5,
                encoding='utf-8'
            )
            file_handler.setLevel(logging.DEBUG)
            file_format = logging.Formatter(
                '[%(asctime)s] [%(levelname)-8s] [%(name)s] [%(filename)s:%(lineno)d] %(message)s',
                datefmt='%Y-%m-%d %H:%M:%S'
            )
            file_handler.setFormatter(file_format)
            self.logger.addHandler(file_handler)
    
    def debug(self, message: str, exc_info: bool = False):
        """Log debug message."""
        if self.logger:
            self.logger.debug(message, exc_info=exc_info)
    
    def info(self, message: str, exc_info: bool = False):
        """Log info message."""
        if self.logger:
            self.logger.info(message, exc_info=exc_info)
    
    def warning(self, message: str, exc_info: bool = False):
        """Log warning message."""
        if self.logger:
            self.logger.warning(message, exc_info=exc_info)
    
    def error(self, message: str, exc_info: bool = False):
        """Log error message."""
        if self.logger:
            self.logger.error(message, exc_info=exc_info)
    
    def critical(self, message: str, exc_info: bool = False):
        """Log critical message."""
        if self.logger:
            self.logger.critical(message, exc_info=exc_info)
    
    def exception(self, message: str):
        """Log exception with traceback."""
        if self.logger:
            self.logger.exception(message)


# Global logger instance
_logger_instance = KenzAILogger()


def get_logger() -> KenzAILogger:
    """Get the global logger instance."""
    return _logger_instance


def initialize_logger(log_level: str = "INFO", log_file: Optional[str] = None):
    """Initialize the global logger."""
    _logger_instance.initialize(log_level, log_file)