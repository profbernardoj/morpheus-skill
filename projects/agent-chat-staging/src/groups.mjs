/**
 * src/groups.mjs
 * Loads and manages groups.json — maps XMTP conversation IDs to OpenClaw sessions.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const XMTP_DIR = process.env.AGENT_CHAT_XMTP_DIR || path.join(os.homedir(), '.everclaw', 'xmtp');
const GROUPS_FILE = path.join(XMTP_DIR, 'groups.json');

export async function loadGroups() {
  try {
    const data = JSON.parse(await fs.readFile(GROUPS_FILE, 'utf8'));
    return data.groups || {};
  } catch {
    return {};
  }
}

export async function saveGroup(conversationId, config) {
  const groups = await loadGroups();
  groups[conversationId] = {
    ...config,
    name: config.name,
    openclawSession: config.openclawSession,
    topics: config.topics || [],
    autoJoin: config.autoJoin ?? false,
    consentPolicyOverride: config.consentPolicyOverride || null
  };

  await fs.mkdir(path.dirname(GROUPS_FILE), { recursive: true });
  await fs.writeFile(GROUPS_FILE, JSON.stringify({ groups }, null, 2));
}

export default { loadGroups, saveGroup };
