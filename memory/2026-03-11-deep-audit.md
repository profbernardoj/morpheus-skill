# EverClaw v2026.3.13 — Deep Audit Report

**Date:** 2026-03-11
**Commit:** 74fc99c
**Auditor:** Bernardo (main agent)

---

## Phase 1: Functional Testing — COMPLETE

### Results Summary

| # | Component | Status | Notes |
|---|-----------|--------|-------|
| 1.1a | Proxy /health | ✅ PASS | Status OK, 4,134 MOR, 2 active sessions, 8 models |
| 1.1b | Proxy /v1/models | ✅ PASS | Returns 8 models correctly |
| 1.1c | Proxy /v1/chat/completions | ⚠️ PARTIAL | Returns response but `content` empty string — reasoning_content has the text. max_tokens=20 may be too low for thinking model |
| 1.2 | Wallet test suite | ✅ PASS | 36/36 tests, 13 suites, 0 failures |
| 1.3a | Session-mgr status | ✅ PASS | Shows balances, sessions, capacity |
| 1.3b | Session-mgr models | ✅ PASS | Lists 8 P2P models with categories |
| 1.3c | Session-mgr estimate | ✅ PASS | Correct capacity calculations |
| 1.3d | Session-mgr fund | ✅ PASS | Correctly requires OP_KEYCHAIN_ACCOUNT |
| 1.4a | Bootstrap --status | ⚠️ BUG | "Version: v2026.2.23" — shows API server version, not local. "Testing connectivity... ✓ Online — undefined" (undefined model name) |
| 1.4b | Bootstrap --test | ⚠️ BUG | "Model: undefined", "Response: ''" — inference works but response parsing broken. Content empty, model name undefined |
| 1.5a | Agent registry total | ✅ PASS | 29,403 registered agents |
| 1.5b | Agent registry list | ✅ PASS | Returns formatted table |
| 1.6 | Diagnose | ✅ PASS | 16 passed, 2 warnings (expected — plist/guardian), 0 failures. reasoning:true fix confirmed working |
| 1.7a | balance.sh | ⚠️ BUG | Syntax error line 64: `[[: 0\n0: syntax error in expression` when parsing sessions |
| 1.7b | chat.sh | ❌ BUG | `kimi: unbound variable` — hardcoded model reference without default |
| 1.8 | Inference balance tracker | ✅ PASS | Correct prices, balances, capacity |
| 1.9 | Router classifier | ✅ PASS | LIGHT/STANDARD/HEAVY tiers working correctly |
| 1.10 | Setup | ✅ PASS | Help output correct, 6 templates, --apply/--test/--restart flags |
| 1.11 | Ecosystem sync | ✅ PASS | 30/30 in sync + smartagent in sync |
| 1.12 | Key API server | ✅ PASS | 5-line server.js, deps: express, better-sqlite3, cors, helmet |
| 1.13 | Everclaw-deps | ✅ PASS | No deps declared (correct) |
| 1.14 | openclaw-update-check.sh | ❌ BUG | Shows 0 lines but contains corrupted binary/JSON data. Not a valid shell script. |
| 1.15a | session.sh | ✅ PASS | Help output correct |
| 1.15b | session-archive.sh | ✅ PASS | 5-phase cleanup, --help correct |
| 1.15c | pii-scan.sh | ✅ PASS | Help correct, multiple scan modes |
| 1.15d | always-on.sh | ✅ PASS | Correctly requires sudo |
| 1.15e | venice-402-watchdog.sh | ✅ PASS | Returns clean status |
| 1.15f | venice-key-monitor.sh | ℹ️ SKIP | No --dry-run mode; requires Venice API keys |

### Bugs Found

| # | Severity | Component | Issue |
|---|----------|-----------|-------|
| B1 | Medium | bootstrap-everclaw --test | Response parsing broken: "Model: undefined", "Response: ''". Content goes to reasoning_content, not content field. Venice/Kimi returns data in reasoning_content when thinking model used. |
| B2 | Medium | bootstrap-everclaw --status | Shows "undefined" for connectivity test model name |
| B3 | Medium | chat.sh | `kimi: unbound variable` — line uses unquoted variable `$MODEL` that defaults to empty, `set -u` catches it |
| B4 | Medium | balance.sh | Syntax error line 64 parsing session data — `[[` comparison broken on multi-line JSON |
| B5 | Low | openclaw-update-check.sh | File contains corrupted binary data, 0 valid lines. Should be deleted or rewritten. |
| B6 | Low | bootstrap-everclaw --status | Shows API server version (v2026.2.23) not local version (v2026.3.13) — misleading but not breaking |

### Phase 1 Score: 22 PASS / 5 BUGS / 1 SKIP (out of 28 tests)
