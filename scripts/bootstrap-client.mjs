#!/usr/bin/env node
/**
 * EverClaw Bootstrap Client
 *
 * Handles micro-funding for x402, ERC-8004, and XMTP Agent Chat.
 * Provides 0.0008 ETH + 2.00 USDC on Base mainnet (or Base Sepolia for testing).
 *
 * Features:
 * - Device fingerprint (SHA-256 hashed)
 * - CPU PoW (6 leading zeros,~7s average)
 * - EIP-712 signing (zero gas)
 * - Optional X post for +1 USDC bonus
 *
 * Usage:
 *   node bootstrap-client.mjs bootstrap
 *   node bootstrap-client.mjs bootstrap --test-fingerprint=deadbeef01
 *
 * Environment:
 *   EVERCLAW_BOOTSTRAP_URL - API endpoint (default: https://api.everclaw.xyz/bootstrap)
 *   TEST_FINGERPRINT - Override fingerprint for testing
 *   NODE_ENV=test - Use Base Sepolia instead of Base mainnet
 */

import crypto from 'crypto';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { machineIdSync } from 'node-machine-id';
import { privateKeyToAccount } from 'viem/accounts';

const BOOTSTRAP_DIR = path.join(os.homedir(), '.everclaw');
const STATE_FILE = path.join(BOOTSTRAP_DIR, 'bootstrap.json');
const API_BASE = process.env.EVERCLAW_BOOTSTRAP_URL || 'https://api.everclaw.xyz/bootstrap';

// ─── Directory Setup ───────────────────────────────────────────────────────

async function ensureDir() {
  if (!fs.existsSync(BOOTSTRAP_DIR)) {
    fs.mkdirSync(BOOTSTRAP_DIR, { recursive: true, mode: 0o700 });
  }
}

// ─── Fingerprint (GAP-001 + GAP-003)───────────────────────────────────────

/**
 * Generate device fingerprint.
 * SHA-256 hash of machine ID + platform.
 * Can be overridden via TEST_FINGERPRINT for testing.
 */
function getFingerprint() {
  // GAP-003: Test override for Sybil/parallel testing
  if (process.env.TEST_FINGERPRINT) {
    return process.env.TEST_FINGERPRINT;
  }
  const machineId = machineIdSync();
  return crypto.createHash('sha256')
    .update(`${machineId}:${process.platform}`)
    .digest('hex');
}

// ─── PoW Solver─────────────────────────────────────────────────────────────

/**
 * Solve PoW challenge.
 * Finds nonce such that SHA-256(challenge + nonce) starts with 6 zeros.
 * Timeout: 60 seconds.
 */
async function solvePoW(challenge) {
  const start = Date.now();
  const timeout = 60000; // 60 seconds

  for (let i = 0; Date.now() - start < timeout; i++) {
    const hash = crypto.createHash('sha256')
      .update(challenge + i.toString())
      .digest('hex');
    if (hash.startsWith('000000')) {
      return i.toString(16);
    }
  }
  throw new Error('PoW timeout');
}

// ─── EIP-712 Signing ────────────────────────────────────────────────────────

/**
 * Sign bootstrap request with EIP-712 (off-chain, zero gas).
 */
async function signBootstrapRequest(privateKey, fingerprint, challenge) {
  const account = privateKeyToAccount(privateKey);

  const domain = {
    name: "EverClaw Bootstrap",
    version: "1",
    chainId: process.env.NODE_ENV === 'test' ? 84532 : 8453 // Base Sepolia : Base
  };

  const types = {
    BootstrapRequest: [
      { name: "wallet", type: "address" },
      { name: "fingerprint", type: "string" },
      { name: "timestamp", type: "uint256" },
      { name: "challengeNonce", type: "bytes32" }
    ]
  };

  const timestamp = BigInt(Date.now());
  const challengeNonce = challenge.startsWith('0x') ? challenge : `0x${challenge}`;

  const message = {
    wallet: account.address,
    fingerprint,
    timestamp,
    challengeNonce
  };

  const signature = await account.signTypedData({
    domain,
    types,
    primaryType: 'BootstrapRequest',
    message
  });

  return { signature, wallet: account.address, timestamp };
}

// ─── Keychain Access─────────────────────────────────────────────────────────

/**
 * Get private key from keychain.
 * Reuses the same logic as everclaw-wallet.mjs.
 */
function getKeyFromKeychain() {
  const platform = os.platform();
  const KEYCHAIN_ACCOUNT = process.env.EVERCLAW_KEYCHAIN_ACCOUNT || 'everclaw-agent';
  const KEYCHAIN_SERVICE = process.env.EVERCLAW_KEYCHAIN_SERVICE || 'everclaw-wallet-key';
  const KEY_STORE_PATH = process.env.EVERCLAW_KEY_STORE || path.join(os.homedir(), '.everclaw', 'wallet.enc');

  // macOS Keychain
  if (platform === 'darwin') {
    try {
      const result = require('child_process').execSync(
        `security find-generic-password -a "${KEYCHAIN_ACCOUNT}" -s "${KEYCHAIN_SERVICE}" -w`,
        { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8', timeout: 5000 }
      );
      return result.trim();
    } catch {
      // Fall through to encrypted file
    }
  }

  // Linux libsecret
  if (platform === 'linux') {
    try {
      require('child_process').execSync('which secret-tool', { stdio: 'pipe' });
      const result = require('child_process').execSync(
        `secret-tool lookup service "${KEYCHAIN_SERVICE}" account "${KEYCHAIN_ACCOUNT}"`,
        { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8', timeout: 5000 }
      );
      return result.trim();
    } catch {
      // Fall through to encrypted file
    }
  }

  // Encrypted file fallback
  if (fs.existsSync(KEY_STORE_PATH)) {
    const blob = fs.readFileSync(KEY_STORE_PATH);
    if (blob.length < 33) return null;

    const iv = blob.subarray(0, 16);
    const authTag = blob.subarray(16, 32);
    const encrypted = blob.subarray(32);

    let machineId = 'everclaw-fallback';
    try {
      if (fs.existsSync('/etc/machine-id')) {
        machineId = fs.readFileSync('/etc/machine-id', 'utf-8').trim();
      } else if (fs.existsSync('/var/lib/dbus/machine-id')) {
        machineId = fs.readFileSync('/var/lib/dbus/machine-id', 'utf-8').trim();
      }
    } catch {}

    const salt = `everclaw-${KEYCHAIN_ACCOUNT}-${process.env.USER || 'agent'}`;
    const encKey = crypto.scryptSync(machineId, salt, 32);

    const decipher = crypto.createDecipheriv('aes-256-gcm', encKey, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf-8');
  }

  return null;
}

// ─── Main Bootstrap Function ────────────────────────────────────────────────

/**
 * Run the bootstrap flow:
 * 1. Check if already bootstrapped
 * 2. Get fingerprint
 * 3. Request challenge
 * 4. Solve PoW
 * 5. Sign and submit
 * 6. Store result
 */
async function bootstrap() {
  await ensureDir();

  // Check if already bootstrapped
  if (fs.existsSync(STATE_FILE)) {
    console.log('✅ Bootstrap already completed');
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  }

  try {
    // Get private key
    const privateKey = getKeyFromKeychain();
    if (!privateKey) {
      throw new Error('No wallet found. Run `everclaw-wallet.mjs setup` first.');
    }

    // Get fingerprint
    const fingerprint = getFingerprint();
    console.log(`🔐 Fingerprint: ${fingerprint.slice(0, 16)}...`);

    // Request challenge (unsigned)
    const timestamp = Date.now();
    console.log('📡 Requesting challenge...');
    const challengeRes = await fetch(`${API_BASE}/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fingerprint, timestamp })
    });

    const challengeData = await challengeRes.json();
    if (!challengeRes.ok || challengeData.error) {
      throw new Error(challengeData.error || `HTTP ${challengeRes.status}`);
    }
    const { challenge } = challengeData;
    console.log(`⚡ Challenge received: ${challenge.slice(0, 16)}...`);

    // Solve PoW
    console.log('🔄 Solving PoW (this takes ~7 seconds)...');
    const solution = await solvePoW(challenge);
    console.log('✅ PoW solved');

    // Sign request
    const { signature, wallet } = await signBootstrapRequest(privateKey, fingerprint, challenge);
    console.log(`✍️ Signed by ${wallet}`);

    // Submit bootstrap request
    console.log('🚀 Submitting bootstrap request...');
    const claimRes = await fetch(`${API_BASE}/bootstrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wallet,
        fingerprint,
        challengeNonce: challenge,
        solution,
        timestamp: BigInt(timestamp),
        signature
      })
    });

    const resultData = await claimRes.json();
    if (!claimRes.ok || resultData.error) {
      throw new Error(resultData.error || `HTTP ${claimRes.status}`);
    }

    // Store result
    fs.writeFileSync(STATE_FILE, JSON.stringify(resultData, null, 2));

    console.log('');
    console.log('✅ Bootstrap complete!');
    console.log(`   ETH: 0.0008 → ${wallet}`);
    console.log(`   USDC: 2.00 → ${wallet}`);
    console.log(`   Claim code: ${resultData.claimCode}`);
    console.log('');
    console.log('To unlock buddy messaging, post this on X:');
    console.log('');
    console.log(`   Just activated my EverClaw Agent on Base!`);
    console.log(`   Agent wallet: ${wallet}`);
    console.log(`   Claim code: ${resultData.claimCode}`);
    console.log(`   #EverClawAI #AgentChat @everclaw_xyz`);
    console.log('');
    console.log(`   Want to chat directly with my new Agent? Install EverClaw and reply with your Agent's address!`);
    console.log('');

    return resultData;
  } catch (error) {
    console.error('🚨 Bootstrap failed:', error.message);
    throw error;
  }
}

// ─── CLI ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // Handle test fingerprint override
  const fingerprintOverride = args.find(a => a.startsWith('--test-fingerprint='));
  if (fingerprintOverride) {
    process.env.TEST_FINGERPRINT = fingerprintOverride.split('=')[1];
  }

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
EverClaw Bootstrap Client

Usage:
  node bootstrap-client.mjs bootstrap [--test-fingerprint=HASH]

Environment:
  EVERCLAW_BOOTSTRAP_URL - API endpoint (default: https://api.everclaw.xyz/bootstrap)
  TEST_FINGERPRINT - Override fingerprint for testing
  NODE_ENV=test - Use Base Sepolia instead of Base mainnet

Examples:
  node bootstrap-client.mjs bootstrap
  TEST_FINGERPRINT=deadbeef01 node bootstrap-client.mjs bootstrap
`);
    process.exit(0);
  }

  if (args[0] === 'bootstrap' || args.length === 0) {
    await bootstrap();
  } else {
    console.error(`Unknown command: ${args[0]}`);
    console.error('Run with --help for usage');
    process.exit(1);
  }
}

const isMain = process.argv[1]?.endsWith('bootstrap-client.mjs');
if (isMain) main().catch(e => { console.error(e.message); process.exit(1); });

// Export for testing
export { bootstrap, getFingerprint, solvePoW };