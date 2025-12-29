"""
Assistant Core
Main orchestrator that coordinates all components.
"""
import ollama
from typing import Optional, Dict, Any, List

try:
    from utils.logger import get_logger
    from utils.helpers import load_config
except ImportError:
    # Fallback for package-style imports
    from ..utils.logger import get_logger
    from ..utils.helpers import load_config
from .model_manager import ModelManager
from .topic_manager import TopicManager
from .personality import Personality
from .conversation import ConversationManager, Conversation
from .greeting_system import GreetingSystem

logger = get_logger()


class KenzAIAssistant:
    """Main KenzAI assistant orchestrator."""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """
        Initialize KenzAI Assistant.
        
        Args:
            config: Configuration dict. If None, loads from file.
        """
        if config is None:
            config = load_config()
        
        self.config = config
        
        # Initialize components
        logger.info("Initializing KenzAI components...")
        self.model_manager = ModelManager(config)
        self.topic_manager = TopicManager(config)
        self.personality = Personality(config)
        self.conversation_manager = ConversationManager()
        self.greeting_system = GreetingSystem(config)
        
        # Ensure models are ready
        if not self.model_manager.ensure_all_models():
            logger.warning("Some models may not be available")
        
        # Initialize conversation with system prompt
        conversation = self.conversation_manager.get_current_conversation()
        conversation.add_system_message(self.personality.get_system_prompt())
        
        logger.info("KenzAI Assistant initialized")
    
    def get_greeting(self) -> str:
        """
        Get a time-aware greeting.
        
        Returns:
            Greeting string.
        """
        return self.greeting_system.get_greeting()
    
    def get_shutdown_greeting(self) -> str:
        """
        Get a shutdown greeting.
        
        Returns:
            Shutdown greeting string.
        """
        return self.greeting_system.get_shutdown_greeting()
    
    def process_query(
        self,
        prompt: str,
        conversation_id: Optional[str] = None,
        use_memory: bool = True,
        max_memory_results: int = 5
    ) -> str:
        """
        Process a user query and return response.
        
        Args:
            prompt: User prompt.
            conversation_id: Optional conversation ID. If None, uses current.
            use_memory: Whether to include memory context.
            max_memory_results: Maximum memory entries to include.
        
        Returns:
            Assistant response.
        """
        try:
            # Get or create conversation
            conversation = self.conversation_manager.get_conversation(conversation_id)
            if conversation is None:
                conversation_id = self.conversation_manager.create_conversation(conversation_id)
                conversation = self.conversation_manager.get_conversation(conversation_id)
                # Add system prompt to new conversation
                conversation.add_system_message(self.personality.get_system_prompt())
            
            # Select model
            model_name = self.model_manager.select_model(prompt)
            self.model_manager.switch_model(model_name)
            
            # Get memory context
            memory_context = ""
            if use_memory:
                memory_context = self.topic_manager.get_memory_context(prompt, max_memory_results)
                if memory_context:
                    # Add memory as system message if not already present
                    messages = conversation.get_messages()
                    has_memory_context = any(
                        'Memory Context' in msg.get('content', '')
                        for msg in messages
                        if msg.get('role') == 'system'
                    )
                    
                    if not has_memory_context and memory_context:
                        # Update system message with memory
                        system_messages = [m for m in messages if m['role'] == 'system']
                        if system_messages:
                            # Append memory to existing system message
                            system_messages[0]['content'] += f"\n\n{memory_context}"
                        else:
                            conversation.add_system_message(memory_context)
            
            # Add user message
            conversation.add_user_message(prompt)
            
            # Get messages for Ollama
            messages = conversation.get_messages()
            
            # Call Ollama
            logger.debug(f"Querying model {model_name} with {len(messages)} messages")
            response = ollama.chat(
                model=model_name,
                messages=messages
            )
            
            # Extract response content
            try:
                response_content = response.message.content
            except AttributeError:
                response_content = response['message']['content']
            
            # Add assistant response to conversation
            conversation.add_assistant_message(response_content)
            
            # Optionally save to memory (first word as topic)
            # This could be made configurable
            topic = prompt.split(" ", 1)[0] if " " in prompt else "general"
            self.topic_manager.add_memory(topic, prompt, prompt)
            
            # Format response according to personality
            formatted_response = self.personality.format_response(response_content)
            
            return formatted_response
            
        except Exception as e:
            logger.error(f"Error processing query: {e}", exc_info=True)
            return f"I apologize, but I encountered an error: {str(e)}"
    
    def add_memory(self, topic: str, content: str):
        """
        Manually add memory.
        
        Args:
            topic: Topic name.
            content: Content to store.
        """
        self.topic_manager.add_memory(topic, content)
    
    def search_memory(self, query: str, limit: int = 10) -> List[str]:
        """
        Search memory.
        
        Args:
            query: Search query.
            limit: Maximum results.
        
        Returns:
            List of memory entries.
        """
        return self.topic_manager.search_memory(query, limit=limit)
    
    def get_conversation(self, conversation_id: Optional[str] = None) -> Optional[Conversation]:
        """
        Get a conversation.
        
        Args:
            conversation_id: Conversation ID. If None, returns current.
        
        Returns:
            Conversation object or None.
        """
        return self.conversation_manager.get_conversation(conversation_id)
    
    def clear_conversation(self, conversation_id: Optional[str] = None):
        """
        Clear a conversation.
        
        Args:
            conversation_id: Conversation ID. If None, clears current.
        """
        conversation = self.conversation_manager.get_conversation(conversation_id)
        if conversation:
            conversation.clear()

