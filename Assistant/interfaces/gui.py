"""
KenzAI GUI Interface
Rainmeter-style draggable and resizable GUI.
Jarvis-inspired black line with audio bars when responding.
"""
import sys
import tkinter as tk
from tkinter import ttk
from pathlib import Path
from typing import Optional, Dict, Any, Tuple, Callable
import math
import threading

# Setup imports
_current_dir = Path(__file__).parent.parent
if str(_current_dir) not in sys.path:
    sys.path.insert(0, str(_current_dir))

from utils.logger import get_logger
from utils.helpers import load_user_preferences, save_user_preferences
from utils.windows_integration import get_screen_resolution, is_windows

logger = get_logger()


class DraggableWindow:
    """Mixin for draggable windows."""
    
    def __init__(self, window):
        """
        Initialize draggable window.
        
        Args:
            window: Tkinter window.
        """
        self.window = window
        self.drag_start_x = 0
        self.drag_start_y = 0
        self.dragging = False
    
    def start_drag(self, event):
        """Start dragging."""
        self.dragging = True
        self.drag_start_x = event.x_root
        self.drag_start_y = event.y_root
    
    def on_drag(self, event):
        """Handle dragging."""
        if self.dragging:
            dx = event.x_root - self.drag_start_x
            dy = event.y_root - self.drag_start_y
            
            x = self.window.winfo_x() + dx
            y = self.window.winfo_y() + dy
            
            self.window.geometry(f"+{x}+{y}")
            
            self.drag_start_x = event.x_root
            self.drag_start_y = event.y_root
    
    def stop_drag(self, event):
        """Stop dragging."""
        self.dragging = False


class ResizableWindow:
    """Mixin for resizable windows."""
    
    def __init__(self, window, min_size: Tuple[int, int] = (120, 40), max_size: Tuple[int, int] = (1200, 800)):
        """
        Initialize resizable window.
        
        Args:
            window: Tkinter window.
            min_size: Minimum window size (width, height).
            max_size: Maximum window size (width, height).
        """
        self.window = window
        self.min_size = min_size
        self.max_size = max_size
        self.resizing = False
        self.resize_start_x = 0
        self.resize_start_y = 0
        self.resize_start_width = 0
        self.resize_start_height = 0
    
    def on_scroll(self, event):
        """
        Handle scroll wheel for resizing.
        
        Args:
            event: Mouse wheel event.
        """
        current_width = self.window.winfo_width()
        current_height = self.window.winfo_height()
        
        # Determine scroll direction
        if event.delta > 0 or event.num == 4:  # Scroll up
            factor = 1.1
        else:  # Scroll down
            factor = 0.9
        
        new_width = int(current_width * factor)
        new_height = int(current_height * factor)
        
        # Clamp to min/max
        new_width = max(self.min_size[0], min(self.max_size[0], new_width))
        new_height = max(self.min_size[1], min(self.max_size[1], new_height))
        
        self.window.geometry(f"{new_width}x{new_height}")
        logger.debug(f"Resized to {new_width}x{new_height}")


class KenzAIGUI:
    """Main KenzAI GUI window."""
    
    def __init__(self, assistant, config: Dict[str, Any], preferences: Dict[str, Any]):
        """
        Initialize KenzAI GUI.
        
        Args:
            assistant: KenzAIAssistant instance.
            config: Configuration dict.
            preferences: User preferences dict.
        """
        self.assistant = assistant
        self.config = config
        self.preferences = preferences
        self.gui_prefs = preferences.get('gui', {})
        
        # Create window
        self.root = tk.Tk()
        self.root.title("KenzAI")
        
        # Remove window decorations for custom appearance
        self.root.overrideredirect(True)
        
        # Setup window properties
        self._setup_window()
        
        # Setup draggable and resizable
        self.draggable = DraggableWindow(self.root)
        self.resizable = ResizableWindow(self.root)
        
        # Bind events
        self._bind_events()
        
        # Create UI
        self._create_ui()
        
        # Setup right-click menu
        self._create_context_menu()
        
        # Snap to edges if enabled
        if self.gui_prefs.get('snap_to_edges', True):
            self._snap_to_edges()
    
    def _setup_window(self):
        """Setup window properties."""
        # Get saved position and size
        position = self.gui_prefs.get('position', {'x': 1200, 'y': 100})
        size = self.gui_prefs.get('size', {'width': 400, 'height': 400})
        appearance = self.gui_prefs.get('last_appearance', 'line')
        opacity = self.gui_prefs.get('opacity', 0.9)
        always_on_top = self.gui_prefs.get('always_on_top', True)
        locked = self.gui_prefs.get('locked', False)
        
        # Line appearance: use a thin bar size if current size is square (legacy)
        w, h = size['width'], size['height']
        if appearance == 'line' and w == h and w >= 300:
            w, h = 520, 56
            self.gui_prefs.setdefault('size', {})['width'] = w
            self.gui_prefs.setdefault('size', {})['height'] = h
        self.root.geometry(f"{w}x{h}+{position['x']}+{position['y']}")
        
        # Set opacity
        if is_windows():
            try:
                self.root.attributes('-alpha', opacity)
            except Exception:
                pass
        
        # Always on top
        if always_on_top:
            self.root.attributes('-topmost', True)
        
        # Store state
        self.locked = locked
        self.appearance = appearance
        
        # Jarvis-style: speaking/processing state for audio bar animation
        self._speaking = False
        self._processing = False
        self._anim_phase = 0.0
        self._bar_count = 11  # Number of vertical bars in line mode
        self._entry_visible = self.gui_prefs.get('show_text_input', False)
        self._show_entry_var = tk.BooleanVar(value=self._entry_visible)
    
    def _bind_events(self):
        """Bind window events."""
        # Dragging
        self.root.bind('<Button-1>', self._on_left_click)
        self.root.bind('<B1-Motion>', self.draggable.on_drag)
        self.root.bind('<ButtonRelease-1>', self.draggable.stop_drag)
        
        # Right-click menu
        self.root.bind('<Button-3>', self._show_context_menu)
        
        # Scroll for resize
        self.root.bind('<MouseWheel>', self.resizable.on_scroll)
        self.root.bind('<Button-4>', self.resizable.on_scroll)  # Linux
        self.root.bind('<Button-5>', self.resizable.on_scroll)  # Linux
        
        # Save position/size on move/resize
        self.root.bind('<Configure>', self._on_configure)
        
        # Close on Escape
        self.root.bind('<Escape>', lambda e: self.close())
    
    def _on_left_click(self, event):
        """Handle left click."""
        if not self.locked:
            self.draggable.start_drag(event)
    
    def _on_configure(self, event):
        """Handle window configuration changes."""
        if event.widget == self.root:
            # Save position and size
            self.gui_prefs['position'] = {
                'x': self.root.winfo_x(),
                'y': self.root.winfo_y()
            }
            self.gui_prefs['size'] = {
                'width': self.root.winfo_width(),
                'height': self.root.winfo_height()
            }
            
            # Save preferences periodically (throttled)
            if not hasattr(self, '_save_timer'):
                self._save_timer = None
            
            if self._save_timer:
                self.root.after_cancel(self._save_timer)
            
            self._save_timer = self.root.after(1000, self._save_preferences)
    
    def _save_preferences(self):
        """Save preferences to file."""
        self.preferences['gui'] = self.gui_prefs
        save_user_preferences(self.preferences)
    
    def _snap_to_edges(self):
        """Snap window to screen edges if close."""
        if not is_windows():
            return
        
        try:
            screen_width, screen_height = get_screen_resolution()
            x = self.root.winfo_x()
            y = self.root.winfo_y()
            width = self.root.winfo_width()
            height = self.root.winfo_height()
            
            snap_distance = 20  # pixels
            
            # Check left edge
            if abs(x) < snap_distance:
                x = 0
            # Check right edge
            elif abs(x + width - screen_width) < snap_distance:
                x = screen_width - width
            # Check top edge
            if abs(y) < snap_distance:
                y = 0
            # Check bottom edge
            elif abs(y + height - screen_height) < snap_distance:
                y = screen_height - height
            
            self.root.geometry(f"+{x}+{y}")
        except Exception as e:
            logger.warning(f"Failed to snap to edges: {e}")
    
    def _create_ui(self):
        """Create UI elements."""
        # Jarvis line: black background; circle: dark gray
        bg = '#0a0a0a' if self.appearance == 'line' else '#1a1a1a'
        self.canvas = tk.Canvas(
            self.root,
            bg=bg,
            highlightthickness=0,
            borderwidth=0
        )
        self.canvas.pack(fill=tk.BOTH, expand=True)
        
        # Optional text entry to ask KenzAI (responses are spoken)
        self._entry_frame = tk.Frame(self.root, bg=bg, height=0)
        self._entry_frame.pack(fill=tk.X, side=tk.BOTTOM)
        self._entry_var = tk.StringVar()
        self._entry = tk.Entry(
            self._entry_frame,
            textvariable=self._entry_var,
            bg='#1a1a2e',
            fg='#e0e0e0',
            insertbackground='#00d4ff',
            relief=tk.FLAT,
            font=('Segoe UI', 10)
        )
        self._entry.pack(fill=tk.X, padx=4, pady=2)
        self._entry.bind('<Return>', self._on_ask_submit)
        self._entry.bind('<Escape>', lambda e: self._entry_var.set(''))
        if not self._entry_visible:
            self._entry_frame.pack_forget()
        
        self._draw_appearance()
        self._animate()
        
        # TTS for speaking responses (optional)
        try:
            from utils.tts_helper import TTSHelper
            self._tts = TTSHelper(self.config, self.preferences)
        except Exception:
            self._tts = None
    
    def set_speaking(self, speaking: bool):
        """Set speaking state for audio bar animation (Jarvis-style)."""
        self._speaking = bool(speaking)
    
    def set_processing(self, processing: bool):
        """Set processing/thinking state (subtle animation)."""
        self._processing = bool(processing)
    
    def _on_ask_submit(self, event=None):
        """User pressed Enter in text entry: ask assistant and speak response."""
        text = (self._entry_var.get() or '').strip()
        if not text:
            return
        self._entry_var.set('')
        
        def do_query():
            try:
                self.root.after(0, lambda: self.set_processing(True))
                response = self.assistant.process_query(text)
                
                def on_start():
                    self.root.after(0, lambda: self.set_processing(False))
                    self.root.after(0, lambda: self.set_speaking(True))
                
                def on_end():
                    self.root.after(0, lambda: self.set_speaking(False))
                
                if self._tts and self._tts.is_available():
                    self._tts.speak(response, on_start=on_start, on_end=on_end)
                else:
                    self.root.after(0, lambda: self.set_processing(False))
                    on_end()
            except Exception as e:
                logger.error(f"Query error: {e}", exc_info=True)
                self.root.after(0, lambda: self.set_processing(False))
                self.root.after(0, lambda: self.set_speaking(False))
        
        threading.Thread(target=do_query, daemon=True).start()
    
    def _draw_appearance(self):
        """Draw the appearance (circle or Jarvis line with audio bars)."""
        self.canvas.delete("all")
        
        width = self.root.winfo_width()
        height = self.root.winfo_height()
        center_x = width // 2
        center_y = height // 2
        
        if self.appearance == 'circle':
            # Draw circle
            radius = min(width, height) // 3
            self.canvas.create_oval(
                center_x - radius,
                center_y - radius,
                center_x + radius,
                center_y + radius,
                outline='#4a9eff',
                width=3,
                fill='#2a2a2a'
            )
        else:
            # Jarvis-style: black bar with vertical audio segments
            self._draw_jarvis_line(width, height, center_y)
    
    def _draw_jarvis_line(self, width: int, height: int, center_y: int):
        """Draw black bar with vertical segments that animate when speaking."""
        n = self._bar_count
        gap = 4
        bar_width = max(3, (width - (n + 1) * gap) // n)
        total_width = n * bar_width + (n + 1) * gap
        left = (width - total_width) // 2
        
        # Base bar color: cyan/blue glow when active, dim when idle
        if self._speaking:
            color = '#00d4ff'  # Bright cyan when speaking
            glow = '#00a8cc'
        elif self._processing:
            color = '#4a9eff'
            glow = '#2a6ebb'
        else:
            color = '#1e3a5f'  # Dim blue when idle
            glow = '#0d1f33'
        
        for i in range(n):
            x = left + gap + i * (bar_width + gap) + bar_width // 2
            
            # Animate height: wave effect when speaking, subtle pulse when processing, minimal when idle
            if self._speaking:
                # Audio-level style: wave with phase offset per bar
                t = self._anim_phase + i * 0.4
                level = 0.4 + 0.6 * (0.5 + 0.5 * math.sin(t))
                h = max(4, int((height * 0.5) * level))
            elif self._processing:
                t = self._anim_phase + i * 0.3
                level = 0.3 + 0.4 * (0.5 + 0.5 * math.sin(t))
                h = max(4, int((height * 0.45) * level))
            else:
                # Idle: very subtle breathing
                t = self._anim_phase + i * 0.2
                level = 0.15 + 0.1 * math.sin(t)
                h = max(2, int((height * 0.35) * level))
            
            y1 = center_y - h // 2
            y2 = center_y + h // 2
            
            # Glow (wider, behind)
            self.canvas.create_rectangle(
                x - bar_width // 2 - 1, y1 - 1,
                x + bar_width // 2 + 1, y2 + 1,
                fill=glow, outline=''
            )
            self.canvas.create_rectangle(
                x - bar_width // 2, y1, x + bar_width // 2, y2,
                fill=color, outline=''
            )
        
        self._anim_phase += 0.12
        if self._anim_phase > math.pi * 2:
            self._anim_phase -= math.pi * 2
        elif self._anim_phase < 0:
            self._anim_phase += math.pi * 2
    
    def _animate(self):
        """Animate the GUI (pulse or Jarvis bars)."""
        if self.appearance == 'line':
            self.canvas.configure(bg='#0a0a0a')
        else:
            self.canvas.configure(bg='#1a1a1a')
        self._draw_appearance()
        self.root.after(80, self._animate)
    
    def _create_context_menu(self):
        """Create right-click context menu."""
        self.context_menu = tk.Menu(self.root, tearoff=0)
        
        # Appearance submenu
        appearance_menu = tk.Menu(self.context_menu, tearoff=0)
        appearance_menu.add_radiobutton(
            label="Circle",
            command=lambda: self._change_appearance('circle'),
            variable=tk.StringVar(value=self.appearance)
        )
        appearance_menu.add_radiobutton(
            label="Line",
            command=lambda: self._change_appearance('line'),
            variable=tk.StringVar(value=self.appearance)
        )
        self.context_menu.add_cascade(label="Appearance", menu=appearance_menu)
        
        self.context_menu.add_checkbutton(
            label="Show text input",
            command=self._toggle_text_input,
            variable=self._show_entry_var
        )
        
        self.context_menu.add_separator()
        
        # Lock position
        self.context_menu.add_checkbutton(
            label="Lock Position",
            command=self._toggle_lock,
            variable=tk.BooleanVar(value=self.locked)
        )
        
        # Opacity submenu
        opacity_menu = tk.Menu(self.context_menu, tearoff=0)
        for op in [0.5, 0.6, 0.7, 0.8, 0.9, 1.0]:
            opacity_menu.add_radiobutton(
                label=f"{int(op * 100)}%",
                command=lambda o=op: self._set_opacity(o)
            )
        self.context_menu.add_cascade(label="Opacity", menu=opacity_menu)
        
        # Always on top
        self.context_menu.add_checkbutton(
            label="Always on Top",
            command=self._toggle_always_on_top,
            variable=tk.BooleanVar(value=self.gui_prefs.get('always_on_top', True))
        )
        
        self.context_menu.add_separator()
        self.context_menu.add_command(label="Close", command=self.close)
    
    def _show_context_menu(self, event):
        """Show context menu."""
        self.context_menu.tk_popup(event.x_root, event.y_root)
    
    def _toggle_text_input(self):
        """Toggle visibility of the text input bar."""
        self._entry_visible = not self._entry_visible
        self._show_entry_var.set(self._entry_visible)
        self.gui_prefs['show_text_input'] = self._entry_visible
        if self._entry_visible:
            self._entry_frame.pack(fill=tk.X, side=tk.BOTTOM)
        else:
            self._entry_frame.pack_forget()
        self._save_preferences()
    
    def _change_appearance(self, appearance: str):
        """Change appearance."""
        self.appearance = appearance
        self.gui_prefs['last_appearance'] = appearance
        if self.canvas:
            self.canvas.configure(bg='#0a0a0a' if appearance == 'line' else '#1a1a1a')
        self._draw_appearance()
        self._save_preferences()
    
    def _toggle_lock(self):
        """Toggle position lock."""
        self.locked = not self.locked
        self.gui_prefs['locked'] = self.locked
    
    def _set_opacity(self, opacity: float):
        """Set window opacity."""
        self.gui_prefs['opacity'] = opacity
        if is_windows():
            try:
                self.root.attributes('-alpha', opacity)
            except Exception:
                pass
        self._save_preferences()
    
    def _toggle_always_on_top(self):
        """Toggle always on top."""
        always_on_top = not self.gui_prefs.get('always_on_top', True)
        self.gui_prefs['always_on_top'] = always_on_top
        self.root.attributes('-topmost', always_on_top)
        self._save_preferences()
    
    def close(self):
        """Close the GUI."""
        self._save_preferences()
        self.root.quit()
        self.root.destroy()
    
    def run(self):
        """Run the GUI main loop."""
        self.root.mainloop()


def launch_gui(assistant, config: Optional[Dict[str, Any]] = None, preferences: Optional[Dict[str, Any]] = None):
    """
    Launch KenzAI GUI.
    
    Args:
        assistant: KenzAIAssistant instance.
        config: Configuration dict. If None, loads from file.
        preferences: User preferences dict. If None, loads from file.
    """
    if config is None:
        from utils.helpers import load_config
        config = load_config()
    
    if preferences is None:
        preferences = load_user_preferences()
    
    logger.info("Launching KenzAI GUI...")
    
    try:
        gui = KenzAIGUI(assistant, config, preferences)
        gui.run()
    except Exception as e:
        logger.error(f"Failed to launch GUI: {e}", exc_info=True)


if __name__ == "__main__":
    # Test GUI
    from core import KenzAIAssistant
    from utils.helpers import load_config, load_user_preferences
    
    config = load_config()
    preferences = load_user_preferences()
    assistant = KenzAIAssistant(config)
    
    launch_gui(assistant, config, preferences)

