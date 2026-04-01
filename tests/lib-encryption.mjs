/**
 * tests/lib-encryption.mjs — Unit tests for encryption.mjs
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  generatePassphrase,
  validatePassphrase,
  encryptDirectory,
  decryptArchive,
  shredFile,
  shredDirectory,
  checkDependencies,
  MIN_PASSPHRASE_LENGTH,
} from "../scripts/lib/encryption.mjs";

const TEST_DIR = join(tmpdir(), "everclaw-test-encryption");
const TEST_PASSPHRASE = "test-passphrase-12345678";

describe("lib/encryption.mjs", () => {
  before(() => {
    // Create test directory
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  after(() => {
    // Cleanup test directory
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe("generatePassphrase()", () => {
    it("should generate a passphrase of default length", () => {
      const pp = generatePassphrase();
      assert.ok(pp.length >= MIN_PASSPHRASE_LENGTH, "Passphrase too short");
    });

    it("should generate a passphrase of custom length", () => {
      const pp = generatePassphrase(32);
      assert.strictEqual(pp.length, 32);
    });

    it("should generate unique passphrases", () => {
      const pp1 = generatePassphrase();
      const pp2 = generatePassphrase();
      assert.notStrictEqual(pp1, pp2, "Passphrases should be unique");
    });
  });

  describe("validatePassphrase()", () => {
    it("should accept valid passphrases", () => {
      const result = validatePassphrase("this-is-a-valid-passphrase-123");
      assert.ok(result.valid, "Should be valid");
    });

    it("should reject short passphrases", () => {
      const result = validatePassphrase("short");
      assert.ok(!result.valid, "Should reject short passphrase");
      assert.ok(result.errors.some(e => e.includes("short")), "Should mention length");
    });

    it("should accept minimum length", () => {
      const result = validatePassphrase("a".repeat(MIN_PASSPHRASE_LENGTH));
      assert.ok(result.valid, `Should accept ${MIN_PASSPHRASE_LENGTH} chars`);
    });
  });

  describe("checkDependencies()", () => {
    it("should return { ok: true } or list missing deps", () => {
      const result = checkDependencies();
      assert.ok(typeof result.ok === "boolean");
      assert.ok(Array.isArray(result.missing));
    });
  });

  describe("shredFile()", () => {
    it("should delete a file", () => {
      const testFile = join(TEST_DIR, "shred-test.txt");
      writeFileSync(testFile, "sensitive data");
      assert.ok(existsSync(testFile), "File should exist before shred");
      
      shredFile(testFile);
      
      assert.ok(!existsSync(testFile), "File should not exist after shred");
    });

    it("should handle non-existent file gracefully", () => {
      // Should not throw
      shredFile(join(TEST_DIR, "nonexistent-file.txt"));
    });

    it("should handle path with spaces", () => {
      const testFile = join(TEST_DIR, "path with spaces.txt");
      writeFileSync(testFile, "data");
      
      shredFile(testFile);
      
      assert.ok(!existsSync(testFile), "File with spaces should be shredded");
    });
  });

  describe("shredDirectory()", () => {
    it("should delete a directory and all contents", () => {
      const testDir = join(TEST_DIR, "shred-dir-test");
      mkdirSync(testDir, { recursive: true });
      writeFileSync(join(testDir, "file1.txt"), "data1");
      writeFileSync(join(testDir, "file2.txt"), "data2");
      
      assert.ok(existsSync(testDir), "Dir should exist");
      
      shredDirectory(testDir);
      
      assert.ok(!existsSync(testDir), "Dir should not exist after shred");
    });

    it("should handle nested directories", () => {
      const testDir = join(TEST_DIR, "nested-dir");
      mkdirSync(join(testDir, "sub1", "sub2"), { recursive: true });
      writeFileSync(join(testDir, "sub1", "sub2", "deep.txt"), "deep data");
      
      shredDirectory(testDir);
      
      assert.ok(!existsSync(testDir), "Nested dir should be shredded");
    });

    it("should handle non-existent directory gracefully", () => {
      // Should not throw
      shredDirectory(join(TEST_DIR, "nonexistent-dir"));
    });
  });

  describe("No shell injection in shred functions", () => {
    it("shredFile should not execute shell commands in filename", () => {
      // Create a file with a safe name
      const safeFile = join(TEST_DIR, "safe-file.txt");
      writeFileSync(safeFile, "data");
      
      // This filename has shell metacharacters but should be treated as literal
      const dangerousName = "file$(whoami).txt";
      const dangerousFile = join(TEST_DIR, dangerousName);
      writeFileSync(dangerousFile, "data");
      
      // Both should be deleted without executing shell commands
      shredFile(dangerousFile);
      
      assert.ok(!existsSync(dangerousFile), "Dangerous filename should be shredded");
      assert.ok(existsSync(safeFile), "Other files should not be affected");
      
      // Cleanup
      shredFile(safeFile);
    });
  });
});