/**
 * tests/lib-wallet-crypto.mjs — Unit tests for wallet-crypto.mjs shared module
 *
 * Tests: deriveEncryptionKey, ENC_FORMAT_V2, passphrase helpers, decryptLegacyV1
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "node:crypto";

import {
  ENC_FORMAT_V2,
  deriveEncryptionKey,
  getPassphraseFromEnv,
  decryptLegacyV1,
} from "../scripts/lib/wallet-crypto.mjs";

describe("lib/wallet-crypto.mjs", () => {

  describe("ENC_FORMAT_V2", () => {
    it("should equal 0x02", () => {
      assert.strictEqual(ENC_FORMAT_V2, 0x02);
    });
  });

  describe("deriveEncryptionKey()", () => {
    it("should return a 32-byte Buffer", async () => {
      const salt = randomBytes(32);
      const key = await deriveEncryptionKey("test-passphrase-1234", salt);
      assert.ok(Buffer.isBuffer(key), "Should return a Buffer");
      assert.strictEqual(key.length, 32, "Key should be 32 bytes");
    });

    it("should produce deterministic output for same inputs", async () => {
      const salt = randomBytes(32);
      const key1 = await deriveEncryptionKey("same-passphrase", salt);
      const key2 = await deriveEncryptionKey("same-passphrase", salt);
      assert.deepStrictEqual(key1, key2, "Same passphrase + salt should produce same key");
    });

    it("should produce different output for different passphrases", async () => {
      const salt = randomBytes(32);
      const key1 = await deriveEncryptionKey("passphrase-one", salt);
      const key2 = await deriveEncryptionKey("passphrase-two", salt);
      assert.notDeepStrictEqual(key1, key2, "Different passphrases should produce different keys");
    });

    it("should produce different output for different salts", async () => {
      const salt1 = randomBytes(32);
      const salt2 = randomBytes(32);
      const key1 = await deriveEncryptionKey("same-passphrase", salt1);
      const key2 = await deriveEncryptionKey("same-passphrase", salt2);
      assert.notDeepStrictEqual(key1, key2, "Different salts should produce different keys");
    });
  });

  describe("v2 encrypt/decrypt round-trip", () => {
    it("should encrypt and decrypt correctly using deriveEncryptionKey", async () => {
      const passphrase = "my-strong-test-passphrase";
      const plaintext = "0xdeadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678";

      // Encrypt (same logic as everclaw-wallet.mjs encryptedFileStore)
      const salt = randomBytes(32);
      const encKey = await deriveEncryptionKey(passphrase, salt);
      const iv = randomBytes(16);
      const cipher = createCipheriv("aes-256-gcm", encKey, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
      const authTag = cipher.getAuthTag();

      // Build v2 blob
      const blob = Buffer.concat([Buffer.from([ENC_FORMAT_V2]), salt, iv, authTag, encrypted]);

      // Decrypt
      assert.strictEqual(blob[0], ENC_FORMAT_V2, "First byte should be v2 marker");
      const dSalt = blob.subarray(1, 33);
      const dIv = blob.subarray(33, 49);
      const dAuthTag = blob.subarray(49, 65);
      const dEncrypted = blob.subarray(65);

      const decKey = await deriveEncryptionKey(passphrase, dSalt);
      const decipher = createDecipheriv("aes-256-gcm", decKey, dIv);
      decipher.setAuthTag(dAuthTag);
      const decrypted = Buffer.concat([decipher.update(dEncrypted), decipher.final()]).toString("utf-8");

      assert.strictEqual(decrypted, plaintext, "Decrypted text should match original");
    });

    it("should fail to decrypt with wrong passphrase", async () => {
      const passphrase = "correct-passphrase-123";
      const plaintext = "0xsecretkey";

      // Encrypt
      const salt = randomBytes(32);
      const encKey = await deriveEncryptionKey(passphrase, salt);
      const iv = randomBytes(16);
      const cipher = createCipheriv("aes-256-gcm", encKey, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
      const authTag = cipher.getAuthTag();
      const blob = Buffer.concat([Buffer.from([ENC_FORMAT_V2]), salt, iv, authTag, encrypted]);

      // Decrypt with wrong passphrase
      const dSalt = blob.subarray(1, 33);
      const dIv = blob.subarray(33, 49);
      const dAuthTag = blob.subarray(49, 65);
      const dEncrypted = blob.subarray(65);

      const wrongKey = await deriveEncryptionKey("wrong-passphrase-456", dSalt);
      const decipher = createDecipheriv("aes-256-gcm", wrongKey, dIv);
      decipher.setAuthTag(dAuthTag);

      assert.throws(() => {
        Buffer.concat([decipher.update(dEncrypted), decipher.final()]);
      }, /Unsupported state|authentication/i, "Wrong passphrase should fail decryption");
    });
  });

  describe("decryptLegacyV1()", () => {
    it("should decrypt a v1 format blob", () => {
      // Build a v1 blob using the legacy key derivation
      const machineId = "everclaw-fallback"; // default when no machine-id file
      const keychainAccount = "everclaw-agent";
      const salt = `everclaw-${keychainAccount}-${process.env.USER || "agent"}`;
      const encKey = scryptSync(machineId, salt, 32);

      const plaintext = "0xlegacyprivatekey1234567890abcdef";
      const iv = randomBytes(16);
      const cipher = createCipheriv("aes-256-gcm", encKey, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
      const authTag = cipher.getAuthTag();

      // v1 format: iv(16) + authTag(16) + ciphertext
      const blob = Buffer.concat([iv, authTag, encrypted]);

      const result = decryptLegacyV1(blob, keychainAccount);
      assert.strictEqual(result, plaintext, "Should decrypt v1 blob correctly");
    });

    it("should return null for blobs that are too short", () => {
      const shortBlob = Buffer.alloc(32); // needs at least 33
      const result = decryptLegacyV1(shortBlob);
      assert.strictEqual(result, null, "Should return null for short blob");
    });
  });

  describe("getPassphraseFromEnv()", () => {
    it("should return null when no env vars set", () => {
      const origPass = process.env.EVERCLAW_WALLET_PASSPHRASE;
      const origFile = process.env.EVERCLAW_WALLET_PASSPHRASE_FILE;
      delete process.env.EVERCLAW_WALLET_PASSPHRASE;
      delete process.env.EVERCLAW_WALLET_PASSPHRASE_FILE;

      const result = getPassphraseFromEnv();
      assert.strictEqual(result, null, "Should return null when no env vars set");

      // Restore
      if (origPass !== undefined) process.env.EVERCLAW_WALLET_PASSPHRASE = origPass;
      if (origFile !== undefined) process.env.EVERCLAW_WALLET_PASSPHRASE_FILE = origFile;
    });

    it("should return passphrase from EVERCLAW_WALLET_PASSPHRASE", () => {
      const origPass = process.env.EVERCLAW_WALLET_PASSPHRASE;
      process.env.EVERCLAW_WALLET_PASSPHRASE = "test-env-passphrase";

      const result = getPassphraseFromEnv();
      assert.strictEqual(result, "test-env-passphrase");

      // Restore
      if (origPass !== undefined) {
        process.env.EVERCLAW_WALLET_PASSPHRASE = origPass;
      } else {
        delete process.env.EVERCLAW_WALLET_PASSPHRASE;
      }
    });
  });
});
