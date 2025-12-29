"""
Personality System
Handles KenzAI's personality and response style.
"""
from typing import Dict, Any, Optional, List
try:
    from utils.logger import get_logger
    from utils.helpers import load_config
except ImportError:
    from ..utils.logger import get_logger
    from ..utils.helpers import load_config

logger = get_logger()


class Personality:
    """Manages KenzAI's personality and communication style."""
    
    # Personality styles
    PERSONALITIES = {
        'bushido_butler': {
            'name': 'Bushido Butler',
            'traits': ['formal', 'respectful', 'loyal', 'efficient', 'humble'],
            'greeting_style': 'formal_time_aware',
            'response_style': 'concise_formal',
            'titles': ['your Highness', 'my Emperor', 'your Grace', 'my liege', 'my lord'],
            'confirmations': ['As you wish', 'Understood', 'It shall be done', 'At once'],
            'acknowledgments': ['Certainly', 'Of course', 'By all means', 'Without question']
        }
    }
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """
        Initialize Personality.
        
        Args:
            config: Configuration dict. If None, loads from file.
        """
        if config is None:
            config = load_config()
        
        self.config = config
        personality_config = config.get('personality', {})
        self.style = personality_config.get('style', 'bushido_butler')
        self.verbosity = personality_config.get('verbosity', 'concise')
        self.confirmation_required = personality_config.get('confirmation_required', False)
        
        # Load personality data
        self.personality_data = self.PERSONALITIES.get(
            self.style,
            self.PERSONALITIES['bushido_butler']
        )
    
    def get_system_prompt(self) -> str:
        """
        Get system prompt based on personality.
        
        Returns:
            System prompt string.
        """
        base_prompt = f"""You are KenzAI, an AI assistant with a {self.personality_data['name']} personality.

Personality Traits: {', '.join(self.personality_data['traits'])}
Communication Style: {self.personality_data['response_style']}
Verbosity: {self.verbosity}

Guidelines:
- Address the user with formal titles: {', '.join(self.personality_data['titles'])}
- Be respectful, loyal, and efficient
- Keep responses {self.verbosity} unless more detail is requested
- Use formal but warm language
- Show dedication to serving the user
"""
        
        if not self.confirmation_required:
            base_prompt += "\n- Execute tasks directly without asking for confirmation unless the action is destructive or irreversible"
        
        return base_prompt
    
    def format_response(self, response: str, context: Optional[Dict[str, Any]] = None) -> str:
        """
        Format response according to personality.
        
        Args:
            response: Raw response text.
            context: Optional context dict.
        
        Returns:
            Formatted response.
        """
        # For now, return as-is. Can add formatting logic later.
        # This could include adding formal prefixes, adjusting tone, etc.
        return response
    
    def get_confirmation_phrase(self) -> str:
        """
        Get a random confirmation phrase.
        
        Returns:
            Confirmation phrase.
        """
        import random
        return random.choice(self.personality_data['confirmations'])
    
    def get_acknowledgment_phrase(self) -> str:
        """
        Get a random acknowledgment phrase.
        
        Returns:
            Acknowledgment phrase.
        """
        import random
        return random.choice(self.personality_data['acknowledgments'])
    
    def should_confirm(self, action: str) -> bool:
        """
        Determine if an action requires confirmation.
        
        Args:
            action: Description of the action.
        
        Returns:
            True if confirmation is needed.
        """
        if not self.confirmation_required:
            return False
        
        # Destructive actions always require confirmation
        destructive_keywords = ['delete', 'remove', 'uninstall', 'format', 'wipe', 'clear all']
        action_lower = action.lower()
        
        return any(keyword in action_lower for keyword in destructive_keywords)
    
    def get_greeting_style(self) -> str:
        """Get the greeting style for this personality."""
        return self.personality_data.get('greeting_style', 'formal_time_aware')

