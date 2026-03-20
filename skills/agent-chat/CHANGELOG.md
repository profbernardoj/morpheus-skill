# Changelog

## v0.2.0 (2026-03-20)

Daemon management improvements — zero-sudo setup.

### Added
- `scripts/setup-agent-chat.sh` — automated daemon setup for macOS and Linux
- User-level systemd service (no sudo required)
- Modern `launchctl bootstrap/bootout` for macOS
- Proper log paths (`~/.everclaw/logs/agent-chat.*`)
- Automatic XMTP directory permissions (700) and key file permissions (600)
- Integration with `install-proxy.sh` for one-command setup
- Idempotent setup (safe to re-run)

### Changed
- Updated launchd plist template with proper log paths
- Updated systemd template for user-level service (`default.target`)
- Templates now use `{{EVERCLAW_PATH}}` for log paths

### Fixed
- No more sudo prompts during curl installer
- Correct nvm/brew/Node path detection in setup script

## v0.1.0 (2026-03-17)

Initial release — XMTP real-time messaging for EverClaw.

### Features
- Always-on XMTP daemon with `@xmtp/agent-sdk` v2.3.0
- E2E-encrypted messaging via MLS protocol on XMTP production network
- V6 structured message format with `xmtp-comms-guard` validation
- 3-policy consent system (open/handshake/strict)
- Filesystem bridge (outbox/inbox) for OpenClaw integration
- Two-tier identity model (28 flavor canonical + per-user wallets)
- launchd (macOS) and systemd (Linux) service templates
- CLI for status, health, groups, and identity setup
- Health file monitoring for OpenClaw heartbeat integration

### Security
- Local key storage with chmod 600 permissions
- Path traversal protection on inbox writes (correlationId sanitization)
- SHA-256 derived DB encryption key
- Runtime wallet key length validation
- Post-setup PII sanity check on source files
- 36-test suite including adversarial security tests

### Architecture Decisions
- Separate daemon process (not in-process with OpenClaw)
- Filesystem IPC over HTTP API (simpler, more reliable for v1)
- Agent.createFromEnv() with CWD save/restore for DB path
- Comms-guard singleton (created once at module level)
- Consent middleware runs before comms-guard in chain
- Fee stub (XMTP production network currently free)

### Known Limitations
- HANDSHAKE/RESPONSE/BYE/INTRODUCTION message types not yet handled (Phase D)
- CLI send command is a stub
- OpenClaw skill dispatch from COMMAND messages is a stub
- Health messagesProcessed counter is hardcoded 0
- Plain text messages skip comms-guard (no rate limiting)
- Key storage is local only (Phase 2: 1Password migration)
