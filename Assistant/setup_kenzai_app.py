"""
KenzAI Application Setup
Creates a Windows application with installer, shortcuts, and proper packaging.
Run this to set up KenzAI as a standalone app.
"""
import sys
import os
import subprocess
from pathlib import Path
import shutil

def print_header(text):
    """Print formatted header."""
    print("\n" + "=" * 70)
    print(text)
    print("=" * 70 + "\n")

def check_dependencies():
    """Check if required packages are installed."""
    print_header("Checking Dependencies")
    
    required = [
        'ollama',
        'pvporcupine',
        'sounddevice',
        'soundfile',
        'numpy',
        'SpeechRecognition',
        'pyttsx3',
        'PyYAML',
        'pystray',
        'Pillow',
        'webrtcvad'
    ]
    
    missing = []
    for package in required:
        try:
            __import__(package)
            print(f"✓ {package}")
        except ImportError:
            print(f"✗ {package} (missing)")
            missing.append(package)
    
    if missing:
        print(f"\n⚠ Missing packages: {', '.join(missing)}")
        print("\nInstall with:")
        print(f"  pip install {' '.join(missing)}")
        return False
    
    print("\n✓ All dependencies installed")
    return True

def create_app_structure():
    """Create application directory structure."""
    print_header("Creating App Structure")
    
    app_root = Path(__file__).parent
    
    # Directories to ensure exist
    dirs = [
        app_root / "config",
        app_root / "memory",
        app_root / "data" / "logs",
        app_root / "assets" / "sounds",
        app_root / "assets" / "wake_words",
    ]
    
    for dir_path in dirs:
        dir_path.mkdir(parents=True, exist_ok=True)
        print(f"✓ {dir_path.relative_to(app_root)}")
    
    print("\n✓ App structure created")

def create_startup_script():
    """Create startup script for the app."""
    print_header("Creating Startup Script")
    
    app_root = Path(__file__).parent
    script_path = app_root / "start_kenzai.bat"
    
    script_content = f'''@echo off
title KenzAI Assistant
cd /d "{app_root}"

REM Check if Python is available
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Python is not installed or not in PATH!
    echo Please install Python 3.8+ from python.org
    pause
    exit /b 1
)

REM Start KenzAI daemon
echo Starting KenzAI...
python unified_kenzai_daemon.py

pause
'''
    
    with open(script_path, 'w') as f:
        f.write(script_content)
    
    print(f"✓ Created {script_path.name}")
    
    # Also create a pythonw version (no console)
    silent_script = app_root / "start_kenzai_silent.bat"
    silent_content = script_content.replace('python unified_kenzai_daemon.py', 
                                           'pythonw unified_kenzai_daemon.py')
    
    with open(silent_script, 'w') as f:
        f.write(silent_content)
    
    print(f"✓ Created {silent_script.name} (silent mode)")

def create_desktop_shortcut():
    """Create desktop shortcut."""
    print_header("Creating Desktop Shortcut")
    
    if sys.platform != 'win32':
        print("⚠ Desktop shortcuts only supported on Windows")
        return
    
    try:
        import win32com.client
        
        desktop = Path.home() / "Desktop"
        app_root = Path(__file__).parent
        
        shell = win32com.client.Dispatch("WScript.Shell")
        shortcut = shell.CreateShortCut(str(desktop / "KenzAI.lnk"))
        shortcut.Targetpath = str(app_root / "start_kenzai.bat")
        shortcut.WorkingDirectory = str(app_root)
        shortcut.IconLocation = str(app_root / "assets" / "icon.ico") if (app_root / "assets" / "icon.ico").exists() else ""
        shortcut.Description = "KenzAI Voice Assistant"
        shortcut.save()
        
        print(f"✓ Created desktop shortcut")
    
    except ImportError:
        print("⚠ Could not create shortcut (pip install pywin32)")
    except Exception as e:
        print(f"⚠ Failed to create shortcut: {e}")

def create_uninstaller():
    """Create uninstaller script."""
    print_header("Creating Uninstaller")
    
    app_root = Path(__file__).parent
    uninstall_path = app_root / "uninstall.py"
    
    uninstall_content = '''"""
KenzAI Uninstaller
Removes KenzAI from Windows startup and cleans up.
"""
import sys
from pathlib import Path

if sys.platform == 'win32':
    try:
        from utils.windows_integration import WindowsStartupManager
        
        if WindowsStartupManager.is_startup_enabled():
            WindowsStartupManager.disable_startup()
            print("✓ Removed from Windows startup")
        
        desktop = Path.home() / "Desktop" / "KenzAI.lnk"
        if desktop.exists():
            desktop.unlink()
            print("✓ Removed desktop shortcut")
        
        print("\\nKenzAI has been uninstalled from startup.")
        print("You can safely delete the KenzAI folder if desired.")
        
    except Exception as e:
        print(f"Error during uninstall: {e}")
else:
    print("Uninstaller only supported on Windows")

input("\\nPress Enter to exit...")
'''
    
    with open(uninstall_path, 'w') as f:
        f.write(uninstall_content)
    
    print(f"✓ Created {uninstall_path.name}")

def setup_config():
    """Check and guide configuration setup."""
    print_header("Configuration Setup")
    
    app_root = Path(__file__).parent
    config_path = app_root / "config" / "config.yaml"
    
    if config_path.exists():
        print(f"✓ Configuration file exists: {config_path}")
        
        # Check for access key
        import yaml
        with open(config_path) as f:
            config = yaml.safe_load(f)
        
        access_key = config.get('interfaces', {}).get('daemon', {}).get('porcupine_access_key', '')
        
        if not access_key or access_key.startswith('${'):
            print("\n⚠ Porcupine access key not configured!")
            print("\nTo enable wake word detection:")
            print("1. Get free access key: https://console.picovoice.ai/")
            print("2. Edit config/config.yaml")
            print("3. Replace porcupine_access_key value")
        else:
            print(f"✓ Porcupine access key configured: {access_key[:20]}...")
    else:
        print(f"⚠ Configuration file not found: {config_path}")
        print("  Make sure config.yaml exists in the config folder")

def print_completion_message():
    """Print setup completion message."""
    print_header("Setup Complete!")
    
    print("KenzAI is now set up as an application!\n")
    print("To start KenzAI:")
    print("  • Double-click the desktop shortcut 'KenzAI'")
    print("  • Or run: start_kenzai.bat")
    print("  • For silent mode: start_kenzai_silent.bat\n")
    
    print("Features:")
    print("  • System tray icon for easy access")
    print("  • Wake word: 'KENZAI'")
    print("  • Sleep/Wake modes for resource efficiency")
    print("  • Optional: Start with Windows\n")
    
    print("Next steps:")
    print("  1. Configure Porcupine access key in config/config.yaml")
    print("  2. Start KenzAI from desktop shortcut")
    print("  3. Right-click system tray icon for options\n")

def main():
    """Main setup function."""
    print_header("KenzAI Application Setup")
    print("This will set up KenzAI as a standalone Windows application.\n")
    
    app_root = Path(__file__).parent
    print(f"Installation directory: {app_root}\n")
    
    # Run setup steps
    steps = [
        ("Checking dependencies", check_dependencies),
        ("Creating app structure", create_app_structure),
        ("Creating startup scripts", create_startup_script),
        ("Creating desktop shortcut", create_desktop_shortcut),
        ("Creating uninstaller", create_uninstaller),
        ("Checking configuration", setup_config),
    ]
    
    for step_name, step_func in steps:
        try:
            if step_func.__name__ == 'check_dependencies':
                if not step_func():
                    print("\n⚠ Please install missing dependencies first")
                    print("Then run this setup again.")
                    return
            else:
                step_func()
        except Exception as e:
            print(f"\n⚠ Error in {step_name}: {e}")
            import traceback
            traceback.print_exc()
    
    print_completion_message()
    
    # Ask about enabling startup
    if sys.platform == 'win32':
        print("\nWould you like to enable KenzAI to start with Windows? (y/n): ", end='')
        response = input().strip().lower()
        
        if response == 'y':
            try:
                from utils.windows_integration import WindowsStartupManager
                WindowsStartupManager.enable_startup(app_root / "unified_kenzai_daemon.py")
                print("✓ Enabled startup with Windows")
            except Exception as e:
                print(f"⚠ Could not enable startup: {e}")
    
    print("\n" + "=" * 70)
    print("Setup complete! You can now launch KenzAI.")
    print("=" * 70 + "\n")


if __name__ == "__main__":
    try:
        main()
        input("\nPress Enter to exit...")
    except KeyboardInterrupt:
        print("\n\nSetup cancelled.")
    except Exception as e:
        print(f"\n\nSetup failed: {e}")
        import traceback
        traceback.print_exc()
        input("\nPress Enter to exit...")