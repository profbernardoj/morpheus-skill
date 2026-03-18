/**
 * test/fixtures/setup-test-env.mjs
 * Creates an isolated temp directory with fake identity/secrets for testing.
 * Sets AGENT_CHAT_XMTP_DIR so all modules use the temp dir instead of ~/.everclaw/xmtp.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

let testDir;

export async function setupTestEnv() {
  testDir = path.join(os.tmpdir(), `agent-chat-test-${crypto.randomBytes(6).toString('hex')}`);
  await fs.mkdir(testDir, { recursive: true });
  await fs.mkdir(path.join(testDir, 'inbox'), { recursive: true });
  await fs.mkdir(path.join(testDir, 'outbox'), { recursive: true });

  // Set env BEFORE any module imports read it
  process.env.AGENT_CHAT_XMTP_DIR = testDir;

  // Write fake secrets
  const fakePrivateKey = '0x' + crypto.randomBytes(32).toString('hex');
  const fakeDbKey = crypto.createHash('sha256')
    .update('xmtp-comms-guard:db:' + fakePrivateKey)
    .digest('hex');

  await fs.writeFile(
    path.join(testDir, '.secrets.json'),
    JSON.stringify({ privateKey: fakePrivateKey, dbEncryptionKey: fakeDbKey }, null, 2)
  );

  // Write fake identity
  await fs.writeFile(
    path.join(testDir, 'identity.json'),
    JSON.stringify({
      address: '0x' + crypto.randomBytes(20).toString('hex'),
      inboxId: null,
      network: 'production',
      flavor: 'everclaw-test',
      createdAt: new Date().toISOString()
    }, null, 2)
  );

  return testDir;
}

export async function teardownTestEnv() {
  if (testDir) {
    await fs.rm(testDir, { recursive: true, force: true });
    delete process.env.AGENT_CHAT_XMTP_DIR;
    testDir = null;
  }
}

export function getTestDir() {
  return testDir;
}
