/**
 * test/adversarial/consent-attacks.test.mjs
 * Tests consent module against adversarial inputs.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { setupTestEnv, teardownTestEnv } from '../fixtures/setup-test-env.mjs';

let consent;

describe('Consent Adversarial Tests', () => {
  before(async () => {
    await setupTestEnv();
    consent = await import('../../src/consent.mjs');
  });

  after(async () => {
    await teardownTestEnv();
  });

  it('strict policy blocks even with spoofed group override attempt', async () => {
    await consent.initConsent({ xmtp: { consentPolicy: 'strict' } });

    // Attacker can't override policy by injecting conversation.id that matches a group
    // because groups.json is empty in test env
    const ctx = {
      message: { senderInboxId: '0xattacker' },
      conversation: { id: 'fake-group-with-open-policy' }
    };

    let called = false;
    await consent.handleConsent(ctx, () => { called = true; });
    assert.ok(!called, 'strict should block even with fake conversation id');
  });

  it('handles extremely long sender address without crash', async () => {
    await consent.initConsent({ xmtp: { consentPolicy: 'open' } });

    const ctx = {
      message: { senderInboxId: '0x' + 'a'.repeat(10000) }
    };

    let called = false;
    await consent.handleConsent(ctx, () => { called = true; });
    assert.ok(called, 'should handle long address gracefully');
  });

  it('handles null/undefined fields without throwing', async () => {
    await consent.initConsent({ xmtp: { consentPolicy: 'handshake' } });

    const edgeCases = [
      { message: undefined },
      { message: { senderInboxId: undefined, senderAddress: undefined } },
      {},
      { message: { senderInboxId: '' } },
    ];

    for (const ctx of edgeCases) {
      let called = false;
      // Should not throw
      await consent.handleConsent(ctx, () => { called = true; });
      // Empty/undefined sender should pass through (no sender = skip check)
    }
  });

  it('handles concurrent consent checks without race condition', async () => {
    await consent.initConsent({ xmtp: { consentPolicy: 'open' } });

    const promises = Array.from({ length: 50 }, (_, i) => {
      const ctx = { message: { senderInboxId: `0xpeer${i}` } };
      return new Promise((resolve) => {
        consent.handleConsent(ctx, () => { resolve(true); });
      });
    });

    const results = await Promise.all(promises);
    assert.strictEqual(results.length, 50, 'all 50 concurrent checks should complete');
    assert.ok(results.every(r => r === true), 'all should pass with open policy');
  });
});
