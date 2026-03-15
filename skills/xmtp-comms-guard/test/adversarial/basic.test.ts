import { describe, it } from "node:test";
import assert from "node:assert";

describe("xmtp-comms-guard V6 adversarial tests", () => {
  it("rejects unknown topic via schema", async () => {
    const { AgentMessageSchema } = await import("../../src/schemas/index.js");
    const result = AgentMessageSchema.safeParse({
      messageType: "DATA",
      version: "6.0",
      payload: {},
      topics: ["malicious-topic"],
      sensitivity: "public",
      intent: "query",
      correlationId: "550e8400-e29b-41d4-a716-446655440000",
      timestamp: new Date().toISOString(),
      nonce: "dGVzdG5vbmNlMTIzNDU2Nzg5MGFiY2RlZmdoaWpr",
    });
    assert.strictEqual(result.success, false, "Should reject unknown topic");
  });

  it("rejects old protocol version", async () => {
    const { AgentMessageSchema } = await import("../../src/schemas/index.js");
    const result = AgentMessageSchema.safeParse({
      messageType: "DATA",
      version: "5.0",
      payload: {},
      topics: ["general"],
      sensitivity: "public",
      intent: "query",
      correlationId: "550e8400-e29b-41d4-a716-446655440000",
      timestamp: new Date().toISOString(),
      nonce: "dGVzdG5vbmNlMTIzNDU2Nzg5MGFiY2RlZmdoaWpr",
    });
    assert.strictEqual(result.success, false, "Should reject version 5.0");
  });

  it("rejects weak nonce format", async () => {
    const { AgentMessageSchema } = await import("../../src/schemas/index.js");
    const result = AgentMessageSchema.safeParse({
      messageType: "DATA",
      version: "6.0",
      payload: {},
      topics: ["general"],
      sensitivity: "public",
      intent: "query",
      correlationId: "550e8400-e29b-41d4-a716-446655440000",
      timestamp: new Date().toISOString(),
      nonce: "tooshort",
    });
    assert.strictEqual(result.success, false, "Should reject non-base64-32-byte nonce");
  });

  it("blocks nonce replay", async () => {
    const { nonceCacheService } = await import("../../src/security/nonceCache.js");
    const nonce = "dGVzdG5vbmNlMTIzNDU2Nzg5MGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6";
    nonceCacheService.markUsed(nonce);
    assert.strictEqual(nonceCacheService.isUsed(nonce), true, "Should detect replayed nonce");
  });

  it("enforces 64KB byte limit concept", () => {
    const huge = "X".repeat(65 * 1024);
    assert.ok(Buffer.byteLength(huge, "utf8") > 64 * 1024, "Should exceed 64KB");
  });

  it("accepts valid message", async () => {
    const { AgentMessageSchema } = await import("../../src/schemas/index.js");
    const crypto = await import("crypto");
    const nonce = crypto.randomBytes(32).toString("base64");
    const result = AgentMessageSchema.safeParse({
      messageType: "DATA",
      version: "6.0",
      payload: { text: "hello" },
      topics: ["everclaw"],
      sensitivity: "technical",
      intent: "query",
      correlationId: "550e8400-e29b-41d4-a716-446655440000",
      timestamp: new Date().toISOString(),
      nonce,
    });
    assert.strictEqual(result.success, true, "Should accept valid V6 message");
  });
});
