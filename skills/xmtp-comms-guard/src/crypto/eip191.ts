/**
 * EIP-191 signing for XMTP V6 Trust Framework handshake.
 * Keys managed by Bagman in production.
 * Identity directory must be passed explicitly — no hardcoded defaults.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";

interface AgentIdentity {
  agentId: string;
  address: string;
  privateKey: string;
  createdAt: string;
  network: string;
  purpose: string;
}

export interface HandshakeChallenge {
  conversationId: string;
  timestamp: string;
  nonce: string;
  version: string;
}

let _viemAccount: any = null;
let _identity: AgentIdentity | null = null;

/**
 * Load agent identity from configured identities directory.
 * @param identitiesDir - Required path (no default — must be explicit)
 */
export function loadAgentIdentity(agentId: string, identitiesDir: string): AgentIdentity {
  const path = join(identitiesDir, `${agentId}.json`);
  const identity = JSON.parse(readFileSync(path, "utf8")) as AgentIdentity;
  _identity = identity;
  return identity;
}

async function getAccount(privateKey: string) {
  if (!_viemAccount) {
    const { privateKeyToAccount } = await import("viem/accounts");
    const key = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
    _viemAccount = privateKeyToAccount(key as `0x${string}`);
  }
  return _viemAccount;
}

export function createChallenge(conversationId: string): HandshakeChallenge {
  return {
    conversationId,
    timestamp: new Date().toISOString(),
    nonce: randomBytes(32).toString("base64"),
    version: "6.0",
  };
}

export async function signChallenge(
  challenge: HandshakeChallenge,
  privateKey: string
): Promise<string> {
  const account = await getAccount(privateKey);
  return await account.signMessage({ message: canonicalizeChallenge(challenge) });
}

export async function verifyChallenge(
  challenge: HandshakeChallenge,
  signature: string,
  expectedAddress: string
): Promise<boolean> {
  const { verifyMessage } = await import("viem");
  return await verifyMessage({
    address: expectedAddress as `0x${string}`,
    message: canonicalizeChallenge(challenge),
    signature: signature as `0x${string}`,
  });
}

export async function signData(data: any, privateKey: string): Promise<string> {
  const account = await getAccount(privateKey);
  const message = createHash("sha256").update(JSON.stringify(data)).digest("hex");
  return await account.signMessage({ message });
}

export function getAgentAddress(): string | null {
  return _identity?.address || null;
}

function canonicalizeChallenge(challenge: HandshakeChallenge): string {
  return [
    `xmtp-comms-guard:handshake:v${challenge.version}`,
    `conversation:${challenge.conversationId}`,
    `timestamp:${challenge.timestamp}`,
    `nonce:${challenge.nonce}`,
  ].join("\n");
}
