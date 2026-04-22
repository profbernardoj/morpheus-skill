/**
 * memory-backend.test.mjs — Automated tests for EverClaw memory backend
 *
 * Tests:
 *   1. FileBackend instantiation and status
 *   2. FileBackend search functionality
 *   3. MemPalace bridge availability check
 *   4. MemPalace backend status and search
 *   5. Backend factory selection (mempalace vs file)
 *   6. Fallback behavior when MemPalace unavailable
 *
 * Run: node --test tests/memory-backend.mjs
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import backends
const { FileBackend } = await import(
  join(__dirname, '../scripts/lib/file-backend.mjs')
);
const { MemPalaceBackend } = await import(
  join(__dirname, '../scripts/lib/mempalace-backend.mjs')
);
const { MemoryBackendFactory } = await import(
  join(__dirname, '../scripts/lib/memory-backend.mjs')
);

// Test directory
const TEST_MEMORY_DIR = join(homedir(), '.openclaw', 'workspace', 'memory');

describe('Memory Backend', () => {
  describe('FileBackend', () => {
    let backend;

    before(() => {
      backend = new FileBackend({ memoryDir: TEST_MEMORY_DIR });
    });

    it('should instantiate with valid directory', () => {
      assert.ok(backend, 'FileBackend should instantiate');
      assert.strictEqual(backend.name, 'FileBackend');
    });

    it('should report healthy status', async () => {
      const status = await backend.status();
      assert.ok(status.healthy, 'FileBackend should report healthy');
      assert.ok(typeof status.factCount === 'number', 'factCount should be a number');
      assert.ok(status.factCount > 0, 'Should have facts in default memory dir');
    });

    it('should return search results', async () => {
      const results = await backend.search('wallet encryption', { maxResults: 3 });
      assert.ok(Array.isArray(results), 'search should return array');
      // May be empty if memory doesn't contain query, that's OK
      if (results.length > 0) {
        assert.ok(results[0].content, 'Result should have content');
        assert.ok(typeof results[0].score === 'number', 'Result should have score');
      }
    });

    it('should handle non-existent directory gracefully', async () => {
      const badBackend = new FileBackend({ memoryDir: '/nonexistent/path/that/does/not/exist' });
      const status = await badBackend.status();
      assert.ok(!status.healthy, 'Should report unhealthy for non-existent dir');
    });
  });

  describe('MemPalace Backend', () => {
    let backend;
    let available = false;

    before(async () => {
      available = await MemoryBackendFactory.isBackendAvailable('mempalace');
      if (available) {
        backend = new MemPalaceBackend();
      }
    });

    it('should detect if MemPalace SDK is available', async () => {
      const isAvailable = await MemoryBackendFactory.isBackendAvailable('mempalace');
      assert.ok(typeof isAvailable === 'boolean', 'Should return boolean');
    });

    it('should detect if FileBackend is available', async () => {
      const isAvailable = await MemoryBackendFactory.isBackendAvailable('file');
      assert.ok(isAvailable, 'FileBackend should always be available');
    });

    it('should detect unknown backends', async () => {
      const isAvailable = await MemoryBackendFactory.isBackendAvailable('unknown');
      assert.ok(!isAvailable, 'Unknown backend should not be available');
    });

    it('should instantiate MemPalaceBackend (if available)', async () => {
      if (!available) return; // skip gracefully
      assert.ok(backend, 'MemPalaceBackend should instantiate');
      assert.strictEqual(backend.name, 'MemPalaceBackend');
    });

    it('should report status from MemPalace (if available)', async () => {
      if (!available) return;
      const status = await backend.status();
      assert.ok(typeof status.healthy === 'boolean', 'Should report healthy status');
      assert.ok(typeof status.factCount === 'number', 'Should report fact count');
    });

    it('should search MemPalace (if available)', async () => {
      if (!available) return;
      const results = await backend.search('wallet', { maxResults: 3 });
      assert.ok(Array.isArray(results), 'Should return array');
    });

    it('should get wake-up context (if available)', async () => {
      if (!available) return;
      const context = await backend.wakeUp({ maxTokens: 500 });
      assert.ok(typeof context === 'string', 'Should return string');
    });
  });

  describe('Backend Factory', () => {
    it('should return FileBackend for "file" type', async () => {
      const backend = await MemoryBackendFactory.create({ backend: 'file', file: { memoryDir: TEST_MEMORY_DIR } });
      assert.ok(backend instanceof FileBackend, 'Should return FileBackend instance');
    });

    it('should return MemPalaceBackend for "mempalace" type', async () => {
      const available = await MemoryBackendFactory.isBackendAvailable('mempalace');
      if (available) {
        const backend = await MemoryBackendFactory.create({ backend: 'mempalace' });
        assert.ok(backend instanceof MemPalaceBackend, 'Should return MemPalaceBackend');
      }
    });

    it('should throw for unknown type', async () => {
      try {
        await MemoryBackendFactory.create({ backend: 'unknown' });
        assert.fail('Should have thrown error');
      } catch (e) {
        assert.ok(e.message.includes('Unknown'), 'Should throw unknown backend error');
      }
    });

    it('should create FileBackend with config', async () => {
      const backend = await MemoryBackendFactory.create({ backend: 'file', file: { memoryDir: TEST_MEMORY_DIR } });
      assert.ok(backend, 'Should create backend with config');
    });
  });

  describe('Regression Tests', () => {
    it('should handle special characters in search queries', async () => {
      const backend = new FileBackend({ memoryDir: TEST_MEMORY_DIR });
      const results = await backend.search('test-with-dashes and "quotes" and \'apostrophes\'', {
        maxResults: 1,
      });
      assert.ok(Array.isArray(results), 'Should handle special chars');
    });

    it('should handle empty search queries', async () => {
      const backend = new FileBackend({ memoryDir: TEST_MEMORY_DIR });
      const results = await backend.search('', { maxResults: 10 });
      assert.ok(Array.isArray(results), 'Should handle empty query');
    });

    it('should handle very long queries', async () => {
      const backend = new FileBackend({ memoryDir: TEST_MEMORY_DIR });
      const longQuery = 'wallet encryption ' .repeat(100);
      const results = await backend.search(longQuery, { maxResults: 1 });
      assert.ok(Array.isArray(results), 'Should handle long queries');
    });

    it('should respect maxResults parameter', async () => {
      const backend = new FileBackend({ memoryDir: TEST_MEMORY_DIR });
      const results = await backend.search('the', { limit: 2 });
      assert.ok(results.length <= 2, 'Should respect limit');
    });
  });
});

// Export for running with node --test
export { describe, it, assert };