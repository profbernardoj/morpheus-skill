# Bootstrap Configuration

## Production Environment Variables

```bash
# Required
TREASURY_HOT_KEY=0x...           # Hot wallet private key (daily limits)
SERVER_SECRET=...                 # Random 32+ bytes for challenge generation
REDIS_URL=redis://...             # Redis connection string
X_API_BEARER_TOKEN=...            # X API v2 bearer token

# Optional (defaults shown)
DAILY_ETH_LIMIT=10               # ETH limit per day
DAILY_USDC_LIMIT=5000             # USDC limit per day
```

## Test Environment Variables

```bash
# For testing only
NODE_ENV=test                          # Use Base Sepolia
TEST_DAILY_ETH_LIMIT=0.01              # Low ETH limit for testing
TEST_DAILY_USDC_LIMIT=50               # Low USDC limit for testing
TEST_FINGERPRINT=deadbeef...           # Override fingerprint for parallel tests
MOCK_X_VERIFICATION=true               # Skip X API calls in tests
```

## Contract Addresses

| Network | USDC Address |
|---------|--------------|
| Base Mainnet | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Base Sepolia | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

## Bootstrap Amounts

| Stage | ETH | USDC | Purpose |
|-------|-----|------|---------|
| Initial | 0.0008 | 2.00 | Basic bootstrap |
| X Bonus | - | +1.00 | After X post verification |

## Daily Limits (Production)

- **ETH:** 10 ETH (~2,000 users at 0.0008 ETH each)
- **USDC:** 5,000 USDC (~1,666 users at 3 USDC each)

## Redis Schema

```
bootstrap:daily:eth:YYYY-MM-DD    → wei spent
bootstrap:daily:usdc:YYYY-MM-DD   → micro-USDC spent
bootstrap:challenge:{fingerprint} → { challenge, timestamp }
bootstrap:used:{wallet}            → { fingerprint, claimedAt }
bootstrap:fingerprint:{hash}       → { wallet, claimedAt }
bootstrap:failed:{wallet}          → { ethTx, usdcAmount, error }
claim:{code}                       → wallet address
tweet:{id}                         → { wallet, code, verifiedAt }
```

## Security Notes

1. **Hot wallet has daily limits** — Even if compromised, losses are bounded
2. **Treasury Safe is recovery** — Hot wallet can be topped up from 3/5 multisig
3. **Fingerprint prevents Sybil** — Same device = one claim
4. **PoW prevents automation** — 5-10 seconds per challenge
5. **X verification is optional** — Bonus only, not required for basic function