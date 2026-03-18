#!/usr/bin/env node
/**
 * setup-identity.mjs
 * Generates XMTP keys and stores them securely locally (v1).
 * Inbox ID is registered lazily on first daemon start.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const XMTP_DIR = process.env.AGENT_CHAT_XMTP_DIR || path.join(os.homedir(), '.everclaw', 'xmtp');
const SECRETS_FILE = path.join(XMTP_DIR, '.secrets.json');
const IDENTITY_FILE = path.join(XMTP_DIR, 'identity.json');

async function ensureDir() {
  await fs.mkdir(XMTP_DIR, { recursive: true });
  await fs.chmod(XMTP_DIR, 0o700);
}

async function deriveDbKey(privateKey) {
  // Aligned with original PoC for future compatibility
  return crypto.createHash('sha256')
    .update('xmtp-comms-guard:db:' + privateKey)
    .digest('hex');
}

async function main() {
  console.log('🔑 Setting up XMTP identity for this agent...\n');

  await ensureDir();

  // Idempotency
  try {
    const existing = JSON.parse(await fs.readFile(IDENTITY_FILE, 'utf8'));
    console.log('✅ Already configured');
    console.log(`  Address : ${existing.address}`);
    return;
  } catch {}

  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const address = account.address;

  const dbEncryptionKey = await deriveDbKey(privateKey);

  const secrets = { privateKey, dbEncryptionKey };
  await fs.writeFile(SECRETS_FILE, JSON.stringify(secrets, null, 2));
  await fs.chmod(SECRETS_FILE, 0o600);

  // TODO: Phase 2 — migrate to 1Password (op) or OS keychain

  const identityData = {
    address,
    inboxId: null, // set on first daemon start
    network: 'production',
    flavor: process.env.EVERCLAW_FLAVOR || 'everclaw',
    createdAt: new Date().toISOString()
  };

  await fs.writeFile(IDENTITY_FILE, JSON.stringify(identityData, null, 2));

  // Post-setup PII sanity check — ensure no real addresses leaked into source
  const srcDir = path.resolve(path.dirname(new URL(import.meta.url).pathname));
  const srcFiles = (await fs.readdir(path.join(srcDir, 'src')).catch(() => []))
    .filter(f => f.endsWith('.mjs'));
  for (const f of srcFiles) {
    const content = await fs.readFile(path.join(srcDir, 'src', f), 'utf8');
    if (content.includes(address)) {
      console.warn(`⚠️  WARNING: Your address ${address} found in src/${f} — possible PII leak!`);
    }
  }

  console.log('✅ XMTP identity created!');
  console.log(`  Address : ${address}`);
  console.log(`  Secrets : ${SECRETS_FILE} (chmod 600)`);
  console.log('\nRun the daemon once to register your inbox ID on the XMTP network.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error('❌', err.message); process.exit(1); });
}

export { main as setupIdentity };
