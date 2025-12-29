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
    
    # Default greetings by time period
    DEFAULT_GREETINGS = {
        'morning': [
            "Good morning, your Highness",
            "A new day begins, my Emperor",
            "The morning greets you, your Grace"
        ],
        'afternoon': [
            "Good afternoon, my liege",
            "Your Highness",
            "At your service, my Emperor"
        ],
        'evening': [
            "Good evening, your Grace",
            "The evening is yours, my lord",
            "Your Highness"
        ],
        'night': [
            "The night welcomes you, your Grace",
            "At your command, my Emperor",
            "Your Highness"
        ]
    }
    
    DEFAULT_SHUTDOWN_GREETINGS = [
        "Rest well, your Highness",
        "Until next time, my Emperor",
        "The shadows await your return, my liege",
        "Farewell, your Grace"
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
            self.greetings = {
                'morning': greetings_config.get('morning', []),
                'afternoon': greetings_config.get('afternoon', []),
                'evening': greetings_config.get('evening', []),
                'night': greetings_config.get('night', [])
            }
        else:
            self.greetings = self.DEFAULT_GREETINGS.copy()
        
        # Ensure all time periods have greetings
        for period in ['morning', 'afternoon', 'evening', 'night']:
            if not self.greetings.get(period):
                self.greetings[period] = self.DEFAULT_GREETINGS[period]
        
        self.rotation_enabled = greetings_config.get('rotation', True)
    
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
            period_greetings = ["Your Highness"]  # Fallback
        
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
        shutdown_greetings = self.config.get('greetings', {}).get('shutdown', self.DEFAULT_SHUTDOWN_GREETINGS)
        
        if not shutdown_greetings:
            shutdown_greetings = self.DEFAULT_SHUTDOWN_GREETINGS
        
        return random.choice(shutdown_greetings)
    
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

