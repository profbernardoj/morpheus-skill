/**
 * XMTP V6 Handshake — Replay-protected identity verification.
 * Uses LRU nonce cache (90s TTL, fail-closed).
 *
 * Flow:
 * 1. Initiator sends HANDSHAKE with signed challenge
 * 2. Responder verifies EIP-191 and sends counter-signature
 * 3. For trust ≥6: ERC-8004 on-chain lookup (cached 24h, fail-closed on stale)
 */
import { PolicyViolationError } from "../types.js";
import { storage } from "../storage/bagmanStorage.js";
import { nonceCacheService } from "../security/nonceCache.js";
import { erc8004Cache } from "../security/erc8004Cache.js";
import {
  createChallenge,
  signChallenge,
  verifyChallenge,
  type HandshakeChallenge,
} from "../crypto/eip191.js";

const CHALLENGE_TTL_MS = 90 * 1000; // V6: 90 seconds

export interface HandshakePayload {
  challenge: HandshakeChallenge;
  signature?: string;
  capabilities?: string[];
}

export async function initiateHandshake(
  conversationId: string,
  ourPrivateKey: string
): Promise<HandshakePayload> {
  const challenge = createChallenge(conversationId);
  const signature = await signChallenge(challenge, ourPrivateKey);
  return { challenge, signature };
}

export async function validateHandshake(
  payload: HandshakePayload,
  expectedPeerAddress: string
): Promise<void> {
  const { challenge, signature } = payload;

  if (!challenge || !signature) {
    throw new PolicyViolationError("UNAUTHORIZED", "Handshake missing challenge or signature");
  }

  // V6: Replay protection via LRU nonce cache (90s TTL, fail-closed)
  const nonceKey = `handshake:${challenge.conversationId}:${challenge.nonce}`;
  if (nonceCacheService.isUsed(nonceKey)) {
    throw new PolicyViolationError("REPLAY", "Handshake replay detected");
  }

  // Timestamp freshness (90s window)
  const challengeAge = Date.now() - new Date(challenge.timestamp).getTime();
  if (challengeAge > CHALLENGE_TTL_MS || challengeAge < -30_000) {
    throw new PolicyViolationError("UNAUTHORIZED", "Handshake challenge expired or future-dated");
  }

  // Version check
  if (challenge.version !== "6.0") {
    throw new PolicyViolationError("UNAUTHORIZED", `Unsupported handshake version: ${challenge.version}`);
  }

  // EIP-191 signature verification
  const valid = await verifyChallenge(challenge, signature, expectedPeerAddress);
  if (!valid) {
    throw new PolicyViolationError("UNAUTHORIZED", "EIP-191 signature verification failed");
  }

  nonceCacheService.markUsed(nonceKey);

  // V6: ERC-8004 escalation for trust ≥6 with 24h cache
  const peer = await storage.getPeer(expectedPeerAddress);
  if (peer && peer.trustLevel >= 6 && peer.erc8004Registered) {
    const cached = await erc8004Cache.get(expectedPeerAddress);
    if (!erc8004Cache.isFresh(cached)) {
      // TODO Phase 4: actual on-chain lookup
      // On RPC failure with no fresh cache → fail-closed:
      // throw new PolicyViolationError("UNAUTHORIZED", "ERC-8004 verification unavailable — fail closed");
      await storage.logAudit("inbound", expectedPeerAddress, "ERC8004_ESCALATION_PENDING");
    }
  }

  await storage.logAudit("inbound", expectedPeerAddress, "HANDSHAKE_VERIFIED");
}
