/**
 * test/unit/payer.test.mjs
 * Tests the Phase 1 fee stub.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { checkPayerAllowance } from '../../src/payer.mjs';

describe('Payer Stub (Phase 1)', () => {
  it('always returns ok with infinite balance', async () => {
    const result = await checkPayerAllowance();
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.balance, Infinity);
  });
});
