#!/usr/bin/env node
/**
 * reconcile-pending.mjs — Background reconciliation for bootstrap claims
 *
 * Scans Redis for lingering `bootstrap:pending:*` keys older than 15 minutes.
 * For each stale pending claim, checks on-chain whether the ETH + USDC transfers
 * actually landed. If funds arrived, completes the Redis state. If not, cleans up.
 *
 * Also scans for `bootstrap:failed:*` keys where the CRITICAL path hit
 * (transfer OK but Redis write failed) and reconciles those.
 *
 * Run manually:   node scripts/reconcile-pending.mjs
 * Run on cron:    every 5 minutes (Vercel cron, GitHub Actions, or local)
 *
 * Environment:
 *   UPSTASH_REDIS_REST_URL   — Required
 *   UPSTASH_REDIS_REST_TOKEN — Required
 *   BASE_RPC_URL             — Optional (default: public Blast RPC)
 *   TREASURY_HOT_KEY         — Required (to derive treasury address)
 *   DRY_RUN=1                — Log actions without writing to Redis
 */

import { Redis } from "@upstash/redis";
import { createPublicClient, http, formatEther, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

// --- Config ---
const DRY_RUN = process.env.DRY_RUN === "1";
const PENDING_MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes
const COMPLETED_TTL = 60 * 60 * 24 * 90;   // 90 days
const BASE_RPC = process.env.BASE_RPC_URL || "https://base-mainnet.public.blastapi.io";

const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ETH_PER_BOOTSTRAP = 0.0008;
const USDC_PER_BOOTSTRAP = 2.0;

const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
];

// --- Init ---
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const pub = createPublicClient({ chain: base, transport: http(BASE_RPC) });

const RAW_KEY = (process.env.TREASURY_HOT_KEY || "").trim();
const TREASURY_KEY = RAW_KEY ? (RAW_KEY.startsWith("0x") ? RAW_KEY : `0x${RAW_KEY}`) : null;
const treasuryAddress = TREASURY_KEY ? privateKeyToAccount(TREASURY_KEY).address : null;

// --- Helpers ---

/**
 * Check if a wallet received bootstrap funds by looking at current balances.
 * This is a heuristic — if wallet has ≥ 0.0008 ETH and ≥ 2 USDC, we assume
 * the bootstrap transfer landed. Not perfect for wallets that already had funds,
 * but for fresh bootstrap wallets this is reliable.
 */
async function walletHasBootstrapFunds(walletAddress) {
  try {
    const [ethBal, usdcBal] = await Promise.all([
      pub.getBalance({ address: walletAddress }),
      pub.readContract({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [walletAddress],
      }),
    ]);

    const ethAmount = Number(formatEther(ethBal));
    const usdcAmount = Number(formatUnits(usdcBal, 6));

    return {
      hasEth: ethAmount >= ETH_PER_BOOTSTRAP * 0.9, // 10% tolerance for gas spent
      hasUsdc: usdcAmount >= USDC_PER_BOOTSTRAP * 0.9,
      ethBal: ethAmount,
      usdcBal: usdcAmount,
    };
  } catch (e) {
    console.error(`  ⚠️  Balance check failed for ${walletAddress}: ${e.message}`);
    return { hasEth: false, hasUsdc: false, ethBal: 0, usdcBal: 0 };
  }
}

/**
 * Scan Redis for keys matching a pattern using SCAN (cursor-based).
 * Upstash Redis REST supports scan with cursor.
 */
async function scanKeys(pattern) {
  const keys = [];
  let cursor = 0;
  do {
    const [nextCursor, batch] = await redis.scan(cursor, { match: pattern, count: 100 });
    cursor = Number(nextCursor);
    if (batch && batch.length) keys.push(...batch);
  } while (cursor !== 0);
  return keys;
}

// --- Reconcile Stale Pending Claims ---

async function reconcilePending() {
  console.log("🔍 Scanning for stale pending claims...");
  const pendingKeys = await scanKeys("bootstrap:pending:*");

  if (!pendingKeys.length) {
    console.log("  ✅ No pending claims found.");
    return { scanned: 0, reconciled: 0, cleaned: 0 };
  }

  console.log(`  Found ${pendingKeys.length} pending claim(s).`);
  let reconciled = 0;
  let cleaned = 0;

  for (const key of pendingKeys) {
    const raw = await redis.get(key);
    if (!raw) continue;

    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    const age = Date.now() - (data.timestamp || 0);
    const fingerprint = key.replace("bootstrap:pending:", "");

    if (age < PENDING_MAX_AGE_MS) {
      console.log(`  ⏳ ${fingerprint.slice(0, 16)}... — ${Math.round(age / 1000)}s old, still within TTL. Skipping.`);
      continue;
    }

    console.log(`  🔎 Stale pending: wallet=${data.wallet} age=${Math.round(age / 60000)}min`);

    if (!data.wallet) {
      console.log(`    ❌ No wallet in pending record. Cleaning up.`);
      if (!DRY_RUN) await redis.del(key);
      cleaned++;
      continue;
    }

    // Check on-chain
    const funds = await walletHasBootstrapFunds(data.wallet);
    console.log(`    On-chain: ETH=${funds.ethBal} USDC=${funds.usdcBal}`);

    if (funds.hasEth || funds.hasUsdc) {
      // Funds landed — complete the Redis state
      const status = funds.hasEth && funds.hasUsdc ? "complete" : "partial";
      console.log(`    ✅ Funds detected! Marking as ${status}.`);

      if (!DRY_RUN) {
        await redis.set(`wallet:${data.wallet}`, JSON.stringify({
          fingerprint,
          claimCode: data.claimCode || "RECONCILED",
          ethTx: "reconciled-on-chain",
          usdcTx: funds.hasUsdc ? "reconciled-on-chain" : null,
          status,
          timestamp: Date.now(),
          reconciledAt: new Date().toISOString(),
        }), { ex: COMPLETED_TTL });

        await redis.set(`fingerprint:${fingerprint}`, JSON.stringify({
          wallet: data.wallet,
          status,
          timestamp: Date.now(),
          reconciledAt: new Date().toISOString(),
        }), { ex: COMPLETED_TTL });

        if (data.claimCode) {
          await redis.set(`claim:${data.claimCode}`, data.wallet);
        }

        await redis.del(key);
      }
      reconciled++;
    } else {
      // No funds on-chain — transfer never went through. Clean up so user can retry.
      console.log(`    🧹 No funds on-chain. Cleaning pending (user can retry).`);
      if (!DRY_RUN) {
        await redis.del(key);
      }
      cleaned++;
    }
  }

  return { scanned: pendingKeys.length, reconciled, cleaned };
}

// --- Reconcile Failed Redis Writes ---

async function reconcileFailedRedis() {
  console.log("\n🔍 Scanning for failed Redis write records...");
  const failedKeys = await scanKeys("bootstrap:failed:*");

  if (!failedKeys.length) {
    console.log("  ✅ No failed records found.");
    return { scanned: 0, reconciled: 0 };
  }

  console.log(`  Found ${failedKeys.length} failed record(s).`);
  let reconciled = 0;

  for (const key of failedKeys) {
    const raw = await redis.get(key);
    if (!raw) continue;

    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    const wallet = key.replace("bootstrap:failed:", "");

    console.log(`  🔎 Failed record: wallet=${wallet} error=${data.error?.slice(0, 60)}`);

    // Check if wallet state was already fixed (e.g., by a retry)
    const existing = await redis.get(`wallet:${wallet}`);
    if (existing) {
      const parsed = typeof existing === "string" ? JSON.parse(existing) : existing;
      if (parsed.status === "complete") {
        console.log(`    ✅ Already completed. Cleaning failed record.`);
        if (!DRY_RUN) await redis.del(key);
        reconciled++;
        continue;
      }
    }

    // Check on-chain
    const funds = await walletHasBootstrapFunds(wallet);
    console.log(`    On-chain: ETH=${funds.ethBal} USDC=${funds.usdcBal}`);

    if (funds.hasEth || funds.hasUsdc) {
      const status = funds.hasEth && funds.hasUsdc ? "complete" : "partial";
      console.log(`    ✅ Funds detected! Completing Redis state as ${status}.`);

      if (!DRY_RUN) {
        await redis.set(`wallet:${wallet}`, JSON.stringify({
          fingerprint: data.fingerprint,
          claimCode: data.claimCode || "RECONCILED",
          ethTx: "reconciled-on-chain",
          usdcTx: funds.hasUsdc ? "reconciled-on-chain" : null,
          status,
          timestamp: Date.now(),
          reconciledAt: new Date().toISOString(),
        }), { ex: COMPLETED_TTL });

        if (data.fingerprint) {
          await redis.set(`fingerprint:${data.fingerprint}`, JSON.stringify({
            wallet,
            status,
            timestamp: Date.now(),
            reconciledAt: new Date().toISOString(),
          }), { ex: COMPLETED_TTL });
        }

        if (data.claimCode) {
          await redis.set(`claim:${data.claimCode}`, wallet);
        }

        await redis.del(key);
      }
      reconciled++;
    } else {
      console.log(`    ⏳ No funds on-chain. Keeping failed record for manual review.`);
    }
  }

  return { scanned: failedKeys.length, reconciled };
}

// --- Main ---

async function main() {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`EverClaw Bootstrap Reconciliation`);
  console.log(`${new Date().toISOString()}${DRY_RUN ? " [DRY RUN]" : ""}`);
  console.log(`${"=".repeat(60)}\n`);

  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    console.error("❌ UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN required");
    process.exit(1);
  }

  const pendingResult = await reconcilePending();
  const failedResult = await reconcileFailedRedis();

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Summary:`);
  console.log(`  Pending: ${pendingResult.scanned} scanned, ${pendingResult.reconciled} reconciled, ${pendingResult.cleaned} cleaned`);
  console.log(`  Failed:  ${failedResult.scanned} scanned, ${failedResult.reconciled} reconciled`);
  console.log(`${"=".repeat(60)}\n`);
}

main().catch((e) => {
  console.error("❌ Reconciliation failed:", e.message);
  process.exit(1);
});
