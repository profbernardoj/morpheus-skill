/**
 * test/unit/router.test.mjs
 * Tests message routing: DATA → inbox file, COMMAND → log, passthrough for unknown.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setupTestEnv, teardownTestEnv, getTestDir } from '../fixtures/setup-test-env.mjs';
import { makeValidDataMessage, makeValidCommandMessage, makeMockCtx } from '../fixtures/v6-messages.mjs';

let router;

describe('Router Module', () => {
  before(async () => {
    await setupTestEnv();
    router = await import('../../src/router.mjs');
  });

  after(async () => {
    await teardownTestEnv();
  });

  it('passes through when no validatedV6 on context', async () => {
    const ctx = { validatedV6: null, message: {} };
    let called = false;
    await router.routerMiddleware(ctx, () => { called = true; });
    assert.ok(called, 'should call next when no V6 payload');
  });

  it('writes DATA message to inbox with correlationId as filename', async () => {
    const v6 = makeValidDataMessage({ correlationId: 'test-uuid-data-001' });
    const ctx = {
      validatedV6: v6,
      message: { senderInboxId: '0xsender' },
      conversation: { id: 'conv-test' }
    };

    let nextCalled = false;
    await router.routerMiddleware(ctx, () => { nextCalled = true; });

    assert.ok(nextCalled, 'should call next after routing');

    // Verify file was written
    const inboxPath = path.join(getTestDir(), 'inbox', 'test-uuid-data-001.json');
    const content = JSON.parse(await fs.readFile(inboxPath, 'utf8'));
    assert.strictEqual(content.messageType, 'DATA');
    assert.strictEqual(content.direction, 'inbound');
    assert.strictEqual(content.correlationId, 'test-uuid-data-001');

    // Cleanup
    await fs.unlink(inboxPath);
  });

  it('generates UUID filename when correlationId is missing', async () => {
    const v6 = makeValidDataMessage();
    delete v6.correlationId;
    const ctx = {
      validatedV6: v6,
      message: { senderInboxId: '0xsender' },
      conversation: { id: 'conv-test' }
    };

    await router.routerMiddleware(ctx, () => {});

    // Should have written a file with UUID name
    const files = await fs.readdir(path.join(getTestDir(), 'inbox'));
    assert.ok(files.length > 0, 'should have created an inbox file');

    // Cleanup
    for (const f of files) {
      await fs.unlink(path.join(getTestDir(), 'inbox', f));
    }
  });

  it('handles COMMAND message without crashing', async () => {
    const v6 = makeValidCommandMessage();
    const ctx = {
      validatedV6: v6,
      message: { senderInboxId: '0xsender' },
      conversation: { id: 'conv-test' }
    };

    let nextCalled = false;
    await router.routerMiddleware(ctx, () => { nextCalled = true; });
    assert.ok(nextCalled, 'COMMAND should pass through to next');
  });

  it('handles HANDSHAKE message type (passes through)', async () => {
    const v6 = { messageType: 'HANDSHAKE', payload: {} };
    const ctx = {
      validatedV6: v6,
      message: { senderInboxId: '0xsender' },
      conversation: {}
    };

    let nextCalled = false;
    await router.routerMiddleware(ctx, () => { nextCalled = true; });
    assert.ok(nextCalled, 'HANDSHAKE should pass through (TODO handler)');
  });
});
