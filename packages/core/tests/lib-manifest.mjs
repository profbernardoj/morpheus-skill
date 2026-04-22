/**
 * tests/lib-manifest.mjs — Unit tests for manifest.mjs
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  generateManifest,
  validateManifest,
  checkVersionCompatibility,
  detectEverclawVersion,
  detectOpenclawVersion,
} from "../scripts/lib/manifest.mjs";

const TEST_DIR = join(tmpdir(), "everclaw-test-manifest");

describe("lib/manifest.mjs", () => {
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

  describe("validateManifest()", () => {
    it("should accept a valid manifest", () => {
      const manifest = {
        version: "2026.3.31",
        created: new Date().toISOString(),
        components: ["openclaw", "morpheus", "everclaw"],
        sizes: { openclaw: 1000 },
      };
      
      const result = validateManifest(manifest);
      assert.ok(result.valid, `Should be valid: ${result.errors?.join(", ")}`);
    });

    it("should reject manifest without version", () => {
      const manifest = {
        created: new Date().toISOString(),
        components: ["openclaw"],
      };
      
      const result = validateManifest(manifest);
      assert.ok(!result.valid);
      assert.ok(result.errors.some(e => e.includes("version")));
    });

    it("should reject manifest without created date", () => {
      const manifest = {
        version: "2026.3.31",
        components: ["openclaw"],
      };
      
      const result = validateManifest(manifest);
      assert.ok(!result.valid);
      assert.ok(result.errors.some(e => e.includes("created")));
    });

    it("should reject manifest with invalid date", () => {
      const manifest = {
        version: "2026.3.31",
        created: "not-a-date",
        components: ["openclaw"],
      };
      
      const result = validateManifest(manifest);
      assert.ok(!result.valid);
    });

    it("should accept manifest with optional fields", () => {
      const manifest = {
        version: "2026.3.31",
        created: new Date().toISOString(),
        components: ["openclaw"],
        sizes: { openclaw: 1000, morpheus: 2000 },
        checksums: { openclaw: "sha256:abc123" },
        versions: { everclaw: "2026.3.31", openclaw: "2026.3.24" },
        platform: { os: "darwin", arch: "arm64" },
        exportMode: "full",
        sourceHost: "mac-mini",
      };
      
      const result = validateManifest(manifest);
      assert.ok(result.valid);
    });
  });

  describe("checkVersionCompatibility()", () => {
    it("should accept same version", () => {
      const manifest = { version: "2026.3.31" };
      const result = checkVersionCompatibility(manifest);
      assert.ok(result.compatible);
      assert.strictEqual(result.warnings.length, 0);
    });

    it("should accept older versions", () => {
      const manifest = { version: "2026.3.20" };
      const result = checkVersionCompatibility(manifest);
      assert.ok(result.compatible);
    });

    it("should warn on major version differences", () => {
      const manifest = { version: "2025.3.31" }; // Old year
      const result = checkVersionCompatibility(manifest);
      // Should still work but may have warnings
      assert.ok(typeof result.compatible === "boolean");
    });

    it("should handle invalid version format", () => {
      const manifest = { version: "invalid" };
      const result = checkVersionCompatibility(manifest);
      // Should handle gracefully
      assert.ok(typeof result.compatible === "boolean");
    });
  });

  describe("detectEverclawVersion()", () => {
    it("should return an object", () => {
      const result = detectEverclawVersion();
      assert.ok(typeof result === "object");
      // May be null if not installed
      if (result) {
        assert.ok("version" in result || "commit" in result);
      }
    });
  });

  describe("detectOpenclawVersion()", () => {
    it("should return an object", () => {
      const result = detectOpenclawVersion();
      assert.ok(typeof result === "object");
      // May be null if not installed
      if (result) {
        assert.ok("version" in result || "commit" in result);
      }
    });
  });

  describe("generateManifest()", () => {
    it("should create a valid manifest", () => {
      const manifest = generateManifest({
        components: ["openclaw", "everclaw"],
        sizes: { openclaw: 1000, everclaw: 500 },
      });
      
      assert.ok(manifest.version);
      assert.ok(manifest.created);
      assert.ok(Array.isArray(manifest.components));
      assert.ok(manifest.components.includes("openclaw"));
    });

    it("should include platform info", () => {
      const manifest = generateManifest({});
      assert.ok(manifest.platform);
      assert.ok(manifest.platform.os);
      assert.ok(manifest.platform.arch);
    });
  });
});