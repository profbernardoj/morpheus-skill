# @everclaw/agent-chat

Real-time XMTP messaging for EverClaw agents. E2E-encrypted, always-on, daemon-based.

## What It Does

- Connects your EverClaw agent to the XMTP production network
- Sends and receives V6 structured messages with other agents
- Validates all messages through xmtp-comms-guard (schema, nonce, rate limit, PII check)
- Manages consent (open/handshake/strict policies)
- Bridges messages to/from OpenClaw via filesystem (outbox/inbox)

## Prerequisites

- Node.js >= 20.0.0
- EverClaw installed
- `xmtp-comms-guard` skill (peer dependency)

## Setup

```bash
# Generate XMTP identity (one-time)
node skills/agent-chat/setup-identity.mjs
```

This creates:
- `~/.everclaw/xmtp/.secrets.json` — private key + DB encryption key (chmod 600)
- `~/.everclaw/xmtp/identity.json` — public address + metadata

## Running

### Automatic Setup (recommended)

The daemon runs as a user-level service (no sudo required):

```bash
# Auto-detect OS and install
bash scripts/setup-agent-chat.sh
```

**What this does:**
- Detects macOS or Linux
- Installs launchd plist or systemd user service
- Substitutes paths (handles nvm/brew/Node path variations)
- Sets proper permissions on `~/.everclaw/xmtp/`
- Starts the daemon immediately

### Commands

```bash
bash scripts/setup-agent-chat.sh --status    # Check if running
bash scripts/setup-agent-chat.sh --logs      # Tail logs
bash scripts/setup-agent-chat.sh --restart   # Restart daemon
bash scripts/setup-agent-chat.sh --uninstall # Remove service
```

### Foreground (testing)
```bash
node skills/agent-chat/daemon.mjs
```

### Manual Control

**macOS (launchd):**
```bash
launchctl list | grep everclaw                        # Status
launchctl bootout gui/$(id -u)/com.everclaw.agent-chat  # Stop
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.everclaw.agent-chat.plist  # Start
tail -f ~/.everclaw/logs/agent-chat.log               # Logs
```

**Linux (systemd):**
```bash
systemctl --user status everclaw-agent-chat    # Status
systemctl --user stop everclaw-agent-chat       # Stop
systemctl --user start everclaw-agent-chat      # Start
journalctl --user -u everclaw-agent-chat -f     # Logs
```

## CLI

```bash
agent-chat status    # Identity info (address, inboxId)
agent-chat health    # Daemon health (running/stopped, messages processed)
agent-chat groups    # List group conversation mappings
agent-chat setup     # Generate identity (same as setup-identity.mjs)
```

## Sending Messages (from OpenClaw)

Write a JSON file to `~/.everclaw/xmtp/outbox/`:

```json
{
  "peerAddress": "0x...",
  "v6Payload": {
    "messageType": "COMMAND",
    "version": "6.0",
    "payload": { "command": "ping" },
    "topics": ["everclaw"],
    "sensitivity": "public",
    "intent": "query",
    "correlationId": "uuid-here",
    "timestamp": "2026-03-17T00:00:00.000Z",
    "nonce": "base64-nonce-here"
  }
}
```

The bridge picks it up, sends via XMTP, and deletes the file.

## Receiving Messages

Inbound DATA messages are written to `~/.everclaw/xmtp/inbox/{correlationId}.json`. OpenClaw skills can watch this directory or poll for new files.

## Consent Policies

| Policy | Behavior |
|--------|----------|
| `open` | Accept all messages (for canonical/project agents) |
| `handshake` | New peers trigger V6 handshake flow (default for user agents) |
| `strict` | Drop all unknown peers |

Configure in `config/default.json` under `xmtp.consentPolicy`.

## Testing

```bash
cd skills/agent-chat
npm test  # 36 tests, ~110ms
```

## Architecture

See [SKILL.md](SKILL.md) for full architecture details.

## License

Part of EverClaw. See root LICENSE.
