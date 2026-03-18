/**
 * src/identity.mjs
 * Loads XMTP identity + secrets for Agent.create / createFromEnv.
 * DB path is the directory only (SDK auto-names files).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// Allow override via env for testing
const XMTP_DIR = process.env.AGENT_CHAT_XMTP_DIR || path.join(os.homedir(), '.everclaw', 'xmtp');
const SECRETS_FILE = path.join(XMTP_DIR, '.secrets.json');
const IDENTITY_FILE = path.join(XMTP_DIR, 'identity.json');

/**
 * Load secrets as real XMTP env-var names (used by daemon)
 */
export async function loadSecrets() {
  const data = JSON.parse(await fs.readFile(SECRETS_FILE, 'utf8'));

  // Runtime validation — catch truncated or malformed keys early
  if (data.privateKey && data.privateKey.length !== 66) {
    console.warn(`[Identity] WARNING: XMTP_WALLET_KEY length is ${data.privateKey.length}, expected 66 (0x + 64 hex)`);
  }

  return {
    XMTP_WALLET_KEY: data.privateKey,
    XMTP_DB_ENCRYPTION_KEY: data.dbEncryptionKey,
    XMTP_ENV: 'production'
  };
}

/**
 * Full identity for runtime
 */
export async function loadIdentity() {
  const metadata = JSON.parse(await fs.readFile(IDENTITY_FILE, 'utf8'));
  const secrets = await loadSecrets();

  return {
    metadata,
    secrets,
    dbPath: XMTP_DIR
  };
}

/**
 * Called by daemon after first Agent.create() to store the real inboxId
 */
export async function saveInboxId(inboxId) {
  const metadata = JSON.parse(await fs.readFile(IDENTITY_FILE, 'utf8'));
  metadata.inboxId = inboxId;
  await fs.writeFile(IDENTITY_FILE, JSON.stringify(metadata, null, 2));
}

/**
 * Quick status for CLI/health
 */
export async function getStatus() {
  try {
    const id = await loadIdentity();
    return {
      status: 'ready',
      address: id.metadata.address,
      inboxId: id.metadata.inboxId || 'pending-first-start'
    };
  } catch (err) {
    return { status: 'missing', error: err.message };
  }
}

export default { loadIdentity, loadSecrets, saveInboxId, getStatus };
