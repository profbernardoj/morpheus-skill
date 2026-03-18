#!/usr/bin/env node
/**
 * XMTP client wrapper for EverClaw agents — V3 Trust Framework.
 * Compatible with @xmtp/node-sdk v6.x
 *
 * V3 changes:
 * - Deterministic DB encryption key (derived from agent private key)
 * - V3 message builder helper
 * - EIP-191 signing for handshakes
 * - Structured message validation
 */
import { Client } from "@xmtp/node-sdk";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));

// V3 protocol constants
export const PROTOCOL_VERSION = "4.0";
export const MAX_MESSAGE_SIZE = 256 * 1024; // 256 KB

/**
 * Load agent identity from identities/<agentId>.json
 */
export function loadIdentity(agentId) {
  const path = join(__dirname, "identities", `${agentId}.json`);
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Create an EOA signer compatible with XMTP v6 signer interface.
 */
export function createSigner(privateKey) {
  const account = privateKeyToAccount(
    privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`
  );

  return {
    type: "EOA",
    getIdentifier: () => ({
      identifier: account.address.toLowerCase(),
      identifierKind: 0, // IdentifierKind.Ethereum
    }),
    signMessage: async (message) => {
      const msgStr =
        typeof message === "string"
          ? message
          : new TextDecoder().decode(message);
      const sig = await account.signMessage({ message: msgStr });
      return new Uint8Array(
        sig.slice(2).match(/.{2}/g).map((b) => parseInt(b, 16))
      );
    },
  };
}

/**
 * Create a viem account for EIP-191 message signing.
 */
export function createAccount(privateKey) {
  return privateKeyToAccount(
    privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`
  );
}

/**
 * Derive a deterministic DB encryption key from agent private key.
 * V3: persistent message history across sessions.
 */
function deriveDbKey(privateKey) {
  return createHash("sha256")
    .update(`xmtp-comms-guard:db:${privateKey}`)
    .digest();
}

/**
 * Initialize an XMTP client for the given agent.
 * V3: uses deterministic DB key for message persistence.
 */
export async function createAgentClient(agentId) {
  const identity = loadIdentity(agentId);
  const signer = createSigner(identity.privateKey);
  const account = createAccount(identity.privateKey);

  // Deterministic DB path + encryption key per agent
  const dbPath = join(__dirname, "data", `${agentId}.db3`);
  const dbEncryptionKey = deriveDbKey(identity.privateKey);

  const client = await Client.create(signer, {
    env: "production",
    dbPath,
    dbEncryptionKey,
  });

  console.log(`[${agentId}] XMTP client initialized (V3)`);
  console.log(`[${agentId}] Address: ${identity.address}`);
  console.log(`[${agentId}] Inbox ID: ${client.inboxId}`);

  return { client, identity, account };
}

/**
 * Build a V3 structured message.
 */
export function buildMessage({ messageType, payload, topics, sensitivity, intent, correlationId }) {
  return {
    messageType,
    version: PROTOCOL_VERSION,
    payload,
    topics,
    sensitivity: sensitivity || "technical",
    intent: intent || "query",
    correlationId: correlationId || crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    nonce: randomBytes(32).toString("base64"),
  };
}

/**
 * Build a V3 HANDSHAKE message with EIP-191 signed challenge.
 */
export async function buildHandshake(account, identity, conversationId) {
  const challenge = {
    conversationId,
    timestamp: new Date().toISOString(),
    nonce: randomBytes(32).toString("base64"),
    version: PROTOCOL_VERSION,
  };

  // Canonical challenge string for EIP-191 signing
  const canonicalChallenge = [
    `xmtp-comms-guard:handshake:v${challenge.version}`,
    `conversation:${challenge.conversationId}`,
    `timestamp:${challenge.timestamp}`,
    `nonce:${challenge.nonce}`,
  ].join("\n");

  const challengeSignature = await account.signMessage({ message: canonicalChallenge });

  return buildMessage({
    messageType: "HANDSHAKE",
    payload: {
      challenge,
      challengeSignature,
      agentId: identity.agentId,
      walletAddress: identity.address,
      capabilities: ["xmtp.v3", "command.exec", "skill.mgmt"],
    },
    topics: ["everclaw", "infrastructure"],
    sensitivity: "technical",
    intent: "handshake",
  });
}

/**
 * Build a V3 RESPONSE to a HANDSHAKE with counter-signature.
 */
export async function buildHandshakeResponse(account, identity, originalMessage) {
  // Counter-sign the original challenge to prove identity
  const challenge = originalMessage.payload.challenge;
  const canonicalChallenge = [
    `xmtp-comms-guard:handshake:v${challenge.version}`,
    `conversation:${challenge.conversationId}`,
    `timestamp:${challenge.timestamp}`,
    `nonce:${challenge.nonce}`,
  ].join("\n");

  const challengeResponse = await account.signMessage({ message: canonicalChallenge });

  return buildMessage({
    messageType: "RESPONSE",
    payload: {
      status: "SUCCESS",
      challengeResponse,
      result: {
        agentId: identity.agentId,
        walletAddress: identity.address,
        message: `${identity.agentId} agent operational. Handshake verified.`,
      },
    },
    topics: originalMessage.topics,
    sensitivity: originalMessage.sensitivity,
    intent: "handshake",
    correlationId: originalMessage.correlationId,
  });
}

/**
 * Build a V3 BYE message with signed revocation receipt.
 */
export async function buildBye(account, identity, reason, conversationId) {
  const receipt = await account.signMessage({
    message: `xmtp-comms-guard:bye:${conversationId}:${new Date().toISOString()}`,
  });

  return buildMessage({
    messageType: "BYE",
    payload: {
      reason,
      revocationReceipt: receipt,
    },
    topics: ["general"],
    sensitivity: "public",
    intent: "revoke",
  });
}

/**
 * Validate that a message conforms to V3 structure.
 * Returns { valid: boolean, errors?: string[] }
 */
export function validateMessage(msg) {
  const errors = [];
  const required = ["messageType", "version", "payload", "topics", "sensitivity", "intent", "correlationId", "timestamp", "nonce"];
  for (const field of required) {
    if (!(field in msg)) errors.push(`Missing required field: ${field}`);
  }
  if (msg.version && msg.version !== PROTOCOL_VERSION) {
    errors.push(`Unsupported version: ${msg.version} (expected ${PROTOCOL_VERSION})`);
  }
  if (msg.topics && (!Array.isArray(msg.topics) || msg.topics.length === 0)) {
    errors.push("topics must be a non-empty array");
  }
  if (msg.nonce && msg.nonce.length < 32) {
    errors.push("nonce must be at least 32 characters");
  }
  const size = JSON.stringify(msg).length;
  if (size > MAX_MESSAGE_SIZE) {
    errors.push(`Message exceeds ${MAX_MESSAGE_SIZE} byte limit (${size})`);
  }
  return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
}
