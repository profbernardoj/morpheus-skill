# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## What Goes Here

Things like:

- Camera names and locations
- SSH hosts and aliases
- Preferred voices for TTS
- Speaker/room names
- Device nicknames
- Anything environment-specific

## Examples

```markdown
### Cameras

- living-room → Main area, 180° wide angle
- front-door → Entrance, motion-triggered

### SSH

- home-server → 192.168.1.100, user: admin

### TTS

- Preferred voice: "Nova" (warm, slightly British)
- Default speaker: Kitchen HomePod
```

### Ollama (Local Inference)

- **Binary:** `/Applications/Ollama.app` + CLI at `/opt/homebrew/bin/ollama`
- **Server:** `http://127.0.0.1:11434` (OpenAI-compatible at `/v1/`)
- **Model:** `qwen3.5:9b` (6.6GB, Qwen3.5 9B parameter)
- **Auto-start:** launchd `com.ollama.ollama` (KeepAlive)
- **Purpose:** Last-resort fallback — runs locally on Apple M4 Metal GPU, zero network dependency
- **Installed:** 2026-03-11

## Why Separate?

Skills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.

---

Add whatever helps you do your job. This is your cheat sheet.
