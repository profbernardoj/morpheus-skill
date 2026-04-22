#!/usr/bin/env node
/**
 * Issue #8 Regression Tests — TLS Enforcement & Response Validation
 * Tests resolveApiBase() behavior and response validation logic.
 * Run: node test-issue8-regression.mjs
 */

let pass = 0;
let fail = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    pass++;
  } catch (e) {
    console.log(`  ❌ ${name}: ${e.message}`);
    fail++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

// ─── Test resolveApiBase() logic (inline, since it's module-scoped) ────────

function resolveApiBase(envUrl) {
  const raw = envUrl || 'https://api.everclaw.xyz';
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Invalid EVERCLAW_BOOTSTRAP_URL: ${raw}`);
  }

  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);

  if (parsed.protocol !== 'https:' && !isLocal) {
    throw new Error(
      `EVERCLAW_BOOTSTRAP_URL must use HTTPS for remote hosts (got ${parsed.protocol}//${parsed.hostname}). ` +
      'Plain HTTP exposes wallet addresses and PoW challenges to network observers. ' +
      'Only localhost/127.0.0.1 may use HTTP for development.'
    );
  }

  return parsed.origin + parsed.pathname.replace(/\/+$/, '');
}

// ─── URL Validation Tests ──────────────────────────────────────────────────

console.log('\n🔒 URL Validation Tests\n');

test('Default URL (https://api.everclaw.xyz) resolves correctly', () => {
  const result = resolveApiBase(undefined);
  assert(result === 'https://api.everclaw.xyz', `Got: ${result}`);
});

test('Custom HTTPS URL via env var works', () => {
  const result = resolveApiBase('https://custom-api.example.com/v2/');
  assert(result === 'https://custom-api.example.com/v2', `Got: ${result}`);
});

test('Custom HTTPS URL with port works', () => {
  const result = resolveApiBase('https://api.example.com:8443/bootstrap');
  assert(result === 'https://api.example.com:8443/bootstrap', `Got: ${result}`);
});

test('http:// remote URL is rejected with clear error', () => {
  let threw = false;
  try {
    resolveApiBase('http://api.everclaw.xyz');
  } catch (e) {
    threw = true;
    assert(e.message.includes('must use HTTPS'), `Wrong error: ${e.message}`);
    assert(e.message.includes('http:'), `Should mention http: protocol`);
  }
  assert(threw, 'Should have thrown');
});

test('http://evil-server.com is rejected', () => {
  let threw = false;
  try {
    resolveApiBase('http://evil-server.com/steal-wallet');
  } catch (e) {
    threw = true;
    assert(e.message.includes('must use HTTPS'), `Wrong error: ${e.message}`);
  }
  assert(threw, 'Should have thrown');
});

test('http://localhost is allowed (dev)', () => {
  const result = resolveApiBase('http://localhost:3000');
  assert(result === 'http://localhost:3000', `Got: ${result}`);
});

test('http://127.0.0.1 is allowed (dev)', () => {
  const result = resolveApiBase('http://127.0.0.1:3000/api');
  assert(result === 'http://127.0.0.1:3000/api', `Got: ${result}`);
});

test('http://[::1] is allowed (dev)', () => {
  const result = resolveApiBase('http://[::1]:3000');
  assert(result === 'http://[::1]:3000', `Got: ${result}`);
});

test('Invalid URL is rejected', () => {
  let threw = false;
  try {
    resolveApiBase('not-a-url');
  } catch (e) {
    threw = true;
    assert(e.message.includes('Invalid EVERCLAW_BOOTSTRAP_URL'), `Wrong error: ${e.message}`);
  }
  assert(threw, 'Should have thrown');
});

test('Empty string env var falls back to default', () => {
  const result = resolveApiBase('');
  assert(result === 'https://api.everclaw.xyz', `Got: ${result} (empty string is falsy, should use default)`);
});

test('Trailing slashes are stripped', () => {
  const result = resolveApiBase('https://api.everclaw.xyz///');
  assert(result === 'https://api.everclaw.xyz', `Got: ${result}`);
});

// ─── Response Validation Tests ─────────────────────────────────────────────

console.log('\n🛡️  Response Validation Tests\n');

function validateChallengeResponse(data) {
  if (!data || typeof data.challenge !== 'string' || data.challenge.length < 16) {
    throw new Error('Invalid challenge response from server — possible MITM or API change');
  }
  return data.challenge;
}

function validateClaimResponse(data) {
  if (!data || typeof data.claimCode !== 'string') {
    throw new Error('Invalid bootstrap response from server — possible MITM or API change');
  }
  return data;
}

test('Valid challenge response passes', () => {
  const challenge = validateChallengeResponse({ challenge: 'abcdef1234567890abcdef1234567890' });
  assert(challenge === 'abcdef1234567890abcdef1234567890');
});

test('Null challenge response is caught', () => {
  let threw = false;
  try { validateChallengeResponse(null); } catch (e) {
    threw = true;
    assert(e.message.includes('possible MITM'));
  }
  assert(threw, 'Should have thrown');
});

test('Missing challenge field is caught', () => {
  let threw = false;
  try { validateChallengeResponse({ foo: 'bar' }); } catch (e) {
    threw = true;
    assert(e.message.includes('possible MITM'));
  }
  assert(threw, 'Should have thrown');
});

test('Challenge too short (<16 chars) is caught', () => {
  let threw = false;
  try { validateChallengeResponse({ challenge: 'short' }); } catch (e) {
    threw = true;
    assert(e.message.includes('possible MITM'));
  }
  assert(threw, 'Should have thrown');
});

test('Non-string challenge is caught', () => {
  let threw = false;
  try { validateChallengeResponse({ challenge: 12345 }); } catch (e) {
    threw = true;
    assert(e.message.includes('possible MITM'));
  }
  assert(threw, 'Should have thrown');
});

test('Empty object challenge response is caught', () => {
  let threw = false;
  try { validateChallengeResponse({}); } catch (e) {
    threw = true;
    assert(e.message.includes('possible MITM'));
  }
  assert(threw, 'Should have thrown');
});

test('Valid claim response passes', () => {
  const result = validateClaimResponse({ claimCode: 'ABC123', txHash: '0x...' });
  assert(result.claimCode === 'ABC123');
});

test('Null claim response is caught', () => {
  let threw = false;
  try { validateClaimResponse(null); } catch (e) {
    threw = true;
    assert(e.message.includes('possible MITM'));
  }
  assert(threw, 'Should have thrown');
});

test('Missing claimCode is caught', () => {
  let threw = false;
  try { validateClaimResponse({ txHash: '0x...' }); } catch (e) {
    threw = true;
    assert(e.message.includes('possible MITM'));
  }
  assert(threw, 'Should have thrown');
});

test('Non-string claimCode is caught', () => {
  let threw = false;
  try { validateClaimResponse({ claimCode: 42 }); } catch (e) {
    threw = true;
    assert(e.message.includes('possible MITM'));
  }
  assert(threw, 'Should have thrown');
});

// ─── Summary ───────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(50)}`);
console.log(`  Results: ${pass} passed, ${fail} failed, ${pass + fail} total`);
console.log(`${'═'.repeat(50)}\n`);

process.exit(fail > 0 ? 1 : 0);
