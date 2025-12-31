"""
Greeting System
Time-aware greeting selection and management.
"""
import random
from typing import List, Optional, Dict, Any
from datetime import datetime

try:
    from utils.logger import get_logger
    from utils.helpers import load_config, load_user_preferences, save_user_preferences, format_time_aware_greeting_time
except ImportError:
    from ..utils.logger import get_logger
    from ..utils.helpers import load_config, load_user_preferences, save_user_preferences, format_time_aware_greeting_time

logger = get_logger()


class GreetingSystem:
    """Manages time-aware greetings with rotation."""
    
    # Default greetings - Professional with respectful titles
    DEFAULT_GREETINGS = {
        'morning': [
            "Good morning, your Highness",
            "Good morning, Sir",
            "Morning, my Lord",
            "Good morning",
            "A new day, Sire",
            "Good morning, ready when you are",
            "Morning, your Highness",
            "The day begins, my Lord"
        ],
        'afternoon': [
            "Good afternoon, Sire",
            "Good afternoon, your Highness",
            "Afternoon, Sir",
            "Good afternoon",
            "Good afternoon, my Lord",
            "At your service, Sire",
            "Afternoon, your Highness",
            "Ready to assist, Sir"
        ],
        'evening': [
            "Good evening, my Lord",
            "Good evening, your Highness",
            "Evening, Sir",
            "Good evening",
            "Good evening, Sire",
            "Evening, my Lord",
            "The evening is yours, your Highness",
            "At your command, Sir"
        ],
        'night': [
            "Good evening, Sire",
            "Evening, your Highness",
            "Good evening, my Lord",
            "Hello, Sir",
            "Still working, my Lord?",
            "Evening, Sire",
            "At your service, your Highness",
            "Ready when you are, Sir"
        ]
    }
    
    DEFAULT_SHUTDOWN_GREETINGS = [
        "Goodbye, my Lord",
        "Until next time, Sire",
        "Farewell, your Highness",
        "Take care, Sir",
        "Goodbye",
        "Rest well, my Lord",
        "Until we meet again, Sire",
        "Farewell, Sir",
        "Good night, your Highness"
    ]
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """
        Initialize GreetingSystem.
        
        Args:
            config: Configuration dict. If None, loads from file.
        """
        if config is None:
            config = load_config()
        
        self.config = config
        self.preferences = load_user_preferences()
        
        # Load greetings from config or use defaults
        greetings_config = config.get('greetings', {})
        
        if 'morning' in greetings_config:
            # Use configured greetings
            self.greetings = {
                'morning': greetings_config.get('morning', []),
                'afternoon': greetings_config.get('afternoon', []),
                'evening': greetings_config.get('evening', []),
                'night': greetings_config.get('night', [])
            }
        else:
            # Use default greetings
            self.greetings = self.DEFAULT_GREETINGS.copy()
        
        # Ensure all time periods have greetings
        for period in ['morning', 'afternoon', 'evening', 'night']:
            if not self.greetings.get(period):
                self.greetings[period] = self.DEFAULT_GREETINGS[period]
        
        # Load shutdown greetings
        if 'shutdown' in greetings_config:
            self.shutdown_greetings = greetings_config['shutdown']
        else:
            self.shutdown_greetings = self.DEFAULT_SHUTDOWN_GREETINGS
        
        self.rotation_enabled = greetings_config.get('rotation', True)
        
        logger.debug("Greeting system initialized")
    
    def get_current_time_period(self) -> str:
        """
        Get current time period.
        
        Returns:
            One of: 'morning', 'afternoon', 'evening', 'night'
        """
        return format_time_aware_greeting_time()
    
    def get_greeting(self, time_period: Optional[str] = None) -> str:
        """
        Get a greeting for the current or specified time period.
        
        Args:
            time_period: Time period ('morning', 'afternoon', 'evening', 'night').
                        If None, uses current time.
        
        Returns:
            Greeting string.
        """
        if time_period is None:
            time_period = self.get_current_time_period()
        
        period_greetings = self.greetings.get(time_period, self.DEFAULT_GREETINGS['morning'])
        
        if not period_greetings:
            period_greetings = ["Hello"]  # Simple fallback
        
        # Rotation: avoid repeating the last greeting
        if self.rotation_enabled:
            last_index = self.preferences.get('daemon', {}).get('last_greeting_index', -1)
            
            # If we have multiple greetings, pick a different one
            if len(period_greetings) > 1:
                available_indices = [i for i in range(len(period_greetings)) if i != last_index]
                if available_indices:
                    selected_index = random.choice(available_indices)
                else:
                    selected_index = 0
            else:
                selected_index = 0
            
            # Save the selected index
            if 'daemon' not in self.preferences:
                self.preferences['daemon'] = {}
            self.preferences['daemon']['last_greeting_index'] = selected_index
            save_user_preferences(self.preferences)
            
            return period_greetings[selected_index]
        else:
            # No rotation, just pick randomly
            return random.choice(period_greetings)
    
    def get_shutdown_greeting(self) -> str:
        """
        Get a shutdown/farewell greeting.
        
        Returns:
            Shutdown greeting string.
        """
        if not self.shutdown_greetings:
            self.shutdown_greetings = self.DEFAULT_SHUTDOWN_GREETINGS
        
        return random.choice(self.shutdown_greetings)
    
    def add_greeting(self, time_period: str, greeting: str):
        """
        Add a custom greeting for a time period.
        
        Args:
            time_period: Time period ('morning', 'afternoon', 'evening', 'night').
            greeting: Greeting text.
        """
        if time_period not in self.greetings:
            logger.warning(f"Invalid time period: {time_period}")
            return
        
        if greeting not in self.greetings[time_period]:
            self.greetings[time_period].append(greeting)
            logger.info(f"Added greeting for {time_period}")
    
    def get_all_greetings(self) -> Dict[str, List[str]]:
        """
        Get all greetings organized by time period.
        
        Returns:
            Dictionary mapping time periods to greeting lists.
        """
        return self.greetings.copy()