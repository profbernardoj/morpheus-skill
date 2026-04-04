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
- **Version:** 0.20.0 (updated 2026-04-03)
- **Models:**
  - `gemma4-26b-q3` — Gemma 4 26B MoE (Q3_K_M, 12GB) — primary local fallback, GLM-5 class quality, supports vision
  - `qwen3.5:9b` (6.6GB, Qwen3.5 9B) — lightweight last-resort fallback
- **Auto-start:** launchd `com.ollama.ollama` (KeepAlive)
- **Purpose:** Local fallback — runs on Apple M4 Metal GPU, zero network dependency
- **Note:** Gemma 4 26B MoE is custom GGUF from Unsloth (Q3_K_M quant). Created via Modelfile from `/tmp/gemma4-26b-q3km.gguf`. The official `gemma4:26b` (17GB Q4) OOM kills on 16GB RAM — Q3_K_M (12GB) fits with ~3.5GB headroom.
- **Ollama updated:** 2026-04-03 (0.17.7 → 0.20.0, needed for Gemma 4 support)

## Why Separate?

Skills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.

---

Add whatever helps you do your job. This is your cheat sheet.
