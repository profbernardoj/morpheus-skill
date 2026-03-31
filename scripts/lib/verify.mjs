/**
 * lib/verify.mjs — Post-restore verification
 *
 * Runs after restore to verify:
 * 1. openclaw doctor — health checks
 * 2. Morpheus proxy health
 * 3. Inference test (GLM-5)
 * 4. Wallet address (if restored)
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { runDoctor } from "./openclaw.mjs";

/**
 * Check OpenClaw gateway health
 */
export function checkGatewayHealth() {
  try {
    const result = execSync("openclaw health 2>/dev/null", {
      encoding: "utf-8",
      timeout: 15000,
    });
    return { healthy: true, details: result.trim() };
  } catch (err) {
    return { healthy: false, details: err.message };
  }
}

/**
 * Check Morpheus proxy health
 */
export function checkProxyHealth() {
  try {
    const result = execSync("curl -sf http://127.0.0.1:8083/health 2>/dev/null", {
      encoding: "utf-8",
      timeout: 10000,
    });
    const health = JSON.parse(result);
    return {
      healthy: true,
      fallbackMode: health.fallbackMode || false,
      morBalance: health.morBalance,
      consecutiveFailures: health.consecutiveFailures || 0,
    };
  } catch {
    return { healthy: false };
  }
}

/**
 * Test inference with a minimal request
 */
export async function testInference() {
  try {
    const result = execSync(
      `curl -sf -X POST http://127.0.0.1:8083/v1/chat/completions ` +
      `-H "Content-Type: application/json" ` +
      `-d '{"model":"glm-5","messages":[{"role":"user","content":"ping"}],"max_tokens":5}' ` +
      `2>/dev/null`,
      {
        encoding: "utf-8",
        timeout: 30000,
      }
    );
    const parsed = JSON.parse(result);
    const model = parsed.model || "unknown";
    const content = parsed.choices?.[0]?.message?.content || "";
    return { success: true, model, response: content.substring(0, 50) };
  } catch {
    // Try via gateway
    try {
      const result = execSync(
        `openclaw agent --message "ping" --max-tokens 5 2>/dev/null`,
        { encoding: "utf-8", timeout: 30000 }
      );
      return { success: true, model: "via-gateway", response: result.trim().substring(0, 50) };
    } catch {
      return { success: false };
    }
  }
}

/**
 * Verify wallet address matches expected
 */
export async function verifyWallet(expectedAddress) {
  try {
    const result = execSync(
      "node scripts/everclaw-wallet.mjs address 2>/dev/null || " +
      "node ~/.openclaw/workspace/skills/everclaw/scripts/everclaw-wallet.mjs address 2>/dev/null",
      { encoding: "utf-8", timeout: 10000 }
    );
    const currentAddress = result.trim().match(/0x[a-fA-F0-9]{40}/)?.[0];
    
    if (!currentAddress) {
      return { verified: false, reason: "Could not read wallet address" };
    }

    if (expectedAddress && currentAddress.toLowerCase() !== expectedAddress.toLowerCase()) {
      return {
        verified: false,
        reason: `Address mismatch: expected ${expectedAddress}, got ${currentAddress}`,
        currentAddress,
      };
    }

    return { verified: true, address: currentAddress };
  } catch {
    return { verified: false, reason: "Wallet not accessible" };
  }
}

/**
 * Run full post-restore verification
 * @param {object} options - { walletAddress?: string }
 * @returns {{ passed: boolean, checks: { name: string, passed: boolean, details: string }[] }}
 */
export async function runFullVerification(options = {}) {
  const checks = [];

  // 1. OpenClaw doctor
  const doctor = runDoctor();
  checks.push({
    name: "OpenClaw Doctor",
    passed: doctor.success,
    details: doctor.success ? "All checks passed" : doctor.output,
  });

  // 2. Gateway health
  const gateway = checkGatewayHealth();
  checks.push({
    name: "Gateway Health",
    passed: gateway.healthy,
    details: gateway.healthy ? gateway.details : "Gateway not responding",
  });

  // 3. Proxy health
  const proxy = checkProxyHealth();
  checks.push({
    name: "Morpheus Proxy",
    passed: proxy.healthy,
    details: proxy.healthy
      ? `MOR: ${proxy.morBalance || "N/A"}, Fallback: ${proxy.fallbackMode ? "ON" : "OFF"}`
      : "Proxy not responding",
  });

  // 4. Inference test
  const inference = await testInference();
  checks.push({
    name: "Inference Test",
    passed: inference.success,
    details: inference.success
      ? `Model: ${inference.model}, Response: "${inference.response}"`
      : "Inference failed",
  });

  // 5. Wallet (if applicable)
  if (options.walletAddress) {
    const wallet = await verifyWallet(options.walletAddress);
    checks.push({
      name: "Wallet Verification",
      passed: wallet.verified,
      details: wallet.verified
        ? `Address: ${wallet.address}`
        : wallet.reason,
    });
  }

  const passed = checks.every(c => c.passed);
  return { passed, checks };
}
