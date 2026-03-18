#!/usr/bin/env node
/**
 * Generate XMTP keypairs for agent-to-agent messaging.
 * Creates two identities: "morpheusai" and "everclaw"
 * Keys are stored in identities/ directory (gitignored).
 */
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const identDir = join(__dirname, "identities");
mkdirSync(identDir, { recursive: true });

const agents = ["morpheusai", "everclaw"];

for (const name of agents) {
  const path = join(identDir, `${name}.json`);
  if (existsSync(path)) {
    console.log(`⏭️  ${name}: already exists, skipping`);
    continue;
  }

  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);

  const identity = {
    agentId: name,
    address: account.address,
    privateKey,
    createdAt: new Date().toISOString(),
    network: "xmtp-production",
    purpose: "XMTP agent-to-agent messaging (no on-chain funds needed)",
  };

  writeFileSync(path, JSON.stringify(identity, null, 2) + "\n");
  console.log(`✅ ${name}: ${account.address}`);
}

// Write .gitignore for identities
const gi = join(identDir, ".gitignore");
if (!existsSync(gi)) {
  writeFileSync(gi, "*.json\n");
}

console.log("\nDone. Keys saved to identities/");
