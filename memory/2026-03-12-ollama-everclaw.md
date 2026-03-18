# Session: 2026-03-12 05:50:42 UTC

- **Session Key**: agent:main:main
- **Session ID**: 36418c56-f6d0-4c55-a7fd-2f16f6c11062
- **Source**: webchat

## Conversation Summary

assistant: ✅ New session started · model: venice/claude-opus-4-6
user: Conversation info (untrusted metadata):
```json
{
  "message_id": "1773293437826",
  "sender_id": "+14432859111",
  "sender": "David Johnston",
  "timestamp": "Thu 2026-03-12 00:30 CDT"
}
```

Sender (untrusted metadata):
```json
{
  "label": "David Johnston (+14432859111)",
  "id": "+14432859111",
  "name": "David Johnston"
}
```

/New
assistant: Fresh session, ready to go. What's up?
user: Conversation info (untrusted metadata):
```json
{
  "message_id": "1773293743646",
  "sender_id": "+14432859111",
  "sender": "David Johnston",
  "timestamp": "Thu 2026-03-12 00:35 CDT"
}
```

Sender (untrusted metadata):
```json
{
  "label": "David Johnston (+14432859111)",
  "id": "+14432859111",
  "name": "David Johnston"
}
```

Hey Bernardo,
You added Ollama to our set up and also the model QWEN3.5:9b as the final back up in the fall back sequence.
Here is the context and where you can find more about this work.

• MEMORY.md — Updated fallback chain info, added completion entry, added DIEM monitoring note to open items
• TOOLS.md — Added Ollama section with binary path, server URL, model, and launchd details
• memory/daily/2026-03-11.md — Already logged during Stage 5

Next, I'd like you to generalize this Ollama skill for use in EverClaw.
One difference is instead of picking only QWEN3.5:9b as the model for Ollama to use, it would be best to look at the user's system hardware space and RAM available and determine what size model should be downloaded and used that doesn't exceed the users local resources.

Follow SOP-001 for code development and deployment on this work.
assistant: Got it — generalize the Ollama local fallback into a proper EverClaw feature with hardware-aware model selection. Let me pull the context I need.
assistant: Let me find SOP-001 and the existing Ollama work in the EverClaw repo.
assistant: Good, I can see SOP-001 is a multi-stage development process. Let me examine the EverClaw codebase structure and existing scripts.
assistant: Now let me look at the existing router and how the model fallback chain is configured, plus check what Ollama models exist by size:
assistant: Now let me look at how Ollama is typically set up and what models are available by size:
assistant: Now let me check SOP-001 stages from the daily log to understand the full process:
assistant: Good. Now I have a solid understanding of the codebase and SOP-001. Let me build the plan. SOP-001 is a staged approach: Planning → Coding → Testing → Review → Deployment.

Here's the plan:

---

## SOP-001 Stage 1: Planning & Design

### Problem Statement

EverClaw has no local inference fallback. When Morpheus Gateway, Morpheus P2P, and Venice are all down (like the Mar 11 outage), the agent goes fully offline. We solved this for our setup by hardcoding `ollama/qwen3.5:9b`, but EverClaw users have wildly different hardware — a Raspberry Pi can't run a 9B model, and a 128GB workstation is wasting capacity on it.

### Proposed Solution: `setup-ollama.sh`

A new EverClaw script that:
1. **Detects hardware** — OS, CPU arch, total RAM, available RAM, GPU (Metal/CUDA/ROCm)
2. **Selects the optimal model** — maps available resources to the best Ollama model that fits
3. **Installs Ollama** if not present (or verifies existing install)
4. **Pulls the selected model**
5. **Configures OpenClaw** — adds `ollama` provider to `openclaw.json` and appends it as last fallback
6. **Sets up auto-start** — launchd (macOS) or systemd (Linux)
7. **Tests inference** — sends a quick prompt to verify the model works

### Hardware-to-Model Mapping

Based on Ollama model library sizes and practical RAM requirements (model needs ~1.2x its file size in RAM):

| Available RAM | Recommended Model | File Size | Quality Level |
|---------------|------------------|-----------|---------------|
| < 1.2 GB | `qwen3.5:0.8b` | ~0.9 GB | Minimal — simple Q&A, formatting |
| 1.2–3.2 GB | `qwen3.5:2b` | ~2.5 GB | Basic — general tasks, light coding |
| 3.2–4 GB | `qwen3.5:4b` | ~3.1 GB | Good — coding, summarization |
| 4–20 GB | `qwen3.5:9b` | ~6.1 GB | Strong — coding, analysis, most tasks |
| 20–27 GB | `qwen3.5:27b` | ~16.2 GB | Excellent — near-frontier quality |
| 27+ GB | `qwen3.5:35b` | ~22.2 GB | Frontier — matches cloud models |

> **Note:** Sizes verified against Ollama registry (2026-03-12). Original plan assumed 1.5b/14b/32b/72b existed — they don't.

**Why Qwen3.5 family?** Single model family = consistent behavior across sizes, Apache 2.0 license, strong multilingual support, good tool use. Users on the same family just get better/worse quality based on hardware.

### GPU Detection

- **macOS (Metal)**: All Apple Silicon has unified memory — GPU shares system RAM. Detect via `sysctl hw.memsize`.
- **Linux (NVIDIA)**: Check `nvidia-smi` for VRAM. Use VRAM for model sizing (faster than CPU).
- **Linux (AMD ROCm)**: Check `rocm-smi` for VRAM.
- **CPU-only**: Fall back to system RAM. Ollama handles CPU inference transparently.

### Safety Rules

- **Never exceed 70% of total RAM** — leaves headroom for OS + other apps
- **Prefer available RAM over total** — if 16GB total but only 3GB free, pick smaller model
- **`--dry-run` by default** — show what would be installed, require `--apply` to execute
- **Skip if Ollama already configured** — detect existing `ollama` provider in openclaw.json

### Integration Points

| File | Change |
|------|--------|
| `scripts/setup-ollama.sh` | **New** — hardware detection, model selection, install, configure |
| `scripts/setup.mjs` | **Modified** — add `--with-ollama` flag that calls setup-ollama.sh after main setup |
| `templates/openclaw-config-mac.json` | **Modified** — add ollama provider section (commented out by default) |
| `templates/openclaw-config-linux.json` | **Modified** — add ollama provider section (commented out by default) |
| `SKILL.md` | **Modified** — document the local fallback feature |

### CLI Interface

```bash
# Dry run (default) — show hardware, recommended model, what would change
bash scripts/setup-ollama.sh

# Apply — install Ollama + pull model + configure OpenClaw
bash scripts/setup-ollama.sh --apply

# Force specific model (override auto-detection)
bash scripts/setup-ollama.sh --model qwen3.5:27b --apply

# Skip auto-start setup
bash scripts/setup-ollama.sh --apply --no-service

# Check status of existing Ollama setup
bash scripts/setup-ollama.sh --status
```

### Dependencies

| Dependency | License | Required? |
|------------|---------|-----------|
| Ollama | MIT ✅ | Installed by the script |
| curl | MIT | Already required by EverClaw |
| jq | MIT | Already used in balance.sh |

### Risk Assessment

- **Low risk** — this is additive, doesn't modify existing inference paths
- **No network dependency** — once installed, works fully offline (the whole point)
- **Reversible** — `--uninstall` flag removes Ollama provider from openclaw.json
- **Safe defaults** — dry-run by default, conservative RAM thresholds

---

**Awaiting approval to proceed to Stage 2 (Coding).**

Should I start building it?
user: System: [2026-03-12 00:39:33 CDT] Exec failed (lucky-em, signal SIGTERM) :: /Users/bernardo/.openclaw/workspace/memory/projects/everclaw /Users/bernardo/.openclaw/workspace/everclaw /Users/bernardo/.openclaw/workspace/everclaw/everclaw /Users/bernardo/.op…

Conversation info (untrusted metadata):
```json
{
  "message_id": "1773294106072",
  "sender_id": "+14432859111",
  "sender": "David Johnston",
  "timestamp": "Thu 2026-03-12 00:41 CDT"
}
```

Sender (untrusted metadata):
```json
{
  "label": "David Johnston (+14432859111)",
  "id": "+14432859111",
  "name": "David Johnston"
}
```

Yes start building it.
