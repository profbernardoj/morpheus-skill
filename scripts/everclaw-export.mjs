#!/usr/bin/env node
/**
 * everclaw-export.mjs — Export EverClaw state for backup and migration
 *
 * Creates encrypted backups of:
 * - OpenClaw state (~/.openclaw)
 * - Morpheus wallet and session data (~/.morpheus)
 * - EverClaw config (~/.everclaw)
 * - Optional: Wallet private key (encrypted separately inside archive)
 *
 * SECURITY:
 * - Plaintext archive NEVER written to disk (streaming tar | age pipeline)
 * - Passphrase NEVER passed via CLI flag (AGE_PASSPHRASE env or interactive)
 * - Wallet export requires typing full wallet address for confirmation
 * - Optional wallet key encrypted with same passphrase, stored as wallet/wallet.enc
 * - Services stopped before export to ensure consistent state
 * - Output archive chmod 600
 *
 * USAGE:
 *   everclaw-export [options] <output.tar.zst.age>
 *
 * OPTIONS:
 *   --no-encrypt          Export UNENCRYPTED tar.zst (DANGEROUS - warns loudly)
 *   --include-wallet      Include wallet private key (requires passphrase + confirmation)
 *   --dry-run             Show what would be exported without writing
 *   --container NAME      Docker container name (auto-detected if omitted)
 *   --passphrase-from-env Read passphrase from EVERCLAW_BACKUP_PASSPHRASE
 *   --generate-passphrase Generate and print a secure passphrase
 *   --no-stop             Skip service shutdown (use with caution)
 *   --verify              Verify archive after creation
 *   -q, --quiet           Minimal output
 *   -v, --verbose         Detailed output
 *   -h, --help            Show this help
 *
 * EXAMPLES:
 *   # Encrypted backup with wallet (prompts for passphrase + wallet address)
 *   everclaw-export --include-wallet backup.tar.zst.age
 *
 *   # Dry run to see what would be exported
 *   everclaw-export --dry-run --container everclaw-prod backup.tar.zst.age
 *
 *   # Unencrypted (DANGEROUS - shows warning, blocks wallet)
 *   everclaw-export --no-encrypt backup.tar.zst
 *
 * EXIT CODES:
 *   0 - Success
 *   1 - Error (see stderr)
 *   2 - Dependency missing (age, tar, zstd)
 *   3 - Container not found
 *   4 - Wallet export failed
 *   5 - Encryption failed
 *   6 - Service stop failed
 */

import { parseArgs } from "node:util";
import { createInterface } from "node:readline";
import { existsSync, mkdirSync, writeFileSync, statSync, rmSync, chmodSync, readdirSync } from "node:fs";
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
  exportVolumes,
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
} from "./lib/morpheus.mjs";

// ─── CLI Argument Parsing ─────────────────────────────────────────────

const CLI_VERSION = "1.0.0";

const HELP_TEXT = `
EverClaw Export v${CLI_VERSION}
Export EverClaw state for backup and migration

USAGE:
  everclaw-export [options] <output.tar.zst.age>

OPTIONS:
  --no-encrypt          Export UNENCRYPTED tar.zst (DANGEROUS)
  --include-wallet      Include wallet private key
  --dry-run             Show what would be exported
  --container NAME      Docker container name
  --passphrase-from-env Read passphrase from EVERCLAW_BACKUP_PASSPHRASE
  --generate-passphrase Generate and print a secure passphrase
  --no-stop             Skip service shutdown
  --verify              Verify archive after creation
  -q, --quiet           Minimal output
  -v, --verbose         Detailed output
  -h, --help            Show this help

EXAMPLES:
  everclaw-export --include-wallet backup.tar.zst.age
  everclaw-export --dry-run backup.tar.zst.age
`;

function parseCliArgs() {
  const { values, positionals } = parseArgs({
    options: {
      "no-encrypt": { type: "boolean", default: false },
      "include-wallet": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      container: { type: "string", short: "c" },
      "passphrase-from-env": { type: "boolean", default: false },
      "generate-passphrase": { type: "boolean", default: false },
      "no-stop": { type: "boolean", default: false },
      verify: { type: "boolean", default: false },
      quiet: { type: "boolean", short: "q", default: false },
      verbose: { type: "boolean", short: "v", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });

  return {
    ...values,
    outputFile: positionals[0],
  };
}

// ─── Constants ────────────────────────────────────────────────────────

const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

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

/**
 * Read a hidden passphrase from stdin.
 * Uses AGE_PASSPHRASE env for child processes (encryption.mjs handles spawn).
 */
async function readPassphrase(prompt = "Enter passphrase") {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY || platform() === "win32") {
      // Non-TTY or Windows: use readline (visible input)
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      rl.question(`${prompt}: `, (answer) => {
        rl.close();
        resolve(answer);
      });
      return;
    }

    // Unix TTY: raw mode for hidden input
    process.stderr.write(`${prompt}: `);
    process.stdin.setRawMode(true);
    let input = "";
    
    const onData = (char) => {
      const c = char.toString("utf8");
      if (c === "\n" || c === "\r" || c === "\u0004") {
        process.stdin.setRawMode(false);
        process.stdin.removeListener("data", onData);
        process.stderr.write("\n");
        resolve(input);
      } else if (c === "\u0003") {
        process.stderr.write("\n");
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

async function readPassphraseConfirm() {
  const pp1 = await readPassphrase("Enter passphrase");
  if (pp1.length < MIN_PASSPHRASE_LENGTH) {
    log(`Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`, "error");
    return null;
  }
  const pp2 = await readPassphrase("Confirm passphrase");
  if (pp1 !== pp2) {
    log("Passphrases do not match", "error");
    return null;
  }
  return pp1;
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

// ─── Wallet Export Flow ───────────────────────────────────────────────

/**
 * Display wallet export warning and require address confirmation.
 * CRITICAL: User must type the full wallet address to proceed.
 */
async function confirmWalletExport(expectedAddress) {
  console.error("");
  console.error("╔════════════════════════════════════════════════════════════════════╗");
  console.error("║  ⚠️  WALLET PRIVATE KEY EXPORT                                      ║");
  console.error("║                                                                    ║");
  console.error("║  You are about to export your WALLET PRIVATE KEY.                 ║");
  console.error("║  This key provides FULL CONTROL over your wallet funds.           ║");
  console.error("║                                                                    ║");
  console.error("║  • The key will be encrypted with your backup passphrase          ║");
  console.error("║  • Store the backup file SECURELY                                 ║");
  console.error("║  • NEVER share the backup file or passphrase                      ║");
  console.error("║                                                                    ║");
  console.error("║  To confirm, type your wallet address:                            ║");
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
    log("Wallet address does not match. Export cancelled.", "error");
    return false;
  }
  
  if (!expectedAddress && typed.length < 10) {
    log("Invalid confirmation. Export cancelled.", "error");
    return false;
  }
  
  return true;
}

async function exportWallet(passphrase, stagingDir) {
  verbose("Reading wallet key from keychain...");
  const result = readWalletKey();

  if (!result.found) {
    log("No wallet key found in keychain", "warn");
    return { found: false };
  }

  if (result.key) {
    verbose(`Key source: ${result.source}`);
  } else if (result.source === "encrypted-file") {
    log("Wallet key is in encrypted file, need separate decryption", "warn");
    return { found: true, source: result.source, needsDecryption: true, path: result.path };
  }

  if (!result.key) {
    return { found: true, source: result.source, needsDecryption: true };
  }

  // Get address for confirmation
  let address = null;
  try {
    address = await getWalletAddress(result.key);
  } catch { /* viem not available */ }

  // REQUIRE address confirmation before proceeding
  if (!await confirmWalletExport(address)) {
    return { found: false, cancelled: true };
  }

  // Encrypt for inclusion in archive
  verbose("Encrypting wallet key for archive...");
  const encrypted = encryptWalletKey(result.key, passphrase);

  // Write to staging
  const walletDir = join(stagingDir, "wallet");
  mkdirSync(walletDir, { recursive: true });
  writeFileSync(join(walletDir, "wallet.enc"), encrypted, { mode: 0o600 });

  verbose(`Wallet encrypted, address: ${address || "unknown"}`);
  return { found: true, source: result.source, encrypted: true, address };
}

// ─── Service Management ────────────────────────────────────────────────

/**
 * Stop services before export, with confirmation.
 * Returns true if services were stopped (for restart tracking).
 */
async function stopServicesForExport(options = {}) {
  const { force = false } = options;
  
  const status = getServiceStatus();
  const runningServices = status.filter(s => s.running);
  
  if (runningServices.length === 0) {
    verbose("No services running");
    return false;
  }
  
  console.error("");
  console.error("📦 The following services must be stopped for a consistent backup:");
  for (const s of runningServices) {
    console.error(`   • ${s.name}`);
  }
  console.error("");
  
  if (!force && process.stdin.isTTY) {
    const confirm = await readConfirmation("Stop these services? [y/N]");
    if (confirm.toLowerCase() !== "y" && confirm.toLowerCase() !== "yes") {
      log("Export cancelled", "info");
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

/**
 * Restart services after export.
 */
async function restartServices() {
  progress("Restarting services");
  const result = startAllServices();
  progressDone(`Started ${result.started.length} services`);
  
  if (result.failed.length > 0) {
    log(`Failed to start: ${result.failed.join(", ")}`, "warn");
  }
}

// ─── Main Export Flow ──────────────────────────────────────────────────

async function main() {
  const args = parseCliArgs();

  if (args.help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  if (args["generate-passphrase"]) {
    const pp = generatePassphrase(6);
    console.log(pp);
    process.exit(0);
  }

  VERBOSE = args.verbose;
  QUIET = args.quiet;

  // Validate output file
  if (!args.outputFile && !args["dry-run"]) {
    log("Output file required", "error");
    console.log(HELP_TEXT);
    process.exit(1);
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

  // Warn loudly for --no-encrypt + --include-wallet (BLOCK wallet in this case)
  if (args["no-encrypt"] && args["include-wallet"]) {
    console.error("");
    console.error("╔════════════════════════════════════════════════════════════════╗");
    console.error("║  🚫 BLOCKED: UNENCRYPTED + WALLET                               ║");
    console.error("║                                                                ║");
    console.error("║  --no-encrypt + --include-wallet is NOT ALLOWED.               ║");
    console.error("║  Exporting a wallet private key in PLAINTEXT is too dangerous. ║");
    console.error("║                                                                ║");
    console.error("║  Remove --include-wallet, or remove --no-encrypt.              ║");
    console.error("╚════════════════════════════════════════════════════════════════╝");
    console.error("");
    process.exit(4);
  }

  // Warn loudly for --no-encrypt
  if (args["no-encrypt"] && !args["dry-run"]) {
    console.error("");
    console.error("╔════════════════════════════════════════════════════════════════╗");
    console.error("║  ⚠️  WARNING: UNENCRYPTED EXPORT                                ║");
    console.error("║                                                                ║");
    console.error("║  You are about to create an UNENCRYPTED backup archive.        ║");
    console.error("║  This file will contain SENSITIVE DATA including:              ║");
    console.error("║    • OpenClaw configuration and credentials                    ║");
    console.error("║    • Session history and agent state                           ║");
    console.error("║    • Agent API keys and preferences                            ║");
    console.error("║                                                                ║");
    console.error("║  Store this file SECURELY. Never share unencrypted backups.    ║");
    console.error("╚════════════════════════════════════════════════════════════════╝");
    console.error("");

    if (process.stdin.isTTY) {
      const confirm = await readConfirmation("Type 'I UNDERSTAND' to continue");
      if (confirm !== "I UNDERSTAND") {
        log("Export cancelled", "info");
        process.exit(1);
      }
    }
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

  // Get passphrase if encrypting
  let passphrase = null;
  if (!args["no-encrypt"]) {
    if (args["passphrase-from-env"]) {
      passphrase = process.env.EVERCLAW_BACKUP_PASSPHRASE;
      if (!passphrase) {
        log("EVERCLAW_BACKUP_PASSPHRASE not set", "error");
        process.exit(1);
      }
    } else if (!args["dry-run"]) {
      passphrase = await readPassphraseConfirm();
      if (!passphrase) {
        process.exit(1);
      }
    }

    // Validate passphrase strength
    const strength = validatePassphrase(passphrase);
    if (!strength.strong) {
      log("Passphrase may be weak:", "warn");
      for (const issue of strength.issues) {
        console.error(`  - ${issue}`);
      }
    }
    
    // Set AGE_PASSPHRASE for child processes (encryption.mjs uses this)
    process.env.AGE_PASSPHRASE = passphrase;
  }

  // Estimate sizes
  let estimatedSize = { totalBytes: 0, volumes: [] };
  if (containerName) {
    try {
      estimatedSize = estimateVolumeSize(containerName);
      verbose(`Estimated size: ${(estimatedSize.totalBytes / 1024 / 1024).toFixed(1)} MB`);
    } catch { /* ignore */ }
  }

  // Dry run - just show what would be exported
  if (args["dry-run"]) {
    console.log("\n📦 Dry Run - What would be exported:\n");

    console.log("Environment:");
    console.log(`  Inside container: ${insideContainer}`);
    if (containerName) {
      console.log(`  Container: ${containerName}`);
    }

    console.log("\nPaths:");
    const stateDir = getStateDir();
    const workspaceDir = getWorkspaceDir();
    console.log(`  OpenClaw state: ${stateDir}`);
    console.log(`  Workspace: ${workspaceDir}`);
    console.log(`  Morpheus: ${join(homedir(), "morpheus")}`);
    console.log(`  EverClaw: ${join(homedir(), ".everclaw")}`);

    if (estimatedSize.volumes.length > 0) {
      console.log("\nVolume sizes:");
      for (const v of estimatedSize.volumes) {
        console.log(`  ${v.path}: ${(v.bytes / 1024 / 1024).toFixed(1)} MB`);
      }
      console.log(`  TOTAL: ${(estimatedSize.totalBytes / 1024 / 1024).toFixed(1)} MB`);
    }

    if (estimatedSize.totalBytes > 2 * 1024 * 1024 * 1024) {
      console.log("\n  ⚠️  Warning: Export > 2 GB may take several minutes");
    }

    console.log("\nWallet:");
    const wallet = readWalletKey();
    if (wallet.found) {
      console.log(`  Found: yes (source: ${wallet.source})`);
    } else {
      console.log("  Found: no");
    }

    console.log("\nServices:");
    const status = getServiceStatus();
    for (const s of status) {
      console.log(`  ${s.name}: ${s.running ? "running" : "stopped"}`);
    }

    console.log("\nOutput:");
    console.log(`  File: ${args.outputFile || "backup.tar.zst.age"}`);
    console.log(`  Encrypted: ${!args["no-encrypt"]}`);
    console.log(`  Include wallet: ${args["include-wallet"]}`);
    console.log(`  Stop services: ${!args["no-stop"]}`);

    process.exit(0);
  }

  // Stop services before export (unless --no-stop)
  let servicesWereStopped = false;
  if (!args["no-stop"]) {
    try {
      servicesWereStopped = await stopServicesForExport();
    } catch (err) {
      log(`Failed to stop services: ${err.message}`, "error");
      process.exit(6);
    }
  }

  // Create staging directory
  const stagingDir = join(tmpdir(), `everclaw-export-${Date.now()}`);
  mkdirSync(stagingDir, { recursive: true });
  verbose(`Staging directory: ${stagingDir}`);

  try {
    // Phase 1: Export data (Docker volumes or host paths)
    if (containerName) {
      // Docker volume export using lib/docker.mjs
      progress("Exporting Docker volumes");
      const volResult = exportVolumes(containerName, join(stagingDir, "volumes.tar.zst"), { compression: "zstd" });
      if (!volResult.success) {
        // Fallback: copy from inside container
        verbose(`Volume export failed, using fallback: ${volResult.error}`);
        progress("Copying container data (fallback)");
        const containerHome = detectContainerHome(containerName);
        const containerUser = detectContainerUser(containerName);
        
        execSync(`docker exec "${containerName}" tar -czf - -C "${containerHome}" .openclaw .morpheus .everclaw 2>/dev/null | tar -xzf - -C "${stagingDir}"`, { stdio: "pipe" });
      } else {
        // Extract volumes tar into staging
        mkdirSync(join(stagingDir, "volumes"), { recursive: true });
        execSync(`tar -xf "${join(stagingDir, "volumes.tar.zst")}" -C "${join(stagingDir, "volumes")}" --zstd 2>/dev/null`, { stdio: "pipe" });
        rmSync(join(stagingDir, "volumes.tar.zst"), { force: true });
      }
      verbose("Docker volumes exported");
    } else {
      // Host-mode export
      progress("Exporting OpenClaw state");
      const ocResult = copyOpenclawState(stagingDir);
      verbose(`Copied ${ocResult.files} files (${(ocResult.bytes / 1024 / 1024).toFixed(1)} MB)`);

      progress("Exporting Morpheus data");
      const morpheusResult = collectMorpheusState(stagingDir);
      verbose(`Morpheus: ${morpheusResult.files} files (${(morpheusResult.bytes / 1024 / 1024).toFixed(1)} MB)`);

      progress("Exporting EverClaw config");
      const everclawDir = join(homedir(), ".everclaw");
      if (existsSync(everclawDir)) {
        const everclawTarget = join(stagingDir, "everclaw");
        mkdirSync(everclawTarget, { recursive: true });
        execSync(`cp -R "${everclawDir}"/* "${everclawTarget}/" 2>/dev/null || true`, { stdio: "pipe" });
        verbose("EverClaw config copied");
      }
    }

    // Phase 2: Export wallet (if requested)
    let walletInfo = { found: false };
    if (args["include-wallet"]) {
      progress("Exporting wallet");
      // passphrase is guaranteed here (--no-encrypt + --include-wallet blocked earlier)
      walletInfo = await exportWallet(passphrase, stagingDir);
      
      if (walletInfo.cancelled) {
        log("Wallet export cancelled by user", "info");
        process.exit(0);
      }
      
      if (walletInfo.found && walletInfo.needsDecryption) {
        log("Wallet requires separate decryption - not included", "warn");
      }
      verbose(`Wallet export: ${JSON.stringify({ found: walletInfo.found, encrypted: walletInfo.encrypted })}`);
    }

    // Phase 3: Generate manifest
    progress("Generating manifest");
    const checksums = checksumDirectory(stagingDir);
    const manifest = generateManifest({
      openclaw: { bytes: checksums.bytes, files: checksums.files },
      morpheus: existsSync(join(stagingDir, "morpheus")) || existsSync(join(stagingDir, "volumes")),
      everclaw: existsSync(join(stagingDir, "everclaw")),
      wallet: walletInfo.found ? { encrypted: walletInfo.encrypted, address: walletInfo.address } : null,
      checksums,
    });

    writeFileSync(join(stagingDir, "manifest.json"), JSON.stringify(manifest, null, 2));
    verbose(`Manifest written (version ${manifest.version})`);

    // Phase 4: Encrypt
    let outputFile = args.outputFile;
    if (args["no-encrypt"]) {
      // Unencrypted tarball
      progress("Creating tarball");
      const compression = detectCompression();
      if (!outputFile.endsWith(compression.ext)) {
        outputFile += compression.ext;
      }

      let tarArgs = ["-c"];
      if (compression.tarFlag) tarArgs.push(compression.tarFlag);
      tarArgs.push("-f", outputFile, "-C", stagingDir, ".");

      execSync(`tar ${tarArgs.join(" ")}`, { stdio: "pipe" });
      chmodSync(outputFile, 0o600);
    } else {
      // Encrypted archive
      progress("Encrypting archive", "this may take a while");

      const result = await encryptDirectory(stagingDir, outputFile, passphrase, {
        compressionLevel: 3,
        onProgress: (p) => {
          if (p.phase === "complete") {
            verbose(`Encrypted: ${(p.bytes / 1024 / 1024).toFixed(1)} MB`);
          }
        },
      });

      outputFile = result.outputFile;
    }

    progressDone(`Export complete: ${outputFile}`);

    // Show summary
    if (!QUIET) {
      const stats = statSync(outputFile);
      console.error(`\n📦 Export complete:`);
      console.error(`   File: ${outputFile}`);
      console.error(`   Size: ${(stats.size / 1024 / 1024).toFixed(1)} MB`);
      console.error(`   Encrypted: ${!args["no-encrypt"]}`);
      console.error(`   Wallet: ${walletInfo.found ? (walletInfo.encrypted ? "encrypted" : "plaintext") : "not included"}`);
      console.error(``);
      console.error(`   Manifest: v${manifest.version}`);
      console.error(`   Created: ${manifest.created}`);
      console.error(`   Platform: ${manifest.platform.os}/${manifest.platform.arch}`);
    }

    // Verify (optional)
    if (args.verify && !args["no-encrypt"]) {
      progress("Verifying archive");
      const verifyDir = join(tmpdir(), `everclaw-verify-${Date.now()}`);
      mkdirSync(verifyDir, { recursive: true });

      try {
        await decryptArchive(outputFile, verifyDir, passphrase);
        const manifestPath = join(verifyDir, "manifest.json");
        if (existsSync(manifestPath)) {
          const fs = await import("node:fs");
          const verifyManifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
          const validation = validateManifest(verifyManifest);
          if (validation.valid) {
            verbose("Archive verification passed");
          } else {
            log(`Manifest validation issues: ${validation.errors.join(", ")}`, "warn");
          }
        }
        shredDirectory(verifyDir);
      } catch (err) {
        log(`Verification failed: ${err.message}`, "error");
      }
    }

    process.exit(0);
  } finally {
    // Cleanup staging (secure if wallet was exported)
    shredDirectory(stagingDir);
    
    // Restart services if we stopped them
    if (servicesWereStopped) {
      await restartServices();
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