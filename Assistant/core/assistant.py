"""
Assistant Core - IMPROVED VERSION
Better memory management and error recovery.
"""
import ollama
from typing import Optional, Dict, Any, List
import time

try:
    from utils.logger import get_logger
    from utils.helpers import load_config
except ImportError:
    from ..utils.logger import get_logger
    from ..utils.helpers import load_config
from .model_manager import ModelManager
from .topic_manager import TopicManager
from .personality import Personality
from .conversation import ConversationManager, Conversation
from .greeting_system import GreetingSystem

logger = get_logger()


class KenzAIAssistant:
    """Main KenzAI assistant orchestrator with improved error handling."""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """Initialize KenzAI Assistant."""
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
        
        # Ensure models are ready with retry
        self._ensure_models_with_retry()
        
        # Initialize conversation with system prompt
        conversation = self.conversation_manager.get_current_conversation()
        conversation.add_system_message(self.personality.get_system_prompt())
        
        logger.info("KenzAI Assistant initialized")
    
    def _ensure_models_with_retry(self, max_retries: int = 3, delay: float = 2.0):
        """Ensure models are available with retry logic."""
        for attempt in range(max_retries):
            try:
                if self.model_manager.ensure_all_models():
                    logger.info("All models ready")
                    return
                else:
                    logger.warning(f"Some models unavailable (attempt {attempt + 1}/{max_retries})")
                    if attempt < max_retries - 1:
                        time.sleep(delay)
            except Exception as e:
                logger.error(f"Error ensuring models: {e}")
                if attempt < max_retries - 1:
                    time.sleep(delay)
        
        logger.warning("Could not ensure all models after retries")
    
    def get_greeting(self) -> str:
        """Get a time-aware greeting."""
        return self.greeting_system.get_greeting()
    
    def get_shutdown_greeting(self) -> str:
        """Get a shutdown greeting."""
        return self.greeting_system.get_shutdown_greeting()
    
    def _should_save_to_memory(self, prompt: str, response: str) -> bool:
        """
        Determine if this interaction should be saved to long-term memory.
        
        Criteria:
        - Not a trivial greeting or short response
        - Contains meaningful information
        - User explicitly asks to remember something
        """
        # Check for explicit remember request
        if any(word in prompt.lower() for word in ['remember', 'save this', 'note that', 'keep in mind']):
            return True
        
        # Skip very short interactions
        if len(prompt) < 20 or len(response) < 50:
            return False
        
        # Skip common greetings
        greetings = ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening']
        if any(greeting in prompt.lower() for greeting in greetings) and len(prompt) < 50:
            return False
        
        # Save code-related queries
        if any(word in prompt.lower() for word in ['code', 'function', 'class', 'error', 'bug', 'debug']):
            return True
        
        # Save questions
        if any(word in prompt.lower() for word in ['how', 'what', 'why', 'when', 'where', 'explain']):
            return True
        
        # Save personal information
        if any(word in prompt.lower() for word in ['my', 'i am', 'i have', 'i like', 'i prefer']):
            return True
        
        # Default: save if response is substantial
        return len(response) > 200
    
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
                conversation.add_system_message(self.personality.get_system_prompt())
            
            # Select model
            model_name = self.model_manager.select_model(prompt)
            
            # Try to switch model with retry
            if not self._switch_model_with_retry(model_name):
                return "I apologize, but I'm having trouble accessing my language models. Please try again in a moment."
            
            # Get memory context
            memory_context = ""
            if use_memory:
                memory_context = self.topic_manager.get_memory_context(prompt, max_memory_results)
                if memory_context:
                    # Add memory as a separate system message
                    conversation.add_system_message(f"\n{memory_context}\n")
            
            # Add user message
            conversation.add_user_message(prompt)
            
            # Get messages for Ollama
            messages = conversation.get_messages()
            
            # Call Ollama with retry
            response_content = self._call_ollama_with_retry(model_name, messages)
            
            if response_content is None:
                return "I apologize, but I'm having difficulty processing your request. Please try again."
            
            # Add assistant response to conversation
            conversation.add_assistant_message(response_content)
            
            # Save to long-term memory if appropriate
            if self._should_save_to_memory(prompt, response_content):
                topic = self.topic_manager.detect_topic(prompt)
                self.topic_manager.add_memory(topic, response_content, prompt)
                logger.debug(f"Saved interaction to long-term memory (topic: {topic})")
            
            # Format response according to personality
            formatted_response = self.personality.format_response(response_content)
            
            return formatted_response
            
        except Exception as e:
            logger.error(f"Error processing query: {e}", exc_info=True)
            return f"I apologize, your Highness, but I encountered an unexpected error. Please try again."
    
    def _switch_model_with_retry(self, model_name: str, max_retries: int = 2) -> bool:
        """Switch model with retry logic."""
        for attempt in range(max_retries):
            try:
                if self.model_manager.switch_model(model_name):
                    return True
                time.sleep(1)
            except Exception as e:
                logger.warning(f"Failed to switch model (attempt {attempt + 1}): {e}")
                if attempt < max_retries - 1:
                    time.sleep(1)
        return False
    
    def _call_ollama_with_retry(
        self, 
        model_name: str, 
        messages: List[Dict[str, str]], 
        max_retries: int = 2
    ) -> Optional[str]:
        """Call Ollama with retry logic."""
        for attempt in range(max_retries):
            try:
                logger.debug(f"Querying model {model_name} with {len(messages)} messages")
                
                response = ollama.chat(
                    model=model_name,
                    messages=messages
                )
                
                # Extract response content
                try:
                    return response.message.content
                except AttributeError:
                    return response['message']['content']
                    
            except Exception as e:
                logger.error(f"Ollama error (attempt {attempt + 1}/{max_retries}): {e}")
                if attempt < max_retries - 1:
                    time.sleep(2)
                else:
                    return None
        
        return None
    
    def add_memory(self, topic: str, content: str, prompt: Optional[str] = None):
        """Manually add memory."""
        self.topic_manager.add_memory(topic, content, prompt, force=True)
    
    def search_memory(self, query: str, limit: int = 10) -> List[str]:
        """Search memory."""
        return self.topic_manager.search_memory(query, limit=limit)
    
    def get_conversation(self, conversation_id: Optional[str] = None) -> Optional[Conversation]:
        """Get a conversation."""
        return self.conversation_manager.get_conversation(conversation_id)
    
    def clear_conversation(self, conversation_id: Optional[str] = None):
        """Clear a conversation."""
        conversation = self.conversation_manager.get_conversation(conversation_id)
        if conversation:
            conversation.clear()
            # Re-add system prompt
            conversation.add_system_message(self.personality.get_system_prompt())
    
    def cleanup_old_memories(self, days: int = 90):
        """Clean up old memories across all topics."""
        for topic in self.topic_manager.default_topics:
            try:
                self.topic_manager.cleanup_old_memories(topic, days=days)
            except Exception as e:
                logger.error(f"Failed to cleanup {topic}: {e}")
    
    def get_memory_stats(self) -> Dict[str, Any]:
        """Get memory statistics across all topics."""
        stats = {}
        for topic in self.topic_manager.default_topics:
            try:
                stats[topic] = self.topic_manager.get_topic_stats(topic)
            except Exception as e:
                logger.error(f"Failed to get stats for {topic}: {e}")
        return stats