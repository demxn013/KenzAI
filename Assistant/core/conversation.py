"""
Conversation Manager
Handles conversation history and message management.
"""
from typing import List, Dict, Any, Optional
from datetime import datetime

try:
    from utils.logger import get_logger
except ImportError:
    from ..utils.logger import get_logger

logger = get_logger()


class Conversation:
    """Manages a single conversation session."""
    
    def __init__(self, max_history: int = 50):
        """
        Initialize Conversation.
        
        Args:
            max_history: Maximum number of messages to keep in history.
        """
        self.messages: List[Dict[str, Any]] = []
        self.max_history = max_history
        self.created_at = datetime.now()
        self.last_activity = datetime.now()
    
    def add_message(self, role: str, content: str, metadata: Optional[Dict[str, Any]] = None):
        """
        Add a message to the conversation.
        
        Args:
            role: Message role ('system', 'user', 'assistant').
            content: Message content.
            metadata: Optional metadata dict.
        """
        message = {
            'role': role,
            'content': content,
            'timestamp': datetime.now().isoformat()
        }
        
        if metadata:
            message['metadata'] = metadata
        
        self.messages.append(message)
        self.last_activity = datetime.now()
        
        # Trim history if needed
        if len(self.messages) > self.max_history:
            # Keep system messages and recent messages
            system_messages = [m for m in self.messages if m['role'] == 'system']
            recent_messages = self.messages[-self.max_history + len(system_messages):]
            self.messages = system_messages + recent_messages
    
    def add_system_message(self, content: str):
        """Add a system message."""
        self.add_message('system', content)
    
    def add_user_message(self, content: str):
        """Add a user message."""
        self.add_message('user', content)
    
    def add_assistant_message(self, content: str):
        """Add an assistant message."""
        self.add_message('assistant', content)
    
    def get_messages(self, include_metadata: bool = False) -> List[Dict[str, Any]]:
        """
        Get conversation messages in Ollama format.
        
        Args:
            include_metadata: Whether to include metadata in output.
        
        Returns:
            List of message dicts.
        """
        if include_metadata:
            return self.messages.copy()
        
        # Return in Ollama format (role + content only)
        return [
            {'role': msg['role'], 'content': msg['content']}
            for msg in self.messages
        ]
    
    def get_recent_messages(self, count: int = 10) -> List[Dict[str, Any]]:
        """
        Get recent messages.
        
        Args:
            count: Number of recent messages to return.
        
        Returns:
            List of recent message dicts.
        """
        return self.messages[-count:]
    
    def clear(self):
        """Clear conversation history (except system messages)."""
        system_messages = [m for m in self.messages if m['role'] == 'system']
        self.messages = system_messages
        self.last_activity = datetime.now()
    
    def get_context_summary(self) -> str:
        """
        Get a summary of conversation context.
        
        Returns:
            Context summary string.
        """
        if not self.messages:
            return "No conversation history"
        
        user_messages = [m for m in self.messages if m['role'] == 'user']
        assistant_messages = [m for m in self.messages if m['role'] == 'assistant']
        
        return f"Conversation: {len(user_messages)} user messages, {len(assistant_messages)} assistant responses"


class ConversationManager:
    """Manages multiple conversation sessions."""
    
    def __init__(self):
        """Initialize ConversationManager."""
        self.conversations: Dict[str, Conversation] = {}
        self.current_conversation_id: Optional[str] = None
    
    def create_conversation(self, conversation_id: Optional[str] = None) -> str:
        """
        Create a new conversation.
        
        Args:
            conversation_id: Optional conversation ID. If None, generates one.
        
        Returns:
            Conversation ID.
        """
        if conversation_id is None:
            conversation_id = f"conv_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        
        self.conversations[conversation_id] = Conversation()
        self.current_conversation_id = conversation_id
        
        return conversation_id
    
    def get_conversation(self, conversation_id: Optional[str] = None) -> Optional[Conversation]:
        """
        Get a conversation by ID.
        
        Args:
            conversation_id: Conversation ID. If None, returns current conversation.
        
        Returns:
            Conversation object or None.
        """
        if conversation_id is None:
            conversation_id = self.current_conversation_id
        
        if conversation_id is None:
            # Create default conversation if none exists
            conversation_id = self.create_conversation()
        
        return self.conversations.get(conversation_id)
    
    def get_current_conversation(self) -> Conversation:
        """
        Get current conversation, creating one if needed.
        
        Returns:
            Current Conversation object.
        """
        if self.current_conversation_id is None:
            self.create_conversation()
        
        return self.conversations[self.current_conversation_id]
    
    def delete_conversation(self, conversation_id: str) -> bool:
        """
        Delete a conversation.
        
        Args:
            conversation_id: Conversation ID.
        
        Returns:
            True if deleted, False if not found.
        """
        if conversation_id in self.conversations:
            del self.conversations[conversation_id]
            if self.current_conversation_id == conversation_id:
                self.current_conversation_id = None
            return True
        return False
    
    def list_conversations(self) -> List[str]:
        """
        List all conversation IDs.
        
        Returns:
            List of conversation IDs.
        """
        return list(self.conversations.keys())

