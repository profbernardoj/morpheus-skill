#!/usr/bin/env node
/**
 * everclaw-verify.mjs — Standalone verification utility
 *
 * Performs comprehensive health checks:
 * - OpenClaw doctor diagnostics
 * - GLM-5 inference test (Morpheus endpoint)
 * - Wallet keychain access
 * - Morpheus session health
 * - Backup manifest verification (if file provided)
 *
 * USAGE:
 *   everclaw-verify [options] [backup-file]
 *
 * OPTIONS:
 *   --inference         Run GLM-5 inference test (default: true)
 *   --no-inference      Skip inference test
 *   --wallet            Check wallet keychain access (default: true)
 *   --no-wallet         Skip wallet check
 *   --session           Check Morpheus session health (default: true)
 *   --no-session        Skip session check
 *   --json              Output results as JSON
 *   --fix               Attempt to fix issues where possible
 *   -v, --verbose       Detailed output
 *   -q, --quiet         Minimal output (errors only)
 *   -h, --help          Show this help
 *
 * EXIT CODES:
 *   0 - All checks passed
 *   1 - Some checks failed
 *   2 - Dependency missing
 *   3 - Backup file not found or invalid
 */

import { parseArgs } from "node:util";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir, platform } from "node:os";
import { execSync, spawn } from "node:child_process";

// Import lib modules
import {
  isInsideContainer,
  detectContainerName,
  detectContainerHome,
} from "./lib/docker.mjs";

import {
  readWalletKey,
  getWalletAddress,
  KEYCHAIN_SERVICE,
  KEYCHAIN_ACCOUNT,
} from "./lib/keychain.mjs";

import {
  checkDependencies,
  decryptArchive,
} from "./lib/encryption.mjs";

import {
  validateManifest,
  checkVersionCompatibility,
  detectEverclawVersion,
  detectOpenclawVersion,
} from "./lib/manifest.mjs";

import {
  isOpenclawAvailable,
  getStateDir,
  runDoctor,
} from "./lib/openclaw.mjs";

import {
  getMorpheusConfig,
  getMorpheusSession,
  checkMorpheusHealth,
} from "./lib/morpheus.mjs";

// ─── CLI Argument Parsing ─────────────────────────────────────────────

const CLI_VERSION = "1.0.0";

const HELP_TEXT = `
EverClaw Verify v${CLI_VERSION}
Standalone verification utility

USAGE:
  everclaw-verify [options] [backup-file]

OPTIONS:
  --inference         Run GLM-5 inference test (default)
  --no-inference      Skip inference test
  --wallet            Check wallet keychain access (default)
  --no-wallet         Skip wallet check
  --session           Check Morpheus session health (default)
  --no-session        Skip session check
  --json              Output results as JSON
  --fix               Attempt to fix issues
  -v, --verbose       Detailed output
  -q, --quiet         Minimal output (errors only)
  -h, --help          Show this help

EXAMPLES:
  everclaw-verify
  everclaw-verify --inference --wallet
  everclaw-verify backup.tar.zst.age
  everclaw-verify --json --no-inference
`;

function parseCliArgs() {
  const { values, positionals } = parseArgs({
    options: {
      inference: { type: "boolean", default: true },
      "no-inference": { type: "boolean", default: false },
      wallet: { type: "boolean", default: true },
      "no-wallet": { type: "boolean", default: false },
      session: { type: "boolean", default: true },
      "no-session": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      fix: { type: "boolean", default: false },
      verbose: { type: "boolean", short: "v", default: false },
      quiet: { type: "boolean", short: "q", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });

  // Handle --no-* flags
  if (values["no-inference"]) values.inference = false;
  if (values["no-wallet"]) values.wallet = false;
  if (values["no-session"]) values.session = false;

  return {
    ...values,
    inputFile: positionals[0],
  };
}

// ─── Output Helpers ──────────────────────────────────────────────────

let VERBOSE = false;
let QUIET = false;
let JSON_OUTPUT = false;

function log(msg, level = "info") {
  if (JSON_OUTPUT) return;
  if (QUIET && level !== "error") return;
  const prefix = level === "error" ? "❌ " : level === "warn" ? "⚠️  " : level === "success" ? "✅ " : level === "skip" ? "⏭️  " : "";
  console.error(`${prefix}${msg}`);
}

function verbose(msg) {
  if (JSON_OUTPUT) return;
  if (VERBOSE && !QUIET) console.error(`  ${msg}`);
}

function progress(phase, detail = "") {
  if (JSON_OUTPUT || QUIET) return;
  const spinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const idx = Math.floor(Date.now() / 100) % spinner.length;
  process.stderr.write(`\r${spinner[idx]} ${phase}${detail ? `: ${detail}` : ""}`);
}

function progressDone(msg = "Done") {
  if (JSON_OUTPUT || QUIET) return;
  process.stderr.write(`\r✅ ${msg}\n`);
}

// ─── Check Results Structure ──────────────────────────────────────────

/**
 * @typedef {Object} CheckResult
 * @property {string} name - Check name
 * @property {boolean} passed - Whether the check passed
 * @property {string} status - "pass" | "fail" | "warn" | "skip"
 * @property {string} [message] - Human-readable message
 * @property {string} [details] - Additional details
 * @property {boolean} [fixable] - Whether --fix can resolve this
 * @property {string} [fixAction] - What --fix would do
 */

function createResult(name, passed, status, message, details = null, fixable = false, fixAction = null) {
  return { name, passed, status, message, details, fixable, fixAction };
}

// ─── Individual Checks ────────────────────────────────────────────────

/**
 * Check OpenClaw availability and run doctor
 */
function checkOpenclaw() {
  const results = [];
  
  // Check if openclaw binary exists
  progress("Checking OpenClaw binary");
  const available = isOpenclawAvailable();
  if (!available) {
    results.push(createResult(
      "openclaw-binary",
      false,
      "fail",
      "OpenClaw binary not found in PATH",
      "Install OpenClaw or add to PATH",
      true,
      "Install OpenClaw"
    ));
    return results;
  }
  results.push(createResult("openclaw-binary", true, "pass", "OpenClaw binary found"));
  verbose("OpenClaw binary found in PATH");
  
  // Run openclaw doctor
  progress("Running OpenClaw doctor");
  const doctorResult = runDoctor();
  if (doctorResult.success) {
    results.push(createResult("openclaw-doctor", true, "pass", "OpenClaw doctor passed"));
    verbose("OpenClaw doctor: all checks passed");
  } else {
    const output = doctorResult.output?.substring(0, 200) || "unknown error";
    results.push(createResult(
      "openclaw-doctor",
      false,
      "warn",
      "OpenClaw doctor reported issues",
      output,
      false,
      null
    ));
    verbose(`OpenClaw doctor output: ${output}`);
  }
  
  // Check state directory
  progress("Checking OpenClaw state");
  const stateDir = getStateDir();
  if (existsSync(stateDir)) {
    results.push(createResult("openclaw-state", true, "pass", "OpenClaw state directory exists", stateDir));
    verbose(`State directory: ${stateDir}`);
  } else {
    results.push(createResult(
      "openclaw-state",
      false,
      "warn",
      "OpenClaw state directory not found",
      `Expected: ${stateDir}`,
      false,
      null
    ));
  }
  
  // Check OpenClaw version
  progress("Checking OpenClaw version");
  const openclawVersionResult = detectOpenclawVersion();
  const openclawVersion = openclawVersionResult?.version || openclawVersionResult;
  if (openclawVersion) {
    const versionStr = openclawVersion.startsWith('v') ? openclawVersion : `v${openclawVersion}`;
    results.push(createResult("openclaw-version", true, "pass", `OpenClaw ${versionStr}`, openclawVersion));
    verbose(`OpenClaw version: ${openclawVersion}`);
  } else {
    results.push(createResult("openclaw-version", false, "warn", "Could not detect OpenClaw version"));
  }
  
  return results;
}

/**
 * Check EverClaw skill installation
 */
function checkEverclaw() {
  const results = [];
  
  progress("Checking EverClaw skill");
  const everclawDir = join(homedir(), ".everclaw");
  
  if (existsSync(everclawDir)) {
    results.push(createResult("everclaw-config", true, "pass", "EverClaw config directory exists", everclawDir));
    verbose(`EverClaw config: ${everclawDir}`);
    
    // Check for key file
    const keyFile = join(everclawDir, "key");
    if (existsSync(keyFile)) {
      results.push(createResult("everclaw-key", true, "pass", "EverClaw key file exists"));
      verbose("EverClaw key file found");
    } else {
      results.push(createResult(
        "everclaw-key",
        false,
        "warn",
        "EverClaw key file not found",
        "Run 'everclaw-setup' to configure",
        true,
        "Run everclaw-setup"
      ));
    }
  } else {
    results.push(createResult(
      "everclaw-config",
      false,
      "warn",
      "EverClaw config directory not found",
      "Run 'everclaw-setup' to initialize",
      true,
      "Run everclaw-setup"
    ));
  }
  
  // Check EverClaw version
  progress("Checking EverClaw version");
  const everclawVersionResult = detectEverclawVersion();
  const everclawVersion = everclawVersionResult?.version || everclawVersionResult;
  if (everclawVersion) {
    const versionStr = everclawVersion.startsWith('v') ? everclawVersion : `v${everclawVersion}`;
    results.push(createResult("everclaw-version", true, "pass", `EverClaw ${versionStr}`, everclawVersion));
    verbose(`EverClaw version: ${everclawVersion}`);
  } else {
    results.push(createResult("everclaw-version", false, "warn", "Could not detect EverClaw version"));
  }
  
  return results;
}

/**
 * Check Morpheus session and wallet
 */
function checkMorpheus() {
  const results = [];
  
  progress("Checking Morpheus directory");
  const morpheusDir = join(homedir(), "morpheus");
  const morpheusAltDir = join(homedir(), ".morpheus");
  
  let morpheusPath = null;
  if (existsSync(morpheusDir)) {
    morpheusPath = morpheusDir;
  } else if (existsSync(morpheusAltDir)) {
    morpheusPath = morpheusAltDir;
  }
  
  if (morpheusPath) {
    results.push(createResult("morpheus-dir", true, "pass", "Morpheus directory exists", morpheusPath));
    verbose(`Morpheus directory: ${morpheusPath}`);
    
    // Check for wallet file
    const walletPath = join(morpheusPath, "wallet", "encrypted_wallet.json");
    if (existsSync(walletPath)) {
      results.push(createResult("morpheus-wallet", true, "pass", "Morpheus wallet file exists"));
      verbose("Morpheus wallet file found");
    } else {
      results.push(createResult(
        "morpheus-wallet",
        false,
        "warn",
        "Morpheus wallet file not found",
        "Run Morpheus to initialize wallet"
      ));
    }
    
    // Check for session data
    const sessionPath = join(morpheusPath, "session");
    if (existsSync(sessionPath)) {
      results.push(createResult("morpheus-session", true, "pass", "Morpheus session data exists"));
      verbose("Morpheus session data found");
    } else {
      results.push(createResult(
        "morpheus-session",
        false,
        "warn",
        "Morpheus session data not found",
        "Run Morpheus to create session"
      ));
    }
  } else {
    results.push(createResult(
      "morpheus-dir",
      false,
      "warn",
      "Morpheus directory not found",
      "Morpheus may not be installed or configured",
      false,
      null
    ));
  }
  
  return results;
}

/**
 * Check wallet keychain access
 */
async function checkWallet() {
  const results = [];
  
  progress("Checking wallet keychain access");
  
  try {
    const walletResult = readWalletKey();
    
    if (walletResult.found && walletResult.key) {
      results.push(createResult("wallet-keychain", true, "pass", "Wallet accessible from keychain", walletResult.source));
      verbose(`Wallet source: ${walletResult.source}`);
      
      // Try to get address
      progress("Extracting wallet address");
      try {
        const address = await getWalletAddress(walletResult.key);
        if (address) {
          results.push(createResult("wallet-address", true, "pass", "Wallet address extracted", address));
          verbose(`Wallet address: ${address}`);
        } else {
          results.push(createResult("wallet-address", false, "warn", "Could not extract wallet address"));
        }
      } catch (err) {
        results.push(createResult(
          "wallet-address",
          false,
          "warn",
          "Failed to extract wallet address",
          err.message
        ));
      }
    } else if (walletResult.error) {
      results.push(createResult(
        "wallet-keychain",
        false,
        "warn",
        "Wallet keychain access failed",
        walletResult.error,
        false,
        null
      ));
    } else {
      results.push(createResult(
        "wallet-keychain",
        false,
        "warn",
        "No wallet found in keychain",
        "Run Morpheus to initialize wallet",
        false,
        null
      ));
    }
  } catch (err) {
    results.push(createResult(
      "wallet-keychain",
      false,
      "fail",
      "Wallet check failed",
      err.message,
      false,
      null
    ));
  }
  
  return results;
}

/**
 * Check Morpheus session health (API connectivity)
 */
async function checkSessionHealth() {
  const results = [];
  
  progress("Checking Morpheus session health");
  
  try {
    const healthResult = await checkMorpheusHealth();
    
    if (healthResult.healthy) {
      results.push(createResult("morpheus-health", true, "pass", "Morpheus is healthy"));
      verbose("Morpheus session health: OK");
      
      if (healthResult.address) {
        results.push(createResult("morpheus-address", true, "pass", "Morpheus session has address", healthResult.address));
        verbose(`Session address: ${healthResult.address}`);
      }
      
      if (healthResult.balance !== undefined) {
        results.push(createResult("morpheus-balance", true, "pass", `Morpheus balance: ${healthResult.balance} MOR`));
        verbose(`Session balance: ${healthResult.balance} MOR`);
      }
    } else {
      results.push(createResult(
        "morpheus-health",
        false,
        "warn",
        "Morpheus session not healthy",
        healthResult.error || "Unknown error",
        false,
        null
      ));
    }
  } catch (err) {
    results.push(createResult(
      "morpheus-health",
      false,
      "warn",
      "Morpheus health check failed",
      err.message,
      false,
      null
    ));
  }
  
  return results;
}

/**
 * Run GLM-5 inference test
 */
async function checkInference() {
  const results = [];
  
  progress("Testing GLM-5 inference");
  
  const morpheusUrl = process.env.MORPHEUS_API_URL || "http://127.0.0.1:8085";
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout
    
    const startTime = Date.now();
    
    const response = await fetch(`${morpheusUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "glm-5",
        messages: [{ role: "user", content: "Say 'inference test ok' in exactly those words." }],
        max_tokens: 10,
      }),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    const latency = Date.now() - startTime;
    
    if (response.ok) {
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || "";
      const model = data.model || "unknown";
      
      if (content.length > 0) {
        results.push(createResult(
          "inference-test",
          true,
          "pass",
          "GLM-5 inference test passed",
          `Model: ${model}, Latency: ${latency}ms, Response: "${content.substring(0, 50)}${content.length > 50 ? "..." : ""}"`,
          false,
          null
        ));
        verbose(`Inference response: ${content}`);
        verbose(`Latency: ${latency}ms`);
      } else {
        results.push(createResult(
          "inference-test",
          false,
          "warn",
          "GLM-5 inference returned empty response",
          `Model: ${model}`,
          false,
          null
        ));
      }
    } else {
      results.push(createResult(
        "inference-test",
        false,
        "warn",
        `GLM-5 inference test failed: HTTP ${response.status}`,
        `Endpoint: ${morpheusUrl}/v1/chat/completions`,
        false,
        null
      ));
    }
  } catch (err) {
    if (err.name === "AbortError") {
      results.push(createResult(
        "inference-test",
        false,
        "warn",
        "GLM-5 inference test timed out (30s)",
        "Morpheus may be slow or not responding",
        false,
        null
      ));
    } else {
      results.push(createResult(
        "inference-test",
        false,
        "warn",
        "GLM-5 inference test failed",
        err.message,
        false,
        null
      ));
    }
  }
  
  return results;
}

/**
 * Check Docker environment (if applicable)
 */
function checkDocker() {
  const results = [];
  
  progress("Checking Docker environment");
  
  const insideContainer = isInsideContainer();
  
  if (insideContainer) {
    results.push(createResult("docker-env", true, "pass", "Running inside Docker container"));
    verbose("Running inside Docker container");
    
    // Check for key directories
    const home = process.env.HOME || "/root";
    const requiredDirs = [".openclaw", ".morpheus", ".everclaw"];
    
    for (const dir of requiredDirs) {
      const fullPath = join(home, dir);
      if (existsSync(fullPath)) {
        results.push(createResult(`docker-dir-${dir}`, true, "pass", `Container ${dir} directory exists`));
        verbose(`Container directory: ${fullPath}`);
      } else {
        results.push(createResult(
          `docker-dir-${dir}`,
          false,
          "warn",
          `Container ${dir} directory not found`,
          `Expected: ${fullPath}`
        ));
      }
    }
  } else {
    // Check if we can detect a container
    const detected = detectContainerName();
    if (detected.found) {
      results.push(createResult("docker-detected", true, "pass", `EverClaw container detected: ${detected.name}`));
      verbose(`Detected container: ${detected.name} (via ${detected.method})`);
      
      if (detected.multiple) {
        results.push(createResult(
          "docker-multiple",
          false,
          "warn",
          `Multiple EverClaw containers detected`,
          detected.multiple.join(", ")
        ));
      }
    } else {
      results.push(createResult("docker-env", true, "pass", "Running on host (no container detected)"));
      verbose("Running on host");
    }
  }
  
  return results;
}

/**
 * Verify backup manifest (if file provided)
 */
async function checkBackupManifest(inputFile, passphrase = null) {
  const results = [];
  
  progress("Verifying backup manifest");
  
  if (!existsSync(inputFile)) {
    results.push(createResult(
      "backup-file",
      false,
      "fail",
      `Backup file not found: ${inputFile}`,
      null,
      false,
      null
    ));
    return results;
  }
  
  const stats = statSync(inputFile);
  results.push(createResult(
    "backup-file",
    true,
    "pass",
    `Backup file found: ${basename(inputFile)}`,
    `Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`
  ));
  
  // Try to decrypt and read manifest
  if (!passphrase) {
    // Try environment variable
    passphrase = process.env.EVERCLAW_BACKUP_PASSPHRASE;
  }
  
  if (!passphrase) {
    results.push(createResult(
      "backup-manifest",
      false,
      "skip",
      "No passphrase provided - skipping manifest verification",
      "Set EVERCLAW_BACKUP_PASSPHRASE or use --passphrase-from-env"
    ));
    return results;
  }
  
  progress("Decrypting backup for manifest check");
  
  try {
    const { mkdirSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const stagingDir = join(tmpdir(), `everclaw-verify-${Date.now()}`);
    mkdirSync(stagingDir, { recursive: true });
    
    try {
      await decryptArchive(inputFile, stagingDir, passphrase);
      
      const manifestPath = join(stagingDir, "manifest.json");
      if (!existsSync(manifestPath)) {
        results.push(createResult(
          "backup-manifest",
          false,
          "fail",
          "Backup missing manifest.json",
          "Not a valid EverClaw backup"
        ));
        return results;
      }
      
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      const validation = validateManifest(manifest);
      
      if (validation.valid) {
        results.push(createResult(
          "backup-manifest",
          true,
          "pass",
          "Backup manifest is valid",
          `Version: ${manifest.version}, Created: ${manifest.created}`
        ));
        verbose(`Manifest version: ${manifest.version}`);
        verbose(`Created: ${manifest.created}`);
        
        // Version compatibility
        const compat = checkVersionCompatibility(manifest);
        if (compat.warnings.length > 0) {
          results.push(createResult(
            "backup-compat",
            false,
            "warn",
            "Backup version compatibility warnings",
            compat.warnings.join("; ")
          ));
        } else {
          results.push(createResult("backup-compat", true, "pass", "Backup version compatible"));
        }
        
        // Check contents
        const contents = [];
        if (existsSync(join(stagingDir, "openclaw")) || existsSync(join(stagingDir, "openclaw", "state"))) {
          contents.push("OpenClaw state");
        }
        if (existsSync(join(stagingDir, "morpheus")) || existsSync(join(stagingDir, ".morpheus"))) {
          contents.push("Morpheus data");
        }
        if (existsSync(join(stagingDir, "everclaw"))) {
          contents.push("EverClaw config");
        }
        if (existsSync(join(stagingDir, "volumes"))) {
          contents.push("Docker volumes");
        }
        if (existsSync(join(stagingDir, "wallet", "wallet.enc"))) {
          contents.push("Wallet (encrypted)");
        }
        
        results.push(createResult(
          "backup-contents",
          true,
          "pass",
          `Backup contains: ${contents.join(", ")}`,
          contents.join("\n")
        ));
        
      } else {
        results.push(createResult(
          "backup-manifest",
          false,
          "fail",
          "Backup manifest validation failed",
          validation.errors.join("; ")
        ));
      }
      
    } finally {
      // Cleanup
      rmSync(stagingDir, { recursive: true, force: true });
    }
  } catch (err) {
    results.push(createResult(
      "backup-manifest",
      false,
      "fail",
      "Failed to decrypt backup",
      err.message
    ));
  }
  
  return results;
}

// ─── Main Verify Flow ──────────────────────────────────────────────────

async function main() {
  const args = parseCliArgs();

  if (args.help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  VERBOSE = args.verbose;
  QUIET = args.quiet;
  JSON_OUTPUT = args.json;

  const allResults = [];
  let passed = 0;
  let failed = 0;
  let warnings = 0;
  let skipped = 0;

  if (!JSON_OUTPUT && !QUIET) {
    console.error("\n📦 EverClaw Verification\n");
  }

  // Always run these checks
  allResults.push(...checkOpenclaw());
  allResults.push(...checkEverclaw());
  allResults.push(...checkMorpheus());
  allResults.push(...checkDocker());

  // Optional: Wallet check
  if (args.wallet) {
    allResults.push(...await checkWallet());
  }

  // Optional: Session health check
  if (args.session) {
    allResults.push(...await checkSessionHealth());
  }

  // Optional: Inference test
  if (args.inference) {
    allResults.push(...await checkInference());
  }

  // Optional: Backup manifest verification
  if (args.inputFile) {
    allResults.push(...await checkBackupManifest(args.inputFile));
  }

  // Count results
  for (const result of allResults) {
    if (result.status === "pass") passed++;
    else if (result.status === "fail") failed++;
    else if (result.status === "warn") warnings++;
    else if (result.status === "skip") skipped++;
  }

  // Output results
  if (JSON_OUTPUT) {
    const output = {
      version: CLI_VERSION,
      timestamp: new Date().toISOString(),
      summary: { passed, failed, warnings, skipped, total: allResults.length },
      checks: allResults,
    };
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.error("\n📋 Results:\n");
    for (const result of allResults) {
      const icon = result.status === "pass" ? "✅" :
                   result.status === "fail" ? "❌" :
                   result.status === "warn" ? "⚠️ " : "⏭️ ";
      console.error(`  ${icon} ${result.name}: ${result.message}`);
      if (result.details && VERBOSE) {
        console.error(`     ${result.details}`);
      }
    }
    
    console.error("\n─────────────────────────────────────");
    console.error(`  ✅ Passed:   ${passed}`);
    console.error(`  ❌ Failed:   ${failed}`);
    console.error(`  ⚠️  Warnings: ${warnings}`);
    console.error(`  ⏭️  Skipped:  ${skipped}`);
    console.error("─────────────────────────────────────\n");
    
    if (failed > 0) {
      console.error("❌ Some checks failed. Review the issues above.\n");
    } else if (warnings > 0) {
      console.error("⚠️  All critical checks passed, but there are warnings.\n");
    } else {
      console.error("✅ All checks passed!\n");
    }
    
    // Show fix suggestions
    const fixable = allResults.filter(r => r.fixable && !r.passed);
    if (fixable.length > 0 && args.fix) {
      console.error("🔧 Attempting to fix issues...\n");
      // TODO: Implement fix actions
      for (const result of fixable) {
        console.error(`  Would fix: ${result.name} - ${result.fixAction}`);
      }
      console.error("\nNote: --fix is not yet implemented. Follow manual steps above.\n");
    } else if (fixable.length > 0) {
      console.error("💡 Some issues can be fixed. Run with --fix to attempt automatic repair.\n");
    }
  }

  // Exit code
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  log(err.message, "error");
  if (VERBOSE && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});