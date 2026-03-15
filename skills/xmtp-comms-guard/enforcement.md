# Enforcement Model — V6

## How Middleware Enforcement Works

The `xmtp-comms-guard` middleware is enforced through **convention + build-time gates**, not runtime interception.

### Build-Time Gates
1. **ESLint rule** (`no-restricted-imports`): Blocks direct `@xmtp/client` imports in any TypeScript file
2. **SkillGuard scan**: Detects raw client usage patterns during `npm run scan`

### What This Means
- Any agent that passes `npm run lint` and `npm run scan` is using the guarded client
- A determined attacker with code access CAN bypass this by disabling ESLint or importing raw client
- We do NOT claim runtime interception — this is honestly documented

### Fail-Closed Behaviors
| Condition | Result |
|-----------|--------|
| Bagman unavailable | Noop stub logs warning, storage operations return null/empty |
| Hash chain broken | `createGuardedXmtpClient()` throws, refuses to start |
| SQLCipher not encrypted | `createGuardedXmtpClient()` throws, refuses to start |
| Nonce replay detected | Message blocked, REPLAY_DETECTED logged |
| Unknown topic | Schema validation fails (Zod enum), message rejected |
| Unknown sensitivity | Trust check fails, TRUST_EXCEEDED |
| Message > 64KB | SIZE_EXCEEDED before any other processing |
| Protocol version != "6.0" | Schema validation fails (Zod literal), message rejected |
| Peer not in registry | UNAUTHORIZED |
| Peer blocked | BLOCKED with reason |

### External Error Responses
All blocked messages return: `"Message could not be delivered."`
No internal error codes, no stack traces, no policy details leak to the sender.
