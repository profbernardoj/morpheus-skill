/**
 * test/unit/consent.test.mjs
 * Tests consent middleware policies: open, strict, handshake.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { setupTestEnv, teardownTestEnv } from '../fixtures/setup-test-env.mjs';

let consent;

describe('Consent Module', () => {
  before(async () => {
    await setupTestEnv();
    consent = await import('../../src/consent.mjs');
  });

  after(async () => {
    await teardownTestEnv();
  });

  describe('open policy', () => {
    before(async () => {
      await consent.initConsent({ xmtp: { consentPolicy: 'open' } });
    });

    it('passes all messages through', async () => {
      const ctx = { message: { senderInboxId: '0xunknown' } };
      let called = false;
      await consent.handleConsent(ctx, () => { called = true; });
      assert.ok(called, 'next() should be called for open policy');
    });

    it('passes even with no conversation context', async () => {
      const ctx = { message: { senderInboxId: '0xany' }, conversation: null };
      let called = false;
      await consent.handleConsent(ctx, () => { called = true; });
      assert.ok(called);
    });
  });

  describe('strict policy', () => {
    before(async () => {
      await consent.initConsent({ xmtp: { consentPolicy: 'strict' } });
    });

    it('drops unknown peers (next not called)', async () => {
      const ctx = { message: { senderInboxId: '0xstranger' } };
      let called = false;
      await consent.handleConsent(ctx, () => { called = true; });
      assert.ok(!called, 'next() should NOT be called for strict policy');
    });
  });

  describe('handshake policy (default)', () => {
    before(async () => {
      await consent.initConsent({ xmtp: { consentPolicy: 'handshake' } });
    });

    it('passes through to handshake flow', async () => {
      const ctx = { message: { senderInboxId: '0xnewpeer' } };
      let called = false;
      await consent.handleConsent(ctx, () => { called = true; });
      assert.ok(called, 'handshake policy should call next (for now)');
    });
  });

  describe('edge cases', () => {
    before(async () => {
      await consent.initConsent({ xmtp: { consentPolicy: 'strict' } });
    });

    it('passes through when no sender info', async () => {
      const ctx = { message: {} };
      let called = false;
      await consent.handleConsent(ctx, () => { called = true; });
      assert.ok(called, 'should pass through when sender is undefined');
    });

    it('passes through when message is null', async () => {
      const ctx = { message: null };
      let called = false;
      await consent.handleConsent(ctx, () => { called = true; });
      assert.ok(called, 'should pass through when message is null');
    });

    it('defaults to handshake when config missing', async () => {
      await consent.initConsent({});
      const ctx = { message: { senderInboxId: '0xtest' } };
      let called = false;
      await consent.handleConsent(ctx, () => { called = true; });
      assert.ok(called, 'default handshake should pass through');
    });
  });
});
