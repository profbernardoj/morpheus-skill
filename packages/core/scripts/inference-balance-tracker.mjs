#!/usr/bin/env node
/**
 * Inference Balance Tracker — EverClaw
 *
 * Daily tracker for MOR + ETH held in inference wallets.
 * Covers only tokens used for Morpheus P2P staking.
 *
 * Reports: MOR/ETH balances, USD values, staking capacity.
 *
 * Required env vars:
 *   MORPHEUS_WALLET_ADDRESS  — Router EOA address
 *   MORPHEUS_SAFE_ADDRESS    — Safe reserve address
 *
 * Usage:
 *   node inference-balance-tracker.mjs           # Full report
 *   node inference-balance-tracker.mjs --json    # JSON output
 */

import http from "node:http";
import https from "node:https";

// --- Config ---
const RPC_URL = process.env.EVERCLAW_RPC || "https://base-mainnet.public.blastapi.io";
const MOR_TOKEN = "0x7431aDa8a591C955a994a21710752EF9b882b8e3";
const ROUTER_WALLET = process.env.MORPHEUS_WALLET_ADDRESS;
const SAFE_ADDRESS = process.env.MORPHEUS_SAFE_ADDRESS;
const DAILY_STAKE = 633; // MOR per 1-day session (approximate)

if (!ROUTER_WALLET) { console.error("❌ MORPHEUS_WALLET_ADDRESS env var required"); process.exit(1); }
if (!SAFE_ADDRESS) { console.error("❌ MORPHEUS_SAFE_ADDRESS env var required"); process.exit(1); }

const jsonMode = process.argv.includes("--json");

// --- RPC Helpers ---
function rpcCall(method, params) {
  return new Promise((resolve, reject) => {
    const url = new URL(RPC_URL);
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
    const client = RPC_URL.startsWith("https") ? https : http;
    const req = client.request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          resolve(data.result);
        } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function getTokenBalance(token, address) {
  const sig = "0x70a08231" + address.slice(2).toLowerCase().padStart(64, "0");
  const result = await rpcCall("eth_call", [{ to: token, data: sig }, "latest"]);
  return Number(BigInt(result)) / 1e18;
}

async function getEthBalance(address) {
  const result = await rpcCall("eth_getBalance", [address, "latest"]);
  return Number(BigInt(result)) / 1e18;
}

/**
 * Fetch MOR + ETH prices from CoinGecko free API (no key needed).
 * Returns { mor: number, eth: number } in USD.
 */
async function getPrices() {
  return new Promise((resolve) => {
    const url = new URL("https://api.coingecko.com/api/v3/simple/price?ids=morpheusai,ethereum&vs_currencies=usd");
    const opts = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: { "User-Agent": "EverClaw/1.0", "Accept": "application/json" },
    };
    https.get(opts, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        https.get(res.headers.location, { headers: opts.headers }, (res2) => {
          const chunks = [];
          res2.on("data", (c) => chunks.push(c));
          res2.on("end", () => {
            try {
              const data = JSON.parse(Buffer.concat(chunks).toString());
              resolve({ mor: data.morpheusai?.usd || 0, eth: data.ethereum?.usd || 0 });
            } catch { resolve({ mor: 0, eth: 0 }); }
          });
        }).on("error", () => resolve({ mor: 0, eth: 0 }));
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          resolve({ mor: data.morpheusai?.usd || 0, eth: data.ethereum?.usd || 0 });
        } catch { resolve({ mor: 0, eth: 0 }); }
      });
    }).on("error", () => resolve({ mor: 0, eth: 0 }));
  });
}

// --- Main ---
async function run() {
  const [routerMor, safeMor, routerEth, safeEth, prices] = await Promise.all([
    getTokenBalance(MOR_TOKEN, ROUTER_WALLET),
    getTokenBalance(MOR_TOKEN, SAFE_ADDRESS),
    getEthBalance(ROUTER_WALLET),
    getEthBalance(SAFE_ADDRESS),
    getPrices(),
  ]);

  const totalMor = routerMor + safeMor;
  const totalEth = routerEth + safeEth;
  const morUsd = prices.mor;
  const ethUsd = prices.eth;
  const totalMorValue = totalMor * morUsd;
  const totalEthValue = totalEth * ethUsd;
  const totalValue = totalMorValue + totalEthValue;
  const maxConcurrentSessions = Math.floor(routerMor / DAILY_STAKE);
  const maxWithSafe = Math.floor(totalMor / DAILY_STAKE);

  const report = {
    timestamp: new Date().toISOString(),
    prices: {
      mor: morUsd,
      eth: ethUsd,
    },
    router: {
      address: ROUTER_WALLET,
      mor: routerMor,
      eth: routerEth,
      morValue: routerMor * morUsd,
      ethValue: routerEth * ethUsd,
    },
    safe: {
      address: SAFE_ADDRESS,
      mor: safeMor,
      eth: safeEth,
      morValue: safeMor * morUsd,
      ethValue: safeEth * ethUsd,
    },
    totals: {
      mor: totalMor,
      eth: totalEth,
      morValue: totalMorValue,
      ethValue: totalEthValue,
      totalValue,
    },
    staking: {
      dailyStakeRate: DAILY_STAKE,
      maxConcurrentFromRouter: maxConcurrentSessions,
      maxConcurrentTotal: maxWithSafe,
      note: "MOR is staked and returned after session close",
    },
  };

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // Human-readable output
  const f = (n, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const usd = (n) => "$" + f(n);

  console.log(`\n💰 Inference Balance Tracker — ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}\n`);
  
  console.log(`📈 Prices:`);
  console.log(`   MOR: ${morUsd ? usd(morUsd) : "unavailable"}   ETH: ${ethUsd ? usd(ethUsd) : "unavailable"}\n`);

  console.log(`🔑 Router EOA:`);
  console.log(`   ${f(routerMor)} MOR  (${usd(routerMor * morUsd)})`);
  console.log(`   ${f(routerEth, 5)} ETH  (${usd(routerEth * ethUsd)})\n`);

  console.log(`🏦 Safe Reserve:`);
  console.log(`   ${f(safeMor)} MOR  (${usd(safeMor * morUsd)})`);
  console.log(`   ${f(safeEth, 5)} ETH  (${usd(safeEth * ethUsd)})\n`);

  console.log(`📊 Totals:`);
  console.log(`   ${f(totalMor)} MOR  (${usd(totalMorValue)})`);
  console.log(`   ${f(totalEth, 5)} ETH  (${usd(totalEthValue)})`);
  console.log(`   Combined: ${usd(totalValue)}\n`);

  console.log(`⚡ Staking Capacity:`);
  console.log(`   Stake per session: ~${DAILY_STAKE} MOR/day (returned after close)`);
  console.log(`   Concurrent sessions (router): ${maxConcurrentSessions}`);
  console.log(`   Concurrent sessions (total):  ${maxWithSafe}`);
  
  // Warnings
  if (routerEth < 0.005) {
    console.log(`\n⚠️  Router ETH low (${f(routerEth, 5)}) — may not cover gas for session open/close`);
  }
  if (routerMor < DAILY_STAKE) {
    console.log(`\n🚨 Router MOR (${f(routerMor)}) below 1-session stake (${DAILY_STAKE}) — fund from Safe!`);
  }
  console.log("");
}

run().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
