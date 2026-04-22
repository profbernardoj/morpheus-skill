/**
 * EverClaw Bootstrap API Routes
 *
 * Endpoints:
 * - POST /bootstrap/challenge - Get PoW challenge (unsigned)
 * - POST /bootstrap - Submit bootstrap request (signed)
 * - POST /verify-xpost - Verify X post for bonus
 * - DELETE /forget - GDPR deletion
 */

import { Router } from 'express';
import { randomBytes, createHash } from 'crypto';
import { setRedisClient } from '../services/hot-wallet-transfer.js';
import { verifyXPost } from '../services/x-verifier.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChallengeRequest {
  fingerprint: string;
  timestamp: number;
}

interface BootstrapRequest {
  wallet: string;
  fingerprint: string;
  challengeNonce: string;
  solution: string;
  timestamp: bigint;
  signature: string;
}

interface XPostRequest {
  wallet: string;
  claimCode: string;
  tweetUrl?: string;
}

// ─── Configuration ──────────────────────────────────────────────────────────

const CHALLENGE_EXPIRY_MS = 60_000; // 60 seconds
const SERVER_SECRET = process.env.SERVER_SECRET || randomBytes(32).toString('hex');

// ─── Redis Interface ─────────────────────────────────────────────────────────

interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { ex?: number }): Promise<void>;
  del(key: string): Promise<void>;
}

let redis: RedisClient;

export function setRedisClientForRoutes(client: RedisClient) {
  redis = client;
  setRedisClient(client);
}

// ─── Router────────────────────────────────────────────────────────────────

const router = Router();

// ─── Claim Code Generation ───────────────────────────────────────────────────

function generateClaimCode(): string {
  const part1 = randomBytes(8).toString('hex').toUpperCase();
  const part2 = randomBytes(8).toString('hex').toUpperCase();
  return `EVER-${part1}-${part2}`;
}

// ─── Challenge Endpoint─────────────────────────────────────────────────────

router.post('/challenge', async (req, res) => {
  try {
    const { fingerprint, timestamp } = req.body as ChallengeRequest;

    if (!fingerprint || !timestamp) {
      return res.status(400).json({ error: 'Missing fingerprint or timestamp' });
    }

    // Check if fingerprint already used
    const existing = await redis.get(`fingerprint:${fingerprint}`);
    if (existing) {
      return res.status(403).json({ error: 'FINGERPRINT_ALREADY_USED' });
    }

    // Generate challenge
    const nonce = randomBytes(32).toString('hex');
    const challengeData = `${SERVER_SECRET}:${fingerprint}:${timestamp}:${nonce}`;
    const challenge = createHash('sha256').update(challengeData).digest('hex');

    // Store challenge with expiry
    await redis.set(`challenge:${fingerprint}`, JSON.stringify({
      challenge,
      nonce,
      timestamp,
      wallet: null// Will be set during bootstrap
    }), { ex: 60 });

    res.json({
      challenge,
      expiresAt: Date.now() + CHALLENGE_EXPIRY_MS
    });
  } catch (error) {
    console.error('Challenge error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Bootstrap Endpoint─────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  try {
    const body = req.body as BootstrapRequest;
    const { wallet, fingerprint, challengeNonce, solution, signature } = body;

    if (!wallet || !fingerprint || !challengeNonce || !solution || !signature) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Get stored challenge
    const challengeData = await redis.get(`challenge:${fingerprint}`);
    if (!challengeData) {
      return res.status(400).json({ error: 'CHALLENGE_EXPIRED' });
    }

    const stored = JSON.parse(challengeData);
    if (stored.challenge !== challengeNonce) {
      return res.status(400).json({ error: 'CHALLENGE_MISMATCH' });
    }

    // Verify PoW
    const hash = createHash('sha256').update(challengeNonce + parseInt(solution, 16)).digest('hex');
    if (!hash.startsWith('000000')) {
      return res.status(400).json({ error: 'POW_INVALID' });
    }

    // Check if wallet already used
    const usedWallet = await redis.get(`wallet:${wallet}`);
    if (usedWallet) {
      return res.status(403).json({ error: 'WALLET_ALREADY_USED' });
    }

    // Check if fingerprint already used
    const usedFingerprint = await redis.get(`fingerprint:${fingerprint}`);
    if (usedFingerprint) {
      return res.status(403).json({ error: 'FINGERPRINT_ALREADY_USED' });
    }

    // Verify EIP-712 signature
    // Note: In production, use viem's verifyTypedData
    // For now, we trust the signature was verified by the client
    // TODO: Add full signature verification

    // Execute transfers
    const { executeTransfers } = await import('../services/hot-wallet-transfer.js');
    const { ethTx, usdcTx } = await executeTransfers(wallet as `0x${string}`);

    // Generate claim code for X post
    const claimCode = generateClaimCode();

    // Store used wallet/fingerprint
    await redis.set(`wallet:${wallet}`, JSON.stringify({
      fingerprint,
      ethTx,
      usdcTx,
      claimCode,
      timestamp: Date.now()
    }));

    await redis.set(`fingerprint:${fingerprint}`, JSON.stringify({
      wallet,
      timestamp: Date.now()
    }));

    // Clear challenge
    await redis.del(`challenge:${fingerprint}`);

    res.json({
      status: 'complete',
      ethTx,
      usdcTx,
      amounts: { eth: '0.0008', usdc: '2.00' },
      claimCode
    });
  } catch (error) {
    console.error('Bootstrap error:', error);
    if (error.message?.includes('LIMIT')) {
      return res.status(429).json({ error: error.message });
    }
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ─── X Post Verification Endpoint────────────────────────────────────────────

router.post('/verify-xpost', async (req, res) => {
  try {
    const { wallet, claimCode, tweetUrl } = req.body as XPostRequest;

    if (!wallet || !claimCode) {
      return res.status(400).json({ error: 'Missing wallet or claimCode' });
    }

    // Verify X post
    const { tweetId } = await verifyXPost(claimCode, wallet);

    // Execute bonus transfer
    const { executeTransfers } = await import('../services/hot-wallet-transfer.js');
    const { usdcTx } = await executeTransfers(wallet as `0x${string}`, { usdcBonus: '1.00' });

    res.json({
      status: 'bonus_issued',
      bonusTx: usdcTx,
      xmtpActivated: true,
      tweetId
    });
  } catch (error) {
    console.error('X verification error:', error);
    if (error.message?.includes('TWEET') || error.message?.includes('CLAIM')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ─── GDPR Forget Endpoint─────────────────────────────────────────────────────

router.delete('/forget', async (req, res) => {
  try {
    const { wallet, fingerprintHash } = req.body;

    if (!wallet && !fingerprintHash) {
      return res.status(400).json({ error: 'Missing wallet or fingerprintHash' });
    }

    // TODO: Verify EIP-712 signature for deletion request

    // Delete all records
    if (wallet) {
      await redis.del(`wallet:${wallet}`);
      await redis.del(`bootstrap:failed:${wallet}`);
    }

    if (fingerprintHash) {
      await redis.del(`fingerprint:${fingerprintHash}`);
    }

    res.status(204).send();
  } catch (error) {
    console.error('Forget error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;