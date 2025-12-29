"""
Topic Manager
Handles topic detection and memory database management.
"""
import sqlite3
import threading
from pathlib import Path
from typing import List, Optional, Dict, Any
from contextlib import contextmanager

from ..utils.logger import get_logger
from ..utils.helpers import load_config, get_memory_path

logger = get_logger()

# Thread-local storage for database connections
_local = threading.local()


class TopicManager:
    """Manages topic detection and memory storage."""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """
        Initialize TopicManager.
        
        Args:
            config: Configuration dict. If None, loads from file.
        """
        if config is None:
            config = load_config()
        
        self.config = config
        self.memory_config = config.get('memory', {})
        self.default_topics = self.memory_config.get('default_topics', ['general'])
        self.auto_detection = self.memory_config.get('auto_topic_detection', True)
        self.similarity_threshold = self.memory_config.get('similarity_threshold', 0.7)
        
        # Ensure memory directory exists
        base_path = Path(self.memory_config.get('base_path', './memory'))
        device_id = config.get('device', {}).get('id', 'local_owner')
        memory_dir = base_path / device_id
        memory_dir.mkdir(parents=True, exist_ok=True)
    
    def detect_topic(self, prompt: str) -> str:
        """
        Automatically detect topic from prompt.
        
        Args:
            prompt: User prompt to analyze.
        
        Returns:
            Detected topic name.
        """
        if not self.auto_detection:
            return 'general'
        
        prompt_lower = prompt.lower()
        
        # Check each default topic
        for topic in self.default_topics:
            if topic.lower() in prompt_lower:
                logger.debug(f"Detected topic: {topic}")
                return topic
        
        # Default fallback
        return 'general'
    
    @contextmanager
    def _get_connection(self, topic: str):
        """
        Get thread-safe database connection.
        
        Args:
            topic: Topic name.
        
        Yields:
            SQLite connection.
        """
        db_path = get_memory_path(topic, self.config)
        
        # Use thread-local connection if available
        if not hasattr(_local, 'connections'):
            _local.connections = {}
        
        conn_key = str(db_path)
        if conn_key not in _local.connections:
            _local.connections[conn_key] = sqlite3.connect(str(db_path), check_same_thread=False)
            _local.connections[conn_key].execute("""
                CREATE TABLE IF NOT EXISTS memory (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    topic TEXT,
                    content TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            _local.connections[conn_key].commit()
        
        conn = _local.connections[conn_key]
        try:
            yield conn
        except Exception as e:
            logger.error(f"Database error for topic {topic}: {e}")
            raise
    
    def add_memory(self, topic: str, content: str, prompt: Optional[str] = None):
        """
        Add memory to topic database.
        
        Args:
            topic: Topic name (if None, auto-detects from prompt).
            content: Content to store.
            prompt: Original prompt (for auto-detection).
        """
        if topic is None and prompt:
            topic = self.detect_topic(prompt)
        elif topic is None:
            topic = 'general'
        
        try:
            with self._get_connection(topic) as conn:
                cursor = conn.cursor()
                cursor.execute(
                    "INSERT INTO memory (topic, content) VALUES (?, ?)",
                    (topic, content)
                )
                conn.commit()
                logger.debug(f"Added memory to topic '{topic}'")
        except Exception as e:
            logger.error(f"Failed to add memory: {e}")
    
    def search_memory(self, prompt: str, topic: Optional[str] = None, limit: int = 10) -> List[str]:
        """
        Search memory for relevant content.
        
        Args:
            prompt: Search query.
            topic: Specific topic to search (if None, searches all topics).
            limit: Maximum number of results.
        
        Returns:
            List of relevant memory content.
        """
        if topic is None and self.auto_detection:
            topic = self.detect_topic(prompt)
        
        results = []
        
        try:
            # Search in specific topic or all topics
            topics_to_search = [topic] if topic else self.default_topics
            
            for search_topic in topics_to_search:
                try:
                    with self._get_connection(search_topic) as conn:
                        cursor = conn.cursor()
                        cursor.execute(
                            """
                            SELECT content FROM memory 
                            WHERE topic LIKE ? OR content LIKE ?
                            ORDER BY created_at DESC
                            LIMIT ?
                            """,
                            (f"%{prompt}%", f"%{prompt}%", limit)
                        )
                        topic_results = [row[0] for row in cursor.fetchall()]
                        results.extend(topic_results)
                except Exception as e:
                    logger.warning(f"Error searching topic {search_topic}: {e}")
            
            # Remove duplicates while preserving order
            seen = set()
            unique_results = []
            for result in results:
                if result not in seen:
                    seen.add(result)
                    unique_results.append(result)
            
            return unique_results[:limit]
            
        except Exception as e:
            logger.error(f"Failed to search memory: {e}")
            return []
    
    def get_memory_context(self, prompt: str, max_results: int = 5) -> str:
        """
        Get formatted memory context for prompt.
        
        Args:
            prompt: User prompt.
            max_results: Maximum number of memory entries to include.
        
        Returns:
            Formatted memory context string.
        """
        memories = self.search_memory(prompt, limit=max_results)
        
        if not memories:
            return ""
        
        context_lines = ["Memory Context:"]
        for i, memory in enumerate(memories, 1):
            context_lines.append(f"{i}. {memory}")
        
        return "\n".join(context_lines)
    
    def clear_topic_memory(self, topic: str) -> bool:
        """
        Clear all memory for a topic.
        
        Args:
            topic: Topic name.
        
        Returns:
            True if successful, False otherwise.
        """
        try:
            with self._get_connection(topic) as conn:
                cursor = conn.cursor()
                cursor.execute("DELETE FROM memory WHERE topic = ?", (topic,))
                conn.commit()
                logger.info(f"Cleared memory for topic '{topic}'")
                return True
        except Exception as e:
            logger.error(f"Failed to clear memory for topic '{topic}': {e}")
            return False
    
    def get_topic_stats(self, topic: str) -> Dict[str, Any]:
        """
        Get statistics for a topic.
        
        Args:
            topic: Topic name.
        
        Returns:
            Dictionary with statistics.
        """
        try:
            with self._get_connection(topic) as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT COUNT(*) FROM memory WHERE topic = ?", (topic,))
                count = cursor.fetchone()[0]
                
                return {
                    'topic': topic,
                    'memory_count': count
                }
        except Exception as e:
            logger.error(f"Failed to get stats for topic '{topic}': {e}")
            return {'topic': topic, 'memory_count': 0}

