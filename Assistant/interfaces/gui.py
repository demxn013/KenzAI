"""
KenzAI GUI Interface
Rainmeter-style draggable and resizable GUI.
"""
import sys
import tkinter as tk
from tkinter import ttk
from pathlib import Path
from typing import Optional, Dict, Any, Tuple
import math

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
    
    def __init__(self, window, min_size: Tuple[int, int] = (200, 200), max_size: Tuple[int, int] = (800, 800)):
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
        appearance = self.gui_prefs.get('last_appearance', 'circle')
        opacity = self.gui_prefs.get('opacity', 0.9)
        always_on_top = self.gui_prefs.get('always_on_top', True)
        locked = self.gui_prefs.get('locked', False)
        
        # Set geometry
        self.root.geometry(f"{size['width']}x{size['height']}+{position['x']}+{position['y']}")
        
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
        # Create canvas for custom drawing
        self.canvas = tk.Canvas(
            self.root,
            bg='#1a1a1a',  # Dark background
            highlightthickness=0,
            borderwidth=0
        )
        self.canvas.pack(fill=tk.BOTH, expand=True)
        
        # Draw appearance
        self._draw_appearance()
        
        # Add pulse animation
        self._animate()
    
    def _draw_appearance(self):
        """Draw the appearance (circle or line)."""
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
                outline='#4a9eff',  # Blue glow
                width=3,
                fill='#2a2a2a'
            )
        else:  # line
            # Draw horizontal line with glow
            line_width = width // 2
            self.canvas.create_line(
                center_x - line_width // 2,
                center_y,
                center_x + line_width // 2,
                center_y,
                fill='#4a9eff',
                width=4
            )
    
    def _animate(self):
        """Animate the GUI (pulse effect)."""
        # Simple pulse animation
        self._draw_appearance()
        self.root.after(100, self._animate)
    
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
    
    def _change_appearance(self, appearance: str):
        """Change appearance."""
        self.appearance = appearance
        self.gui_prefs['last_appearance'] = appearance
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

