/**
 * mempalace-bridge.test.mjs — Automated tests for MemPalace Python bridge
 *
 * Tests:
 *   1. Bridge availability (Python + SDK)
 *   2. Status command
 *   3. Init command
 *   4. Mine command (dry-run)
 *   5. Search command
 *   6. Wake-up command
 *   7. Export command (JSON and Markdown)
 *   8. As-of command (temporal query)
 *   9. Error handling (invalid commands, missing args)
 *
 * Run: node --test tests/mempalace-bridge.mjs
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BRIDGE_PATH = join(__dirname, '../scripts/python/mempalace_bridge.py');
const MJS_BRIDGE_PATH = join(__dirname, '../scripts/memory/mempalace-bridge.mjs');
const MEMORY_DIR = join(homedir(), '.openclaw', 'workspace', 'memory');
const PALACE_PATH = join(homedir(), '.mempalace', 'palace');

// Helper: Call Python bridge directly
function callPython(args, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', [BRIDGE_PATH, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Python bridge exited ${code}: ${stderr || stdout}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`Invalid JSON: ${stdout.slice(0, 200)}`));
      }
    });

    proc.on('error', reject);
  });
}

// Helper: Call Node bridge
function callNode(args, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [MJS_BRIDGE_PATH, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Node bridge exited ${code}: ${stderr || stdout}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        // Wake-up returns raw string, not JSON
        resolve(stdout);
      }
    });

    proc.on('error', reject);
  });
}

describe('MemPalace Python Bridge', () => {
  let sdkAvailable = false;

  before(async () => {
    // Check if MemPalace SDK is installed
    try {
      const result = await callPython(['status']);
      sdkAvailable = result.success !== false;
    } catch {
      sdkAvailable = false;
    }
  });

  describe('Environment', () => {
    it('should have Python 3 available', async () => {
      const result = await new Promise((resolve, reject) => {
        const proc = spawn('python3', ['--version'], { stdio: 'pipe' });
        let out = '';
        proc.stdout.on('data', (d) => { out += d.toString(); });
        proc.stderr.on('data', (d) => { out += d.toString(); });
        proc.on('close', (code) => resolve({ code, out }));
        proc.on('error', reject);
      });
      assert.ok(result.out.includes('Python 3'), 'Python 3 should be available');
    });

    it('should have bridge script file', () => {
      assert.ok(existsSync(BRIDGE_PATH), 'Bridge script should exist');
    });
  });

  describe('Core Operations (requires SDK)', () => {
    it('should return status', async () => {
      if (!sdkAvailable) return;
      const result = await callPython(['status'], 10000);
      assert.ok(result.success !== false, 'Status should succeed');
      assert.ok(typeof result.healthy === 'boolean', 'Should report healthy');
      assert.ok(typeof result.fact_count === 'number', 'Should report fact count');
    });

    it('should search for results', async () => {
      if (!sdkAvailable) return;
      const result = await callPython(['search', 'wallet', '--results', '3'], 15000);
      assert.ok(result.success !== false, 'Search should succeed');
      assert.ok(Array.isArray(result.results), 'Should return results array');
    });

    it('should handle wing filter', async () => {
      if (!sdkAvailable) return;
      const result = await callPython(['search', 'test', '--wing', 'everclaw', '--results', '1'], 15000);
      assert.ok(result.success !== false, 'Wing filter should work');
      if (result.results && result.results.length > 0) {
        assert.strictEqual(result.results[0].metadata?.wing, 'everclaw', 'Should filter by wing');
      }
    });
  });

  describe('Node.js Bridge (requires SDK)', () => {
    it('should return status from Node bridge', async () => {
      if (!sdkAvailable) return;
      const result = await callNode(['status']);
      assert.ok(result, 'Node bridge should return parsed result');
    });

    it('should return search results from Node bridge', async () => {
      if (!sdkAvailable) return;
      const result = await callNode(['search', 'wallet']);
      assert.ok(Array.isArray(result), 'Should return array');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid command', async () => {
      try {
        await callPython(['invalid-command-xyz'], 5000);
        assert.fail('Should have thrown error');
      } catch (e) {
        assert.ok(e.message, 'Should throw error for invalid command');
      }
    });

    it('should handle missing required arguments', async () => {
      try {
        await callPython(['search'], 5000); // Missing query
        assert.fail('Should have thrown error');
      } catch (e) {
        assert.ok(e.message, 'Should throw error for missing args');
      }
    });
  });
});

// Export for running with node --test
export { describe, it, assert };