/**
 * test/fixtures/v6-messages.mjs
 * Valid V6 structured messages matching AgentMessageSchema from xmtp-comms-guard.
 * Schema requires: messageType, version:"6.0", payload, topics, sensitivity, intent,
 *                  correlationId (UUID), timestamp (ISO datetime), nonce (base64 44 chars)
 */

import crypto from 'node:crypto';

function makeNonce() {
  return crypto.randomBytes(32).toString('base64');
}

function makeUUID() {
  return crypto.randomUUID();
}

export function makeValidDataMessage(overrides = {}) {
  return {
    messageType: 'DATA',
    version: '6.0',
    payload: { key: 'value', data: 'test-payload' },
    topics: ['everclaw'],
    sensitivity: 'public',
    intent: 'update',
    correlationId: makeUUID(),
    timestamp: new Date().toISOString(),
    nonce: makeNonce(),
    ...overrides
  };
}

export function makeValidCommandMessage(overrides = {}) {
  return {
    messageType: 'COMMAND',
    version: '6.0',
    payload: { command: 'ping', args: ['hello'] },
    topics: ['infrastructure'],
    sensitivity: 'technical',
    intent: 'query',
    correlationId: makeUUID(),
    timestamp: new Date().toISOString(),
    nonce: makeNonce(),
    ...overrides
  };
}

export function makeHandshakeMessage(overrides = {}) {
  return {
    messageType: 'HANDSHAKE',
    version: '6.0',
    payload: { agentName: 'test-agent', capabilities: ['chat'] },
    topics: ['everclaw'],
    sensitivity: 'public',
    intent: 'introduce',
    correlationId: makeUUID(),
    timestamp: new Date().toISOString(),
    nonce: makeNonce(),
    ...overrides
  };
}

export function makeMalformedMessage() {
  return { id: 'bad', messageType: 'INVALID' };
}

/**
 * Create a mock agent-sdk context object
 */
export function makeMockCtx(content, overrides = {}) {
  return {
    message: {
      content: typeof content === 'string' ? content : JSON.stringify(content),
      senderInboxId: '0xabcdef1234567890',
      senderAddress: '0xabcdef1234567890',
      timestamp: Date.now(),
      ...(overrides.message || {})
    },
    conversation: {
      id: 'conv-test-123',
      ...(overrides.conversation || {})
    },
    validatedV6: overrides.validatedV6 || null,
    ...overrides
  };
}
