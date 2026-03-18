/**
 * src/router.mjs
 * DM/Group/Command dispatch + OpenClaw inbox injection.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { loadGroups } from './groups.mjs';

const XMTP_DIR = process.env.AGENT_CHAT_XMTP_DIR || path.join(os.homedir(), '.everclaw', 'xmtp');

export async function routerMiddleware(ctx, next) {
  const v6 = ctx.validatedV6;
  if (!v6) return next();

  const groups = await loadGroups();
  const groupConfig = groups[ctx.conversation?.id];

  console.log(`[Router] ${v6.messageType} from ${ctx.message?.senderInboxId}`);

  // COMMAND → skill dispatch (V6 uses v6.payload)
  if (v6.messageType === 'COMMAND') {
    console.log(`[Router] Executing command: ${v6.payload?.command}`);
    // TODO: OpenClaw skill API call (Stage 4)
  }

  // DATA → write to inbox for OpenClaw
  if (v6.messageType === 'DATA') {
    // Sanitize correlationId to prevent path traversal
    const rawId = v6.correlationId || crypto.randomUUID();
    const fileId = rawId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const inboxDir = path.join(XMTP_DIR, 'inbox');
    await fs.mkdir(inboxDir, { recursive: true });
    const inboxPath = path.join(inboxDir, `${fileId}.json`);
    await fs.writeFile(inboxPath, JSON.stringify({ ...v6, direction: 'inbound' }, null, 2));
  }

  // TODO: handle HANDSHAKE / RESPONSE / BYE / INTRODUCTION (Stage 4)

  return next();
}
