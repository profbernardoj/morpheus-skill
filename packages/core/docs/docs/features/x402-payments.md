# x402 Payments

EverClaw includes an x402 payment client for agent-to-agent USDC payments. When a server returns HTTP 402 (Payment Required), your agent automatically signs a USDC payment and retries.

## Overview

| Aspect | Details |
|--------|---------|
| **Protocol** | [x402](https://x402.org) — HTTP-native payments |
| **Currency** | USDC on Base |
| **Signing** | EIP-712 (TransferWithAuthorization) |
| **Budget** | Per-request and daily limits |
| **Facilitator** | Coinbase CDP |

---

## How It Works

```
1. Agent sends request
   └─> Server returns HTTP 402 + PAYMENT-REQUIRED header
2. Agent parses payment requirements
   └─> Checks budget limits
3. Agent signs EIP-712 payment
   └─> Uses wallet from macOS Keychain
4. Agent retries with PAYMENT-SIGNATURE header
   └─> Server verifies via facilitator
5. Facilitator settles USDC transfer
   └─> Server returns resource
```

---

## CLI Usage

```bash
# Make a request to an x402-protected endpoint
node skills/everclaw/scripts/x402-client.mjs GET https://api.example.com/data

# Dry-run: see what would be paid without signing
node skills/everclaw/scripts/x402-client.mjs --dry-run GET https://api.example.com/data

# Set max payment per request
node skills/everclaw/scripts/x402-client.mjs --max-amount 0.50 GET https://api.example.com/data

# POST with body
node skills/everclaw/scripts/x402-client.mjs POST https://api.example.com/task '{"prompt":"hello"}'

# Check daily spending
node skills/everclaw/scripts/x402-client.mjs --budget
```

---

## Programmatic Usage

```javascript
import { makePayableRequest, createX402Client } from './scripts/x402-client.mjs';

// One-shot request
const result = await makePayableRequest("https://api.example.com/data");
// result.paid → true if 402 was handled
// result.amount → "$0.010000" (USDC)
// result.body → response content

// Reusable client with budget limits
const client = createX402Client({
  maxPerRequest: 0.50,  // $0.50 USDC max per request
  dailyLimit: 5.00,     // $5.00 USDC per day
  dryRun: false,
});

const res = await client.get("https://agent-api.example.com/query?q=weather");
const data = await client.post("https://agent-api.example.com/task", { prompt: "hello" });

// Check spending
console.log(client.budget());
// { date: "2026-03-15", spent: "$0.520000", remaining: "$4.480000", limit: "$5.000000", transactions: 3 }
```

---

## Budget Controls

Prevent runaway spending with budget limits:

| Setting | Default | Description |
|---------|---------|-------------|
| `maxPerRequest` | $1.00 | Maximum USDC per request |
| `dailyLimit` | $10.00 | Maximum USDC per day |
| `dryRun` | false | Simulate without signing |

Budget tracking is persisted to `.x402-budget.json` (amounts only, no keys).

---

## Security

### Key Management

- Private key loaded from **macOS Keychain** at runtime
- Key is **never written to disk** as plaintext
- Key is **immediately unset** from environment after signing

### Payment Verification

- Uses **EIP-3009 TransferWithAuthorization** (USDC on Base)
- Signature verified by Coinbase facilitator
- Payments are **irreversible** once settled

### Budget Enforcement

- Per-request limit prevents accidental large payments
- Daily limit caps total exposure
- Dry-run mode for testing without spending

---

## Contract Addresses

| Item | Address |
|------|---------|
| USDC (Base) | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Coinbase Facilitator | `https://api.cdp.coinbase.com/platform/v2/x402` |
| Base Chain ID | `8453` |

---

## Payment Flow Details

1. **Request** — Standard HTTP request to any URL
2. **402 Detection** — Server returns `HTTP 402` with `PAYMENT-REQUIRED` header containing JSON payment requirements
3. **Budget Check** — Verifies amount against limits
4. **EIP-712 Signing** — Signs a `TransferWithAuthorization` for USDC on Base
5. **Retry** — Resends request with `PAYMENT-SIGNATURE` header
6. **Settlement** — Coinbase facilitator verifies and settles
7. **Response** — Server returns the resource

---

## Use Cases

### Agent-to-Agent Payments

Pay other agents for their services:

```javascript
// Discovery via ERC-8004 registry
const agent = await discoverAgent(42);
const endpoint = agent.services.find(s => s.name === "A2A")?.endpoint;

// Pay for the service
if (agent.x402Support && endpoint) {
  const result = await makePayableRequest(endpoint, {
    method: "POST",
    body: JSON.stringify({ task: "Analyze sentiment" }),
    maxAmount: 0.50,
  });
}
```

### API Access

Pay for premium API access:

```javascript
const result = await makePayableRequest("https://api.premium-service.com/data", {
  maxAmount: 0.25,
});
```

### Content Access

Pay for gated content:

```javascript
const article = await makePayableRequest("https://publisher.com/article/123");
```

---

## Troubleshooting

### "Insufficient USDC balance"

Check your USDC balance on Base:
```bash
node skills/everclaw/scripts/everclaw-wallet.mjs balance
```

### "Daily budget exceeded"

Check your spending:
```bash
node skills/everclaw/scripts/x402-client.mjs --budget
```

### "Payment rejected"

The server's requirements may exceed your limits. Increase `maxPerRequest` or contact the provider.

---

## Next Steps

- [Wallet Management](wallet.md) — USDC balance, swaps
- [ERC-8004 Registry](erc8004-registry.md) — Agent discovery