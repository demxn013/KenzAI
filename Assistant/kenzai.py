import os
import sqlite3
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
import ollama
import keyboard
import subprocess
import sys
import time

# -----------------------------
# CONFIG
# -----------------------------
WATCHED_FOLDERS = [
    # Add folders here if you want KenzAI to watch files
]

MEMORY_FOLDER = r"D:\Yazanaki\KenzAI\Assistant\memory"

# Models
CODE_MODEL = "deepseek-coder:6.7b"
GENERAL_MODEL = "deepseek-v2:16b-lite-chat-q4_0"  # general-purpose chat model

# Map topics to databases
TOPIC_DBS = {
    "yazanaki": os.path.join(MEMORY_FOLDER, "kenzai_yazanaki.db"),
    "elementalmc": os.path.join(MEMORY_FOLDER, "kenzai_elementalmc.db"),
    "general": os.path.join(MEMORY_FOLDER, "kenzai_general.db"),
}

# Ensure memory folder exists
os.makedirs(MEMORY_FOLDER, exist_ok=True)

# -----------------------------
# ENSURE MODELS ARE LOCAL
# -----------------------------
def ensure_model(model_name):
    try:
        models = subprocess.check_output(["ollama", "list"], text=True)
        if model_name not in models:
            print(f"[KenzAI] Downloading model {model_name} locally...")
            subprocess.run(["ollama", "pull", model_name], check=True)
            print(f"[KenzAI] Model {model_name} downloaded.")
        else:
            print(f"[KenzAI] Model {model_name} found locally.")
    except FileNotFoundError:
        print("[KenzAI] Ollama CLI not found! Please make sure Ollama is installed and on PATH.")
        sys.exit(1)

def check_daemon():
    print("[KenzAI] Make sure Ollama daemon is running with `ollama serve` for best performance.")

# Ensure models exist locally
ensure_model(CODE_MODEL)
ensure_model(GENERAL_MODEL)
check_daemon()

# -----------------------------
# FOLDER WATCHER (Optional)
# -----------------------------
class WatchHandler(FileSystemEventHandler):
    def on_modified(self, event):
        if event.is_directory:
            return
        print(f"[KenzAI] Detected change in {event.src_path}")

observer = Observer()
for folder in WATCHED_FOLDERS:
    observer.schedule(WatchHandler(), folder, recursive=True)
observer.start()

# -----------------------------
# MEMORY FUNCTIONS (Thread-Safe, Multi-DB)
# -----------------------------
def detect_topic(prompt):
    """Automatically detect topic for database selection."""
    prompt_lower = prompt.lower()
    for topic, db_file in TOPIC_DBS.items():
        if topic in prompt_lower:
            return db_file
    return TOPIC_DBS["general"]

def add_memory(topic, content, prompt):
    """Save memory to appropriate database based on prompt context."""
    db_file = detect_topic(prompt)
    os.makedirs(os.path.dirname(db_file), exist_ok=True)
    with sqlite3.connect(db_file) as conn:
        cursor = conn.cursor()
        cursor.execute("CREATE TABLE IF NOT EXISTS memory (topic TEXT, content TEXT)")
        cursor.execute("INSERT INTO memory (topic, content) VALUES (?, ?)", (topic, content))
        conn.commit()

def search_memory(prompt):
    """Search memory in the appropriate database automatically."""
    db_file = detect_topic(prompt)
    with sqlite3.connect(db_file) as conn:
        cursor = conn.cursor()
        cursor.execute("CREATE TABLE IF NOT EXISTS memory (topic TEXT, content TEXT)")
        cursor.execute(
            "SELECT content FROM memory WHERE topic LIKE ? OR content LIKE ?",
            (f"%{prompt}%", f"%{prompt}%")
        )
        return [row[0] for row in cursor.fetchall()]

# -----------------------------
# MODEL SELECTION
# -----------------------------
current_model = None

def choose_model(prompt):
    """Select model based on prompt content."""
    prompt_lower = prompt.lower()
    if any(keyword in prompt_lower for keyword in ["code", "python", "javascript", "program", "script"]):
        return CODE_MODEL
    return GENERAL_MODEL

# -----------------------------
# CORE FUNCTION
# -----------------------------
def ask_kenzai(prompt):
    global current_model
    model_to_use = choose_model(prompt)
    if current_model != model_to_use:
        print(f"[KenzAI] Switching to model {model_to_use}...")
        current_model = model_to_use

    relevant = search_memory(prompt)
    memory_context = "\n".join(relevant)

    messages = []
    if memory_context:
        messages.append({'role': 'system', 'content': f"Memory:\n{memory_context}"})
    messages.append({'role': 'user', 'content': prompt})

    response = ollama.chat(
        model=current_model,
        messages=messages
    )

    try:
        return response.message.content
    except AttributeError:
        return response['message']['content']

# -----------------------------
# HOTKEY INTERACTION
# -----------------------------
def kenzai_hotkey():
    print("\n[KenzAI] Hotkey triggered. Type your prompt:")
    user_input = input(">>> ")

    # Auto-save memory based on prompt context
    topic = user_input.split(" ", 1)[0]  # first word as topic
    add_memory(topic, user_input, user_input)

    reply = ask_kenzai(user_input)
    print(f"[KenzAI] {reply}")

keyboard.add_hotkey('ctrl+shift+j', kenzai_hotkey)

# -----------------------------
# MAIN LOOP
# -----------------------------
print(f"[KenzAI] Running with models: CODE='{CODE_MODEL}', GENERAL='{GENERAL_MODEL}'... Press Ctrl+C to quit.")
try:
    while True:
        time.sleep(0.1)
except KeyboardInterrupt:
    observer.stop()
observer.join()
