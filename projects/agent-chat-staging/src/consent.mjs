/**
 * src/consent.mjs
 * XMTP consent gate — runs BEFORE comms-guard (per architecture).
 */

import { loadGroups } from './groups.mjs';

let globalPolicy = 'handshake';

export async function initConsent(config) {
  globalPolicy = config?.xmtp?.consentPolicy || 'handshake';
  console.log(`[Consent] Global policy: ${globalPolicy}`);
}

/**
 * Middleware: consent check + handshake flow
 */
export async function handleConsent(ctx, next) {
  const sender = ctx.message?.senderInboxId || ctx.message?.senderAddress;
  if (!sender) return next();

  const groups = await loadGroups();
  const groupOverride = groups[ctx.conversation?.id]?.consentPolicyOverride;
  const policy = groupOverride || globalPolicy;

  if (policy === 'open') {
    // TODO: Verify exact agent-sdk consent API
    return next();
  }

  if (policy === 'strict') {
    console.log(`[Consent] Blocked unknown peer: ${sender}`);
    return; // drop
  }

  // handshake policy (default for users)
  console.log(`[Consent] New peer ${sender} — initiating V6 handshake`);
  // TODO: Send HANDSHAKE V6 message (Phase D)
  return next();
}

export default { initConsent, handleConsent };
