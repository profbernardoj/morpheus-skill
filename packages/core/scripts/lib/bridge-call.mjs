/**
 * bridge-call.mjs — Shared Python bridge communication utility
 *
 * Single source of truth for calling mempalace_bridge.py via spawn().
 * Used by both MemPalaceBackend and mempalace-search-hook.
 *
 * @module bridge-call
 */

import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_BRIDGE_PATH = join(__dirname, '..', 'python', 'mempalace_bridge.py');

/**
 * Call the Python bridge and return parsed JSON.
 *
 * @param {string[]} args - Arguments for mempalace_bridge.py
 * @param {Object} [options]
 * @param {number} [options.timeout=60000] - Timeout in ms
 * @param {string} [options.bridgePath] - Override bridge script path
 * @param {string} [options.pythonPath='python3'] - Python binary
 * @param {boolean} [options.rejectOnError=true] - If false, resolve with error object instead of rejecting
 * @returns {Promise<Object>} Parsed JSON result
 */
export function callPythonBridge(args, options = {}) {
  const {
    timeout = 60_000,
    bridgePath = DEFAULT_BRIDGE_PATH,
    pythonPath = 'python3',
    rejectOnError = true,
  } = options;

  return new Promise((resolve, reject) => {
    const proc = spawn(pythonPath, [bridgePath, ...args], {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      timeout,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      try {
        const result = JSON.parse(stdout.trim());

        if (!result.success && rejectOnError) {
          const err = new Error(result.error || 'MemPalace bridge error');
          err.hint = result.hint;
          reject(err);
          return;
        }

        resolve(result);
      } catch {
        const errorMsg = `MemPalace bridge failed (exit ${code}): ${stderr || stdout || 'no output'}`;
        if (rejectOnError) {
          reject(new Error(errorMsg));
        } else {
          resolve({ success: false, error: errorMsg });
        }
      }
    });

    proc.on('error', (err) => {
      const errorMsg = `Failed to spawn Python bridge: ${err.message}`;
      if (rejectOnError) {
        reject(new Error(errorMsg));
      } else {
        resolve({ success: false, error: errorMsg });
      }
    });
  });
}
