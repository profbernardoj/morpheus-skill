/**
 * test/adversarial/router-attacks.test.mjs
 * Tests router against malicious/malformed V6 payloads.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setupTestEnv, teardownTestEnv, getTestDir } from '../fixtures/setup-test-env.mjs';

let router;

describe('Router Adversarial Tests', () => {
  before(async () => {
    await setupTestEnv();
    router = await import('../../src/router.mjs');
  });

  after(async () => {
    await teardownTestEnv();
  });

  it('handles missing payload gracefully', async () => {
    const ctx = {
      validatedV6: { messageType: 'COMMAND' }, // no payload
      message: { senderInboxId: '0xattacker' },
      conversation: {}
    };

    let nextCalled = false;
    await router.routerMiddleware(ctx, () => { nextCalled = true; });
    assert.ok(nextCalled, 'should not crash on missing payload');
  });

  it('sanitizes path traversal in correlationId', async () => {
    const ctx = {
      validatedV6: {
        messageType: 'DATA',
        correlationId: '../../../etc/passwd',
        payload: { evil: true }
      },
      message: { senderInboxId: '0xattacker' },
      conversation: {}
    };

    let nextCalled = false;
    await router.routerMiddleware(ctx, () => { nextCalled = true; });
    assert.ok(nextCalled, 'should not crash on path traversal attempt');

    // File should be inside inbox dir with sanitized name (dots/slashes replaced)
    const inboxDir = path.join(getTestDir(), 'inbox');
    const files = await fs.readdir(inboxDir);
    assert.ok(files.length > 0, 'should have written a sanitized file');

    // Verify the file is inside inbox, not outside
    for (const f of files) {
      assert.ok(!f.includes('..'), 'filename should not contain path traversal');
      assert.ok(!f.includes('/'), 'filename should not contain slashes');
    }

    // Cleanup
    for (const f of files) {
      await fs.unlink(path.join(inboxDir, f));
    }
  });

  it('handles extremely large payload without crash', async () => {
    const bigPayload = { data: 'x'.repeat(60000) }; // under 64KB V6 limit
    const ctx = {
      validatedV6: {
        messageType: 'DATA',
        correlationId: 'big-payload-test',
        payload: bigPayload
      },
      message: { senderInboxId: '0xtest' },
      conversation: {}
    };

    let nextCalled = false;
    await router.routerMiddleware(ctx, () => { nextCalled = true; });
    assert.ok(nextCalled);

    // Cleanup
    const fp = path.join(getTestDir(), 'inbox', 'big-payload-test.json');
    await fs.unlink(fp).catch(() => {});
  });

  it('handles unknown messageType without crash', async () => {
    const ctx = {
      validatedV6: { messageType: 'DOESNOTEXIST', payload: {} },
      message: { senderInboxId: '0xtest' },
      conversation: {}
    };

    let nextCalled = false;
    await router.routerMiddleware(ctx, () => { nextCalled = true; });
    assert.ok(nextCalled, 'unknown messageType should just pass through');

    // No file should be in inbox (only DATA writes)
    const files = await fs.readdir(path.join(getTestDir(), 'inbox'));
    assert.strictEqual(files.length, 0, 'unknown type should not write to inbox');
  });
});
