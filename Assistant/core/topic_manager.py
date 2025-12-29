"""
Topic Manager - IMPROVED VERSION
Fixes thread safety, memory leak, and adds proper connection pooling.
"""
import sqlite3
import threading
from pathlib import Path
from typing import List, Optional, Dict, Any
from contextlib import contextmanager
import hashlib
from datetime import datetime, timedelta

try:
    from utils.logger import get_logger
    from utils.helpers import load_config, get_memory_path
except ImportError:
    from ..utils.logger import get_logger
    from ..utils.helpers import load_config, get_memory_path

logger = get_logger()


class ConnectionPool:
    """Thread-safe connection pool for SQLite databases."""
    
    def __init__(self, max_connections: int = 5):
        self.max_connections = max_connections
        self.pools: Dict[str, List[sqlite3.Connection]] = {}
        self.locks: Dict[str, threading.Lock] = {}
        self.main_lock = threading.Lock()
    
    @contextmanager
    def get_connection(self, db_path: Path):
        """Get a connection from the pool."""
        db_key = str(db_path)
        
        # Ensure pool exists for this database
        with self.main_lock:
            if db_key not in self.pools:
                self.pools[db_key] = []
                self.locks[db_key] = threading.Lock()
        
        conn = None
        try:
            # Try to get existing connection
            with self.locks[db_key]:
                if self.pools[db_key]:
                    conn = self.pools[db_key].pop()
                else:
                    # Create new connection
                    conn = sqlite3.connect(str(db_path), check_same_thread=False)
                    conn.execute("""
                        CREATE TABLE IF NOT EXISTS memory (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            topic TEXT NOT NULL,
                            content TEXT NOT NULL,
                            content_hash TEXT NOT NULL,
                            importance REAL DEFAULT 0.5,
                            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            last_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            access_count INTEGER DEFAULT 0
                        )
                    """)
                    conn.execute("""
                        CREATE INDEX IF NOT EXISTS idx_topic ON memory(topic)
                    """)
                    conn.execute("""
                        CREATE INDEX IF NOT EXISTS idx_content_hash ON memory(content_hash)
                    """)
                    conn.execute("""
                        CREATE INDEX IF NOT EXISTS idx_created_at ON memory(created_at)
                    """)
                    conn.commit()
            
            yield conn
            
        finally:
            # Return connection to pool
            if conn:
                with self.locks[db_key]:
                    if len(self.pools[db_key]) < self.max_connections:
                        self.pools[db_key].append(conn)
                    else:
                        conn.close()
    
    def close_all(self):
        """Close all connections in all pools."""
        with self.main_lock:
            for pool in self.pools.values():
                for conn in pool:
                    try:
                        conn.close()
                    except Exception:
                        pass
            self.pools.clear()


class TopicManager:
    """Manages topic detection and memory storage with improved efficiency."""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """Initialize TopicManager."""
        if config is None:
            config = load_config()
        
        self.config = config
        self.memory_config = config.get('memory', {})
        self.default_topics = self.memory_config.get('default_topics', ['general'])
        self.auto_detection = self.memory_config.get('auto_topic_detection', True)
        self.similarity_threshold = self.memory_config.get('similarity_threshold', 0.7)
        
        # Connection pool
        self.connection_pool = ConnectionPool()
        
        # Memory cache for frequently accessed data
        self._cache: Dict[str, List[str]] = {}
        self._cache_lock = threading.Lock()
        self._cache_ttl = timedelta(minutes=5)
        self._cache_timestamps: Dict[str, datetime] = {}
        
        # Ensure memory directory exists
        base_path = Path(self.memory_config.get('base_path', './memory'))
        device_id = config.get('device', {}).get('id', 'local_owner')
        memory_dir = base_path / device_id
        memory_dir.mkdir(parents=True, exist_ok=True)
    
    def detect_topic(self, prompt: str) -> str:
        """Detect topic from prompt using keyword matching."""
        if not self.auto_detection:
            return 'general'
        
        prompt_lower = prompt.lower()
        
        # Check each default topic
        for topic in self.default_topics:
            if topic.lower() in prompt_lower:
                logger.debug(f"Detected topic: {topic}")
                return topic
        
        # Could add more sophisticated detection here (NER, keyword extraction, etc.)
        
        return 'general'
    
    def _compute_content_hash(self, content: str) -> str:
        """Compute SHA-256 hash of content for deduplication."""
        return hashlib.sha256(content.encode('utf-8')).hexdigest()
    
    def _compute_importance(self, prompt: str, content: str) -> float:
        """
        Compute importance score (0.0-1.0) for memory entry.
        Higher scores = more important to remember.
        """
        importance = 0.5  # Base score
        
        # Longer responses = potentially more important
        if len(content) > 500:
            importance += 0.1
        
        # Questions are important
        if any(word in prompt.lower() for word in ['how', 'what', 'why', 'when', 'where', 'who']):
            importance += 0.1
        
        # Code-related queries are important
        if any(word in prompt.lower() for word in ['code', 'function', 'class', 'error', 'debug']):
            importance += 0.15
        
        # Personal information is important
        if any(word in prompt.lower() for word in ['my', 'i am', 'i have', 'remember']):
            importance += 0.2
        
        return min(1.0, importance)
    
    def add_memory(
        self, 
        topic: str, 
        content: str, 
        prompt: Optional[str] = None,
        force: bool = False
    ):
        """
        Add memory to topic database with deduplication.
        
        Args:
            topic: Topic name (if None, auto-detects from prompt).
            content: Content to store.
            prompt: Original prompt (for importance calculation).
            force: If True, add even if duplicate exists.
        """
        if topic is None and prompt:
            topic = self.detect_topic(prompt)
        elif topic is None:
            topic = 'general'
        
        # Skip empty content
        if not content or not content.strip():
            return
        
        content = content.strip()
        content_hash = self._compute_content_hash(content)
        
        try:
            db_path = get_memory_path(topic, self.config)
            
            with self.connection_pool.get_connection(db_path) as conn:
                cursor = conn.cursor()
                
                # Check for duplicate unless forced
                if not force:
                    cursor.execute(
                        "SELECT id FROM memory WHERE content_hash = ?",
                        (content_hash,)
                    )
                    if cursor.fetchone():
                        logger.debug(f"Duplicate content, skipping: {content[:50]}...")
                        return
                
                # Compute importance
                importance = self._compute_importance(prompt or "", content)
                
                # Insert memory
                cursor.execute(
                    """
                    INSERT INTO memory (topic, content, content_hash, importance)
                    VALUES (?, ?, ?, ?)
                    """,
                    (topic, content, content_hash, importance)
                )
                conn.commit()
                
                logger.debug(f"Added memory to '{topic}' (importance: {importance:.2f})")
                
                # Invalidate cache
                with self._cache_lock:
                    self._cache.pop(topic, None)
                
        except Exception as e:
            logger.error(f"Failed to add memory: {e}")
    
    def search_memory(
        self, 
        prompt: str, 
        topic: Optional[str] = None, 
        limit: int = 10
    ) -> List[str]:
        """
        Search memory with caching and access tracking.
        
        Args:
            prompt: Search query.
            topic: Specific topic to search (if None, searches detected topic).
            limit: Maximum number of results.
        
        Returns:
            List of relevant memory content.
        """
        if topic is None and self.auto_detection:
            topic = self.detect_topic(prompt)
        
        # Check cache first
        cache_key = f"{topic}:{prompt}:{limit}"
        with self._cache_lock:
            if cache_key in self._cache:
                cache_age = datetime.now() - self._cache_timestamps.get(cache_key, datetime.min)
                if cache_age < self._cache_ttl:
                    logger.debug("Cache hit for search")
                    return self._cache[cache_key]
        
        results = []
        
        try:
            topics_to_search = [topic] if topic else self.default_topics
            
            for search_topic in topics_to_search:
                try:
                    db_path = get_memory_path(search_topic, self.config)
                    
                    with self.connection_pool.get_connection(db_path) as conn:
                        cursor = conn.cursor()
                        
                        # Search with relevance scoring
                        cursor.execute(
                            """
                            SELECT id, content, importance, access_count
                            FROM memory 
                            WHERE topic LIKE ? OR content LIKE ?
                            ORDER BY 
                                importance DESC,
                                access_count DESC,
                                created_at DESC
                            LIMIT ?
                            """,
                            (f"%{prompt}%", f"%{prompt}%", limit)
                        )
                        
                        rows = cursor.fetchall()
                        
                        # Update access tracking
                        if rows:
                            ids = [row[0] for row in rows]
                            cursor.execute(
                                f"""
                                UPDATE memory 
                                SET 
                                    last_accessed = CURRENT_TIMESTAMP,
                                    access_count = access_count + 1
                                WHERE id IN ({','.join('?' * len(ids))})
                                """,
                                ids
                            )
                            conn.commit()
                        
                        results.extend([row[1] for row in rows])
                        
                except Exception as e:
                    logger.warning(f"Error searching topic {search_topic}: {e}")
            
            # Remove duplicates while preserving order
            seen = set()
            unique_results = []
            for result in results:
                if result not in seen:
                    seen.add(result)
                    unique_results.append(result)
            
            final_results = unique_results[:limit]
            
            # Update cache
            with self._cache_lock:
                self._cache[cache_key] = final_results
                self._cache_timestamps[cache_key] = datetime.now()
            
            return final_results
            
        except Exception as e:
            logger.error(f"Failed to search memory: {e}")
            return []
    
    def get_memory_context(self, prompt: str, max_results: int = 5) -> str:
        """Get formatted memory context for prompt."""
        memories = self.search_memory(prompt, limit=max_results)
        
        if not memories:
            return ""
        
        context_lines = ["Memory Context:"]
        for i, memory in enumerate(memories, 1):
            # Truncate long memories
            memory_preview = memory[:200] + "..." if len(memory) > 200 else memory
            context_lines.append(f"{i}. {memory_preview}")
        
        return "\n".join(context_lines)
    
    def cleanup_old_memories(self, topic: str, days: int = 90, keep_important: bool = True):
        """
        Clean up old, low-importance memories.
        
        Args:
            topic: Topic to clean up.
            days: Remove memories older than this many days.
            keep_important: If True, keep high-importance memories regardless of age.
        """
        try:
            db_path = get_memory_path(topic, self.config)
            
            with self.connection_pool.get_connection(db_path) as conn:
                cursor = conn.cursor()
                
                if keep_important:
                    # Delete only low-importance old memories
                    cursor.execute(
                        """
                        DELETE FROM memory
                        WHERE 
                            topic = ?
                            AND created_at < datetime('now', '-' || ? || ' days')
                            AND importance < 0.6
                            AND access_count < 2
                        """,
                        (topic, days)
                    )
                else:
                    # Delete all old memories
                    cursor.execute(
                        """
                        DELETE FROM memory
                        WHERE 
                            topic = ?
                            AND created_at < datetime('now', '-' || ? || ' days')
                        """,
                        (topic, days)
                    )
                
                deleted_count = cursor.rowcount
                conn.commit()
                
                logger.info(f"Cleaned up {deleted_count} old memories from '{topic}'")
                
        except Exception as e:
            logger.error(f"Failed to cleanup memories: {e}")
    
    def clear_topic_memory(self, topic: str) -> bool:
        """Clear all memory for a topic."""
        try:
            db_path = get_memory_path(topic, self.config)
            
            with self.connection_pool.get_connection(db_path) as conn:
                cursor = conn.cursor()
                cursor.execute("DELETE FROM memory WHERE topic = ?", (topic,))
                conn.commit()
                
                logger.info(f"Cleared memory for topic '{topic}'")
                
                # Invalidate cache
                with self._cache_lock:
                    self._cache.pop(topic, None)
                
                return True
        except Exception as e:
            logger.error(f"Failed to clear memory for topic '{topic}': {e}")
            return False
    
    def get_topic_stats(self, topic: str) -> Dict[str, Any]:
        """Get statistics for a topic."""
        try:
            db_path = get_memory_path(topic, self.config)
            
            with self.connection_pool.get_connection(db_path) as conn:
                cursor = conn.cursor()
                
                cursor.execute(
                    """
                    SELECT 
                        COUNT(*) as total,
                        AVG(importance) as avg_importance,
                        SUM(CASE WHEN importance > 0.7 THEN 1 ELSE 0 END) as high_importance
                    FROM memory 
                    WHERE topic = ?
                    """,
                    (topic,)
                )
                row = cursor.fetchone()
                
                return {
                    'topic': topic,
                    'memory_count': row[0] if row else 0,
                    'avg_importance': round(row[1], 2) if row and row[1] else 0,
                    'high_importance_count': row[2] if row else 0
                }
        except Exception as e:
            logger.error(f"Failed to get stats for topic '{topic}': {e}")
            return {'topic': topic, 'memory_count': 0}
    
    def __del__(self):
        """Cleanup on deletion."""
        try:
            self.connection_pool.close_all()
        except Exception:
            pass