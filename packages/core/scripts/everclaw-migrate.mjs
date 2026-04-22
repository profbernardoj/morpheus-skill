#!/usr/bin/env node
/**
 * everclaw-migrate.mjs — Migration wizard for EverClaw transfers
 *
 * Interactive wizard for migrating EverClaw between environments:
 * - Cloud VPS → Physical hardware
 * - Docker container → Bare metal
 * - One machine → Another machine
 * - One container → Another container
 *
 * The wizard guides you through:
 * 1. Export state from source
 * 2. Transfer backup to target
 * 3. Restore state on target
 * 4. Verify migration success
 *
 * USAGE:
 *   everclaw-migrate [mode] [options]
 *
 * MODES:
 *   export     Generate export commands for source machine
 *   transfer   Show transfer instructions
 *   import     Generate import commands for target machine
 *   wizard     Full interactive wizard (default)
 *   status     Check migration status
 *
 * OPTIONS:
 *   --source TYPE        Source type: host, docker, ssh
 *   --target TYPE        Target type: host, docker, ssh
 *   --source-host HOST   Source hostname/IP for SSH transfer
 *   --target-host HOST   Target hostname/IP for SSH transfer
 *   --container NAME     Container name (for docker source/target)
 *   --wallet             Include wallet in migration (default: prompt)
 *   --no-wallet          Exclude wallet from migration
 *   --verify             Run verification after restore
 *   --no-verify          Skip verification
 *   --clean              Remove backup after successful migration
 *   --json               Output as JSON for scripting
 *   -v, --verbose        Detailed output
 *   -q, --quiet          Minimal output
 *   -h, --help           Show this help
 *
 * EXAMPLES:
 *   # Interactive wizard
 *   everclaw-migrate
 *   everclaw-migrate wizard
 *
 *   # Export from Docker container
 *   everclaw-migrate export --source docker --container everclaw-prod
 *
 *   # Transfer via SSH
 *   everclaw-migrate transfer --source-host 192.168.1.100 --target-host 192.168.1.200
 *
 *   # Import on target machine
 *   everclaw-migrate import --target docker --container everclaw-new
 *
 * EXIT CODES:
 *   0 - Success
 *   1 - Error
 *   2 - Interrupted/cancelled
 */

import { parseArgs } from "node:util";
import { createInterface } from "node:readline";
import { existsSync, statSync, readdirSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { homedir, tmpdir, platform } from "node:os";
import { execSync, spawn } from "node:child_process";

// Import lib modules
import {
  isInsideContainer,
  detectContainerName,
  detectContainerHome,
  getContainerVolumes,
} from "./lib/docker.mjs";

import {
  checkDependencies,
} from "./lib/encryption.mjs";

import {
  detectEverclawVersion,
  detectOpenclawVersion,
} from "./lib/manifest.mjs";

import {
  isOpenclawAvailable,
  getStateDir,
} from "./lib/openclaw.mjs";

import {
  detectMorpheusPaths,
} from "./lib/morpheus.mjs";

// ─── CLI Argument Parsing ─────────────────────────────────────────────

const CLI_VERSION = "1.0.0";

const HELP_TEXT = `
EverClaw Migrate v${CLI_VERSION}
Migration wizard for EverClaw transfers

USAGE:
  everclaw-migrate [mode] [options]

MODES:
  export     Generate export commands for source machine
  transfer   Show transfer instructions
  import     Generate import commands for target machine
  wizard     Full interactive wizard (default)
  status     Check migration status

OPTIONS:
  --source TYPE        Source type: host, docker, ssh
  --target TYPE        Target type: host, docker, ssh
  --source-host HOST   Source hostname/IP for SSH transfer
  --target-host HOST   Target hostname/IP for SSH transfer
  --container NAME     Container name (for docker source/target)
  --wallet             Include wallet in migration
  --no-wallet          Exclude wallet from migration
  --verify             Run verification after restore
  --no-verify          Skip verification
  --clean              Remove backup after successful migration
  --json               Output as JSON for scripting
  -v, --verbose        Detailed output
  -q, --quiet          Minimal output
  -h, --help           Show this help

EXAMPLES:
  everclaw-migrate                    # Interactive wizard
  everclaw-migrate export --source docker --container everclaw
  everclaw-migrate import --target host
  everclaw-migrate status
`;

function parseCliArgs() {
  const { values, positionals } = parseArgs({
    options: {
      source: { type: "string" },
      target: { type: "string" },
      "source-host": { type: "string" },
      "target-host": { type: "string" },
      container: { type: "string", short: "c" },
      wallet: { type: "boolean", default: undefined },
      "no-wallet": { type: "boolean", default: false },
      verify: { type: "boolean", default: true },
      "no-verify": { type: "boolean", default: false },
      clean: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      verbose: { type: "boolean", short: "v", default: false },
      quiet: { type: "boolean", short: "q", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });

  // Handle --no-* flags
  if (values["no-wallet"]) values.wallet = false;
  if (values["no-verify"]) values.verify = false;

  return {
    ...values,
    mode: positionals[0] || "wizard",
  };
}

// ───Output Helpers ──────────────────────────────────────────────────

let VERBOSE = false;
let QUIET = false;
let JSON_OUTPUT = false;

function log(msg, level = "info") {
  if (JSON_OUTPUT && level !== "error") return;
  if (QUIET && level !== "error") return;
  const prefix = level === "error" ? "❌ " : level === "warn" ? "⚠️  " : level === "success" ? "✅ " : level === "step" ? "📍 " : level === "cmd" ? "💻 " : "";
  console.error(`${prefix}${msg}`);
}

function verbose(msg) {
  if (JSON_OUTPUT || QUIET) return;
  if (VERBOSE) console.error(`  ${msg}`);
}

function step(num, title) {
  if (JSON_OUTPUT || QUIET) return;
  console.error(`\n━━━ Step ${num}: ${title}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}

function prompt(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    rl.question(`${question}: `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function promptYesNo(question, defaultYes = true) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const hint = defaultYes ? "[Y/n]" : "[y/N]";
    rl.question(`${question} ${hint}: `, (answer) => {
      rl.close();
      const lower = answer.trim().toLowerCase();
      if (!answer.trim()) {
        resolve(defaultYes);
      } else {
        resolve(lower === "y" || lower === "yes");
      }
    });
  });
}

function showCommand(cmd, description = "") {
  if (description) {
    console.error(`  ${description}:`);
  }
  console.error(`  ${cmd}`);
  console.error("");
}

function progressBar(percent, label = "") {
  if (JSON_OUTPUT || QUIET) return;
  const width = 40;
  const filled = Math.round(width * percent);
  const empty = width - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  process.stderr.write(`\r  [${bar}] ${Math.round(percent * 100)}%${label ? ` ${label}` : ""}`);
  if (percent >= 1) {
    process.stderr.write("\n");
  }
}

// ─── Environment Detection ────────────────────────────────────────────

function detectEnvironment() {
  const insideContainer = isInsideContainer();
  const openclawAvailable = isOpenclawAvailable();
  const everclawVersionResult = detectEverclawVersion();
  const openclawVersionResult = detectOpenclawVersion();
  const everclawVersion = everclawVersionResult?.version || everclawVersionResult;
  const openclawVersion = openclawVersionResult?.version || openclawVersionResult;
  const morpheusPaths = detectMorpheusPaths();
  
  let containerName = null;
  if (!insideContainer) {
    const detected = detectContainerName();
    if (detected.found) {
      containerName = detected.name;
    }
  }
  
  const stateDir = getStateDir();
  const stateExists = existsSync(stateDir);
  
  const everclawDir = join(homedir(), ".everclaw");
  const everclawExists = existsSync(everclawDir);
  
  return {
    insideContainer,
    containerName,
    openclawAvailable,
    openclawVersion,
    everclawVersion,
    everclawExists,
    morpheusPaths,
    stateDir,
    stateExists,
    platform: platform(),
    hostname: process.env.HOSTNAME || process.env.COMPUTERNAME || "unknown",
  };
}

// ─── Migration State ──────────────────────────────────────────────────

const STATE_FILE = join(homedir(), ".everclaw", "migration-state.json");

function loadMigrationState() {
  try {
    if (existsSync(STATE_FILE)) {
      const data = JSON.parse(readFileSync(STATE_FILE, "utf-8"));
      return data;
    }
  } catch { /* ignore */}
  return null;
}

function saveMigrationState(state) {
  try {
    const everclawDir = dirname(STATE_FILE);
    if (!existsSync(everclawDir)) {
      mkdirSync(everclawDir, { recursive: true });
    }
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    verbose(`Failed to save migration state: ${err.message}`);
  }
}

function clearMigrationState() {
  try {
    if (existsSync(STATE_FILE)) {
      rmSync(STATE_FILE, { force: true });
    }
  } catch { /* ignore */}
}

// ─── Export Mode ──────────────────────────────────────────────────────

function generateExportCommands(options) {
  const env = detectEnvironment();
  const lines = [];
  
  lines.push("");
  lines.push("📦 EXPORT COMMANDS FOR SOURCE MACHINE");
  lines.push("═══════════════════════════════════════");
  lines.push("");
  
  // Detect source type
  let sourceType = options.source;
  if (!sourceType) {
    if (env.insideContainer) {
      sourceType = "docker";
    } else if (env.containerName) {
      sourceType = "docker-external";
    } else {
      sourceType = "host";
    }
  }
  
  lines.push(`Source type: ${sourceType}`);
  lines.push("");
  
  // Build export command
  const exportCmd = buildExportCommand(sourceType, options, env);
  lines.push("Run this command on the SOURCE machine:");
  lines.push("");
  lines.push(`  ${exportCmd}`);
  lines.push("");
  
  // Wallet warning
  if (options.wallet !== false) {
    lines.push("⚠️  WALLET WARNING:");
    lines.push("  The backup will include your ENCRYPTED wallet private key.");
    lines.push("  You will need the backup passphrase to restore it.");
    lines.push("  Use --no-wallet to exclude wallet from backup.");
    lines.push("");
  }
  
  // Output file info
  const outputFile = options.outputFile || `everclaw-backup-${Date.now()}.tar.zst.age`;
  lines.push(`Output file: ${outputFile}`);
  lines.push("");
  
  // Next steps
  lines.push("NEXT STEPS:");
  lines.push("  1. Run the export command above");
  lines.push("  2. Transfer the backup file to the target machine");
  lines.push("  3. Run 'everclaw-migrate import' on the target");
  lines.push("");
  
  return lines.join("\n");
}

function buildExportCommand(sourceType, options, env) {
  const parts = ["everclaw-export"];
  
  // Container handling
  if (sourceType === "docker" && env.insideContainer) {
    parts.push("--inside-container");
  } else if (sourceType === "docker" || sourceType === "docker-external") {
    const container = options.container || env.containerName;
    if (container) {
      parts.push(`--container ${container}`);
    }
  }
  
  // Wallet
  if (options.wallet === true) {
    parts.push("--wallet");
  } else if (options.wallet === false) {
    parts.push("--no-wallet");
  }
  
  // Output file
  const outputFile = options.outputFile || `everclaw-backup-${Date.now()}.tar.zst.age`;
  parts.push(`-o ${outputFile}`);
  
  return parts.join(" ");
}

// ───Transfer Mode ─────────────────────────────────────────────────────

function generateTransferInstructions(options) {
  const lines = [];
  
  lines.push("");
  lines.push("📦TRANSFER INSTRUCTIONS");
  lines.push("══════════════════════════════════════");
  lines.push("");
  
  const sourceHost = options.sourceHost;
  const targetHost = options.targetHost;
  const backupFile = options.backupFile || "everclaw-backup-*.tar.zst.age";
  
  if (sourceHost && targetHost) {
    // Direct SSH transfer
    lines.push("DIRECT SSH TRANSFER (Source → Target):");
    lines.push("");
    lines.push(`  scp ${backupFile} ${targetHost}:~/`);
    lines.push("");
    lines.push("Or with rsync for progress:");
    lines.push("");
    lines.push(`  rsync -avz --progress ${backupFile} ${targetHost}:~/`);
    lines.push("");
  } else if (sourceHost) {
    // Download from source
    lines.push("DOWNLOAD FROM SOURCE (to local machine):");
    lines.push("");
    lines.push(`  scp ${sourceHost}:~/${backupFile} ./`);
    lines.push("");
    lines.push("Then upload to target:");
    lines.push("");
    lines.push(`  scp ${backupFile} <target-host>:~/`);
    lines.push("");
  } else if (targetHost) {
    // Upload to target
    lines.push("UPLOAD TO TARGET:");
    lines.push("");
    lines.push(`  scp ${backupFile} ${targetHost}:~/`);
    lines.push("");
    lines.push("Or with rsync:");
    lines.push("");
    lines.push(`  rsync -avz --progress ${backupFile} ${targetHost}:~/`);
    lines.push("");
  } else {
    // Generic instructions
    lines.push("CHOOSE YOUR TRANSFER METHOD:");
    lines.push("");
    lines.push("Option 1: USB Drive");
    lines.push("  1. Copy backup file to USB drive");
    lines.push("  2. Plug USB into target machine");
    lines.push("  3. Copy to home directory");
    lines.push("");
    lines.push("Option 2: SSH/SCP");
    lines.push(`  scp ${backupFile} <target-host>:~/`);
    lines.push("");
    lines.push("Option 3: Cloud Storage");
    lines.push("  1. Upload to S3, Dropbox, etc.");
    lines.push("  2. Download on target machine");
    lines.push("");
    lines.push("Option 4: Local Network");
    lines.push("  1. Start HTTP server on source:");
    lines.push("     python3 -m http.server 8000");
    lines.push("  2. Download on target:");
    lines.push(`     wget http://<source-ip>:8000/${backupFile}`);
    lines.push("");
  }
  
  // Security reminder
  lines.push("⚠️SECURITY REMINDERS:");
  lines.push("  - Backup file is ENCRYPTED (AGE encryption)");
  lines.push("  - Keep passphrase separate from backup file");
  lines.push("  - Delete backup from intermediate storage after transfer");
  lines.push("  - Verify file integrity after transfer:");
  lines.push(`    everclaw-verify ${backupFile}`);
  lines.push("");
  
  return lines.join("\n");
}

// ─── Import Mode ──────────────────────────────────────────────────────

function generateImportCommands(options) {
  const env = detectEnvironment();
  const lines = [];
  
  lines.push("");
  lines.push("📦 IMPORT COMMANDS FOR TARGET MACHINE");
  lines.push("══════════════════════════════════════");
  lines.push("");
  
  // Detect target type
  let targetType = options.target;
  if (!targetType) {
    if (env.insideContainer) {
      targetType = "docker";
    } else if (env.containerName) {
      targetType = "docker-external";
    } else {
      targetType = "host";
    }
  }
  
  lines.push(`Target type: ${targetType}`);
  lines.push("");
  
  // Build restore command
  const restoreCmd = buildRestoreCommand(targetType, options, env);
  lines.push("Run this command on the TARGET machine:");
  lines.push("");
  lines.push(`  ${restoreCmd}`);
  lines.push("");
  
  // Verification
  if (options.verify !== false) {
    lines.push("After restore, verify the migration:");
    lines.push("");
    lines.push("  everclaw-verify");
    lines.push("");
  }
  
  // Post-migration steps
  lines.push("POST-MIGRATION STEPS:");
  lines.push("  1. Restart services: openclaw gateway restart");
  lines.push("  2. Verify wallet: everclaw-verify --wallet");
  lines.push("  3. Test inference: everclaw-verify --inference");
  lines.push("  4. (Optional) Delete backup file after verification");
  lines.push("");
  
  return lines.join("\n");
}

function buildRestoreCommand(targetType, options, env) {
  const parts = ["everclaw-restore"];
  
  // Container handling
  if (targetType === "docker" && env.insideContainer) {
    // Running inside container, no --container needed
  } else if (targetType === "docker" || targetType === "docker-external") {
    const container = options.container || env.containerName;
    if (container) {
      parts.push(`--container ${container}`);
    }
  }
  
  // Verification
  if (options.verify === false) {
    parts.push("--no-verify");
  }
  
  // Input file
  const inputFile = options.inputFile || "everclaw-backup-*.tar.zst.age";
  parts.push(inputFile);
  
  return parts.join(" ");
}

// ─── Status Mode ───────────────────────────────────────────────────────

function showMigrationStatus() {
  const env = detectEnvironment();
  const state = loadMigrationState();
  
  const lines = [];
  
  lines.push("");
  lines.push("📦 MIGRATION STATUS");
  lines.push("══════════════════════════════════════");
  lines.push("");
  
  lines.push("CURRENT ENVIRONMENT:");
  lines.push(`  Platform: ${env.platform}`);
  lines.push(`  In Container: ${env.insideContainer ? "Yes" : "No"}`);
  if (env.containerName) {
    lines.push(`  Container: ${env.containerName}`);
  }
  lines.push(`  OpenClaw: ${env.openclawAvailable ? `v${env.openclawVersion?.version || env.openclawVersion || "unknown"}`: "Not installed"}`);
  lines.push(`  EverClaw: ${(env.everclawVersion?.version || env.everclawVersion || "Not installed")}`);
  lines.push(`  State Dir: ${env.stateDir} ${env.stateExists? "✓" : "✗"}`);
  lines.push(`  Morpheus: ${env.morpheusPaths.length > 0 ? "Found" : "Not found"}`);
  lines.push("");
  
  if (state) {
    lines.push("MIGRATION IN PROGRESS:");
    lines.push(`  Started: ${state.started || "unknown"}`);
    lines.push(`  Phase: ${state.phase || "unknown"}`);
    if (state.backupFile) {
      lines.push(`  Backup: ${state.backupFile}`);
    }
    if (state.sourceHost) {
      lines.push(`  Source: ${state.sourceHost}`);
    }
    if (state.targetHost) {
      lines.push(`  Target: ${state.targetHost}`);
    }
    lines.push("");
  } else {
    lines.push("No migration in progress.");
    lines.push("");
  }
  
  return lines.join("\n");
}

// ─── Wizard Mode ───────────────────────────────────────────────────────

async function runWizard(options) {
  if (!JSON_OUTPUT && !QUIET) {
    console.error("");
    console.error("╔════════════════════════════════════════════════════════════════════╗");
    console.error("║                    EverClaw Migration Wizard                        ║");
    console.error("║                                                                    ║");
    console.error("║  This wizard will guide you through migrating your EverClaw        ║");
    console.error("║  setup from one machine to another.                               ║");
    console.error("╚════════════════════════════════════════════════════════════════════╝");
    console.error("");
  }
  
  const env = detectEnvironment();
  const answers = {};
  
  // Step 1: Determine source type
  step(1, "Source Environment");
  
  if (options.source) {
    answers.sourceType = options.source;
    log(`Source type: ${answers.sourceType} (from --source)`);
  } else {
    const defaultSource = env.insideContainer ? "docker" : "host";
    console.error("Where is EverClaw currently running?");
    console.error("  1) Directly on host (bare metal or VM)");
    console.error("  2) Inside a Docker container");
    console.error("");
    
    const choice = await prompt(`Select source type [1-2, default: ${defaultSource === "host"? "1" : "2"}]`);
    if (choice === "2" || (choice === "" && defaultSource === "docker")) {
      answers.sourceType = "docker";
    } else {
      answers.sourceType = "host";
    }
  }
  
  // Container name if docker
  if (answers.sourceType === "docker"&& !env.insideContainer) {
    if (options.container) {
      answers.containerName = options.container;
      log(`Container: ${answers.containerName} (from --container)`);
    } else if (env.containerName) {
      const useDetected = await promptYesNo(`Detected container: ${env.containerName}. Use this?`, true);
      if (useDetected) {
        answers.containerName = env.containerName;
      } else {
        answers.containerName = await prompt("Enter container name");
      }
    } else {
      answers.containerName = await prompt("Enter container name");
    }
  }
  
  // Step 2: Determine target type
  step(2, "Target Environment");
  
  if (options.target) {
    answers.targetType = options.target;
    log(`Target type: ${answers.targetType} (from --target)`);
  } else {
    console.error("Where will EverClaw be running after migration?");
    console.error("  1) Directly on host (bare metal or VM)");
    console.error("  2) Inside a Docker container");
    console.error("");
    
    const choice = await prompt("Select target type [1-2, default: 1]");
    if (choice === "2") {
      answers.targetType = "docker";
    } else {
      answers.targetType = "host";
    }
  }
  
  // Target container name if docker
  if (answers.targetType === "docker") {
    if (options.container && answers.targetType === "docker") {
      answers.targetContainer = options.container;
      log(`Target container: ${answers.targetContainer} (from --container)`);
    } else {
      answers.targetContainer = await prompt("Enter target container name (or leave empty for new container)");
      if (!answers.targetContainer) {
        answers.targetContainer = "everclaw";
      }
    }
  }
  
  // Step 3: Wallet
  step(3, "Wallet Migration");
  
  if (options.wallet !== undefined) {
    answers.includeWallet = options.wallet;
    log(`Include wallet: ${answers.includeWallet ? "Yes" : "No"} (from ${options.wallet ? "--wallet" : "--no-wallet"})`);
  } else {
    console.error("Your Morpheus wallet private key can be included in the backup.");
    console.error("It will be encrypted with the backup passphrase.");
    console.error("");
    answers.includeWallet = await promptYesNo("Include wallet in migration?", true);
  }
  
  // Step 4: Transfer method
  step(4, "Transfer Method");
  
  if (options.sourceHost || options.targetHost) {
    answers.transferMethod = "ssh";
    answers.sourceHost = options.sourceHost;
    answers.targetHost = options.targetHost;
    if (options.sourceHost) log(`Source host: ${options.sourceHost}`);
    if (options.targetHost) log(`Target host: ${options.targetHost}`);
  } else {
    console.error("How will you transfer the backup file?");
    console.error("  1) SSH/SCP (direct or via local machine)");
    console.error("  2) USB drive or external storage");
    console.error("  3) Cloud storage (S3, Dropbox, etc.)");
    console.error("  4) Generate commands only (I'll handle transfer)");
    console.error("");
    
    const choice = await prompt("Select transfer method [1-4, default: 1]");
    if (choice === "2") {
      answers.transferMethod = "usb";
    } else if (choice === "3") {
      answers.transferMethod = "cloud";
    } else if (choice === "4") {
      answers.transferMethod = "manual";
    } else {
      answers.transferMethod = "ssh";
      answers.sourceHost = await prompt("Source host/IP (leave empty if this is source)");
      answers.targetHost = await prompt("Target host/IP (leave empty if this is target)");
    }
  }
  
  // Step 5: Generate commands
  step(5, "Migration Commands");
  
  const timestamp = Date.now();
  const backupFile = `everclaw-backup-${timestamp}.tar.zst.age`;
  
  // Export command
  console.error("━━━ ON SOURCE MACHINE:");
  console.error("");
  
  const exportCmd = buildExportCommand(answers.sourceType, {
    container: answers.containerName || answers.targetContainer,
    wallet: answers.includeWallet,
    outputFile: backupFile,
  }, env);
  
  showCommand(exportCmd, "Export EverClaw state");
  
  // Transfer instructions
  console.error("━━━ TRANSFER:");
  console.error("");
  
  if (answers.transferMethod === "ssh") {
    if (answers.sourceHost && answers.targetHost) {
      showCommand(`scp ${backupFile} ${answers.targetHost}:~/}`, "Direct transfer");
    } else if (answers.sourceHost) {
      showCommand(`scp ${answers.sourceHost}:~/${backupFile} ./`, "Download from source");
      showCommand(`scp ${backupFile} <target-host>:~/`, "Then upload to target");
    } else if (answers.targetHost) {
      showCommand(`scp ${backupFile} ${answers.targetHost}:~/`, "Upload to target");
    } else {
      showCommand(`scp ${backupFile} <target-host>:~/`, "Transfer to target");
    }
  } else if (answers.transferMethod === "usb") {
    console.error("  1. Copy backup file to USB drive");
    console.error("  2. Plug USB into target machine");
    console.error(`  3. Copy ${backupFile} to home directory`);
    console.error("");
  } else if (answers.transferMethod === "cloud") {
    console.error("  1. Upload backup file to your cloud storage");
    console.error("  2. Generate and save a download link");
    console.error("  3. Download on target machine");
    console.error("");
  } else if (answers.transferMethod === "manual") {
    console.error("  Transfer the backup file using your preferred method.");
    console.error("");
  }
  
  // Import command
  console.error("━━━ ON TARGET MACHINE:");
  console.error("");
  
  const restoreCmd = buildRestoreCommand(answers.targetType, {
    container: answers.targetContainer || answers.containerName,
    verify: options.verify,
    inputFile: backupFile,
  }, env);
  
  showCommand(restoreCmd, "Restore EverClaw state");
  
  // Verify command
  if (options.verify !== false) {
    showCommand("everclaw-verify", "Verify migration");
  }
  
  // Step 6: Save state
  step(6, "Migration Tracking");
  
  const state = {
    started: new Date().toISOString(),
    phase: "commands-generated",
    sourceType: answers.sourceType,
    targetType: answers.targetType,
    backupFile,
    sourceHost: answers.sourceHost,
    targetHost: answers.targetHost,
    includeWallet: answers.includeWallet,
    transferMethod: answers.transferMethod,
  };
  
  saveMigrationState(state);
  log("Migration state saved. Run 'everclaw-migrate status' to check progress.");
  console.error("");
  
  // Summary
  console.error("━━━ SUMMARY:");
  console.error(`  Source: ${answers.sourceType}${answers.containerName ? ` (${answers.containerName})` : ""}`);
  console.error(`  Target: ${answers.targetType}${answers.targetContainer ? ` (${answers.targetContainer})` : ""}`);
  console.error(`  Wallet: ${answers.includeWallet ? "Included (encrypted)" : "Excluded"}`);
  console.error(`  Transfer: ${answers.transferMethod}`);
  console.error(`  Backup: ${backupFile}`);
  console.error("");
  
  // Final reminder
  console.error("⚠️  IMPORTANT:");
  console.error("  - Keep your backup passphrase safe and separate from the backup file");
  console.error("  - Verify the migration before deleting the backup");
  console.error("  - Restart services on the target: openclaw gateway restart");
  console.error("");
  
  if (options.clean) {
    const clean = await promptYesNo("Remove backup file after successful migration?", false);
    if (clean) {
      console.error("  After verifying, run:");
      console.error(`  rm ${backupFile}`);
      console.error("");
    }
  }
  
  log("Migration wizard complete!", "success");
  
  if (JSON_OUTPUT) {
    console.log(JSON.stringify({
      success: true,
      state,
      commands: {
        export: exportCmd,
        restore: restoreCmd,
        backupFile,
      },
    }, null, 2));
  }
  
  return 0;
}

// ─── Main ──────────────────────────────────────────────────────────────

async function main() {
  const args = parseCliArgs();

  if (args.help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  VERBOSE = args.verbose;
  QUIET = args.quiet;
  JSON_OUTPUT = args.json;

  // Check dependencies
  const deps = checkDependencies();
  if (!deps.ok && !args.json) {
    log("Missing dependencies:", "warn");
    for (const missing of deps.missing) {
      console.error(`  - ${missing}`);
    }
    console.error("");
    console.error("Some features may not work without these dependencies.");
    console.error("");
  }

  try {
    switch (args.mode) {
      case "export":
        console.log(generateExportCommands(args));
        break;
        
      case "transfer":
        console.log(generateTransferInstructions(args));
        break;
        
      case "import":
        console.log(generateImportCommands(args));
        break;
        
      case "status":
        console.log(showMigrationStatus());
        break;
        
      case "wizard":
      default:
        await runWizard(args);
        break;
    }
    
    process.exit(0);
  } catch (err) {
    if (err.message === "cancelled") {
      log("Migration cancelled by user", "warn");
      process.exit(2);
    }
    log(err.message, "error");
    if (VERBOSE && err.stack) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  log(err.message, "error");
  if (VERBOSE && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});