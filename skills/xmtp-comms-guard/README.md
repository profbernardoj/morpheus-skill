# xmtp-comms-guard v6.0

Deterministic sovereign agent-to-agent communication for OpenClaw/EverClaw.

**All agents MUST use `createGuardedXmtpClient`**. Raw @xmtp/client imports are blocked by ESLint + SkillGuard.

## Quick Start
```bash
clawhub install xmtp-comms-guard
```

## Usage
```ts
import { createGuardedXmtpClient } from "xmtp-comms-guard";
const { client, middleware } = await createGuardedXmtpClient(rawClient, userWallet);
```

## Security Pipeline (8 deterministic steps)
1. Size check (64KB max, `Buffer.byteLength`)
2. Schema validation (Zod, version "6.0", strict topics enum)
3. Nonce replay protection (90s LRU cache)
4. Peer authentication (Bagman registry)
5. Rate limiting (10 msg/min per peer)
6. PII scanning (via pii-guard)
7. Prompt injection detection (via prompt-guard)
8. Trust context enforcement (profile-based topic + sensitivity rules)

## CLI
```bash
xmtp-guard trust-list
xmtp-guard audit <peer-address>
xmtp-guard revoke <address> [reason]
xmtp-guard rotate-key <address>
xmtp-guard chain-verify
```

See SKILL.md for full integration guide and threat-model.md for adversary analysis.
