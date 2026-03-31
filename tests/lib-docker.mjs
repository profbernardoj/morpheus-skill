/**
 * tests/lib-docker.mjs — Unit tests for docker.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert";

import {
  isInsideContainer,
  isValidContainerName,
  detectContainerName,
  detectContainerHome,
  detectContainerUser,
  getContainerVolumes,
  estimateVolumeSize,
} from "../scripts/lib/docker.mjs";

describe("lib/docker.mjs", () => {
  describe("isInsideContainer()", () => {
    it("should return a boolean", () => {
      const result = isInsideContainer();
      assert.strictEqual(typeof result, "boolean");
    });
  });

  describe("isValidContainerName()", () => {
    it("should accept valid container names", () => {
      assert.ok(isValidContainerName("everclaw"));
      assert.ok(isValidContainerName("everclaw-prod"));
      assert.ok(isValidContainerName("everclaw_prod"));
      assert.ok(isValidContainerName("everclaw.prod"));
      assert.ok(isValidContainerName("my-container-123"));
      assert.ok(isValidContainerName("a"));
      assert.ok(isValidContainerName("a1"));
    });

    it("should reject invalid container names", () => {
      assert.ok(!isValidContainerName("")); // Empty
      assert.ok(!isValidContainerName(null)); // Null
      assert.ok(!isValidContainerName(undefined)); // Undefined
      assert.ok(!isValidContainerName(123)); // Number
      assert.ok(!isValidContainerName("-everclaw")); // Starts with dash
      assert.ok(!isValidContainerName(".everclaw")); // Starts with dot
      assert.ok(!isValidContainerName("everclaw container")); // Has space
      assert.ok(!isValidContainerName("everclaw$(whoami)")); // Shell injection
      assert.ok(!isValidContainerName("everclaw; rm -rf /")); // Command injection
      assert.ok(!isValidContainerName("a".repeat(64))); // Too long (>63 chars)
    });

    it("should reject shell injection attempts", () => {
      // Critical security test - these should NEVER be valid
      assert.ok(!isValidContainerName("'; DROP TABLE users; --"));
      assert.ok(!isValidContainerName("$(whoami)"));
      assert.ok(!isValidContainerName("`id`"));
      assert.ok(!isValidContainerName("$(rm -rf /)"));
      assert.ok(!isValidContainerName("everclaw; id"));
      assert.ok(!isValidContainerName("everclaw|cat /etc/passwd"));
      assert.ok(!isValidContainerName("everclaw&&whoami"));
    });

    it("should handle edge cases", () => {
      // Max length should be valid
      assert.ok(isValidContainerName("a".repeat(63)));
      
      // Unicode should be rejected (Docker doesn't support)
      assert.ok(!isValidContainerName("everclaw-日本語"));
      
      // Special chars that aren't allowed
      assert.ok(!isValidContainerName("everclaw@prod"));
      assert.ok(!isValidContainerName("everclaw!prod"));
      assert.ok(!isValidContainerName("everclaw#prod"));
    });
  });

  describe("detectContainerName()", () => {
    it("should return an object with found property", () => {
      const result = detectContainerName();
      assert.ok(typeof result === "object");
      assert.ok("found" in result);
    });

    it("should accept override parameter", () => {
      const result = detectContainerName("my-container");
      assert.ok(result.found);
      assert.strictEqual(result.name, "my-container");
      assert.strictEqual(result.method, "override");
    });
  });

  describe("detectContainerHome()", () => {
    it("should return a string", () => {
      // When container doesn't exist, returns default
      const result = detectContainerHome("nonexistent-container-12345");
      assert.strictEqual(typeof result, "string");
      assert.ok(result.length > 0);
    });

    it("should return default home for invalid names", () => {
      const result = detectContainerHome("invalid;name");
      assert.strictEqual(result, "/home/node");
    });
  });

  describe("detectContainerUser()", () => {
    it("should return a string", () => {
      const result = detectContainerUser("nonexistent-container-12345");
      assert.strictEqual(typeof result, "string");
    });

    it("should return default user for invalid names", () => {
      const result = detectContainerUser("invalid;name");
      assert.strictEqual(result, "node");
    });
  });

  describe("getContainerVolumes()", () => {
    it("should return an array for invalid names", () => {
      const result = getContainerVolumes("invalid;name");
      assert.ok(Array.isArray(result));
      assert.strictEqual(result.length, 0);
    });

    it("should return empty array for nonexistent container", () => {
      const result = getContainerVolumes("nonexistent-container-12345");
      assert.ok(Array.isArray(result));
    });
  });

  describe("estimateVolumeSize()", () => {
    it("should return object with totalBytes and volumes", () => {
      const result = estimateVolumeSize("nonexistent-container-12345");
      assert.ok(typeof result === "object");
      assert.ok("totalBytes" in result);
      assert.ok("volumes" in result);
      assert.ok(Array.isArray(result.volumes));
    });

    it("should return zero for invalid names", () => {
      const result = estimateVolumeSize("invalid;name");
      assert.strictEqual(result.totalBytes, 0);
      assert.strictEqual(result.volumes.length, 0);
    });
  });
});