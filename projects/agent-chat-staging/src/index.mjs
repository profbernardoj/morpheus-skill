/**
 * src/index.mjs
 * Public API for other EverClaw skills to import.
 */

export { default as identity } from './identity.mjs';
export { loadIdentity, loadSecrets, saveInboxId, getStatus } from './identity.mjs';
