# Ollama Local Fallback

Ollama provides offline, local inference as EverClaw's last-resort fallback tier. When all upstream providers fail, your agent still works.

## Overview

| Aspect | Details |
|--------|---------|
| **Purpose** | Offline fallback, last resort |
| **Models** | Qwen3.5 family (0.8B-72B) |
| **Hardware** | Runs on CPU, GPU, or Apple Metal |
| **Cost** | Free (uses your hardware) |
| **Latency** | Higher than cloud (depends on hardware) |

---

## Installation

### Automated Setup

```bash
node skills/everclaw/scripts/setup-ollama.sh
```

The script:
1. Detects your OS (macOS, Linux)
2. Checks available RAM and GPU
3. Selects the optimal Qwen3.5 model
4. Installs Ollama
5. Pulls the model
6. Configures OpenClaw fallback

### Manual Installation

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull a model
ollama pull qwen3.5:9b

# Verify
ollama list
```

---

## Hardware Requirements

The setup script auto-selects based on your hardware:

| Model | Parameters | RAM Required | Disk | Best For |
|-------|------------|--------------|------|----------|
| qwen3.5:0.8b | 0.8B | 2 GB | 1 GB | Minimal hardware |
| qwen3.5:2b | 2B | 4 GB | 2 GB | Light tasks |
| qwen3.5:4b | 4B | 6 GB | 3 GB | Balanced |
| qwen3.5:9b | 9B | 8 GB | 6 GB | **Recommended** |
| qwen3.5:27b | 27B | 16 GB | 17 GB | High quality |
| qwen3.5:72b | 72B | 48 GB | 43 GB | Best quality |

### Model Selection Logic

```bash
# The script uses this logic:
if RAM >= 48GB; then
  MODEL=qwen3.5:72b
elif RAM >= 16GB; then
  MODEL=qwen3.5:27b
elif RAM >= 8GB; then
  MODEL=qwen3.5:9b    # Most common
elif RAM >= 6GB; then
  MODEL=qwen3.5:4b
elif RAM >= 4GB; then
  MODEL=qwen3.5:2b
else
  MODEL=qwen3.5:0.8b
fi
```

---

## GPU Acceleration

### Apple Silicon (macOS)

Ollama automatically uses Apple Metal GPU acceleration. No configuration needed.

```bash
# Verify Metal is active
ollama run qwen3.5:9b "Hello"
# Look for "metal" in the output
```

### NVIDIA GPU (Linux)

```bash
# Check CUDA availability
nvidia-smi

# Ollama auto-detects and uses CUDA
# If not working, set:
export CUDA_VISIBLE_DEVICES=0
```

### AMD GPU (Linux)

```bash
# ROCm support
export HSA_OVERRIDE_GFX_VERSION=10.3.0
```

---

## Configuration

### OpenClaw Provider

Add to `~/.openclaw/openclaw.json`:

```json
{
  "providers": {
    "ollama": {
      "type": "openai-compatible",
      "baseURL": "http://127.0.0.1:11434/v1",
      "apiKey": "ollama"
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "fallbacks": ["ollama/qwen3.5:9b"]
      }
    }
  }
}
```

### Ollama Server

Ollama runs as a background service:

```bash
# Start
ollama serve

# Check status
curl http://127.0.0.1:11434/api/tags

# Stop
pkill ollama
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_HOST` | `127.0.0.1:11434` | Server bind address |
| `OLLAMA_MODELS` | `~/.ollama/models` | Model storage path |
| `OLLAMA_KEEP_ALIVE` | `5m` | Keep model loaded duration |

---

## Usage

### Direct API Calls

```bash
curl http://127.0.0.1:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3.5:9b",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": false
  }'
```

### Via OpenClaw

When configured as fallback, OpenClaw automatically routes to Ollama when upstream providers fail.

### Model Management

```bash
# List installed models
ollama list

# Pull a new model
ollama pull qwen3.5:27b

# Remove a model
ollama rm qwen3.5:0.8b

# Show model info
ollama show qwen3.5:9b
```

---

## Performance

### Typical Latency

| Hardware | Model | Tokens/sec | First Token |
|----------|-------|------------|-------------|
| M4 Mac mini | qwen3.5:9b | 35-50 | 0.5s |
| M4 Mac mini | qwen3.5:27b | 10-15 | 1.5s |
| RTX 4090 | qwen3.5:9b | 80-100 | 0.2s |
| CPU only | qwen3.5:9b | 3-5 | 2s |

### Optimization Tips

1. **Use 9B model** — Best balance of quality and speed on 16GB Mac
2. **Keep model loaded** — Set `OLLAMA_KEEP_ALIVE=30m`
3. **Batch requests** — Multiple requests share the loaded model
4. **Use streaming** — Get first token faster with `"stream": true`

---

## Auto-Start (macOS)

Ollama includes a launchd service:

```bash
# Check status
launchctl list | grep ollama

# Start
launchctl kickstart gui/$(id -u)/com.ollama.ollama

# Stop
launchctl stop com.ollama.ollama
```

### Custom LaunchAgent

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.ollama.ollama</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/ollama</string>
    <string>serve</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
```

Save to `~/Library/LaunchAgents/com.ollama.ollama.plist`.

---

## Troubleshooting

### "Ollama not found"

Install Ollama:
```bash
curl -fsSL https://ollama.com/install.sh | sh
```

### "Model not found"

Pull the model:
```bash
ollama pull qwen3.5:9b
```

### "Out of memory"

Use a smaller model:
```bash
ollama pull qwen3.5:4b
ollama rm qwen3.5:9b
```

### Slow responses

1. Check if GPU is being used:
   ```bash
   ollama run qwen3.5:9b "Test"
   ```
2. If running on CPU, switch to a smaller model
3. Reduce context length in requests

---

## Next Steps

- [Fallback Chain](fallback.md) — How Ollama fits into the fallback system
- [Monitoring](../operations/monitoring.md) — Health checks for all providers