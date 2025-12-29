"""
Porcupine Diagnostic Script
Identifies exactly why Porcupine is failing to initialize.
"""
import sys
from pathlib import Path

# Add parent directory to path
_current_dir = Path(__file__).parent.parent
if str(_current_dir) not in sys.path:
    sys.path.insert(0, str(_current_dir))

print("=" * 70)
print("KENZAI PORCUPINE DIAGNOSTIC")
print("=" * 70)

# Step 1: Check Python version
print("\n[1] Checking Python version...")
print(f"    Python {sys.version}")
if sys.version_info < (3, 7):
    print("    ❌ ERROR: Python 3.7+ required")
    sys.exit(1)
else:
    print("    ✓ Python version OK")

# Step 2: Check package installations
print("\n[2] Checking required packages...")

packages_ok = True

try:
    import pvporcupine
    # Try to get version, but don't fail if not available
    try:
        version = pvporcupine.__version__
    except AttributeError:
        version = "installed (version unknown)"
    print(f"    ✓ pvporcupine: {version}")
except ImportError as e:
    print(f"    ❌ pvporcupine: NOT INSTALLED")
    print(f"       Error: {e}")
    packages_ok = False

try:
    import sounddevice as sd
    print(f"    ✓ sounddevice: installed")
except ImportError:
    print(f"    ❌ sounddevice: NOT INSTALLED")
    packages_ok = False

try:
    import numpy as np
    print(f"    ✓ numpy: {np.__version__}")
except ImportError:
    print(f"    ❌ numpy: NOT INSTALLED")
    packages_ok = False

if not packages_ok:
    print("\n    Install missing packages with:")
    print("    pip install pvporcupine sounddevice numpy")
    sys.exit(1)

# Step 3: Check audio devices
print("\n[3] Checking audio devices...")
try:
    import sounddevice as sd
    devices = sd.query_devices()
    print(f"    Found {len(devices)} audio devices")
    
    # Find input devices
    input_devices = [d for d in devices if d['max_input_channels'] > 0]
    print(f"    Input devices: {len(input_devices)}")
    
    if input_devices:
        default_input = sd.query_devices(kind='input')
        print(f"    ✓ Default input: {default_input['name']}")
    else:
        print(f"    ⚠ WARNING: No input devices found!")
        
except Exception as e:
    print(f"    ❌ Error checking audio: {e}")

# Step 4: Load configuration
print("\n[4] Checking configuration...")
try:
    from utils.helpers import load_config
    config = load_config()
    print("    ✓ Config loaded")
    
    # Check Porcupine config
    daemon_config = config.get('interfaces', {}).get('daemon', {})
    porcupine_access_key = daemon_config.get('porcupine_access_key')
    porcupine_keyword = daemon_config.get('porcupine_keyword', 'jarvis')
    porcupine_keyword_path = daemon_config.get('porcupine_keyword_path')
    
    print(f"    Keyword: {porcupine_keyword}")
    
    if porcupine_access_key:
        print(f"    Access Key: {porcupine_access_key[:20]}... (loaded from config)")
    else:
        print(f"    Access Key: NOT SET in config")
    
    if porcupine_keyword_path:
        keyword_path = Path(porcupine_keyword_path)
        if not keyword_path.is_absolute():
            keyword_path = Path(__file__).parent.parent / keyword_path
        
        if keyword_path.exists():
            print(f"    ✓ Custom keyword file: {keyword_path}")
        else:
            print(f"    ❌ Custom keyword file NOT FOUND: {keyword_path}")
    
except Exception as e:
    print(f"    ❌ Error loading config: {e}")
    import traceback
    traceback.print_exc()

# Step 5: Test Porcupine initialization with different approaches
print("\n[5] Testing Porcupine initialization...")

# Test 1: Try with built-in keyword WITHOUT access key (old version)
print("\n    Test 1: Built-in keyword without access key (Porcupine v1.x)")
try:
    import pvporcupine
    porcupine = pvporcupine.create(keywords=["jarvis"])
    print("    ✓ SUCCESS: Porcupine v1.x style works (no access key needed)")
    porcupine.delete()
except TypeError as e:
    if "access_key" in str(e):
        print(f"    ❌ FAILED: Requires access_key (Porcupine v2.x+)")
        print(f"       Error: {e}")
    else:
        print(f"    ❌ FAILED: {e}")
except Exception as e:
    print(f"    ❌ FAILED: {e}")

# Test 2: Try with access key from config
print("\n    Test 2: Built-in keyword WITH access key from config")
try:
    from utils.helpers import load_config
    config = load_config()
    daemon_config = config.get('interfaces', {}).get('daemon', {})
    access_key = daemon_config.get('porcupine_access_key')
    
    if access_key:
        import pvporcupine
        porcupine = pvporcupine.create(
            access_key=access_key,
            keywords=["jarvis"]
        )
        print("    ✓ SUCCESS: Works with config access key")
        porcupine.delete()
    else:
        print("    ⚠ SKIPPED: No access key in config")
        
except Exception as e:
    print(f"    ❌ FAILED: {e}")
    print(f"       Full error details:")
    import traceback
    traceback.print_exc()

# Test 3: Check if access key is valid format
print("\n    Test 3: Validating access key format")
try:
    from utils.helpers import load_config
    config = load_config()
    daemon_config = config.get('interfaces', {}).get('daemon', {})
    access_key = daemon_config.get('porcupine_access_key')
    
    if access_key:
        # Check if it looks like a valid key
        if len(access_key) < 10:
            print(f"    ⚠ WARNING: Access key seems too short ({len(access_key)} chars)")
        elif access_key.startswith("${"):
            print(f"    ❌ ERROR: Access key not substituted from environment!")
            print(f"       Current value: {access_key}")
            print(f"       This means environment variable substitution failed.")
            print(f"\n       Solutions:")
            print(f"       1. Replace ${PORCUPINE_ACCESS_KEY} directly in config.yaml")
            print(f"       2. Or create a .env file with PORCUPINE_ACCESS_KEY=your_key")
        else:
            print(f"    ✓ Access key format looks valid ({len(access_key)} chars)")
    else:
        print("    ⚠ No access key found in config")
        
except Exception as e:
    print(f"    ❌ Error: {e}")

# Step 6: Test custom keyword file
print("\n[6] Testing custom keyword file (kenzai.ppn)...")
try:
    from utils.helpers import load_config
    config = load_config()
    daemon_config = config.get('interfaces', {}).get('daemon', {})
    keyword_path = daemon_config.get('porcupine_keyword_path')
    
    if keyword_path:
        keyword_path = Path(keyword_path)
        if not keyword_path.is_absolute():
            keyword_path = Path(__file__).parent.parent / keyword_path
        
        if keyword_path.exists():
            print(f"    ✓ Custom keyword file exists: {keyword_path}")
            print(f"    File size: {keyword_path.stat().st_size} bytes")
            
            # Try to use it
            access_key = daemon_config.get('porcupine_access_key')
            if access_key and not access_key.startswith("${"):
                try:
                    import pvporcupine
                    porcupine = pvporcupine.create(
                        access_key=access_key,
                        keyword_paths=[str(keyword_path)]
                    )
                    print("    ✓ SUCCESS: Custom keyword works!")
                    porcupine.delete()
                except Exception as e:
                    print(f"    ❌ FAILED to load custom keyword: {e}")
            else:
                print("    ⚠ Cannot test: No valid access key")
        else:
            print(f"    ❌ Custom keyword file NOT FOUND: {keyword_path}")
    else:
        print("    ⚠ No custom keyword path configured")
        
except Exception as e:
    print(f"    ❌ Error: {e}")

# Summary
print("\n" + "=" * 70)
print("DIAGNOSIS SUMMARY")
print("=" * 70)

print("\nMost likely issues:")
print("1. Access key not properly substituted (still shows ${PORCUPINE_ACCESS_KEY})")
print("2. Access key invalid or expired")
print("3. Wrong Porcupine version installed")

print("\nRecommended solutions:")
print("1. Edit config.yaml and replace the placeholder directly:")
print("   porcupine_access_key: \"YOUR_ACTUAL_KEY_HERE\"")
print("\n2. Or create .env file:")
print("   echo PORCUPINE_ACCESS_KEY=your_key_here > .env")
print("\n3. Get new key from: https://console.picovoice.ai/")

print("\n" + "=" * 70)