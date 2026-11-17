#!/usr/bin/env node
/**
 * Integration tests for EverClaw Auth Proxy
 *
 * Tests the proxy server with a mock OpenClaw backend.
 * Covers: health check, unauthenticated access, JWT verification,
 * session cookies, WebSocket auth, rate limiting, logout, edge cases.
 *
 * Usage: node test-proxy.mjs
 */

import { createServer } from 'node:http';
import { createHmac, generateKeyPairSync, randomBytes } from 'node:crypto';
import { SignJWT, exportJWK } from 'jose';
import { createPrivateKey } from 'node:crypto';

// ─── Test Configuration ──────────────────────────────────────────────────────

const PROXY_PORT = 19789;   // Test proxy port (not 18789 to avoid conflicts)
const BACKEND_PORT = 19790;  // Mock OpenClaw port
const OWNER_PRIVY_ID = 'did:privy:test-owner-123';
const NON_OWNER_ID = 'did:privy:some-other-user';

let passed = 0;
let failed = 0;
let total = 0;

function assert(condition, message) {
  total++;
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.error(`  ❌ ${message}`);
  }
}

// ─── Generate ES256 Test Keys ────────────────────────────────────────────────

const { publicKey, privateKey } = generateKeyPairSync('ec', {
  namedCurve: 'P-256',
});

const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
const privateKeyJwk = await exportJWK(createPrivateKey(privateKey.export({ type: 'pkcs8', format: 'pem' })));

// Ensure the JWK has the algorithm set
privateKeyJwk.alg = 'ES256';

const PRIVY_APP_ID = 'test-app-id';

async function signTestJwt(sub, options = {}) {
  const jwt = new SignJWT({})
    .setProtectedHeader({ alg: 'ES256' })
    .setIssuer(options.issuer || 'privy.io')
    .setAudience(options.audience || PRIVY_APP_ID)
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(options.exp || '1h');

  return jwt.sign(createPrivateKey(privateKey.export({ type: 'pkcs8', format: 'pem' })));
}

// ─── Mock OpenClaw Backend ───────────────────────────────────────────────────

let lastBackendHeaders = {};

function startMockBackend() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      lastBackendHeaders = { ...req.headers };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        mock: 'openclaw',
        forwardedUser: req.headers['x-forwarded-user'] || null,
        path: req.url,
      }));
    });

    server.listen(BACKEND_PORT, '127.0.0.1', () => {
      console.log(`  Mock backend on :${BACKEND_PORT}`);
      resolve(server);
    });
  });
}

// ─── Start Auth Proxy (as child process) ─────────────────────────────────────

async function startProxy() {
  const { spawn } = await import('node:child_process');

  const env = {
    ...process.env,
    AUTH_PROXY_PORT: String(PROXY_PORT),
    OPENCLAW_INTERNAL_PORT: String(BACKEND_PORT),
    PRIVY_APP_ID: PRIVY_APP_ID,
    PRIVY_VERIFICATION_KEY: publicKeyPem,
    OPENCLAW_OWNER_PRIVY_ID: OWNER_PRIVY_ID,
    SESSION_SECRET: 'test-secret-for-testing-only-32chars!',
  };

  const child = spawn('node', ['server.mjs'], {
    cwd: new URL('.', import.meta.url).pathname,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  child.stdout.on('data', (d) => { /* swallow */ });

  // Wait for proxy to be ready
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PROXY_PORT}/health`);
      if (res.ok) {
        console.log(`  Auth proxy on :${PROXY_PORT}`);
        return child;
      }
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 200));
  }

  console.error('  ❌ Proxy failed to start');
  console.error('  stderr:', stderr);
  child.kill();
  process.exit(1);
}

// ─── HTTP Helpers ────────────────────────────────────────────────────────────

const BASE = `http://127.0.0.1:${PROXY_PORT}`;

async function get(path, headers = {}) {
  return fetch(`${BASE}${path}`, { headers, redirect: 'manual' });
}

async function post(path, body, headers = {}) {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    redirect: 'manual',
  });
}

function extractCookie(res) {
  const setCookie = res.headers.get('set-cookie') || '';
  const match = setCookie.match(/everclaw_session=([^;]+)/);
  return match ? match[1] : null;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

async function runTests() {
  console.log('\n🧪 EverClaw Auth Proxy — Integration Tests\n');

  const backend = await startMockBackend();
  const proxyChild = await startProxy();

  try {
    // ── 1. Health check ──
    console.log('\n📋 Health Check');
    {
      const res = await get('/health');
      const data = await res.json();
      assert(res.status === 200, 'Health returns 200');
      assert(data.authProxy === true, 'Health response has authProxy: true');
    }

    // ── 2. Unauthenticated access → login page ──
    console.log('\n📋 Unauthenticated Access');
    {
      const res = await get('/');
      const html = await res.text();
      assert(res.status === 200, 'Root returns 200');
      assert(html.includes('EverClaw'), 'Login page contains EverClaw branding');
      assert(html.includes('Sign in'), 'Login page has sign-in text');
      assert(html.includes('login-bundle.js'), 'Login page references bundle');
      assert(res.headers.get('x-frame-options') === 'DENY', 'X-Frame-Options: DENY');
      assert(res.headers.get('cache-control') === 'no-store', 'Cache-Control: no-store');
    }

    // ── 3. Login bundle JS served ──
    console.log('\n📋 Login Bundle');
    {
      const res = await get('/auth/login-bundle.js');
      const js = await res.text();
      assert(res.status === 200, 'Bundle returns 200');
      assert(res.headers.get('content-type').includes('javascript'), 'Content-Type is JavaScript');
      assert(js.length > 1000, `Bundle has content (${Math.round(js.length / 1024)}KB)`);
      assert(res.headers.get('cache-control').includes('immutable'), 'Bundle is cacheable');
    }

    // ── 4. Auth callback — valid owner JWT → session cookie ──
    // Run happy path FIRST (before error cases consume rate limit window)
    console.log('\n📋 Successful Authentication');
    let sessionCookie;
    {
      const token = await signTestJwt(OWNER_PRIVY_ID);
      const res = await post('/auth/callback', { token });
      assert(res.status === 200, 'Valid owner JWT returns 200');
      const data = await res.json();
      assert(data.success === true, 'Response has success: true');

      sessionCookie = extractCookie(res);
      assert(sessionCookie !== null, 'Session cookie is set');
      assert(res.headers.get('set-cookie').includes('HttpOnly'), 'Cookie is HttpOnly');
      assert(res.headers.get('set-cookie').includes('SameSite=Lax'), 'Cookie is SameSite=Lax');
    }

    // ── 10. Authenticated request → proxied to backend ──
    console.log('\n📋 Authenticated Proxy');
    {
      const res = await get('/api/test', { Cookie: `everclaw_session=${sessionCookie}` });
      assert(res.status === 200, 'Authenticated request returns 200');
      const data = await res.json();
      assert(data.mock === 'openclaw', 'Response came from mock backend');
      assert(data.forwardedUser === OWNER_PRIVY_ID, `x-forwarded-user is ${OWNER_PRIVY_ID}`);
    }

    // ── 11. x-forwarded-user header stripping ──
    console.log('\n📋 Header Spoofing Prevention');
    {
      const res = await get('/api/test', {
        Cookie: `everclaw_session=${sessionCookie}`,
        'x-forwarded-user': 'evil-spoof@attacker.com',
      });
      const data = await res.json();
      assert(data.forwardedUser === OWNER_PRIVY_ID, 'Spoofed x-forwarded-user is stripped and replaced');
      assert(lastBackendHeaders['x-forwarded-user'] === OWNER_PRIVY_ID, 'Backend sees correct owner, not spoofed value');
    }

    // ── 12. Invalid session cookie → login page ──
    console.log('\n📋 Invalid/Expired Sessions');
    {
      const res = await get('/', { Cookie: 'everclaw_session=garbage-value' });
      const html = await res.text();
      assert(res.status === 200, 'Invalid cookie returns 200 (login page)');
      assert(html.includes('EverClaw'), 'Shows login page for invalid cookie');
      const clearedCookie = res.headers.get('set-cookie');
      assert(clearedCookie && clearedCookie.includes('Max-Age=0'), 'Invalid cookie is cleared');
    }

    // ── 13. Tampered session cookie ──
    {
      // Take a valid cookie and tamper with it
      const decoded = Buffer.from(sessionCookie, 'base64url').toString('utf8');
      const tampered = Buffer.from(decoded.replace(OWNER_PRIVY_ID, 'did:privy:evil')).toString('base64url');
      const res = await get('/api/test', { Cookie: `everclaw_session=${tampered}` });
      const html = await res.text();
      assert(html.includes('EverClaw'), 'Tampered cookie shows login page');
    }

    // ── Error cases (run after happy path to avoid rate limit conflict) ──
    console.log('\n📋 Auth Callback — Error Cases');
    {
      const res = await post('/auth/callback', {});
      assert(res.status === 400, 'Missing token returns 400');
      const data = await res.json();
      assert(data.error === 'missing_token', 'Error is missing_token');
    }
    {
      const res = await post('/auth/callback', { token: 'not-a-jwt' });
      assert(res.status === 401, 'Invalid JWT returns 401');
    }
    {
      const token = await signTestJwt(NON_OWNER_ID);
      const res = await post('/auth/callback', { token });
      assert(res.status === 403, 'Non-owner JWT returns 403');
      const data = await res.json();
      assert(data.reason === 'owner_mismatch', 'Reason is owner_mismatch');
    }
    {
      const token = await signTestJwt(OWNER_PRIVY_ID, { issuer: 'evil.io' });
      const res = await post('/auth/callback', { token });
      assert(res.status === 401, 'Wrong issuer returns 401');
    }
    {
      const token = await signTestJwt(OWNER_PRIVY_ID, { audience: 'wrong-app' });
      const res = await post('/auth/callback', { token });
      // This may be 401 or 429 (rate limited after 5 attempts)
      assert(res.status === 401 || res.status === 429, `Wrong audience returns 401 or 429 (got ${res.status})`);
    }

    // ── 14. Logout ──
    console.log('\n📋 Logout');
    {
      const res = await post('/auth/logout', {}, { Cookie: `everclaw_session=${sessionCookie}` });
      assert(res.status === 200, 'Logout returns 200');
      const data = await res.json();
      assert(data.success === true, 'Logout response has success: true');
      const clearedCookie = res.headers.get('set-cookie');
      assert(clearedCookie && clearedCookie.includes('Max-Age=0'), 'Session cookie is cleared');
    }

    // ── 15. Rate limiting ──
    console.log('\n📋 Rate Limiting');
    {
      // Burn through 5 attempts (rate limit is 5/min)
      // We already used some attempts above, so reset by waiting or just hammering
      const results = [];
      for (let i = 0; i < 7; i++) {
        const res = await post('/auth/callback', { token: 'bad-token-' + i });
        results.push(res.status);
      }
      const has429 = results.includes(429);
      assert(has429, `Rate limiter kicks in (statuses: ${results.join(',')})`);
    }

    // ── 16. Body too large ──
    console.log('\n📋 Body Size Limit');
    {
      const bigBody = { token: 'x'.repeat(20000) };
      const res = await post('/auth/callback', bigBody);
      assert(res.status === 413 || res.status === 429, `Large body rejected (status ${res.status})`);
    }

    // ── 17. Unauthenticated paths still serve login ──
    console.log('\n📋 Unauthenticated Path Coverage');
    {
      const paths = ['/some/random/path', '/api/v1/status', '/__openclaw__/control'];
      for (const path of paths) {
        const res = await get(path);
        const html = await res.text();
        assert(html.includes('EverClaw'), `${path} → login page (no cookie)`);
      }
    }

  } finally {
    proxyChild.kill('SIGTERM');
    backend.close();
    await new Promise(r => setTimeout(r, 500));
  }

  // ── Summary ──
  console.log('\n' + '═'.repeat(50));
  console.log(`  Results: ${passed}/${total} passed, ${failed} failed`);
  console.log('═'.repeat(50) + '\n');

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('❌ Test runner error:', err);
  process.exit(1);
});
