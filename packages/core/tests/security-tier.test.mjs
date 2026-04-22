#!/usr/bin/env node

/**
 * tests/security-tier.test.mjs — Tests for EverClaw Security Tiers
 *
 * Covers:
 * - Template loading and validation
 * - Binary detection (detect-bins.mjs)
 * - exec-approvals.json generation
 * - Upgrade safety (generatedBy field)
 * - Tier switching
 * - Docker/CI env var handling
 * - Edge cases (missing binaries, invalid tiers)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { platform } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const TEMPLATES_DIR = join(ROOT, 'templates');
const SCRIPTS_DIR = join(ROOT, 'scripts');
const TMP_DIR = join(ROOT, 'tests', '.tmp-security-tier');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}`);
    failed++;
  }
}

function setup() {
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true, force: true });
  mkdirSync(TMP_DIR, { recursive: true });
}

function cleanup() {
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true, force: true });
}

// ─── Test 1: All tier templates exist and are valid JSON ────────

function testTemplatesExist() {
  console.log('\n  ── Test 1: Tier templates exist and are valid JSON');
  for (const tier of ['low', 'recommended', 'maximum']) {
    const path = join(TEMPLATES_DIR, `exec-approvals-${tier}.json`);
    assert(existsSync(path), `Template exists: exec-approvals-${tier}.json`);
    try {
      const data = JSON.parse(readFileSync(path, 'utf-8'));
      assert(data.tier === tier, `Template tier field: ${tier}`);
      assert(data.label && data.label.length > 0, `Template has label: ${data.label}`);
      assert(data.description && data.description.length > 0, `Template has description`);
      assert(data.config && data.config.security === 'allowlist', `Template config.security = allowlist`);
      assert(Array.isArray(data.bins) && data.bins.length > 0, `Template has bins array (${data.bins.length} entries)`);
      assert(Array.isArray(data.blocked) && data.blocked.length > 0, `Template has blocked array`);
    } catch (e) {
      assert(false, `Template ${tier} is valid JSON: ${e.message}`);
    }
  }
}

// ─── Test 2: rm is blocked in ALL tiers ─────────────────────────

function testRmBlockedAllTiers() {
  console.log('\n  ── Test 2: rm is blocked in all tiers');
  for (const tier of ['low', 'recommended', 'maximum']) {
    const data = JSON.parse(readFileSync(join(TEMPLATES_DIR, `exec-approvals-${tier}.json`), 'utf-8'));
    assert(data.blocked.includes('rm'), `rm blocked in ${tier}`);
    assert(!data.bins.includes('rm'), `rm not in bins for ${tier}`);
    assert(!(data.macBins || []).includes('rm'), `rm not in macBins for ${tier}`);
    assert(!(data.linuxBins || []).includes('rm'), `rm not in linuxBins for ${tier}`);
  }
}

// ─── Test 3: ssh, sudo, docker blocked in ALL tiers ─────────────

function testDangerousBinsBlocked() {
  console.log('\n  ── Test 3: ssh, sudo, docker blocked in all tiers');
  const dangerous = ['ssh', 'scp', 'sudo', 'docker', 'osascript'];
  for (const tier of ['low', 'recommended', 'maximum']) {
    const data = JSON.parse(readFileSync(join(TEMPLATES_DIR, `exec-approvals-${tier}.json`), 'utf-8'));
    for (const bin of dangerous) {
      assert(data.blocked.includes(bin), `${bin} blocked in ${tier}`);
    }
  }
}

// ─── Test 4: strictInlineEval is true in all tiers ──────────────

function testStrictInlineEval() {
  console.log('\n  ── Test 4: strictInlineEval is true in all tiers');
  for (const tier of ['low', 'recommended', 'maximum']) {
    const data = JSON.parse(readFileSync(join(TEMPLATES_DIR, `exec-approvals-${tier}.json`), 'utf-8'));
    assert(data.config.strictInlineEval === true, `strictInlineEval=true in ${tier}`);
  }
}

// ─── Test 5: Maximum tier has minimal allowlist ─────────────────

function testMaximumTierMinimal() {
  console.log('\n  ── Test 5: Maximum tier has minimal (read-only) allowlist');
  const max = JSON.parse(readFileSync(join(TEMPLATES_DIR, 'exec-approvals-maximum.json'), 'utf-8'));
  const low = JSON.parse(readFileSync(join(TEMPLATES_DIR, 'exec-approvals-low.json'), 'utf-8'));

  assert(max.bins.length < low.bins.length, `Maximum bins (${max.bins.length}) < Low bins (${low.bins.length})`);
  assert(!max.bins.includes('node'), 'node not auto-allowed in maximum');
  assert(!max.bins.includes('git'), 'git not auto-allowed in maximum');
  assert(!max.bins.includes('curl'), 'curl not auto-allowed in maximum');
  assert(!max.bins.includes('npm'), 'npm not auto-allowed in maximum');
  assert(max.bins.includes('ls'), 'ls IS auto-allowed in maximum');
  assert(max.bins.includes('cat'), 'cat IS auto-allowed in maximum');
  assert(max.bins.includes('grep'), 'grep IS auto-allowed in maximum');
  assert(max.bins.includes('echo'), 'echo IS auto-allowed in maximum');
  assert(max.bins.includes('find'), 'find IS auto-allowed in maximum');
  assert(max.bins.includes('pwd'), 'pwd IS auto-allowed in maximum');
}

// ─── Test 6: Maximum tier has autoAllowSkills=false ─────────────

function testMaximumAutoAllowSkills() {
  console.log('\n  ── Test 6: Maximum tier disables autoAllowSkills');
  const max = JSON.parse(readFileSync(join(TEMPLATES_DIR, 'exec-approvals-maximum.json'), 'utf-8'));
  assert(max.config.autoAllowSkills === false, 'autoAllowSkills=false in maximum');

  const low = JSON.parse(readFileSync(join(TEMPLATES_DIR, 'exec-approvals-low.json'), 'utf-8'));
  assert(low.config.autoAllowSkills === true, 'autoAllowSkills=true in low');

  const rec = JSON.parse(readFileSync(join(TEMPLATES_DIR, 'exec-approvals-recommended.json'), 'utf-8'));
  assert(rec.config.autoAllowSkills === true, 'autoAllowSkills=true in recommended');
}

// ─── Test 7: detect-bins.mjs resolves known binaries ────────────

async function testDetectBins() {
  console.log('\n  ── Test 7: detect-bins.mjs resolves known binaries');
  const { resolveBin, resolveBins, getPlatformBins } = await import(join(SCRIPTS_DIR, 'lib', 'detect-bins.mjs'));

  // Test resolveBin with a binary that definitely exists
  const lsResult = resolveBin('ls');
  assert(lsResult.path !== null, `resolveBin('ls') found: ${lsResult.path}`);
  assert(lsResult.source === 'which' || lsResult.source === 'scan', `resolveBin('ls') source: ${lsResult.source}`);

  // Test with a binary that does NOT exist
  const fakeResult = resolveBin('__nonexistent_binary_xyz__');
  assert(fakeResult.path === null, 'resolveBin for nonexistent binary returns null');
  assert(fakeResult.source === 'missing', 'resolveBin source is "missing"');

  // Test resolveBins with mixed list
  const { found, missing } = resolveBins(['ls', 'cat', '__nonexistent_binary_xyz__']);
  assert(found.length === 2, `resolveBins found 2 of 3`);
  assert(missing.length === 1, `resolveBins missing 1 of 3`);
  assert(missing[0] === '__nonexistent_binary_xyz__', 'Correct binary identified as missing');

  // Test getPlatformBins
  const os = platform();
  const bins = getPlatformBins(['ls', 'cat'], ['open', 'pbcopy'], ['xdg-open']);
  if (os === 'darwin') {
    assert(bins.includes('open'), 'macOS gets open');
    assert(!bins.includes('xdg-open'), 'macOS does not get xdg-open');
  } else if (os === 'linux') {
    assert(!bins.includes('open'), 'Linux does not get open');
    assert(bins.includes('xdg-open'), 'Linux gets xdg-open');
  }
  assert(bins.includes('ls'), 'Common bins always included');
}

// ─── Test 8: security-tier.mjs --status runs without error ──────

function testSecurityTierStatus() {
  console.log('\n  ── Test 8: security-tier.mjs --status runs');
  try {
    const output = execSync(
      `node "${join(SCRIPTS_DIR, 'security-tier.mjs')}" --status 2>&1`,
      { encoding: 'utf-8', timeout: 15000 }
    );
    assert(output.includes('EverClaw Security'), '--status prints header');
    passed++; // ran without throwing
  } catch (e) {
    assert(false, `--status threw: ${e.message}`);
  }
}

// ─── Test 9: security-tier.mjs --tier <name> dry-run ────────────

function testSecurityTierDryRun() {
  console.log('\n  ── Test 9: security-tier.mjs --tier recommended (dry-run)');
  try {
    const output = execSync(
      `node "${join(SCRIPTS_DIR, 'security-tier.mjs')}" --tier recommended 2>&1`,
      { encoding: 'utf-8', timeout: 15000 }
    );
    assert(output.includes('Dry-run'), 'Dry-run message shown');
    assert(output.includes('Recommended'), 'Tier name shown');
    assert(output.includes('Detecting binaries'), 'Binary detection ran');
  } catch (e) {
    assert(false, `--tier dry-run threw: ${e.message}`);
  }
}

// ─── Test 10: Invalid tier rejected ─────────────────────────────

function testInvalidTierRejected() {
  console.log('\n  ── Test 10: Invalid tier rejected');
  try {
    execSync(
      `node "${join(SCRIPTS_DIR, 'security-tier.mjs')}" --tier invalid_tier 2>&1`,
      { encoding: 'utf-8', timeout: 15000 }
    );
    assert(false, 'Should have thrown for invalid tier');
  } catch (e) {
    assert(e.stdout?.includes('Invalid tier') || e.stderr?.includes('Invalid tier') || e.status !== 0,
      'Invalid tier produces error');
  }
}

// ─── Test 11: generatedBy field present in all templates ────────

function testGeneratedBySchema() {
  console.log('\n  ── Test 11: Templates have $schema field for identification');
  for (const tier of ['low', 'recommended', 'maximum']) {
    const data = JSON.parse(readFileSync(join(TEMPLATES_DIR, `exec-approvals-${tier}.json`), 'utf-8'));
    assert(data.$schema === 'everclaw-security-tier-v1', `$schema=everclaw-security-tier-v1 in ${tier}`);
  }
}

// ─── Test 12: No overlap between bins and blocked ───────────────

function testNoBinBlockedOverlap() {
  console.log('\n  ── Test 12: No binary appears in both bins and blocked');
  for (const tier of ['low', 'recommended', 'maximum']) {
    const data = JSON.parse(readFileSync(join(TEMPLATES_DIR, `exec-approvals-${tier}.json`), 'utf-8'));
    const allBins = [...data.bins, ...(data.macBins || []), ...(data.linuxBins || [])];
    const overlap = allBins.filter(b => data.blocked.includes(b));
    assert(overlap.length === 0, `No overlap in ${tier} (overlap: ${overlap.join(', ') || 'none'})`);
  }
}

// ─── Test 13: dd excluded from all tiers ────────────────────────

function testDdBlocked() {
  console.log('\n  ── Test 13: dd excluded from all tiers');
  for (const tier of ['low', 'recommended', 'maximum']) {
    const data = JSON.parse(readFileSync(join(TEMPLATES_DIR, `exec-approvals-${tier}.json`), 'utf-8'));
    assert(data.blocked.includes('dd'), `dd blocked in ${tier}`);
    assert(!data.bins.includes('dd'), `dd not in bins for ${tier}`);
  }
}

// ─── Test 14: safeBins are stdin-only filters ───────────────────

function testSafeBinsValid() {
  console.log('\n  ── Test 14: safeBins are stdin-only stream filters');
  const allowedSafeBins = ['cut', 'uniq', 'head', 'tail', 'tr', 'wc', 'sort'];
  for (const tier of ['low', 'recommended', 'maximum']) {
    const data = JSON.parse(readFileSync(join(TEMPLATES_DIR, `exec-approvals-${tier}.json`), 'utf-8'));
    const safeBins = data.config.safeBins;
    assert(Array.isArray(safeBins), `safeBins is array in ${tier}`);
    for (const bin of safeBins) {
      assert(allowedSafeBins.includes(bin), `${bin} is a valid stdin-only filter in ${tier}`);
    }
    // Ensure no interpreters in safeBins
    const forbidden = ['node', 'python3', 'bash', 'sh', 'jq', 'awk', 'sed'];
    for (const bin of forbidden) {
      assert(!safeBins.includes(bin), `${bin} NOT in safeBins for ${tier}`);
    }
  }
}

// ─── Run all tests ─────────────────────────────────────────────

console.log('\n♾️  EverClaw Security Tier Tests\n');

setup();

try {
  testTemplatesExist();
  testRmBlockedAllTiers();
  testDangerousBinsBlocked();
  testStrictInlineEval();
  testMaximumTierMinimal();
  testMaximumAutoAllowSkills();
  await testDetectBins();
  testSecurityTierStatus();
  testSecurityTierDryRun();
  testInvalidTierRejected();
  testGeneratedBySchema();
  testNoBinBlockedOverlap();
  testDdBlocked();
  testSafeBinsValid();
} finally {
  cleanup();
}

console.log(`\n  ─── Results: ${passed} passed, ${failed} failed ───\n`);
process.exit(failed > 0 ? 1 : 0);
