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
        self.verbosity = personality_config.get('verbosity', 'balanced')
        self.confirmation_required = personality_config.get('confirmation_required', False)
        
        # Core traits
        self.traits = ['professional', 'efficient', 'respectful', 'intelligent', 'direct']
        self.confirmations = ['Done', 'Got it', 'Understood', 'Will do', 'On it']
        self.acknowledgments = ['Sure', 'Of course', 'Absolutely', 'No problem', 'Certainly']
    
    def get_system_prompt(self) -> str:
        """
        Get system prompt based on personality.
        
        Returns:
            System prompt string.
        """
        base_prompt = f"""You are KenzAI, a professional AI assistant with a refined, efficient personality.

Core traits: {', '.join(self.traits)}

Communication guidelines:
- Be direct and professional - no unnecessary formalities or roleplay
- Address the user occasionally with respectful titles: my Lord, Sire, Sir, Emperor, your Highness, Demxn, Lord Thirteen, Master
- Use titles naturally and sparingly - not in every response, just when appropriate
- Provide clear, accurate, and useful information
- Keep responses {self.verbosity} - expand when needed, but stay focused
- Be helpful and intelligent without being overly formal or casual
- Maintain a consistent, professional tone that's warm but not chatty
- No made-up lore, backstories, or fictional character elements
- Avoid repetitive phrases like "as your loyal servant" - vary your language
- Just be helpful naturally - let your competence speak for itself

Response style:
- Get to the point quickly without sacrificing clarity
- Use natural, modern language that's professional but not stiff
- Show intelligence through substance and accuracy
- Adapt slightly to context (more technical for code, slightly warmer for casual conversation)
- Be consistently reliable and efficient in every interaction
- When using titles, do so naturally without forcing them into every sentence
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
        # Return as-is since the system prompt handles the style
        return response
    
    def get_confirmation_phrase(self) -> str:
        """
        Get a random confirmation phrase.
        
        Returns:
            Confirmation phrase.
        """
        import random
        return random.choice(self.confirmations)
    
    def get_acknowledgment_phrase(self) -> str:
        """
        Get a random acknowledgment phrase.
        
        Returns:
            Acknowledgment phrase.
        """
        import random
        return random.choice(self.acknowledgments)
    
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
        return 'professional_time_aware'