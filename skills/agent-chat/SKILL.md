# agent-chat

XMTP real-time agent-to-agent and user-to-agent messaging for EverClaw.

## Overview

Always-on daemon providing E2E-encrypted messaging via XMTP's MLS protocol. Runs as a separate process managed by launchd (macOS) or systemd (Linux), communicating with OpenClaw through a filesystem bridge.

## Version

0.2.0

## Dependencies

- `@xmtp/agent-sdk` ^2.3.0
- `xmtp-comms-guard` ^6.0.0 (peer)
- Node.js >= 20.0.0

## Quick Start

```bash
# 1. Generate XMTP identity
node skills/agent-chat/setup-identity.mjs

# 2. Start daemon (foreground for testing)
node skills/agent-chat/daemon.mjs

# 3. Check status
node skills/agent-chat/cli.mjs status
```

## Architecture

- **Process model**: Separate always-on daemon (not in-process with OpenClaw)
- **IPC**: Filesystem bridge (~/.everclaw/xmtp/outbox/ → inbox/)
- **Message format**: V6 JSON inside XMTP text content type
- **Consent**: Configurable per-agent (open/handshake/strict)
- **Middleware chain**: Consent → CommsGuard V6 → Router

## Identity Model

Two-tier:
- **28 flavor canonical wallets** — project-controlled, `open` consent
- **Per-user wallets** — generated at install, `handshake` consent

XMTP wallet is messaging-only — no funds. Separate from MOR staking wallet.

## Files

| File | Purpose |
|------|---------|
| `daemon.mjs` | Entry point for launchd/systemd |
| `cli.mjs` | CLI commands (status, health, groups, setup) |
| `setup-identity.mjs` | One-time key generation |
| `src/agent.mjs` | Agent creation + middleware wiring |
| `src/identity.mjs` | Secret/identity loading |
| `src/consent.mjs` | 3-policy consent gate |
| `src/router.mjs` | Message routing (COMMAND/DATA dispatch) |
| `src/bridge.mjs` | Filesystem outbox watcher |
| `src/health.mjs` | Health file writer |
| `src/groups.mjs` | Group conversation mapping |
| `src/payer.mjs` | Fee stub (network currently free) |
| `src/index.mjs` | Public API re-exports |

## Daemon Management

The agent-chat daemon runs as a user-level service (no sudo required):

- **macOS**: launchd (`~/Library/LaunchAgents/com.everclaw.agent-chat.plist`)
- **Linux**: systemd user service (`~/.config/systemd/user/everclaw-agent-chat.service`)

### Setup

```bash
# Auto-detect OS and install daemon
bash scripts/setup-agent-chat.sh

# Or specify OS explicitly
bash scripts/setup-agent-chat.sh --macos
bash scripts/setup-agent-chat.sh --linux
```

### Commands

```bash
# Check daemon status
bash scripts/setup-agent-chat.sh --status

# View daemon logs
bash scripts/setup-agent-chat.sh --logs

# Restart daemon
bash scripts/setup-agent-chat.sh --restart

# Uninstall daemon
bash scripts/setup-agent-chat.sh --uninstall

# Preview without changes
bash scripts/setup-agent-chat.sh --dry-run

# Help
bash scripts/setup-agent-chat.sh --help
```

### Manual Control

**macOS (launchd):**
```bash
# Status
launchctl list | grep everclaw

# Stop
launchctl bootout gui/$(id -u)/com.everclaw.agent-chat

# Start
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.everclaw.agent-chat.plist

# Logs
tail -f ~/.everclaw/logs/agent-chat.log
```

**Linux (systemd):**
```bash
# Status
systemctl --user status everclaw-agent-chat

# Stop
systemctl --user stop everclaw-agent-chat

# Start
systemctl --user start everclaw-agent-chat

# Logs
journalctl --user -u everclaw-agent-chat -f
```

### Logs and Health

- **Logs**: `~/.everclaw/logs/agent-chat.log` (macOS) or `journalctl --user -u everclaw-agent-chat` (Linux)
- **Health file**: `~/.everclaw/xmtp/health.json`
- **Identity**: `~/.everclaw/xmtp/` (chmod 700)

### First-Time Setup

Before starting the daemon, generate your XMTP identity:

```bash
node skills/agent-chat/setup-identity.mjs
```

This creates the messaging-only wallet in `~/.everclaw/xmtp/` (separate from your MOR staking wallet).

## Security

- Keys stored in `~/.everclaw/xmtp/.secrets.json` (chmod 600)
- Path traversal protection on inbox writes (correlationId sanitized)
- CommsGuard V6 validates all structured messages (schema, nonce, rate limit, PII)
- Plain text messages bypass comms-guard (acceptable for agent-to-agent v1)
