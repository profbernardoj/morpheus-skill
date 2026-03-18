/**
 * test/unit/groups.test.mjs
 * Tests groups.json loading, saving, and per-group overrides.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setupTestEnv, teardownTestEnv, getTestDir } from '../fixtures/setup-test-env.mjs';

let groups;

describe('Groups Module', () => {
  before(async () => {
    await setupTestEnv();
    groups = await import('../../src/groups.mjs');
  });

  after(async () => {
    await teardownTestEnv();
  });

  it('returns empty object when no groups.json exists', async () => {
    const result = await groups.loadGroups();
    assert.deepStrictEqual(result, {});
  });

  it('saves a group mapping', async () => {
    await groups.saveGroup('conv-123', {
      name: 'test-ops',
      openclawSession: 'everclaw',
      topics: ['infrastructure'],
      autoJoin: true,
      consentPolicyOverride: 'open'
    });

    const result = await groups.loadGroups();
    assert.ok(result['conv-123']);
    assert.strictEqual(result['conv-123'].name, 'test-ops');
    assert.strictEqual(result['conv-123'].openclawSession, 'everclaw');
    assert.deepStrictEqual(result['conv-123'].topics, ['infrastructure']);
    assert.strictEqual(result['conv-123'].autoJoin, true);
    assert.strictEqual(result['conv-123'].consentPolicyOverride, 'open');
  });

  it('saves multiple groups', async () => {
    await groups.saveGroup('conv-456', {
      name: 'user-support',
      openclawSession: 'support',
      topics: ['help']
    });

    const result = await groups.loadGroups();
    assert.ok(result['conv-123'], 'first group should still exist');
    assert.ok(result['conv-456'], 'second group should exist');
    assert.strictEqual(result['conv-456'].autoJoin, false, 'autoJoin should default to false');
    assert.strictEqual(result['conv-456'].consentPolicyOverride, null, 'override should default to null');
  });

  it('updates an existing group', async () => {
    await groups.saveGroup('conv-123', {
      name: 'test-ops-updated',
      openclawSession: 'everclaw-v2',
      topics: ['infrastructure', 'updates']
    });

    const result = await groups.loadGroups();
    assert.strictEqual(result['conv-123'].name, 'test-ops-updated');
    assert.strictEqual(result['conv-123'].openclawSession, 'everclaw-v2');
    assert.deepStrictEqual(result['conv-123'].topics, ['infrastructure', 'updates']);
  });

  it('persists to disk as valid JSON', async () => {
    const raw = JSON.parse(await fs.readFile(path.join(getTestDir(), 'groups.json'), 'utf8'));
    assert.ok(raw.groups, 'should have groups key');
    assert.ok(raw.groups['conv-123']);
    assert.ok(raw.groups['conv-456']);
  });
});
