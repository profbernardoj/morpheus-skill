/**
 * test/unit/health.test.mjs
 * Tests health file writing with proper inboxId resolution.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setupTestEnv, teardownTestEnv, getTestDir } from '../fixtures/setup-test-env.mjs';

let health;

describe('Health Module', () => {
  before(async () => {
    await setupTestEnv();
    health = await import('../../src/health.mjs');
  });

  after(async () => {
    await teardownTestEnv();
  });

  it('writes health.json with running status', async () => {
    await health.writeHealthFile('running');

    const healthPath = path.join(getTestDir(), 'health.json');
    const content = JSON.parse(await fs.readFile(healthPath, 'utf8'));

    assert.strictEqual(content.status, 'running');
    assert.ok(content.timestamp, 'should have timestamp');
    assert.ok(new Date(content.timestamp).getTime() > 0, 'timestamp should be valid ISO');
    assert.strictEqual(typeof content.messagesProcessed, 'number');
  });

  it('inboxId is a string, not a Promise or object', async () => {
    await health.writeHealthFile('running');

    const healthPath = path.join(getTestDir(), 'health.json');
    const content = JSON.parse(await fs.readFile(healthPath, 'utf8'));

    assert.strictEqual(typeof content.inboxId, 'string', 'inboxId must be a string');
    assert.ok(content.inboxId !== '[object Promise]', 'inboxId must not be a serialized Promise');
    assert.ok(content.inboxId !== '{}', 'inboxId must not be empty object');
  });

  it('writes stopped status', async () => {
    await health.writeHealthFile('stopped');

    const healthPath = path.join(getTestDir(), 'health.json');
    const content = JSON.parse(await fs.readFile(healthPath, 'utf8'));

    assert.strictEqual(content.status, 'stopped');
  });
});
