# KenzAI Assistant – Overview and Improvement Guide

This document describes the **Assistant** part of KenzAI and where to add or improve features.

---

## 1. High-level layout

```
Assistant/
├── kenzai.py              # CLI entry (interactive loop, hotkey)
├── launcher.py            # Startup: shadow animation, greeting TTS, then starts GUI
├── unified_kenzai_daemon.py  # Tray daemon: wake word, VAD, voice commands, speaks responses
├── core/
│   ├── assistant.py       # Main orchestrator: process_query, memory, Ollama
│   ├── model_manager.py   # Model selection (code/general/reasoning)
│   ├── conversation.py   # Chat turns, message list
│   ├── personality.py     # System prompt, response formatting
│   ├── topic_manager.py   # Long-term memory (topics, search)
│   └── greeting_system.py # Time-based greetings
├── interfaces/
│   ├── gui.py             # Tk GUI: Jarvis-style line / circle, text input, TTS
│   ├── vad_voice.py       # VAD + Vosk STT + pyttsx3 TTS (daemon voice)
│   ├── voice.py           # Fallback voice (single-command STT + TTS)
│   └── porcupine_wake.py  # Wake word (e.g. "KenzAI")
└── utils/
    ├── tts_helper.py      # TTS with on_start/on_end (for GUI animation)
    ├── helpers.py         # Config, preferences, paths
    ├── logger.py
    └── windows_integration.py
```

---

## 2. What was added / fixed

### 2.1 Jarvis-style line GUI

- **Default appearance** is now **line**: a black bar with vertical “audio” segments.
- **Idle**: bars do a subtle breathing animation.
- **Processing** (thinking): bars animate with a blue wave.
- **Speaking**: bars animate with a brighter cyan wave (when TTS is playing a response).
- Default size for line mode is a thin bar (e.g. 520×56); circle keeps the previous behavior.
- Right-click → **Appearance** → Circle / Line.

### 2.2 Assistant speaks responses

- **From GUI**: Right-click → **Show text input**, type a question, press Enter. The assistant answers and **speaks** the response (pyttsx3). The line switches to “speaking” animation during TTS.
- **From daemon**: When you use voice (wake word + VAD), the daemon already called `voice.speak(response)` in `_handle_command`. So the assistant **does** speak in daemon mode; ensure `interfaces.voice.enabled` is true and pyttsx3 (and Vosk for STT) are installed.
- **TTS helper** (`utils/tts_helper.py`): shared TTS with `on_start` / `on_end` callbacks so the GUI can show “speaking” and animate the line.

---

## 3. Where to add or improve things

### 3.1 GUI

| Area | Suggestion |
|------|------------|
| **Daemon + GUI** | When the daemon speaks a response (voice command), the GUI line does not switch to “speaking” (no shared state). You could add a small “speaking” bus (e.g. a queue or callback the daemon pushes to and the GUI reads on a timer) so the line animates during daemon TTS too. |
| **Line look** | Bar count, colors, and speed are in `gui.py` (`_bar_count`, `_draw_jarvis_line`). You could make these configurable in `config.yaml` or user preferences. |
| **Input** | Text input is optional (Show text input). You could add a “push-to-talk” button that uses the same VAD/STT as the daemon for voice queries from the GUI. |
| **Resize** | For line mode, you could enforce a max height (e.g. 80px) so the window stays bar-like. |

### 3.2 Speech (TTS / STT)

| Area | Suggestion |
|------|------------|
| **TTS engine** | Currently pyttsx3 (offline). You could add a second engine (e.g. gTTS, or a local Piper/Coqui) and choose via config. |
| **Voice selection** | `config.interfaces.voice.tts_voice` and `tts.voice_id` exist; you could expose voice list in a settings UI. |
| **Interrupt** | Add “stop speaking” (e.g. hotkey or GUI button) that calls `tts_engine.stop()` and clears the queue. |
| **Long responses** | For very long answers, consider chunking and speaking in segments so the user can interrupt earlier. |

### 3.3 Core assistant

| Area | Suggestion |
|------|------------|
| **Streaming** | `process_query` is all-at-once. Ollama supports streaming; you could stream tokens and (optionally) stream TTS per sentence for a more responsive feel. |
| **Concurrency** | Only one command is processed at a time in the daemon (`_command_lock`). Fine for single user; consider a queue if you add multiple entry points. |
| **Context window** | Conversation length is unbounded; you could trim or summarize old messages to avoid hitting model limits. |
| **Model fallback** | There is already fallback to another model if the selected one is missing; you could add fallback on timeout or errors. |

### 3.4 Memory and personality

| Area | Suggestion |
|------|------------|
| **Topics** | `topic_manager` and `default_topics` in config control long-term memory. You could add a “forget this” command or a UI to inspect/edit memories. |
| **Personality** | `personality.py` holds the system prompt and format. You could add presets (formal, casual, coding-only) in config. |

### 3.5 Launcher and daemon

| Area | Suggestion |
|------|------------|
| **Startup** | Launcher runs shadow animation then greeting TTS then GUI; daemon does its own greeting. You could unify “first run” experience (e.g. one greeting and one place to enable/disable TTS). |
| **Config** | `interfaces.voice.enabled` and `interfaces.gui.enabled` control TTS and GUI; good place to add “speak responses from GUI” and “animate line when daemon speaks” toggles. |

### 3.6 Errors and robustness

| Area | Suggestion |
|------|------------|
| **Ollama down** | Clear message and retry/backoff is already there; you could add a small “Ollama status” indicator in the GUI. |
| **No TTS** | If pyttsx3 is missing or fails, the GUI still works; responses just aren’t spoken. You could show a one-time tip in the GUI when TTS is unavailable. |

---

## 4. Quick reference: “Where does speech happen?”

| Entry point | Speaks greeting? | Speaks response? |
|-------------|-------------------|------------------|
| **Launcher** (`launcher.py`) | Yes (VoiceGreeting) | No (only GUI; now GUI can speak via text input + TTS helper) |
| **Daemon** (`unified_kenzai_daemon.py`) | Yes (voice.speak in wake) | Yes (`voice.speak(response)` in `_handle_command`) |
| **GUI** (text input + Enter) | N/A | Yes (TTSHelper with on_start/on_end → line animation) |
| **CLI** (`kenzai.py` interactive) | No | No (print only) |

---

## 5. Dependencies relevant to assistant

- **Ollama** – LLM (required).
- **pyttsx3** – TTS for greeting (launcher), daemon responses, and GUI responses.
- **Vosk** – Offline STT for daemon voice.
- **webrtcvad / sounddevice / soundfile** – VAD and audio for daemon.
- **pvporcupine** – Wake word (optional).
- **pystray / PIL** – System tray for daemon (optional).
- **tkinter** – GUI (usually with Python).

If something “doesn’t speak,” check: `interfaces.voice.enabled`, pyttsx3 installed, and (for daemon) that the voice interface (VAD or fallback voice) is initialized and used in `_handle_command`.
