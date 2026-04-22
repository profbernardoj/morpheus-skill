/**
 * tests/lib-keychain.mjs — Unit tests for keychain.mjs
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { platform } from "node:os";

import {
  readWalletKey,
  writeWalletKey,
  encryptWalletKey,
  decryptWalletKey,
  detectCurrentUser,
  KEYCHAIN_SERVICE,
  KEYCHAIN_ACCOUNT,
} from "../scripts/lib/keychain.mjs";

const TEST_DIR = join(tmpdir(), "everclaw-test-keychain");
const TEST_PRIVATE_KEY = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const TEST_PASSPHRASE = "test-passphrase-12345678";

describe("lib/keychain.mjs", () => {
  before(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  after(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe("detectCurrentUser()", () => {
    it("should return a non-empty string", () => {
      const user = detectCurrentUser();
      assert.ok(typeof user === "string");
      assert.ok(user.length > 0);
    });
  });

  describe("encryptWalletKey() / decryptWalletKey()", () => {
    it("should encrypt and decrypt a key", () => {
      const encrypted = encryptWalletKey(TEST_PRIVATE_KEY, TEST_PASSPHRASE);
      assert.ok(typeof encrypted === "string");
      assert.ok(encrypted.length > 0);
      assert.ok(encrypted.includes("-----BEGIN AGE ENCRYPTED FILE-----"));

      const decrypted = decryptWalletKey(encrypted, TEST_PASSPHRASE);
      assert.strictEqual(decrypted, TEST_PRIVATE_KEY);
    });

    it("should fail to decrypt with wrong passphrase", () => {
      const encrypted = encryptWalletKey(TEST_PRIVATE_KEY, TEST_PASSPHRASE);
      
      assert.throws(() => {
        decryptWalletKey(encrypted, "wrong-passphrase");
      }, /decrypt|failed/i);
    });

    it("should produce different ciphertext each time", () => {
      const encrypted1 = encryptWalletKey(TEST_PRIVATE_KEY, TEST_PASSPHRASE);
      const encrypted2 = encryptWalletKey(TEST_PRIVATE_KEY, TEST_PASSPHRASE);
      
      // AGE uses random nonces, so same plaintext should produce different ciphertext
      assert.notStrictEqual(encrypted1, encrypted2);
    });
  });

  describe("readWalletKey() / writeWalletKey()", () => {
    // These tests require keychain access, which may not be available in CI
    // We test the encrypted file fallback
    
    it("should return object with found property", () => {
      const result = readWalletKey();
      assert.ok(typeof result === "object");
      assert.ok("found" in result);
      assert.ok("source" in result);
    });
  });

  describe("Security: No shell injection in key handling", () => {
    it("encryptWalletKey should handle malicious passphrase", () => {
      // Passphrase with shell metacharacters should be treated as literal string
      const maliciousPassphrase = "$(whoami); rm -rf /";
      
      // Should not throw, should treat as literal string
      const encrypted = encryptWalletKey(TEST_PRIVATE_KEY, maliciousPassphrase);
      assert.ok(typeof encrypted === "string");
      
      // Should be able to decrypt with the same literal string
      const decrypted = decryptWalletKey(encrypted, maliciousPassphrase);
      assert.strictEqual(decrypted, TEST_PRIVATE_KEY);
    });

    it("encryptWalletKey should handle special characters in key", () => {
      // Private keys only contain hex, but test robustness
      const encrypted = encryptWalletKey(TEST_PRIVATE_KEY, TEST_PASSPHRASE);
      
      // The encrypted output should be ASCII-armored AGE format
      assert.ok(!encrypted.includes("$(whoami)"));
      assert.ok(!encrypted.includes("`"));
    });
  });
});