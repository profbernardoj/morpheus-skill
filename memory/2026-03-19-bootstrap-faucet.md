# Session: 2026-03-19 05:43:32 UTC

- **Session Key**: agent:main:main
- **Session ID**: 2ff4366f-b6ec-4815-920c-84047fb0f311
- **Source**: signal

## Conversation Summary

assistant: Now push and deploy:
assistant: Now commit the client fix:
assistant: Now test the deployed v2.0.0:
assistant: **v2.0.0 — All audit fixes LIVE and verified:**

1. ✅ **Health:** v2.0.0, redis + transfers enabled
2. ✅ **Real transfer:** 0.0008 ETH + 2 USDC sent successfully
3. ✅ **Idempotency:** Same wallet returns `already_completed` with existing TX hashes (no double-spend)

**All Grok 4.2 recommendations implemented:**

| Fix | Status |
|-----|--------|
| Claim state machine (PENDING → COMPLETE) | ✅ Deployed |
| Redis writes AFTER transfer | ✅ Deployed |
| Treasury balance pre-check | ✅ Deployed |
| Per-IP rate limiting (5/day) | ✅ Deployed |
| Idempotent responses (return existing TX) | ✅ Tested |
| Explicit gas limits (21k ETH, 100k USDC) | ✅ Deployed |
| Tweet fetch timeout (8s) + retry | ✅ Deployed |
| Dead EIP-712 code removed | ✅ Deployed |
| CRITICAL path logging | ✅ Deployed |
| Pending TTL (15 min) | ✅ Deployed |

Transfer #7 total. Treasury is getting low — you'll want to fund it before your friends test tomorrow.

Want me to run the ecosystem sync for the client-side fix, or save that for the next full release?
user: System: [2026-03-19 00:07:15 CDT] Exec completed (fast-sag, code 0) :: "usdc": "2.00" }, "claimCode": "EVER-31DFBD18D0C1238D-2C2ED269AA539389" } === 3. Idempotency test (same wallet again) === { "status": "already_completed", "ethTx": "0x62c773a64dba…

Conversation info (untrusted metadata):
```json
{
  "message_id": "1773896980994",
  "sender_id": "+14432859111",
  "sender": "David Johnston",
  "timestamp": "Thu 2026-03-19 00:09 CDT"
}
```

Sender (untrusted metadata):
```json
{
  "label": "David Johnston (+14432859111)",
  "id": "+14432859111",
  "name": "David Johnston"
}
```

How much is in the Treasury? I can send more now.
Yes push everything to the ecosystem sync and trigger the Github Docker + Tag.
Also give me the final links and I'll have Grok 4.2 re-run its analysis on the updates.
assistant: **Treasury: 0.0036 ETH + 34 USDC — only 4 bootstraps left.**

Send to: **`0x5FB26ECA8F276d8fF7e9B3B33e61934Fa26AE417`** on **Base mainnet**

Recommended: 0.1 ETH + 500 USDC = ~125 bootstraps for initial testing with friends.

Now ecosystem sync + tag:
assistant: 30/30 synced. Now GitHub release + Docker:
assistant: All done. Here's everything for Grok 4.2 re-review:

---

**Files for Grok 4.2 to audit:**

1. **Server (all fixes):** `https://github.com/DavidAJohnston/everclawkeyapi/blob/main/server.js`
2. **Client (dead code removed):** `https://github.com/EverClaw/EverClaw/blob/main/scripts/bootstrap-client.mjs`
3. **Wallet integration (unchanged):** `https://github.com/EverClaw/EverClaw/blob/main/scripts/everclaw-wallet.mjs`

**Treasury address:** `0x5FB26ECA8F276d8fF7e9B3B33e61934Fa26AE417` (Base mainnet)
**Current balance:** 0.0036 ETH + 34 USDC (4 bootstraps left)

**Deployment status:**
- ✅ API v2.0.0 live at `api.everclaw.xyz`
- ✅ EverClaw v2026.3.26 — 30/30 repos synced
- ✅ GitHub release published
- ✅ 3 Docker CI builds running
user: [media attached: /Users/bernardo/.openclaw/media/inbound/28b8ee8b-8633-4bff-aa2d-c852af7d9712 (text/x-signal-plain) | /Users/bernardo/.openclaw/media/inbound/28b8ee8b-8633-4bff-aa2d-c852af7d9712]
To send an image back, prefer the message tool (media/path/filePath). If you must inline, use MEDIA:https://example.com/image.jpg (spaces ok, quote if needed) or a safe relative path like MEDIA:./image.jpg. Avoid absolute paths (MEDIA:/...) and ~ paths — they are blocked for security. Keep caption in the text body.
System: [2026-03-19 00:10:44 CDT] Exec completed (mild-atl, code 0) :: b876..166f6cc main -> main ✅ vcclaw.org pushed 5f8b876..166f6cc main -> main ✅ windowsclaw.org pushed ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 📊 Sync Summary Total remotes: 30 ✅ Pushed:…

Conversation info (untrusted metadata):
```json
{
  "message_id": "1773897256922",
  "sender_id": "+14432859111",
  "sender": "David Johnston",
  "timestamp": "Thu 2026-03-19 00:14 CDT"
}
```

Sender (untrusted metadata):
```json
{
  "label": "David Johnston (+14432859111)",
  "id": "+14432859111",
  "name": "David Johnston"
}
```

[Signal David Johnston id:+14432859111 +3m Thu 2026-03-19 00:14 CDT] Grok 4.2 needs a bit more information. Please review below what he needs and provide it to me to send to him.

Re-Audit Status: Partial (due to repo access)
Bernardo — great work tackling the original audit items! Unfortunately I cannot perform the full in-depth line-by-line re-audit you asked for right now because:

The everclawkeyapi repo (server.js) is private → both raw.githubusercontent.com and the GitHub blob page return 404.
The EverClaw repo is public, so I could fetch the client files (though they got partially truncated by GitHub’s display).

Here is exactly what my team and I could verify from the public files:
1. bootstrap-client.mjs (Client)
Status: GOOD (but one original MEDIUM issue still open)

Dead EIP-712 code (signBootstrapRequest() function with full domain/types/message/signing logic for Base + Sepolia) is still present and completely unused.
It sits right after solvePoW() and before the keychain section — exactly as flagged in the original audit.
Everything else looks clean and unchanged from the previous “Good” rating:
Fingerprint generation (node-machine-id → macOS ioreg → /etc/machine-id → hostname fallback)
PoW solver (6 leading zeros, 60s timeout)
Local state file handling (~/.everclaw/bootstrap.json)
Keychain fallback logic

Provisional rating (Grok 4.2): Good (would be Excellent once dead code is deleted).

2. everclaw-wallet.mjs (Wallet integration)
Status: EXCELLENT (unchanged)

Exactly as you said — no changes.
cmdSetup() still calls the bootstrap flow at the end.
Keychain storage, viem clients, swap/approve logic all still rock-solid.
Rating: Excellent (both auditors would still agree).

3. server.js
Status: Cannot audit
I have zero visibility into the critical fixes (the HIGH Redis timing issue, treasury pre-check, pending state machine, per-IP rate limiting, tweet verification timeout/retry, etc.).
This is the only file that actually matters for production safety on XMTP/x402/8004 onboarding.
Immediate Next Steps for Bernardo (today — 30 minutes max)
Please

<file name="28b8ee8b-8633-4bff-aa2d-c852af7d9712" mime="text/plain">
Grok 4.2 needs a bit more information. Please review below what he needs and provide it to me to send to him.

Re-Audit Status: Partial (due to repo access)
Bernardo — great work tackling the original audit items! Unfortunately I cannot perform the full in-depth line-by-line re-audit you asked for right now because:

The everclawkeyapi repo (server.js) is private → both raw.githubusercontent.com and the GitHub blob page return 404.
The EverClaw repo is public, so I could fetch the client files (though they got partially truncated by GitHub’s display).

Here is exactly what my team and I could verify from the public files:
1. bootstrap-client.mjs (Client)
Status: GOOD (but one original MEDIUM issue still open)

Dead EIP-712 code (signBootstrapRequest() function with full domain/types/message/signing logic for Base + Sepolia) is still present and completely unused.
It sits right after solvePoW() and before the keychain section — exactly as flagged in the original audit.
Everything else looks clean and unchanged from the previous “Good” rating:
Fingerprint generation (node-machine-id → macOS ioreg → /etc/machine-id → hostname fallback)
PoW solver (6 leading zeros, 60s timeout)
Local state file handling (~/.everclaw/bootstrap.json)
Keychain fallback logic

Provisional rating (Grok 4.2): Good (would be Excellent once dead code is deleted).

2. everclaw-wallet.mjs (Wallet integration)
Status: EXCELLENT (unchanged)

Exactly as you said — no changes.
cmdSetup() still calls the bootstrap flow at the end.
Keychain storage, viem clients, swap/approve logic all still rock-solid.
Rating: Excellent (both auditors would still agree).

3. server.js
Status: Cannot audit
I have zero visibility into the critical fixes (the HIGH Redis timing issue, treasury pre-check, pending state machine, per-IP rate limiting, tweet verification timeout/retry, etc.).
This is the only file that actually matters for production safety on XMTP/x402/8004 onboarding.
Immediate Next Steps for Bernardo (today — 30 minutes max)
Please do one of these (easiest first):
Option A (fastest)
Paste the full current /bootstrap route + surrounding code here in this chat. Specifically include:

The entire app.post('/bootstrap', ...) handler
All Redis keys/operations (pending:, fingerprint:, wallet:, rate:ip:)
Treasury balance pre-check
The viem transfer + waitForTransactionReceipt
Any new pending state machine logic
Per-IP rate limiting and tweet fetch (with timeout/retry)

Just copy-paste ~100-200 lines — I’ll immediately do the full re-audit, give updated ratings, and either give you the green light or tiny patches.
</file>
assistant: Two things:

1. **Grok is seeing stale files** — the dead EIP-712 code WAS removed (commit `dd52309`). Grok's fetching a cached GitHub version. The current line 117 of bootstrap-client.mjs reads: `// EIP-712 signing deferred to v2 — server currently validates via PoW + fingerprint`

2. **server.js is in a private repo** — let me give you the full file to paste to Grok:
assistant: That's the full `server.js` (v2.0.0, 434 lines). Also here's confirmation the EIP-712 code is gone from the client:
assistant: David — paste the full `server.js` output above to Grok. Two corrections for his review:

1. **bootstrap-client.mjs: Dead EIP-712 code IS removed** — commit `dd52309`. The 42-line `signBootstrapRequest()` function is gone, replaced with a single comment. Grok was fetching a stale GitHub cache.

2. **server.js** is the full v2.0.0 with all fixes. Key things for Grok to verify:
   - **Phase 1** (lines 261-309): All pre-checks before chain
   - **Phase 2** (lines 311-317): PENDING state with 15-min TTL
   - **Phase 3** (lines 319-333): Treasury pre-flight balance check
   - **Phase 4** (lines 335-370): On-chain transfer with partial failure handling
   - **Phase 5** (lines 372-389): Redis writes AFTER successful transfer
   - **Per-IP rate limit** (lines 299-304): 5 bootstraps/day per IP
   - **Idempotency** (lines 278-283): Already-completed wallets return existing TX
user: Conversation info (untrusted metadata):
```json
{
  "message_id": "1773897540428",
  "sender_id": "+14432859111",
  "sender": "David Johnston",
  "timestamp": "Thu 2026-03-19 00:19 CDT"
}
```

Sender (untrusted metadata):
```json
{
  "label": "David Johnston (+14432859111)",
  "id": "+14432859111",
  "name": "David Johnston"
}
```

I don't have access to your Mac Mini please copy and past the full (v2.0.0, 434 lines) output here.
assistant: Here's the full server.js v2.0.0 (434 lines) for Grok:

```js
import express from "express";
import { randomBytes, createHash } from "crypto";
import helmet from "helmet";
import cors from "cors";
import { Redis } from "@upstash/redis";
import { createWalletClient, createPublicClient, http, parseEther, parseUnits, formatEther, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

// --- Config ---
const PORT = process.env.PORT || process.env.EVERCLAW_API_PORT || 3000;
const SERVER_SECRET = process.env.SERVER_SECRET || "dev-secret";

// --- Bootstrap Config ---
const DAILY_BOOTSTRAP_LIMIT = parseInt(process.env.DAILY_BOOTSTRAP_LIMIT || "500", 10);
const IP_RATE_LIMIT = 5; // max bootstraps per IP per day
const ETH_PER_BOOTSTRAP = "0.0008";
const USDC_PER_BOOTSTRAP = "2.00";
const PENDING_TTL = 900; // 15 min TTL for pending claims
const COMPLETED_TTL = 60 * 60 * 24 * 90; // 90 days for completed claims

// Min treasury balance to proceed (ETH for transfer + gas buffer)
const MIN_TREASURY_ETH = parseEther("0.002"); // 0.0008 transfer + gas buffer
const MIN_TREASURY_USDC = parseUnits("3", 6); // 2 USDC transfer + 1 USDC bonus buffer

// --- On-chain transfer config ---
const RAW_KEY = (process.env.TREASURY_HOT_KEY || "").trim();
const TREASURY_KEY = RAW_KEY ? (RAW_KEY.startsWith("0x") ? RAW_KEY : `0x${RAW_KEY}`) : null;
const BASE_RPC = process.env.BASE_RPC_URL || "https://base-mainnet.public.blastapi.io";
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // Base mainnet

const ERC20_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
];

// Create transfer clients per-request (serverless = no persistent state)
function getTransferClients() {
  if (!TREASURY_KEY) throw new Error("TREASURY_HOT_KEY not set");
  const account = privateKeyToAccount(TREASURY_KEY);
  const wallet = createWalletClient({ account, chain: base, transport: http(BASE_RPC) });
  const pub = createPublicClient({ chain: base, transport: http(BASE_RPC) });
  return { account, wallet, pub };
}

/**
 * Pre-flight treasury balance check.
 * Returns { ethOk, usdcOk, ethBal, usdcBal } or throws.
 */
async function checkTreasuryBalance() {
  const { account, pub } = getTransferClients();
  const [ethBal, usdcBal] = await Promise.all([
    pub.getBalance({ address: account.address }),
    pub.readContract({ address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] }),
  ]);
  return {
    ethOk: ethBal >= MIN_TREASURY_ETH,
    usdcOk: usdcBal >= MIN_TREASURY_USDC,
    ethBal: formatEther(ethBal),
    usdcBal: formatUnits(usdcBal, 6),
  };
}

/**
 * Execute ETH + USDC bootstrap transfer.
 * Returns { ethTx, usdcTx } or throws.
 */
async function executeBootstrapTransfer(recipientAddress) {
  const { wallet } = getTransferClients();
  const ethAmount = parseEther(ETH_PER_BOOTSTRAP);
  const usdcAmount = parseUnits(USDC_PER_BOOTSTRAP, 6);

  // Send ETH first
  const ethTx = await wallet.sendTransaction({
    to: recipientAddress,
    value: ethAmount,
    gas: 21000n, // explicit gas for simple ETH transfer
  });

  // Send USDC
  let usdcTx;
  try {
    usdcTx = await wallet.writeContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [recipientAddress, usdcAmount],
      gas: 100000n, // explicit gas for ERC20 transfer
    });
  } catch (usdcErr) {
    console.error(`PARTIAL: ETH sent (${ethTx}) but USDC failed for ${recipientAddress}: ${usdcErr.message}`);
    throw new Error(`USDC_TRANSFER_FAILED:${ethTx}`);
  }

  return { ethTx, usdcTx };
}

/**
 * Fetch tweet with timeout and retry (max 2 attempts).
 */
async function fetchTweet(tweetId) {
  const url = `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&token=0`;
  let lastErr;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const resp = await fetch(url, { signal: controller.signal });
        if (!resp.ok) {
          if (resp.status === 404) throw new Error("TWEET_NOT_FOUND");
          throw new Error(`TWEET_FETCH_FAILED:${resp.status}`);
        }
        const data = await resp.json();
        if (!data || !data.text) throw new Error("TWEET_EMPTY");
        return { text: data.text, authorHandle: data.user?.screen_name || "unknown" };
      } finally {
        clearTimeout(timeout);
      }
    } catch (e) {
      lastErr = e;
      if (e.message === "TWEET_NOT_FOUND" || e.message === "TWEET_EMPTY") throw e;
      if (attempt < 1) await new Promise(r => setTimeout(r, 1000));
    }
  }
  throw lastErr;
}

function extractTweetId(input) {
  if (/^\d+$/.test(input)) return input;
  const m = input.match(/(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/);
  return m ? m[1] : null;
}

// --- Upstash Redis ---
let redis = null;
let redisError = null;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  try {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  } catch (e) {
    redisError = e.message;
    console.error("Redis init error:", e.message);
  }
} else {
  redisError = `URL=${!!process.env.UPSTASH_REDIS_REST_URL} TOKEN=${!!process.env.UPSTASH_REDIS_REST_TOKEN}`;
}

// --- App ---
const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "16kb" }));
app.set("trust proxy", 1);

// --- Helpers ---
const genClaimCode = () =>
  `EVER-${randomBytes(8).toString("hex").toUpperCase()}-${randomBytes(8).toString("hex").toUpperCase()}`;

// --- Routes ---

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    redis: !!redis,
    transfers: !!TREASURY_KEY,
    version: "2.0.0",
    timestamp: new Date().toISOString(),
  });
});

// Treasury balance (admin only)
app.get("/admin/treasury", async (req, res) => {
  if (!SERVER_SECRET || req.headers["x-admin-secret"] !== SERVER_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    const { account, pub } = getTransferClients();
    const ethBal = await pub.getBalance({ address: account.address });
    const usdcBal = await pub.readContract({
      address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address],
    });
    const today = new Date().toISOString().slice(0, 10);
    const dailyCount = (await redis?.get(`bootstrap:daily:count:${today}`)) || 0;

    res.json({
      address: account.address,
      eth: formatEther(ethBal),
      usdc: formatUnits(usdcBal, 6),
      dailyBootstraps: Number(dailyCount),
      dailyLimit: DAILY_BOOTSTRAP_LIMIT,
      remainingToday: DAILY_BOOTSTRAP_LIMIT - Number(dailyCount),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Bootstrap Routes ---

// Atomic daily counter Lua
const LIMIT_LUA = `
local key = KEYS[1]
local limit = tonumber(ARGV[1]) or 0
local raw = redis.call('GET', key)
local current = 0
if raw and raw ~= false then
  current = tonumber(raw) or 0
end
if current >= limit then
  return 0
else
  redis.call('INCR', key)
  redis.call('EXPIRE', key, 86400)
  return 1
end
`;

// POST /bootstrap/challenge
app.post("/bootstrap/challenge", async (req, res) => {
  try {
    if (!redis) return res.status(503).json({ error: "Redis not configured" });

    const { fingerprint, timestamp } = req.body;
    if (!fingerprint || !timestamp) {
      return res.status(400).json({ error: "Missing fingerprint or timestamp" });
    }

    // Per-IP rate limit on challenges
    const ip = req.ip || "unknown";
    const ipKey = `rate:challenge:ip:${ip}:${new Date().toISOString().slice(0, 10)}`;
    const ipCount = await redis.incr(ipKey);
    if (ipCount === 1) await redis.expire(ipKey, 86400);
    if (ipCount > IP_RATE_LIMIT * 3) {
      return res.status(429).json({ error: "IP_RATE_LIMITED" });
    }

    // Check if fingerprint already used
    const existing = await redis.get(`fingerprint:${fingerprint}`);
    if (existing) {
      return res.status(403).json({ error: "FINGERPRINT_ALREADY_USED" });
    }

    // Generate challenge
    const nonce = randomBytes(32).toString("hex");
    const challengeData = `${SERVER_SECRET}:${fingerprint}:${timestamp}:${nonce}`;
    const challenge = createHash("sha256").update(challengeData).digest("hex");

    // Store challenge with 60s TTL
    await redis.set(`challenge:${fingerprint}`, JSON.stringify({ challenge, timestamp }), { ex: 60 });

    res.json({ challenge, expiresAt: Date.now() + 60000 });
  } catch (e) {
    console.error("Challenge error:", e);
    res.status(500).json({ error: "Internal error" });
  }
});

// POST /bootstrap — Claim State Machine
app.post("/bootstrap", async (req, res) => {
  try {
    if (!redis) return res.status(503).json({ error: "Redis not configured" });

    const { wallet, fingerprint, challengeNonce, solution } = req.body;
    if (!wallet || !fingerprint || !challengeNonce || !solution) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const walletLower = wallet.toLowerCase();

    // === PHASE 1: Pre-checks (all before touching chain) ===

    const rawChallenge = await redis.get(`challenge:${fingerprint}`);
    if (!rawChallenge) return res.status(400).json({ error: "CHALLENGE_EXPIRED" });

    const stored = typeof rawChallenge === "string" ? JSON.parse(rawChallenge) : rawChallenge;
    if (stored.challenge !== challengeNonce) {
      return res.status(400).json({ error: "CHALLENGE_MISMATCH" });
    }

    const hash = createHash("sha256")
      .update(challengeNonce + parseInt(solution, 16))
      .digest("hex");
    if (!hash.startsWith("000000")) {
      return res.status(400).json({ error: "POW_INVALID" });
    }

    const usedWallet = await redis.get(`wallet:${walletLower}`);
    if (usedWallet) {
      const parsed = typeof usedWallet === "string" ? JSON.parse(usedWallet) : usedWallet;
      if (parsed.ethTx) {
        return res.json({ status: "already_completed", ethTx: parsed.ethTx, usdcTx: parsed.usdcTx, claimCode: parsed.claimCode });
      }
      return res.status(403).json({ error: "WALLET_ALREADY_USED" });
    }

    const usedFingerprint = await redis.get(`fingerprint:${fingerprint}`);
    if (usedFingerprint) {
      return res.status(403).json({ error: "FINGERPRINT_ALREADY_USED" });
    }

    const pendingKey = `bootstrap:pending:${fingerprint}`;
    const existingPending = await redis.get(pendingKey);
    if (existingPending) {
      return res.status(409).json({ error: "BOOTSTRAP_IN_PROGRESS", detail: "A bootstrap is already pending for this device" });
    }

    const ip = req.ip || "unknown";
    const ipKey = `rate:bootstrap:ip:${ip}:${new Date().toISOString().slice(0, 10)}`;
    const ipCount = await redis.incr(ipKey);
    if (ipCount === 1) await redis.expire(ipKey, 86400);
    if (ipCount > IP_RATE_LIMIT) {
      return res.status(429).json({ error: "IP_RATE_LIMITED" });
    }

    const today = new Date().toISOString().slice(0, 10);
    const approved = await redis.eval(
      LIMIT_LUA,
      [`bootstrap:daily:count:${today}`],
      [String(DAILY_BOOTSTRAP_LIMIT)],
    );
    if (!approved) {
      return res.status(429).json({ error: "DAILY_LIMIT_REACHED" });
    }

    // === PHASE 2: Set PENDING state ===
    const claimCode = genClaimCode();
    await redis.set(pendingKey, JSON.stringify({
      wallet: walletLower, claimCode, ip, timestamp: Date.now(), status: "pending",
    }), { ex: PENDING_TTL });

    await redis.del(`challenge:${fingerprint}`);

    // === PHASE 3: Treasury pre-flight check ===
    let treasuryCheck;
    try {
      treasuryCheck = await checkTreasuryBalance();
    } catch (e) {
      await redis.del(pendingKey);
      await redis.decr(`bootstrap:daily:count:${today}`);
      console.error("Treasury check failed:", e.message);
      return res.status(503).json({ error: "TREASURY_CHECK_FAILED" });
    }

    if (!treasuryCheck.ethOk || !treasuryCheck.usdcOk) {
      await redis.del(pendingKey);
      await redis.decr(`bootstrap:daily:count:${today}`);
      console.error(`Treasury low: ETH=${treasuryCheck.ethBal} USDC=${treasuryCheck.usdcBal}`);
      return res.status(503).json({ error: "TREASURY_LOW", detail: "Please try again later" });
    }

    // === PHASE 4: Execute on-chain transfers ===
    let ethTx, usdcTx;
    try {
      const txResult = await executeBootstrapTransfer(wallet);
      ethTx = txResult.ethTx;
      usdcTx = txResult.usdcTx;
    } catch (txErr) {
      const errMsg = txErr.message || "unknown";
      console.error(`Transfer failed for ${wallet}: ${errMsg}`);

      await redis.set(`bootstrap:failed:${walletLower}`, JSON.stringify({
        fingerprint, claimCode, error: errMsg, ip, timestamp: Date.now(),
      }));

      if (errMsg.startsWith("USDC_TRANSFER_FAILED:")) {
        const partialEthTx = errMsg.split(":")[1];
        await redis.set(`wallet:${walletLower}`, JSON.stringify({
          fingerprint, claimCode, ethTx: partialEthTx, usdcTx: null, status: "partial", timestamp: Date.now(),
        }), { ex: COMPLETED_TTL });
        await redis.set(`fingerprint:${fingerprint}`, JSON.stringify({
          wallet: walletLower, status: "partial", timestamp: Date.now(),
        }), { ex: COMPLETED_TTL });
        await redis.set(`claim:${claimCode}`, walletLower);
        await redis.del(pendingKey);

        return res.json({
          status: "partial",
          ethTx: partialEthTx, usdcTx: null,
          error: "USDC transfer failed — will retry manually",
          amounts: { eth: ETH_PER_BOOTSTRAP, usdc: "0" },
          claimCode,
        });
      }

      await redis.del(pendingKey);
      try { await redis.decr(`bootstrap:daily:count:${today}`); } catch (_) {}

      return res.status(500).json({ error: "TRANSFER_FAILED", detail: errMsg });
    }

    // === PHASE 5: Mark COMPLETED (after successful transfer) ===
    try {
      await redis.set(`wallet:${walletLower}`, JSON.stringify({
        fingerprint, claimCode, ethTx, usdcTx, status: "complete", timestamp: Date.now(),
      }), { ex: COMPLETED_TTL });
      await redis.set(`fingerprint:${fingerprint}`, JSON.stringify({
        wallet: walletLower, status: "complete", timestamp: Date.now(),
      }), { ex: COMPLETED_TTL });
      await redis.set(`claim:${claimCode}`, walletLower);
      await redis.del(pendingKey);
    } catch (redisErr) {
      console.error(`CRITICAL: Transfer OK but Redis write failed! wallet=${wallet} ethTx=${ethTx} usdcTx=${usdcTx} claim=${claimCode} error=${redisErr.message}`);
    }

    console.log(`Bootstrap complete: wallet=${wallet} ethTx=${ethTx} usdcTx=${usdcTx} claim=${claimCode}`);

    res.json({
      status: "complete",
      ethTx,
      usdcTx,
      amounts: { eth: ETH_PER_BOOTSTRAP, usdc: USDC_PER_BOOTSTRAP },
      claimCode,
    });
  } catch (e) {
    console.error("Bootstrap error:", e);
    res.status(500).json({ error: "Internal error", detail: e.message });
  }
});

// --- X Post Verification ---
const USDC_BONUS = "1.00";

// POST /verify-xpost
app.post("/verify-xpost", async (req, res) => {
  try {
    if (!redis) return res.status(503).json({ error: "Redis not configured" });

    const { wallet, claimCode, tweetUrl } = req.body;
    if (!wallet || !claimCode || !tweetUrl) {
      return res.status(400).json({ error: "Missing wallet, claimCode, or tweetUrl" });
    }

    const storedWallet = await redis.get(`claim:${claimCode}`);
    if (!storedWallet) return res.status(400).json({ error: "CLAIM_CODE_NOT_FOUND" });
    if (storedWallet !== wallet.toLowerCase() && storedWallet !== wallet) {
      return res.status(400).json({ error: "CLAIM_CODE_MISMATCH" });
    }

    const alreadyClaimed = await redis.get(`bonus:${claimCode}`);
    if (alreadyClaimed) return res.status(400).json({ error: "BONUS_ALREADY_CLAIMED" });

    const tweetId = extractTweetId(tweetUrl.trim());
    if (!tweetId) return res.status(400).json({ error: "INVALID_TWEET_URL" });

    const tweetUsed = await redis.get(`tweet:${tweetId}`);
    if (tweetUsed) return res.status(400).json({ error: "TWEET_ALREADY_USED" });

    let tweetData;
    try {
      tweetData = await fetchTweet(tweetId);
    } catch (fetchErr) {
      const msg = fetchErr.message || "unknown";
      if (msg === "TWEET_NOT_FOUND") return res.status(400).json({ error: "TWEET_NOT_FOUND" });
      if (msg === "TWEET_EMPTY") return res.status(400).json({ error: "TWEET_EMPTY" });
      return res.status(502).json({ error: "TWEET_FETCH_FAILED", detail: msg });
    }

    if (!tweetData.text.includes(claimCode)) {
      return res.status(400).json({ error: "CLAIM_CODE_NOT_IN_TWEET" });
    }

    let bonusTx;
    try {
      const { wallet: wClient } = getTransferClients();
      bonusTx = await wClient.writeContract({
        address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "transfer",
        args: [wallet, parseUnits(USDC_BONUS, 6)],
        gas: 100000n,
      });
    } catch (txErr) {
      console.error(`Bonus transfer failed for ${wallet}: ${txErr.message}`);
      return res.status(500).json({ error: "BONUS_TRANSFER_FAILED", detail: txErr.message });
    }

    await redis.set(`bonus:${claimCode}`, JSON.stringify({
      tweetId, tweetUrl, bonusTx, author: tweetData.authorHandle, timestamp: Date.now(),
    }));
    await redis.set(`tweet:${tweetId}`, claimCode);

    res.json({
      status: "bonus_issued",
      bonusTx,
      bonusAmount: USDC_BONUS,
      tweetAuthor: tweetData.authorHandle,
      xmtpActivated: true,
    });
  } catch (e) {
    console.error("X-verify error:", e);
    res.status(500).json({ error: "Internal error", detail: e.message });
  }
});

// DELETE /forget (GDPR)
app.delete("/forget", async (req, res) => {
  try {
    if (!redis) return res.status(503).json({ error: "Redis not configured" });
    const { wallet, fingerprintHash } = req.body;
    if (wallet) {
      const wl = wallet.toLowerCase();
      await redis.del(`wallet:${wl}`);
      await redis.del(`bootstrap:failed:${wl}`);
      await redis.del(`bootstrap:pending:${wl}`);
    }
    if (fingerprintHash) {
      await redis.del(`fingerprint:${fingerprintHash}`);
      await redis.del(`bootstrap:pending:${fingerprintHash}`);
    }
    res.status(204).send();
  } catch (e) {
    console.error("Forget error:", e);
    res.status(500).json({ error: "Internal error" });
  }
});

// --- Start (local dev) or Export (Vercel) ---
if (process.env.VERCEL !== "1") {
  app.listen(PORT, () => console.log(`EverClaw API on port ${PORT}`));
}

export default app;
```

Also note: the dead EIP-712 code in bootstrap-client.mjs IS already removed (commit dd52309). Grok was seeing a stale GitHub cache. Current line 117 is just a comment: `// EIP-712 signing deferred to v2`
assistant: NO_REPLY
