#!/usr/bin/env node
/**
 * everclaw-restore.mjs — Restore EverClaw state from backup
 *
 * Restores encrypted backups created by everclaw-export:
 * - OpenClaw state (~/.openclaw)
 * - Morpheus wallet and session data (~/.morpheus)
 * - EverClaw config (~/.everclaw)
 * - Optional: Wallet private key (encrypted inside archive)
 *
 * SECURITY:
 * - Decrypts using passphrase (AGE_PASSPHRASE env or interactive)
 * - Wallet restore requires typing full wallet address for confirmation
 * - Services stopped before restore to ensure consistent state
 * - Existing data backed up before overwrite
 * - Post-restore verification runs automatically
 *
 * USAGE:
 *   everclaw-restore [options] <backup.tar.zst.age>
 *
 * OPTIONS:
 *   --passphrase-from-env Read passphrase from EVERCLAW_BACKUP_PASSPHRASE
 *   --container NAME      Docker container name (auto-detected if omitted)
 *   --volumes-only        Only restore Docker volumes (skip host paths)
 *   --no-volumes          Skip Docker volumes (host paths only)
 *   --no-backup           Don't backup existing data before restore
 *   --no-stop             Skip service shutdown (use with caution)
 *   --no-verify           Skip post-restore verification
 *   --rollback DIR        Restore from pre-restore backup directory
 *   --dry-run             Show what would be restored without writing
 *   -q, --quiet           Minimal output
 *   -v, --verbose         Detailed output
 *   -h, --help            Show this help
 *
 * EXAMPLES:
 *   # Restore from encrypted backup (prompts for passphrase)
 *   everclaw-restore backup.tar.zst.age
 *
 *   # Restore to Docker container
 *   everclaw-restore --container everclaw-prod backup.tar.zst.age
 *
 *   # Dry run to preview restore
 *   everclaw-restore --dry-run backup.tar.zst.age
 *
 * EXIT CODES:
 *   0 - Success
 *   1 - Error (see stderr)
 *   2 - Dependency missing (age, tar, zstd)
 *   3 - Archive not found or unreadable
 *   4 - Decryption failed
 *   5 - Wallet restore failed
 *   6 - Service stop failed
 *   7 - Manifest validation failed
 *   8 - Version incompatibility
 *   9 - Post-restore verification failed
 */

import { parseArgs } from "node:util";
import { createInterface } from "node:readline";
import { existsSync, mkdirSync, writeFileSync, statSync, rmSync, chmodSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { platform, homedir, tmpdir } from "node:os";
import { execSync, spawn } from "node:child_process";

// Import lib modules
import {
  isInsideContainer,
  detectContainerName,
  detectContainerHome,
  detectContainerUser,
  getContainerVolumes,
  estimateVolumeSize,
  // Note: restoreVolumes removed - we use streamDockerVolumesRestore directly
} from "./lib/docker.mjs";

import {
  readWalletKey,
  writeWalletKey,
  encryptWalletKey,
  decryptWalletKey,
  getWalletAddress,
  KEYCHAIN_SERVICE,
  KEYCHAIN_ACCOUNT,
} from "./lib/keychain.mjs";

import {
  checkDependencies,
  validatePassphrase,
  generatePassphrase,
  encryptDirectory,
  decryptArchive,
  shredFile,
  shredDirectory,
  detectCompression,
  MIN_PASSPHRASE_LENGTH,
} from "./lib/encryption.mjs";

import {
  generateManifest,
  validateManifest,
  checkVersionCompatibility,
  checksumDirectory,
  detectEverclawVersion,
  detectOpenclawVersion,
  detectDocker,
} from "./lib/manifest.mjs";

import {
  isOpenclawAvailable,
  getStateDir,
  getWorkspaceDir,
  createOpenclawBackup,
  copyOpenclawState,
  restoreOpenclawState,
  restoreEverclawConfig,
  runDoctor,
} from "./lib/openclaw.mjs";

import {
  stopAllServices,
  startAllServices,
  getServiceStatus,
} from "./lib/services.mjs";

import {
  collectMorpheusState,
  estimateMorpheusSize,
  restoreMorpheusState,
} from "./lib/morpheus.mjs";

// ─── Constants ────────────────────────────────────────────────────────

const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

// ─── CLI Argument Parsing ─────────────────────────────────────────────

const CLI_VERSION = "1.0.0";

const HELP_TEXT = `
EverClaw Restore v${CLI_VERSION}
Restore EverClaw state from backup

USAGE:
  everclaw-restore [options] <backup.tar.zst.age>

OPTIONS:
  --passphrase-from-env Read passphrase from EVERCLAW_BACKUP_PASSPHRASE
  --container NAME      Docker container name
  --volumes-only        Only restore Docker volumes (skip host paths)
  --no-volumes          Skip Docker volumes (host paths only)
  --no-backup           Don't backup existing data before restore
  --no-stop             Skip service shutdown
  --no-verify           Skip post-restore verification
  --rollback DIR        Restore from pre-restore backup directory
  --dry-run             Show what would be restored
  -q, --quiet           Minimal output
  -v, --verbose         Detailed output
  -h, --help            Show this help

EXAMPLES:
  everclaw-restore backup.tar.zst.age
  everclaw-restore --dry-run backup.tar.zst.age
  everclaw-restore --container everclaw-prod backup.tar.zst.age
  everclaw-restore --rollback /tmp/everclaw-pre-restore-1234567890
`;

function parseCliArgs() {
  const { values, positionals } = parseArgs({
    options: {
      "passphrase-from-env": { type: "boolean", default: false },
      container: { type: "string", short: "c" },
      "volumes-only": { type: "boolean", default: false },
      "no-volumes": { type: "boolean", default: false },
      "no-backup": { type: "boolean", default: false },
      "no-stop": { type: "boolean", default: false },
      "no-verify": { type: "boolean", default: false },
      rollback: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      quiet: { type: "boolean", short: "q", default: false },
      verbose: { type: "boolean", short: "v", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });

  return {
    ...values,
    inputFile: positionals[0],
  };
}

// ─── Output Helpers ──────────────────────────────────────────────────

let VERBOSE = false;
let QUIET = false;

function log(msg, level = "info") {
  if (QUIET && level !== "error") return;
  const prefix = level === "error" ? "❌ " : level === "warn" ? "⚠️  " : level === "success" ? "✅ " : "";
  console.error(`${prefix}${msg}`);
}

function verbose(msg) {
  if (VERBOSE && !QUIET) console.error(`  ${msg}`);
}

function progress(phase, detail = "") {
  if (QUIET) return;
  const spinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const idx = Math.floor(Date.now() / 100) % spinner.length;
  process.stderr.write(`\r${spinner[idx]} ${phase}${detail ? `: ${detail}` : ""}`);
}

function progressDone(msg = "Done") {
  if (QUIET) return;
  process.stderr.write(`\r✅ ${msg}\n`);
}

// ─── Passphrase Input ─────────────────────────────────────────────────

async function readPassphrase(prompt = "Enter passphrase") {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY || platform() === "win32") {
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      rl.question(`${prompt}: `, (answer) => {
        rl.close();
        resolve(answer);
      });
      return;
    }

    process.stderr.write(`${prompt}: `);
    process.stdin.setRawMode(true);
    let input = "";
    let cleanup = null;
    
    cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.removeListener("data", onData);
      process.stderr.write("\n");
    };
    
    const onData = (char) => {
      const c = char.toString("utf8");
      if (c === "\n" || c === "\r" || c === "\u0004") {
        cleanup();
        resolve(input);
      } else if (c === "\u0003") {
        cleanup();
        process.exit(1);
      } else if (c === "\u007f" || c === "\u0008") {
        input = input.slice(0, -1);
      } else {
        input += c;
      }
    };
    
    process.stdin.on("data", onData);
  });
}

/**
 * Read a plaintext confirmation (for wallet address verification)
 */
async function readConfirmation(prompt) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    rl.question(`${prompt}: `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ─── Wallet Restore Flow ───────────────────────────────────────────────

/**
 * Display wallet restore warning and require address confirmation.
 * CRITICAL: User must type the full wallet address to proceed.
 */
async function confirmWalletRestore(expectedAddress) {
  console.error("");
  console.error("╔════════════════════════════════════════════════════════════════════╗");
  console.error("║  ⚠️  WALLET PRIVATE KEY RESTORE                                    ║");
  console.error("║                                                                    ║");
  console.error("║  You are about to RESTORE a WALLET PRIVATE KEY.                   ║");
  console.error("║  This will REPLACE your current wallet if one exists.             ║");
  console.error("║                                                                    ║");
  console.error("║  • This key provides FULL CONTROL over wallet funds               ║");
  console.error("║  • Ensure this backup is from a trusted source                    ║");
  console.error("║  • BACK UP your current wallet first if you have one              ║");
  console.error("║                                                                    ║");
  console.error("║  To confirm, type the wallet address from the backup:             ║");
  if (expectedAddress) {
    console.error(`║  Expected: ${expectedAddress}`);
  }
  console.error("╚════════════════════════════════════════════════════════════════════╝");
  console.error("");

  const typed = await readConfirmation("Wallet address");
  
  // Validate Ethereum address format
  if (!ETH_ADDRESS_REGEX.test(typed)) {
    log("Invalid Ethereum address format. Expected 0x followed by 40 hex characters.", "error");
    return false;
  }
  
  if (expectedAddress && typed.toLowerCase() !== expectedAddress.toLowerCase()) {
    log("Wallet address does not match. Restore cancelled.", "error");
    return false;
  }
  
  if (!expectedAddress && typed.length < 10) {
    log("Invalid confirmation. Restore cancelled.", "error");
    return false;
  }
  
  return true;
}

async function restoreWallet(stagingDir, passphrase) {
  const walletFile = join(stagingDir, "wallet", "wallet.enc");
  
  if (!existsSync(walletFile)) {
    verbose("No wallet.enc found in archive");
    return { found: false };
  }
  
  verbose("Found encrypted wallet in archive");
  
  // Read and decrypt
  const encrypted = readFileSync(walletFile, "utf-8");
  let decryptedKey;
  
  try {
    decryptedKey = decryptWalletKey(encrypted, passphrase);
  } catch (err) {
    log(`Failed to decrypt wallet: ${err.message}`, "error");
    return { found: true, error: err.message };
  }
  
  // Get address for confirmation
  let address = null;
  try {
    address = await getWalletAddress(decryptedKey);
  } catch { /* viem not available */ }
  
  // REQUIRE address confirmation before proceeding
  if (!await confirmWalletRestore(address)) {
    return { found: false, cancelled: true };
  }
  
  // Check for existing wallet
  const existing = readWalletKey();
  if (existing.found) {
    log("Existing wallet found - will be replaced", "warn");
  }
  
  // Write to keychain
  const result = writeWalletKey(decryptedKey);
  
  if (result.success) {
    verbose(`Wallet restored to ${result.source}`);
    return { found: true, restored: true, address, source: result.source };
  } else {
    log(`Failed to write wallet: ${result.error}`, "error");
    return { found: true, error: result.error };
  }
}

// ─── Service Management ────────────────────────────────────────────────

async function stopServicesForRestore(options = {}) {
  const { force = false } = options;
  
  const status = getServiceStatus();
  const runningServices = status.filter(s => s.running);
  
  if (runningServices.length === 0) {
    verbose("No services running");
    return false;
  }
  
  console.error("");
  console.error("📦 The following services must be stopped for a consistent restore:");
  for (const s of runningServices) {
    console.error(`   • ${s.name}`);
  }
  console.error("");
  
  if (!force && process.stdin.isTTY) {
    const confirm = await readConfirmation("Stop these services? [y/N]");
    if (confirm.toLowerCase() !== "y" && confirm.toLowerCase() !== "yes") {
      log("Restore cancelled", "info");
      process.exit(1);
    }
  }
  
  progress("Stopping services");
  const result = stopAllServices();
  progressDone(`Stopped ${result.stopped.length} services`);
  
  if (result.failed.length > 0) {
    log(`Failed to stop: ${result.failed.join(", ")}`, "warn");
  }
  
  return true;
}

async function restartServices() {
  progress("Restarting services");
  const result = startAllServices();
  progressDone(`Started ${result.started.length} services`);
  
  if (result.failed.length > 0) {
    log(`Failed to start: ${result.failed.join(", ")}`, "warn");
  }
}

// ─── Backup Existing Data ───────────────────────────────────────────────

async function backupExistingData(backupDir) {
  mkdirSync(backupDir, { recursive: true });
  let backedUp = [];
  
  // Backup OpenClaw
  const stateDir = getStateDir();
  if (existsSync(stateDir)) {
    progress("Backing up OpenClaw state");
    const target = join(backupDir, "openclaw");
    execSync(`cp -R "${stateDir}" "${target}" 2>/dev/null || true`, { stdio: "pipe" });
    backedUp.push("openclaw");
  }
  
  // Backup Morpheus (both locations)
  // Note: We handle both ~/morpheus and ~/.morpheus as Morpheus
  // can use either location depending on installation method
  const morpheusDir = join(homedir(), "morpheus");
  if (existsSync(morpheusDir)) {
    progress("Backing up Morpheus data");
    const target = join(backupDir, "morpheus");
    execSync(`cp -R "${morpheusDir}" "${target}" 2>/dev/null || true`, { stdio: "pipe" });
    backedUp.push("morpheus");
  }
  
  const morpheusAltDir = join(homedir(), ".morpheus");
  if (existsSync(morpheusAltDir)) {
    progress("Backing up Morpheus data (.morpheus)");
    const target = join(backupDir, ".morpheus");
    execSync(`cp -R "${morpheusAltDir}" "${target}" 2>/dev/null || true`, { stdio: "pipe" });
    backedUp.push(".morpheus");
  }
  
  // Backup EverClaw
  const everclawDir = join(homedir(), ".everclaw");
  if (existsSync(everclawDir)) {
    progress("Backing up EverClaw config");
    const target = join(backupDir, "everclaw");
    execSync(`cp -R "${everclawDir}" "${target}" 2>/dev/null || true`, { stdio: "pipe" });
    backedUp.push("everclaw");
  }
  
  return { backedUp };
}

// ─── Rollback from Pre-Restore Backup ────────────────────────────────────

/**
 * Restore from a pre-restore backup directory.
 * This is used when a restore fails and the user wants to revert.
 * Uses lib functions for consistency with normal restore.
 * 
 * @param {string} backupDir - Path to pre-restore backup directory
 * @param {string|null} containerName - Docker container name (optional)
 * @returns {{ restored: string[], error?: string }}
 */
async function rollbackFromBackup(backupDir, containerName = null) {
  if (!existsSync(backupDir)) {
    return { restored: [], error: `Backup directory not found: ${backupDir}` };
  }

  const restored = [];
  const hasOpenClaw = existsSync(join(backupDir, "openclaw"));
  const hasMorpheus = existsSync(join(backupDir, "morpheus")) || existsSync(join(backupDir, ".morpheus"));
  const hasEverClaw = existsSync(join(backupDir, "everclaw"));
  const hasVolumes = existsSync(join(backupDir, "volumes"));

  // Restore OpenClaw using lib function
  if (hasOpenClaw) {
    progress("Rolling back OpenClaw state");
    const result = restoreOpenclawState(backupDir);
    if (result.success) {
      restored.push("openclaw");
    } else {
      verbose(`OpenClaw rollback: ${result.error || "done"}`);
    }
  }

  // Restore Morpheus using lib function
  if (hasMorpheus) {
    progress("Rolling back Morpheus data");
    const result = restoreMorpheusState(backupDir);
    if (result.restored?.length > 0) {
      restored.push(...result.restored);
    }
    if (result.error) {
      verbose(`Morpheus rollback: ${result.error}`);
    }
  }

  // Restore EverClaw using lib function
  if (hasEverClaw) {
    progress("Rolling back EverClaw config");
    const result = restoreEverclawConfig(backupDir);
    if (result.success) {
      restored.push("everclaw");
    } else {
      verbose(`EverClaw rollback: ${result.error || "done"}`);
    }
  }

  // Restore Docker volumes (if container specified and volumes present)
  if (hasVolumes && containerName) {
    progress("Rolling back Docker volumes");
    try {
      await streamDockerVolumesRestore(containerName, join(backupDir, "volumes"));
      restored.push("volumes");
    } catch (err) {
      verbose(`Docker volumes rollback: ${err.message}`);
    }
  }

  return { restored };
}

// ─── Docker Volume Restore (Streaming) ──────────────────────────────────

/**
 * Stream restore to Docker container using zstd.
 * @param {string} containerName - Docker container name
 * @param {string} sourceDir - Source directory to restore from (NOT the staging root)
 */
async function streamDockerVolumesRestore(containerName, sourceDir) {
  const containerHome = detectContainerHome(containerName);
  const containerUser = detectContainerUser(containerName);

  return new Promise((resolve, reject) => {
    // Pack on host, stream to docker
    const tar = spawn("tar", ["-cf", "-", "--zstd", "-C", sourceDir, "."], {
      stdio: ["ignore", "pipe", "pipe"]
    });

    const docker = spawn("docker", [
      "exec", "-i", containerName,
      "tar", "-xf", "-", "--zstd", "-C", containerHome
    ], { stdio: ["pipe", "inherit", "pipe"] });

    tar.stdout.pipe(docker.stdin);
    tar.stdout.on("error", () => {});
    
    let tarErr = "";
    let dockerErr = "";
    tar.stderr.on("data", (d) => tarErr += d.toString());
    docker.stderr.on("data", (d) => dockerErr += d.toString());

    docker.on("close", (code) => {
      if (code === 0) {
        // Fix permissions
        try {
          execSync(`docker exec "${containerName}" chown -R ${containerUser}:${containerUser} "${containerHome}/.openclaw" "${containerHome}/.morpheus" "${containerHome}/.everclaw" 2>/dev/null || true`, { stdio: "pipe" });
        } catch { /* ignore */ }
        resolve({ success: true });
      } else {
        reject(new Error(`Docker restore failed (code ${code}): ${dockerErr || tarErr}`));
      }
    });

    docker.on("error", reject);
    tar.on("error", reject);

    tar.on("close", (code) => {
      if (code !== 0 && code !== null) {
        verbose(`Tar exited with code ${code}: ${tarErr}`);
      }
    });
  });
}

// ─── Post-Restore Verification ──────────────────────────────────────────

/**
 * Run post-restore verification:
 * 1. OpenClaw doctor
 * 2. Basic health check
 * 3. Wallet address verification (if wallet was restored)
 * 4. GLM-5 inference test (if Morpheus available)
 */
async function verifyRestore(walletInfo) {
  const issues = [];
  
  // 1. Run OpenClaw doctor
  progress("Running OpenClaw doctor");
  const doctorResult = runDoctor();
  if (!doctorResult.success) {
    issues.push(`OpenClaw doctor reported issues: ${doctorResult.output?.substring(0, 200) || "unknown"}`);
  } else {
    verbose("OpenClaw doctor passed");
  }
  
  // 2. Check OpenClaw state directory exists
  const stateDir = getStateDir();
  if (!existsSync(stateDir)) {
    issues.push(`OpenClaw state directory not found: ${stateDir}`);
  } else {
    verbose(`OpenClaw state directory verified: ${stateDir}`);
  }
  
  // 3. Verify wallet address (if restored)
  if (walletInfo?.restored && walletInfo?.address) {
    progress("Verifying wallet");
    const currentWallet = readWalletKey();
    if (currentWallet.found && currentWallet.key) {
      try {
        const currentAddress = await getWalletAddress(currentWallet.key);
        if (currentAddress?.toLowerCase() !== walletInfo.address.toLowerCase()) {
          issues.push(`Wallet address mismatch: expected ${walletInfo.address}, got ${currentAddress}`);
        } else {
          verbose(`Wallet address verified: ${currentAddress}`);
        }
      } catch (err) {
        issues.push(`Failed to verify wallet address: ${err.message}`);
      }
    }
  }
  
  // 4. GLM-5 inference test (v3.0 spec compliance)
  // Tests that the Morpheus inference endpoint can generate a response
  progress("Testing GLM-5 inference");
  try {
    const morpheusUrl = process.env.MORPHEUS_API_URL || "http://127.0.0.1:8085";
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
    
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
    
    if (response.ok) {
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || "";
      if (content.toLowerCase().includes("ok") || content.length > 0) {
        verbose("GLM-5 inference test passed");
      } else {
        issues.push("GLM-5 inference test: unexpected response");
      }
    } else {
      verbose(`GLM-5 inference test: HTTP ${response.status} (Morpheus may not be running)`);
    }
  } catch (err) {
    // Non-blocking - Morpheus may not be running
    verbose(`GLM-5 inference test: ${err.message} (optional)`);
  }
  
  return { success: issues.length === 0, issues };
}

// ─── Main Restore Flow ──────────────────────────────────────────────────

async function main() {
  const args = parseCliArgs();

  if (args.help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  // Validate conflicting flags
  if (args["volumes-only"] && args["no-volumes"]) {
    log("Cannot use --volumes-only and --no-volumes together", "error");
    process.exit(1);
  }

  if (args.rollback && args.inputFile) {
    log("Cannot use --rollback with a backup file", "error");
    console.log("Use: everclaw-restore --rollback <backup-dir>");
    process.exit(1);
  }

  if (args.rollback && args["no-backup"]) {
    log("Cannot use --rollback with --no-backup", "error");
    process.exit(1);
  }

  VERBOSE = args.verbose;
  QUIET = args.quiet;

  //─── Rollback Mode ────────────────────────────────────────────────
  if (args.rollback) {
    // Rollback from pre-restore backup
    const rollbackDir = args.rollback;
    
    if (!existsSync(rollbackDir)) {
      log(`Rollback directory not found: ${rollbackDir}`, "error");
      process.exit(3);
    }

    // Detect container for Docker volume rollback
    const rollbackInsideContainer = isInsideContainer();
    let containerName = null;
    if (args.container) {
      containerName = args.container;
    } else if (!rollbackInsideContainer) {
      const detected = detectContainerName();
      if (detected.found) {
        containerName = detected.name;
      }
    }

    console.log("\n📦 Rolling back from pre-restore backup:\n");
    console.log(`  Backup: ${rollbackDir}`);
    if (containerName) {
      console.log(`  Container: ${containerName}`);
    }
    console.log("");

    // Stop services
    let servicesWereStopped = false;
    if (!args["no-stop"]) {
      try {
        servicesWereStopped = await stopServicesForRestore();
      } catch (err) {
        log(`Failed to stop services: ${err.message}`, "error");
        process.exit(6);
      }
    }

    try {
      const result = await rollbackFromBackup(rollbackDir, containerName);
      
      if (result.error) {
        log(`Rollback error: ${result.error}`, "error");
        process.exit(1);
      }

      if (result.restored.length === 0) {
        log("No data found in rollback directory", "warn");
      } else {
        progressDone(`Rolled back: ${result.restored.join(", ")}`);
      }

      // Verify
      if (!args["no-verify"]) {
        progress("Verifying rollback");
        const verifyResult = await verifyRestore(null);
        if (!verifyResult.success) {
          log("Rollback verification had issues:", "warn");
          for (const issue of verifyResult.issues) {
            console.error(`  - ${issue}`);
          }
        } else {
          verbose("Rollback verification passed");
        }
      }

      console.error(`\n📦 Rollback complete`);
      if (servicesWereStopped) {
        console.error("   ✅ Services restarted automatically");
      } else {
        console.error("   ⚠️  Restart services: openclaw gateway restart");
      }

      process.exit(0);
    } finally {
      if (servicesWereStopped) {
        await restartServices();
      }
    }
  }

  // ─── Normal Restore Mode ──────────────────────────────────────────

  if (args["volumes-only"] && !args.container && !isInsideContainer()) {
    log("--volumes-only requires --container or running inside a container", "error");
    process.exit(1);
  }

  // Validate input file
  if (!args.inputFile) {
    log("Backup file required", "error");
    console.log(HELP_TEXT);
    process.exit(1);
  }

  if (!existsSync(args.inputFile)) {
    log(`Backup file not found: ${args.inputFile}`, "error");
    process.exit(3);
  }

  // Check dependencies
  const deps = checkDependencies();
  if (!deps.ok) {
    log("Missing dependencies:", "error");
    for (const missing of deps.missing) {
      console.error(`  - ${missing}`);
    }
    process.exit(2);
  }

  // Detect environment
  const insideContainer = isInsideContainer();
  verbose(`Running inside container: ${insideContainer}`);

  let containerName = null;
  if (args.container) {
    containerName = args.container;
  } else if (!insideContainer) {
    const detected = detectContainerName();
    if (detected.found) {
      containerName = detected.name;
      verbose(`Detected container: ${containerName} (via ${detected.method})`);
      if (detected.multiple) {
        log(`Multiple EverClaw containers found: ${detected.multiple.join(", ")}`, "warn");
        log(`Using first: ${containerName}`, "warn");
      }
    }
  }

  // Get passphrase
  let passphrase = null;
  if (args["passphrase-from-env"]) {
    passphrase = process.env.EVERCLAW_BACKUP_PASSPHRASE;
    if (!passphrase) {
      log("EVERCLAW_BACKUP_PASSUP_PASSPHRASE not set", "error");
      process.exit(1);
    }
  } else {
    passphrase = await readPassphrase("Enter backup passphrase");
    if (!passphrase) {
      process.exit(1);
    }
  }

  if (passphrase) {
    process.env.AGE_PASSPHRASE = passphrase;
  }

  // Create staging directory (for decryption and inspection)
  const stagingDir = join(tmpdir(), `everclaw-restore-${Date.now()}`);
  mkdirSync(stagingDir, { recursive: true });
  verbose(`Staging directory: ${stagingDir}`);

  // Track state for proper cleanup and restart
  let servicesWereStopped = false;
  let restoreSuccess = false;
  let backupDir = null;
  let manifest = null;

  try {
    // Phase 1: Decrypt archive and parse manifest (ALWAYS, even for dry-run)
    progress("Decrypting archive");
    
    try {
      await decryptArchive(args.inputFile, stagingDir, passphrase);
      progressDone("Archive decrypted");
    } catch (err) {
      log(`Decryption failed: ${err.message}`, "error");
      process.exit(4);
    }

    // Parse manifest
    const manifestPath = join(stagingDir, "manifest.json");
    if (!existsSync(manifestPath)) {
      log("Archive missing manifest.json - not a valid EverClaw backup", "error");
      process.exit(7);
    }

    manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    const validation = validateManifest(manifest);
    
    if (!validation.valid) {
      log(`Manifest validation failed: ${validation.errors.join(", ")}`, "error");
      process.exit(7);
    }

    verbose(`Manifest version: ${manifest.version}`);
    verbose(`Created: ${manifest.created}`);
    verbose(`Platform: ${manifest.platform?.os || "unknown"}/${manifest.platform?.arch || "unknown"}`);
    if (manifest.exportMode) {
      verbose(`Export mode: ${manifest.exportMode}`);
    }

    // Version compatibility check
    const compat = checkVersionCompatibility(manifest);
    if (compat.warnings.length > 0) {
      for (const w of compat.warnings) {
        log(w, "warn");
      }
    }

    // Check what's in the archive
    const hasOpenClaw = existsSync(join(stagingDir, "openclaw")) || existsSync(join(stagingDir, "openclaw", "state"));
    const hasMorpheus = existsSync(join(stagingDir, "morpheus")) || existsSync(join(stagingDir, ".morpheus"));
    const hasEverClaw = existsSync(join(stagingDir, "everclaw"));
    const hasVolumes = existsSync(join(stagingDir, "volumes"));
    const hasWallet = existsSync(join(stagingDir, "wallet", "wallet.enc"));

    // Respect manifest exportMode if not explicitly overridden
    let effectiveVolumesOnly = args["volumes-only"];
    if (manifest.exportMode === "volumes-only" && !args["no-volumes"]) {
      effectiveVolumesOnly = true;
      verbose("Using volumes-only mode from manifest");
    }

    // Dry run - show what would be restored
    if (args["dry-run"]) {
      console.log("\n📦 Dry Run - What would be restored:\n");

      console.log("Environment:");
      console.log(`  Inside container: ${insideContainer}`);
      if (containerName) {
        console.log(`  Container: ${containerName}`);
      }
      console.log(`  Volumes only: ${effectiveVolumesOnly}`);
      console.log(`  Skip volumes: ${args["no-volumes"]}`);
      console.log(`  Backup existing: ${!args["no-backup"]}`);

      console.log("\nArchive Info:");
      const stats = statSync(args.inputFile);
      console.log(`  File: ${args.inputFile}`);
      console.log(`  Size: ${(stats.size / 1024 / 1024).toFixed(1)} MB`);
      console.log(`  Created: ${manifest.created}`);
      console.log(`  Version: ${manifest.version}`);

      console.log("\nContents:");
      if (hasOpenClaw) console.log("  ✓ OpenClaw state");
      if (hasMorpheus) console.log("  ✓ Morpheus data");
      if (hasEverClaw) console.log("  ✓ EverClaw config");
      if (hasVolumes) console.log("  ✓ Docker volumes");
      if (hasWallet) console.log("  ✓ Wallet (encrypted)");

      console.log("\nTargets:");
      if (!effectiveVolumesOnly) {
        console.log(`  OpenClaw state: ${getStateDir()}`);
        console.log(`  Morpheus: ${join(homedir(), "morpheus")}`);
        console.log(`  EverClaw: ${join(homedir(), ".everclaw")}`);
      } else {
        console.log("  (Volumes only - host paths skipped)");
      }

      console.log("\nServices:");
      const status = getServiceStatus();
      for (const s of status) {
        console.log(`  ${s.name}: ${s.running ? "running" : "stopped"}`);
      }
      console.log(`  Stop before restore: ${!args["no-stop"]}`);
      console.log(`  Post-restore verify: ${!args["no-verify"]}`);

      process.exit(0);
    }

    // Stop services before restore
    if (!args["no-stop"]) {
      try {
        servicesWereStopped = await stopServicesForRestore();
      } catch (err) {
        log(`Failed to stop services: ${err.message}`, "error");
        process.exit(6);
      }
    }

    // Backup existing data
    if (!args["no-backup"]) {
      backupDir = join(tmpdir(), `everclaw-pre-restore-${Date.now()}`);
      progress("Backing up existing data");
      const backupResult = await backupExistingData(backupDir);
      if (backupResult.backedUp.length > 0) {
        verbose(`Backup created at ${backupDir} (${backupResult.backedUp.join(", ")})`);
      } else {
        verbose("No existing data to backup");
        rmSync(backupDir, { recursive: true, force: true });
        backupDir = null;
      }
    }

    // Phase 2: Restore data
    if (effectiveVolumesOnly) {
      // Volumes-only restore
      if (!containerName) {
        log("--volumes-only requires a container", "error");
        process.exit(1);
      }
      
      // Determine source directory
      const volumesSource = hasVolumes ? join(stagingDir, "volumes") : stagingDir;
      
      progress("Restoring Docker volumes");
      try {
        await streamDockerVolumesRestore(containerName, volumesSource);
        verbose("Docker volumes restored");
      } catch (err) {
        log(`Volume restore failed: ${err.message}`, "error");
        process.exit(3);
      }
    } else {
      // Full restore (use lib functions where available)
      
      // Restore OpenClaw using lib (lib looks for stagingDir/openclaw/state internally)
      if (hasOpenClaw) {
        progress("Restoring OpenClaw state");
        const result = restoreOpenclawState(stagingDir);
        if (!result.success) {
          log(`OpenClaw restore failed: ${result.error}`, "error");
          // Continue with other restores
        } else {
          verbose("OpenClaw state restored");
        }
      }

      // Restore Morpheus using lib (handles both morpheus/ and .morpheus/ locations)
      if (hasMorpheus) {
        progress("Restoring Morpheus data");
        const morpheusResult = restoreMorpheusState(stagingDir);
        if (morpheusResult.error) {
          log(`Morpheus restore error: ${morpheusResult.error}`, "warn");
        }
        if (morpheusResult.restored.length > 0) {
          verbose(`Morpheus restored: ${morpheusResult.restored.join(", ")} (${morpheusResult.files} files)`);
        }
      }

      // Restore EverClaw using lib function
      if (hasEverClaw) {
        progress("Restoring EverClaw config");
        const everclawResult = restoreEverclawConfig(stagingDir);
        if (!everclawResult.success) {
          log(`EverClaw restore failed: ${everclawResult.error}`, "warn");
        } else {
          verbose(`EverClaw config restored (${everclawResult.files || 0} files)`);
        }
      }

      // Restore Docker volumes (if present and not skipped)
      const volumesBackup = join(stagingDir, "volumes");
      if (existsSync(volumesBackup) && containerName && !args["no-volumes"]) {
        progress("Restoring Docker volumes");
        try {
          await streamDockerVolumesRestore(containerName, volumesBackup);
          verbose("Docker volumes restored");
        } catch (err) {
          log(`Docker volume restore failed: ${err.message}`, "warn");
        }
      }
    }

    // Phase 3: Restore wallet (if present)
    let walletInfo = null;
    if (hasWallet) {
      progress("Restoring wallet");
      walletInfo = await restoreWallet(stagingDir, passphrase);
      
      if (walletInfo.cancelled) {
        log("Wallet restore cancelled by user", "info");
        // Continue with verification
      } else if (walletInfo.error) {
        log(`Wallet restore failed: ${walletInfo.error}`, "warn");
      } else if (walletInfo.restored) {
        verbose(`Wallet restored: ${walletInfo.address}`);
      }
    }

    // Phase 4: Post-restore verification
    if (!args["no-verify"]) {
      progress("Verifying restore");
      const verifyResult = await verifyRestore(walletInfo);
      
      if (!verifyResult.success) {
        log("Post-restore verification failed:", "warn");
        for (const issue of verifyResult.issues) {
          console.error(`  - ${issue}`);
        }
        // Don't fail - just warn
      } else {
        verbose("Post-restore verification passed");
      }
    }

    restoreSuccess = true;
    progressDone("Restore complete");

    // Show summary
    if (!QUIET) {
      console.error(`\n📦 Restore complete:`);
      console.error(`   Source: ${args.inputFile}`);
      console.error(`   Mode: ${effectiveVolumesOnly ? "volumes-only" : (containerName ? "docker" : "host")}`);
      if (backupDir) {
        console.error(`   Pre-restore backup: ${backupDir}`);
      }
      if (walletInfo?.restored) {
        console.error(`   Wallet: ${walletInfo.address}`);
      }
      console.error(``);
      if (servicesWereStopped) {
        console.error("   ✅ Services restarted automatically");
      } else {
        console.error("   ⚠️  Restart services to apply changes:");
        console.error("      openclaw gateway restart");
      }
    }

    process.exit(0);
  } finally {
    // Cleanup staging (always shred for security)
    shredDirectory(stagingDir);
    
    // Restart services ONLY if restore succeeded
    if (servicesWereStopped) {
      if (restoreSuccess) {
        await restartServices();
      } else {
        log("Restore failed - services NOT restarted (system may be in inconsistent state)", "warn");
        log("Fix the issue and run: openclaw gateway restart", "warn");
      }
    }
  }
}

main().catch((err) => {
  log(err.message, "error");
  if (VERBOSE && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});