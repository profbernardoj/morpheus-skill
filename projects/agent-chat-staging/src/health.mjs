/**
 * src/health.mjs — status.json for OpenClaw heartbeat.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const XMTP_DIR = process.env.AGENT_CHAT_XMTP_DIR || path.join(os.homedir(), '.everclaw', 'xmtp');
const HEALTH_FILE = path.join(XMTP_DIR, 'health.json');

let getStatusFn; // cached import

export async function writeHealthFile(status) {
  if (!getStatusFn) {
    const mod = await import('./identity.mjs');
    getStatusFn = mod.getStatus;
  }

  const identityStatus = await getStatusFn();
  const health = {
    status,
    timestamp: new Date().toISOString(),
    inboxId: identityStatus.inboxId || 'unknown',
    messagesProcessed: 0 // TODO: wire counter
  };

  await fs.writeFile(HEALTH_FILE, JSON.stringify(health, null, 2));
}
