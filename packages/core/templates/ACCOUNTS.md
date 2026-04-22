# ACCOUNTS.md - Service Accounts & Access

*Tracks which services have dedicated accounts for the agent vs. your personal accounts.*

---

## Guiding Principles

- **Isolation:** Agent should have dedicated accounts separate from your personal credentials
- **Privacy:** Minimize exposure of your identity in public registries
- **Security:** Dedicated accounts limit blast radius if compromised

---

## Account Status

### ✅ Configured (Dedicated)

| Service | Account | Notes |
|---------|---------|-------|
| [SERVICE_1] | [ACCOUNT_ID] | [NOTES] |
| [SERVICE_2] | [ACCOUNT_ID] | [NOTES] |

### 🔲 Planned / Pending

| Service | Purpose | Privacy Considerations | Status |
|---------|---------|------------------------|--------|
| [SERVICE] | [PURPOSE] | [CONSIDERATIONS] | [STATUS] |

### ⏸️ Using Personal Accounts (Temporary)

| Service | Notes | Migrate to Dedicated? |
|---------|-------|----------------------|
| [SERVICE] | [NOTES] | [YES/NO] |

---

## Wallet / On-Chain Registration Planning

**Agent Name:** [AGENT_NAME]

**Before registering, decide:**
- [ ] What `description` to use (avoid revealing personal identity)
- [ ] Which `services` endpoints to expose
- [ ] Which wallet to use as `agentWallet` (dedicated wallet, not personal main)
- [ ] What trust models to advertise
- [ ] Whether to verify endpoint domain ownership

**Public vs. Private:**
- Registration metadata may be public
- Reputation and validation records may be public
- Ensure no PII or links back to personal identity

---

## Payment Rails

**x402 (if applicable):**
- Open HTTP-native payment standard for internet payments
- Zero protocol fees (just network gas)
- Zero friction (no signups, no API key management)
- Docs: https://www.x402.org/

---

## Notes

*Add notes about account setup, credentials storage, etc.*

- [NOTE_1]
- [NOTE_2]

---

*Last updated: [DATE]*
