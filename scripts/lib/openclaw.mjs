/**
 * lib/openclaw.mjs — OpenClaw backup wrapper
 *
 * Delegates to `openclaw backup create` for core state backup.
 * Handles the OpenClaw backup → extract → integrate flow.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, cpSync, rmSync, renameSync, unlinkSync, statSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";

const HOME = process.env.HOME || "";

/**
 * Check if OpenClaw CLI is available
 */
export function isOpenclawAvailable() {
  try {
    execSync("openclaw --version 2>/dev/null", { encoding: "utf-8" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get OpenClaw state directory
 */
export function getStateDir() {
  // Standard locations
  const candidates = [
    process.env.OPENCLAW_STATE_DIR,
    join(process.env.HOME || "", ".openclaw"),
    join(process.env.HOME || "", ".clawdbot"), // Legacy
  ];

  for (const dir of candidates) {
    if (dir && existsSync(dir)) return dir;
  }

  return join(process.env.HOME || "", ".openclaw");
}

/**
 * Get OpenClaw workspace directory
 */
export function getWorkspaceDir() {
  const stateDir = getStateDir();
  
  // Try to read from config
  try {
    const configPath = join(stateDir, "openclaw.json");
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      const workspace = config?.agents?.defaults?.workspace;
      if (workspace && existsSync(workspace)) return workspace;
    }
  } catch { /* use default */ }

  return join(stateDir, "workspace");
}

/**
 * Create OpenClaw backup using native CLI
 *
 * @param {string} outputDir - Directory to write backup archive
 * @param {object} options - { includeWorkspace: true, onlyConfig: false, verify: true }
 * @returns {{ success: boolean, archivePath?: string, bytes?: number, error?: string }}
 */
export function createOpenclawBackup(outputDir, options = {}) {
  const { includeWorkspace = true, onlyConfig = false, verify = true } = options;

  if (!isOpenclawAvailable()) {
    return { success: false, error: "OpenClaw CLI not available" };
  }

  mkdirSync(outputDir, { recursive: true });

  const args = ["backup", "create", "--output", outputDir, "--json"];
  if (!includeWorkspace) args.push("--no-include-workspace");
  if (onlyConfig) args.push("--only-config");
  if (verify) args.push("--verify");

  try {
    const result = execSync(`openclaw ${args.join(" ")} 2>/dev/null`, {
      encoding: "utf-8",
      timeout: 300000, // 5 minutes
    });

    // Parse JSON output
    try {
      const parsed = JSON.parse(result);
      return {
        success: true,
        archivePath: parsed.archivePath || parsed.path,
        bytes: parsed.bytes || parsed.size,
      };
    } catch {
      // Non-JSON output — try to find the archive
      const files = execSync(`ls -t "${outputDir}"/*.tar.gz 2>/dev/null | head -1`, { encoding: "utf-8" }).trim();
      if (files) {
        const stats = statSync(files);
        return { success: true, archivePath: files, bytes: stats.size };
      }
      return { success: true, archivePath: null };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Extract OpenClaw backup into a staging directory
 */
export function extractOpenclawBackup(archivePath, stagingDir) {
  mkdirSync(stagingDir, { recursive: true });

  try {
    execSync(`tar -xzf "${archivePath}" -C "${stagingDir}" 2>/dev/null`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Copy OpenClaw state to staging directory (direct copy, no CLI)
 * Fallback when openclaw CLI is not available (e.g., inside Docker)
 */
export function copyOpenclawState(stagingDir) {
  const stateDir = getStateDir();
  const targetDir = join(stagingDir, "openclaw");
  mkdirSync(targetDir, { recursive: true });

  let files = 0;
  let bytes = 0;

  // Copy state directory
  if (existsSync(stateDir)) {
    try {
      cpSync(stateDir, join(targetDir, "state"), {
        recursive: true,
        filter: (src) => {
          // Exclude large/unnecessary files
          if (src.includes("node_modules")) return false;
          if (src.includes(".git")) return false;
          if (src.endsWith(".log") && statSync(src).size > 10 * 1024 * 1024) return false;
          return true;
        },
      });

      // Count files
      const countResult = execSync(`find "${join(targetDir, "state")}" -type f | wc -l`, { encoding: "utf-8" }).trim();
      files = parseInt(countResult, 10) || 0;
      
      const sizeResult = execSync(`du -sb "${join(targetDir, "state")}" 2>/dev/null | cut -f1`, { encoding: "utf-8" }).trim();
      bytes = parseInt(sizeResult, 10) || 0;
    } catch { /* partial copy is ok */ }
  }

  // Copy config separately for easy access
  const configPath = join(stateDir, "openclaw.json");
  if (existsSync(configPath)) {
    cpSync(configPath, join(targetDir, "openclaw.json"));
  }

  return { files, bytes };
}

/**
 * Restore OpenClaw state from staging directory
 */
export function restoreOpenclawState(stagingDir) {
  const stateDir = getStateDir();
  const sourceDir = join(stagingDir, "openclaw", "state");

  if (!existsSync(sourceDir)) {
    return { success: false, error: "OpenClaw state not found in archive" };
  }

  try {
    cpSync(sourceDir, stateDir, { recursive: true });
    
    // Fix permissions
    execSync(`chmod 700 "${stateDir}" 2>/dev/null || true`);
    execSync(`chmod 600 "${join(stateDir, "openclaw.json")}" 2>/dev/null || true`);

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Restore EverClaw config from a staging directory.
 * 
 * @param {string} stagingDir - Directory containing everclaw/ subdir
 * @returns {{ success: boolean, files?: number, error?: string }}
 */
export function restoreEverclawConfig(stagingDir) {
  const sourceDir = join(stagingDir, "everclaw");
  const targetDir = join(HOME, ".everclaw");

  if (!existsSync(sourceDir)) {
    return { success: false, error: "EverClaw config not found in archive" };
  }

  try {
    // Remove existing
    if (existsSync(targetDir)) {
      rmSync(targetDir, { recursive: true, force: true });
    }
    
    // Copy from staging
    mkdirSync(dirname(targetDir), { recursive: true });
    cpSync(sourceDir, targetDir, { recursive: true });
    
    // Fix permissions
    execSync(`chmod 700 "${targetDir}" 2>/dev/null || true`);

    // Count files
    let files = 0;
    try {
      const count = (function countDir(dir) {
        let n = 0;
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            n += countDir(join(dir, entry.name));
          } else if (entry.isFile()) {
            n++;
          }
        }
        return n;
      })(targetDir);
      files = count;
    } catch { /* ignore */ }

    return { success: true, files };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Run openclaw doctor for verification
 */
export function runDoctor() {
  try {
    const result = execSync("openclaw doctor 2>/dev/null", {
      encoding: "utf-8",
      timeout: 30000,
    });
    return { success: true, output: result };
  } catch (err) {
    return { success: false, output: err.stdout || err.message };
  }
}
