# XMTP V6 Threat Model

## Adversary Classes

### 1. Malicious External Agent
- **Attack:** Crafted messages, schema abuse, topic escalation
- **Mitigation:** Zod schema validation, strict topic enum, sensitivity ordering, peer registry check
- **Fail mode:** Message rejected, generic error returned, salted hash logged

### 2. Compromised Internal Agent
- **Attack:** Bypass middleware, direct @xmtp/client usage
- **Mitigation:** ESLint rule + SkillGuard scan at build time (convention-based, not runtime)
- **Limitation:** Cannot prevent runtime bypass if agent is fully compromised
- **Honest disclosure:** Enforcement is build-time gates, not runtime interception

### 3. Replay Attack
- **Attack:** Resend valid captured messages
- **Mitigation:** LRU nonce cache (90s TTL, 10K max entries), base64-encoded 32-byte nonce requirement
- **Fail mode:** REPLAY_DETECTED error, blocked and logged

### 4. Host Compromise
- **Attack:** Access to Bagman DB, key material
- **Mitigation:** SQLCipher encryption, HMAC-SHA256 hash chain (Bagman-managed secret), fail-closed on integrity failure
- **Limitation:** If attacker has root + Bagman key, full compromise is possible

### 5. Data Exfiltration
- **Attack:** Sensitive data in message payloads
- **Mitigation:** PII Guard scan, trust context rules (profile-based topic + sensitivity limits)
- **Fail mode:** PII_DETECTED or TRUST_EXCEEDED, message blocked

### 6. Introduction Chain Poisoning
- **Attack:** Trusted peer introduces malicious agent
- **Mitigation:** Introduction chain tracking, cascading Three-Shift review on introducer revocation

## Design Principles
- All checks are deterministic and binary (pass/fail)
- No LLM, no probabilistic classification in enforcement path
- External errors are always generic ("Message could not be delivered.")
- Internal audit log uses HMAC-SHA256 hash chain with json-stable-stringify
- Blocked message hashes are salted and truncated (16 hex chars) to prevent fingerprinting
