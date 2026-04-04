#!/usr/bin/env node

/**
 * EverClaw Bootstrap — Starter Key for GLM-5 Inference
 *
 * Automatically provisions a free EverClaw key for new users,
 * enabling immediate access to GLM-5 via Morpheus Gateway without
 * requiring sign-up or API key configuration.
 *
 * Usage:
 *   node bootstrap-everclaw.mjs              # Bootstrap (default)
 *   node bootstrap-everclaw.mjs --setup      # Same as above
 *   node bootstrap-everclaw.mjs --status     # Show key status
 *   node bootstrap-everclaw.mjs --test       # Test inference
 *   node bootstrap-everclaw.mjs --revoke     # Remove key (graduation)
 *
 * The bootstrap key provides:
 *   - 1000 requests/day
 *   - 30-day auto-renewal
 *   - GLM-5 via Morpheus Gateway
 *
 * Graduation: Get your own key at https://app.mor.org
 * Then run: node bootstrap-gateway.mjs --key YOUR_KEY
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync, chmodSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash, randomBytes } from 'crypto';
import { hostname, networkInterfaces, type, arch, userInfo, homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Configuration ─────────────────────────────────────────────

const CONFIG = {
  apiUrl: 'https://keys.everclaw.xyz',
  keyFile: join(homedir(), '.openclaw', '.bootstrap-key'),
  providerName: 'mor-gateway',
  gatewayBaseUrl: 'https://api.mor.org/api/v1',
  timeout: 10000, // 10 seconds
  everclawVersion: 'v2026.3.13', // Will be detected from SKILL.md if possible
};

// ─── Security Helpers ──────────────────────────────────────────

/**
 * Mask an API key for display — only show first 4 and last 4 chars.
 */
function maskKey(key) {
  if (!key || key.length < 8) return '[REDACTED]';
  return key.slice(0, 4) + '...' + key.slice(-4);
}

/**
 * Create a timestamped backup before overwriting a config file.
 */
function backupBeforeWrite(filePath) {
  if (!existsSync(filePath)) return;
  const backup = `${filePath}.bak-${Date.now()}`;
  writeFileSync(backup, readFileSync(filePath, 'utf-8'));
  console.log(`  💾 Config backed up → ${backup}`);
}

// Self-heal: fix permissions on existing key files from older installs
if (existsSync(CONFIG.keyFile)) {
  try { chmodSync(CONFIG.keyFile, 0o600); } catch { /* best effort */ }
}

// GLM-5 model config for Morpheus Gateway
const GLM5_MODEL = {
  id: 'glm-5',
  name: 'GLM-5 (via Morpheus Gateway)',
  reasoning: true,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200000,
  maxTokens: 8192,
};

// ─── Device Fingerprint ────────────────────────────────────────

/**
 * Find the primary (non-internal) MAC address.
 * Prefers en0 (macOS), eth0 (Linux), or first available.
 */
function findPrimaryMac(interfaces) {
  const ifaces = Object.entries(interfaces);
  
  // Preferred interface names (in order)
  const preferred = ['en0', 'eth0', 'en1', 'eth1', 'wlan0', 'Wi-Fi'];
  
  for (const name of preferred) {
    const iface = interfaces[name];
    if (iface) {
      const mac = iface.find(a => a.mac && !a.internal && a.mac !== '00:00:00:00:00:00');
      if (mac) return mac.mac;
    }
  }
  
  // Fallback: first non-internal MAC
  for (const [name, addrs] of ifaces) {
    const mac = addrs.find(a => a.mac && !a.internal && a.mac !== '00:00:00:00:00:00');
    if (mac) return mac.mac;
  }
  
  return null;
}

/**
 * Generate a stable, unique device fingerprint.
 * No PII exposed — all components are hashed.
 */
function generateDeviceFingerprint() {
  const components = [];
  
  // 1. Hostname (stable across reboots)
  components.push(hostname() || 'unknown-host');
  
  // 2. Primary MAC address (most unique identifier)
  const mac = findPrimaryMac(networkInterfaces());
  components.push(mac || 'no-mac');
  
  // 3. Platform info
  components.push(`${type()}-${arch()}`);
  
  // 4. Username (fallback uniqueness for shared machines)
  try {
    components.push(userInfo().username || 'unknown-user');
  } catch {
    components.push('no-user');
  }
  
  // Hash with SHA-256, take first 32 chars (128 bits)
  const fingerprint = createHash('sha256')
    .update(components.join(':'))
    .digest('hex')
    .slice(0, 32);
  
  return `device_${fingerprint}`;
}

/**
 * Detect EverClaw version from SKILL.md or fall back to default.
 */
function detectEverClawVersion() {
  try {
    const skillDir = dirname(__dirname);
    const skillMd = join(skillDir, 'SKILL.md');
    if (existsSync(skillMd)) {
      const content = readFileSync(skillMd, 'utf-8');
      // Match: version: 2026.2.23 or version: "2026.2.23"
      const match = content.match(/^version:\s*["']?(\d{4}\.\d{1,2}\.\d{1,2})/m);
      if (match) {
        return `v${match[1]}`;
      }
    }
  } catch {
    // Fall through to default
  }
  return CONFIG.everclawVersion;
}

// ─── Key API ───────────────────────────────────────────────────

/**
 * Request a key from the EverClaw Key API.
 * Returns { api_key, expires_at, rate_limit } or throws.
 */
async function requestKey(fingerprint, version) {
  const url = `${CONFIG.apiUrl}/api/keys/request`;
  const body = JSON.stringify({
    device_fingerprint: fingerprint,
    everclaw_version: version,
  });
  
  try {
    // Use -w to capture HTTP status code separately
    const result = execSync(
      `curl -s -w '\n%{http_code}' -m ${CONFIG.timeout / 1000} -X POST "${url}" ` +
      `-H "Content-Type: application/json" ` +
      `-d '${body.replace(/'/g, "'\\''")}'`,
      { timeout: CONFIG.timeout + 5000, encoding: 'utf-8' }
    );
    
    // Split response body from HTTP status code
    const lines = result.trimEnd().split('\n');
    const statusStr = lines.pop()?.trim() ?? '';
    const httpStatus = parseInt(statusStr, 10);
    const responseBody = lines.join('\n').trim();
    
    if (isNaN(httpStatus)) {
      throw new Error(`Failed to parse HTTP status from curl output. Raw: ${result.slice(0, 300)}`);
    }
    
    // Check HTTP status before parsing JSON
    if (httpStatus >= 500) {
      throw new Error(`Key server returned HTTP ${httpStatus} (server error). The service may be temporarily down — try again in a few minutes.`);
    }
    if (httpStatus >= 400) {
      throw new Error(`Key server returned HTTP ${httpStatus}: ${responseBody.slice(0, 200)}`);
    }
    if (!responseBody) {
      throw new Error('Key server returned an empty response');
    }
    
    let data;
    try {
      data = JSON.parse(responseBody);
    } catch (parseErr) {
      throw new Error(`Key server returned non-JSON response (HTTP ${httpStatus}): ${responseBody.slice(0, 200)}`);
    }
    
    if (data.error) {
      throw new Error(`API error: ${data.error}`);
    }
    
    if (!data.api_key) {
      throw new Error('No API key in response');
    }
    
    return {
      apiKey: data.api_key,
      expiresAt: data.expires_at,
      rateLimit: data.rate_limit || { daily: 1000, remaining: 1000 },
    };
  } catch (e) {
    if (e.signal === 'SIGTERM' || e.killed) {
      throw new Error('Request timed out');
    }
    throw e;
  }
}

/**
 * Store the bootstrap key data.
 */
function storeKey(keyData, fingerprint, version) {
  const keyDir = dirname(CONFIG.keyFile);
  if (!existsSync(keyDir)) {
    mkdirSync(keyDir, { recursive: true, mode: 0o700 });
  }
  
  backupBeforeWrite(CONFIG.keyFile);
  
  const payload = {
    api_key: keyData.apiKey,
    device_fingerprint: fingerprint,
    expires_at: keyData.expiresAt,
    rate_limit: keyData.rateLimit,
    created_at: new Date().toISOString(),
    everclaw_version: version,
    source: 'keys.everclaw.xyz',
  };
  
  writeFileSync(CONFIG.keyFile, JSON.stringify(payload, null, 2) + '\n');
  chmodSync(CONFIG.keyFile, 0o600);
  console.log(`  🔐 Key stored securely (0600) at ${CONFIG.keyFile}`);
  return payload;
}

/**
 * Load existing bootstrap key if present and valid.
 */
function loadExistingKey() {
  if (!existsSync(CONFIG.keyFile)) {
    return null;
  }
  
  try {
    const raw = readFileSync(CONFIG.keyFile, 'utf-8');
    const data = JSON.parse(raw);
    
    // Check expiration
    if (data.expires_at) {
      const expires = new Date(data.expires_at);
      if (expires < new Date()) {
        return { ...data, expired: true };
      }
    }
    
    return data;
  } catch {
    return null;
  }
}

/**
 * Remove the bootstrap key file.
 */
function removeKey() {
  if (existsSync(CONFIG.keyFile)) {
    unlinkSync(CONFIG.keyFile);
    return true;
  }
  return false;
}

// ─── OpenClaw Config ───────────────────────────────────────────

/**
 * Find the OpenClaw config file.
 */
function findOpenClawConfig() {
  const candidates = [
    join(homedir(), '.openclaw', 'openclaw.json'),
    join(process.cwd(), 'openclaw.json'),
  ];
  if (process.env.OPENCLAW_CONFIG) candidates.unshift(process.env.OPENCLAW_CONFIG);
  
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Configure mor-gateway provider in openclaw.json.
 * Only configures if no existing non-bootstrap key is present.
 */
function configureOpenClawProvider(apiKey, configPath) {
  if (!configPath) {
    configPath = findOpenClawConfig();
  }
  
  if (!configPath) {
    return { success: false, error: 'OpenClaw config not found' };
  }
  
  const raw = readFileSync(configPath, 'utf-8');
  const config = JSON.parse(raw);
  
  // Ensure structure exists
  if (!config.models) config.models = {};
  if (!config.models.providers) config.models.providers = {};
  
  // Check if mor-gateway already has a non-bootstrap (user's own) key
  const existingProvider = config.models.providers[CONFIG.providerName];
  if (existingProvider?.apiKey && !existingProvider.apiKey.startsWith('evcl_')) {
    // User has graduated to their own key - don't overwrite
    return { 
      success: false, 
      skipped: true, 
      reason: 'User has their own mor-gateway key (graduated from bootstrap)' 
    };
  }
  
  // Add/update mor-gateway provider with bootstrap key
  config.models.providers[CONFIG.providerName] = {
    baseUrl: CONFIG.gatewayBaseUrl,
    apiKey: apiKey,
    api: 'openai-completions',
    models: [GLM5_MODEL],
  };
  
  if (!config.models.mode) config.models.mode = 'merge';
  
  // Set GLM-5 as primary if no primary set, or if current is Venice (bootstrap usage)
  if (!config.agents) config.agents = {};
  if (!config.agents.defaults) config.agents.defaults = {};
  if (!config.agents.defaults.model) config.agents.defaults.model = {};
  
  const currentPrimary = config.agents.defaults.model.primary || '';
  const isBootstrapOrVenice = 
    currentPrimary.includes('venice') || 
    currentPrimary.startsWith('evcl_') ||
    currentPrimary === '';
  
  if (isBootstrapOrVenice) {
    config.agents.defaults.model.primary = `${CONFIG.providerName}/glm-5`;
    
    // Ensure fallbacks exist
    if (!config.agents.defaults.model.fallbacks) {
      config.agents.defaults.model.fallbacks = [
        'venice/claude-opus-4-6',
        'venice/kimi-k2-5',
      ];
    }
  }
  
  // Add alias
  if (!config.agents.defaults.models) config.agents.defaults.models = {};
  config.agents.defaults.models[`${CONFIG.providerName}/glm-5`] = {
    alias: 'GLM-5 (Bootstrap)',
  };
  
  // Write back (with backup)
  backupBeforeWrite(configPath);
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  
  return { success: true, configPath };
}

// ─── Test Inference ─────────────────────────────────────────────

/**
 * Test the bootstrap key with GLM-5 inference.
 */
async function testKey(apiKey) {
  const url = `${CONFIG.gatewayBaseUrl}/chat/completions`;
  const body = JSON.stringify({
    model: 'glm-5',
    messages: [{ role: 'user', content: 'Say hello in exactly 5 words.' }],
    max_tokens: 50,
  });
  
  try {
    const result = execSync(
      `curl -s -w '\n%{http_code}' -m ${CONFIG.timeout / 1000} -X POST "${url}" ` +
      `-H "Authorization: Bearer ${apiKey.replace(/"/g, '\\"')}" ` +
      `-H "Content-Type: application/json" ` +
      `-d '${body.replace(/'/g, "'\\''")}'`,
      { timeout: CONFIG.timeout + 5000, encoding: 'utf-8' }
    );
    
    const lines = result.trimEnd().split('\n');
    const statusStr = lines.pop()?.trim() ?? '';
    const httpStatus = parseInt(statusStr, 10);
    const responseBody = lines.join('\n').trim();
    
    if (isNaN(httpStatus)) {
      return { ok: false, error: `Failed to parse HTTP status from curl output. Raw: ${result.slice(0, 300)}` };
    }
    
    if (httpStatus >= 500) {
      return { ok: false, error: `Inference gateway returned HTTP ${httpStatus} (server error)` };
    }
    if (httpStatus >= 400) {
      return { ok: false, error: `Inference gateway returned HTTP ${httpStatus}: ${responseBody.slice(0, 200)}` };
    }
    if (!responseBody) {
      return { ok: false, error: 'Inference gateway returned an empty response' };
    }
    
    let data;
    try {
      data = JSON.parse(responseBody);
    } catch (parseErr) {
      return { ok: false, error: `Non-JSON response (HTTP ${httpStatus}): ${responseBody.slice(0, 200)}` };
    }
    
    if (data.error) {
      return { ok: false, error: data.error.message || data.error };
    }
    
    const content = data.choices?.[0]?.message?.content || '';
    const model = data.model || data.choices?.[0]?.model || 'glm-5';
    return { ok: true, model, content: content.trim() };
  } catch (e) {
    if (e.signal === 'SIGTERM' || e.killed) {
      return { ok: false, error: 'Request timed out' };
    }
    return { ok: false, error: e.message };
  }
}

// ─── Commands ──────────────────────────────────────────────────

async function cmdSetup() {
  console.log('\n♾️  EverClaw Bootstrap — GLM-5 Starter Key\n');
  
  // Check for existing valid key
  const existing = loadExistingKey();
  if (existing && !existing.expired) {
    console.log('  ✓ Found existing bootstrap key');
    console.log(`    Key: ${existing.api_key.slice(0, 12)}...`);
    console.log(`    Expires: ${new Date(existing.expires_at).toLocaleDateString()}`);
    console.log(`    Rate limit: ${existing.rate_limit?.daily || 1000}/day`);
    
    // Still configure OpenClaw if needed (but don't overwrite user's own key)
    const configPath = findOpenClawConfig();
    if (configPath) {
      const result = configureOpenClawProvider(existing.api_key, configPath);
      if (result.success) {
        console.log(`\n  ✓ Configured mor-gateway/glm-5 in OpenClaw`);
      } else if (result.skipped) {
        console.log(`\n  ℹ️  Your own mor-gateway key is configured (graduated from bootstrap)`);
      }
    }
    
    console.log('\n  GLM-5 via Morpheus Gateway is ready!\n');
    return;
  }
  
  if (existing?.expired) {
    console.log('  ⚠️  Previous key expired. Fetching new key...\n');
  }
  
  // Generate fingerprint
  const fingerprint = generateDeviceFingerprint();
  const version = detectEverClawVersion();
  
  console.log(`  Device: ${fingerprint.slice(0, 20)}...`);
  console.log(`  Version: ${version}`);
  console.log('\n  Requesting starter key from keys.everclaw.xyz...');
  
  // Request key
  let keyData;
  try {
    keyData = await requestKey(fingerprint, version);
  } catch (e) {
    console.log(`\n  ❌ Could not reach EverClaw key server: ${e.message}`);
    console.log('\n  To retry later, run:');
    console.log('     node scripts/bootstrap-everclaw.mjs\n');
    process.exit(1);
  }
  
  console.log(`  ✓ Key received: ${keyData.apiKey.slice(0, 12)}...`);
  
  // Store key
  const stored = storeKey(keyData, fingerprint, version);
  console.log(`  ✓ Stored at: ${CONFIG.keyFile}`);
  
  // Configure OpenClaw
  const configPath = findOpenClawConfig();
  if (configPath) {
    const result = configureOpenClawProvider(keyData.apiKey, configPath);
    if (result.success) {
      console.log(`  ✓ Configured mor-gateway/glm-5 in OpenClaw`);
    } else if (result.skipped) {
      console.log(`  ℹ️  Not overwriting existing mor-gateway key (you've graduated!)`);
    } else {
      console.log(`  ⚠️  Could not configure OpenClaw: ${result.error}`);
    }
  } else {
    console.log('  ⚠️  OpenClaw config not found. Key stored but not activated.');
    console.log('     Run this script from your OpenClaw workspace.');
  }
  
  // Test
  console.log('\n  Testing GLM-5 inference...');
  const test = await testKey(keyData.apiKey);
  if (test.ok) {
    console.log(`  ✓ Success! Model responded: "${test.content.slice(0, 40)}..."`);
  } else {
    console.log(`  ⚠️  Key stored, but test failed: ${test.error}`);
    console.log('     The key server may be syncing. Try again in a minute.');
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  🎉 EverClaw Bootstrap Complete!\n');
  console.log('  You now have access to GLM-5 via Morpheus Gateway.');
  console.log('  Rate limit: 1000 requests/day');
  console.log('  Expires: ' + new Date(keyData.expiresAt).toLocaleDateString());
  console.log('\n  To graduate to your own key:');
  console.log('     1. Go to https://app.mor.org');
  console.log('     2. Create an account and API key');
  console.log('     3. Run: node scripts/bootstrap-gateway.mjs --key YOUR_KEY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

async function cmdStatus() {
  console.log('\n♾️  EverClaw Bootstrap Key Status\n');
  
  const key = loadExistingKey();
  
  if (!key) {
    console.log('  No bootstrap key found.');
    console.log('  Run: node scripts/bootstrap-everclaw.mjs\n');
    return;
  }
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Key: ${maskKey(key.api_key)}`);
  console.log(`  Device: ${key.device_fingerprint}`);
  console.log(`  Created: ${new Date(key.created_at).toLocaleDateString()}`);
  console.log(`  Expires: ${new Date(key.expires_at).toLocaleDateString()}${key.expired ? ' (EXPIRED)' : ''}`);
  console.log(`  Rate limit: ${key.rate_limit?.daily || 1000}/day`);
  console.log(`  Version: ${key.everclaw_version}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  if (key.expired) {
    console.log('\n  ⚠️  Your key has expired. Run --setup to renew.\n');
  } else {
    // Test connectivity
    console.log('\n  Testing connectivity...');
    const test = await testKey(key.api_key);
    if (test.ok) {
      console.log(`  ✓ Online — ${test.model || 'connected'}\n`);
    } else {
      console.log(`  ❌ ${test.error}\n`);
    }
  }
}

async function cmdTest() {
  console.log('\n♾️  Testing EverClaw Bootstrap Key\n');
  
  const key = loadExistingKey();
  
  if (!key) {
    console.log('  No bootstrap key found.');
    console.log('  Run: node scripts/bootstrap-everclaw.mjs\n');
    return;
  }
  
  console.log(`  Testing GLM-5 inference with key ${maskKey(key.api_key)}...`);
  
  const test = await testKey(key.api_key);
  
  if (test.ok) {
    console.log(`\n  ✓ Success!`);
    console.log(`  Model: ${test.model || 'glm-5'}`);
    console.log(`  Response: "${test.content || '(empty)'}"\n`);
  } else {
    console.log(`\n  ❌ Failed: ${test.error}\n`);
    process.exit(1);
  }
}

async function cmdRevoke() {
  console.log('\n♾️  Revoking EverClaw Bootstrap Key\n');
  
  const removed = removeKey();
  
  if (removed) {
    console.log('  ✓ Bootstrap key removed from this device.');
    console.log('\n  To set up your own Morpheus API key:');
    console.log('     1. Go to https://app.mor.org');
    console.log('     2. Create an API key');
    console.log('     3. Run: node scripts/bootstrap-gateway.mjs --key YOUR_KEY\n');
  } else {
    console.log('  No bootstrap key found.\n');
  }
}

// ─── Main ──────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--status')) {
  await cmdStatus();
} else if (args.includes('--test')) {
  await cmdTest();
} else if (args.includes('--revoke')) {
  await cmdRevoke();
} else if (args.includes('--help') || args.includes('-h')) {
  console.log(`
EverClaw Bootstrap — GLM-5 Starter Key

Usage:
  node bootstrap-everclaw.mjs [command]

Commands:
  --setup     Bootstrap a new key (default)
  --status    Show current key status
  --test      Test key connectivity
  --revoke    Remove the bootstrap key (graduation)
  --help      Show this message

The bootstrap key provides free access to GLM-5 via Morpheus Gateway.
Get your own key at https://app.mor.org for continued use.
`);
} else {
  // Default: --setup
  await cmdSetup();
}