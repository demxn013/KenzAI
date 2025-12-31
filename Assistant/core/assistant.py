"""
Assistant Core - FIXED VERSION
Better memory management and no context leakage.
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
        
        # Check models availability (does NOT download)
        self._check_models()
        
        # Initialize conversation with system prompt
        conversation = self.conversation_manager.get_current_conversation()
        conversation.add_system_message(self.personality.get_system_prompt())
        
        logger.info("✓ KenzAI Assistant initialized")
    
    def _check_models(self):
        """Check model availability without downloading."""
        logger.info("Checking configured models...")
        
        try:
            availability = self.model_manager.check_all_models()
            
            available_count = sum(1 for available in availability.values() if available)
            total_count = len(availability)
            
            if available_count == 0:
                logger.error("=" * 70)
                logger.error("NO MODELS AVAILABLE!")
                logger.error("=" * 70)
                logger.error("KenzAI cannot function without at least one model installed.")
                logger.error("\nPlease install at least one model:")
                logger.error(f"  ollama pull {self.model_manager.models['general']}")
                logger.error("=" * 70)
            elif available_count < total_count:
                logger.warning(f"⚠ {available_count}/{total_count} models available")
                logger.warning("KenzAI will work but with limited capabilities.")
            else:
                logger.info(f"✓ All {total_count} models available")
                
        except Exception as e:
            logger.error(f"Error checking models: {e}")
            logger.warning("Continuing anyway - models will be checked on first use")
    
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
        max_memory_results: int = 3
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
            
            # Select model based on prompt
            model_name = self.model_manager.select_model(prompt)
            logger.info(f"Using model: {model_name}")
            
            # Check if model is available before trying to use it
            if not self.model_manager.is_model_available(model_name):
                error_msg = f"The selected model '{model_name}' is not installed."
                logger.error(error_msg)
                
                # Try to find ANY available model as emergency fallback
                available = self.model_manager._get_available_models()
                if available:
                    fallback = available[0]
                    logger.warning(f"Using emergency fallback: {fallback}")
                    model_name = fallback
                else:
                    return (
                        f"I apologize, but the required model '{model_name}' is not installed. "
                        f"Please install it with: ollama pull {model_name}"
                    )
            
            # Switch to model (this now only works if model exists)
            if not self._switch_model_with_retry(model_name):
                return (
                    "I apologize, but I'm having trouble accessing the language model. "
                    f"Please ensure '{model_name}' is installed: ollama pull {model_name}"
                )
            
            # Get memory context (but don't add to conversation - just use as reference)
            memory_items = []
            if use_memory:
                memory_items = self.topic_manager.search_memory(prompt, limit=max_memory_results)
                
                # Only add memory context if it's actually relevant
                if memory_items:
                    # Create a condensed memory context that won't leak into responses
                    memory_summary = "Previous relevant context: " + "; ".join([
                        item[:100] + "..." if len(item) > 100 else item 
                        for item in memory_items[:2]  # Only use top 2 most relevant
                    ])
                    # Add as a system message that will be used but not repeated
                    conversation.add_system_message(memory_summary)
            
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
            return f"I apologize, but I encountered an unexpected error. Please try again."
    
    def _switch_model_with_retry(self, model_name: str, max_retries: int = 2) -> bool:
        """Switch model with retry logic (no download)."""
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
                error_str = str(e).lower()
                
                # Check if it's a "model not found" error
                if 'not found' in error_str or 'does not exist' in error_str:
                    logger.error(f"Model '{model_name}' not found in Ollama")
                    logger.error(f"Install it with: ollama pull {model_name}")
                    return None
                
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