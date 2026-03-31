/**
 * lib/morpheus.mjs — Morpheus proxy state collection
 *
 * Collects Morpheus-specific state for backup:
 * - Config files (.env, router.conf, models-config.json)
 * - Session data (sessions.json, .cookie)
 * - Data directory (badger storage)
 *
 * Excludes:
 * - Binary files (proxy-router — reinstall from repo)
 * - Log files older than 7 days
 * - Temporary files
 */

import { existsSync, readdirSync, statSync, cpSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join, basename, dirname } from "node:path";

const HOME = process.env.HOME || "";

/**
 * Known Morpheus paths
 */
const MORPHEUS_PATHS = {
  primary: join(HOME, "morpheus"),
  alt: join(HOME, ".morpheus"),
};

/**
 * Files to always include (if they exist)
 */
const INCLUDE_FILES = [
  ".env",
  ".cookie",
  "sessions.json",
  "models-config.json",
  "router.conf",
  "proxy.conf",
];

/**
 * Directories to include
 */
const INCLUDE_DIRS = [
  "data",      // Session storage (badger)
  "config",    // Config files
  "proxy",     // Proxy config
];

/**
 * Patterns to exclude
 */
const EXCLUDE_PATTERNS = [
  /^proxy-router$/,     // Binary — reinstall
  /\.log$/,             // Log files (filtered by age below)
  /\.tmp$/,             // Temp files
  /\.bak$/,             // Backup files
  /node_modules/,       // Dependencies
  /\.pid$/,             // PID files
];

/**
 * Detect Morpheus installation paths
 */
export function detectMorpheusPaths() {
  const found = [];
  for (const [label, path] of Object.entries(MORPHEUS_PATHS)) {
    if (existsSync(path)) {
      found.push({ label, path });
    }
  }
  return found;
}

/**
 * Collect Morpheus state files into a staging directory
 *
 * @param {string} stagingDir - Directory to copy files into
 * @returns {{ files: number, bytes: number, paths: string[] }}
 */
export function collectMorpheusState(stagingDir) {
  const morpheusPaths = detectMorpheusPaths();
  let totalFiles = 0;
  let totalBytes = 0;
  const collectedPaths = [];

  for (const { label, path: morpheusPath } of morpheusPaths) {
    const targetDir = join(stagingDir, label === "primary" ? "morpheus" : ".morpheus");
    mkdirSync(targetDir, { recursive: true });

    // Copy individual files
    for (const file of INCLUDE_FILES) {
      const src = join(morpheusPath, file);
      if (existsSync(src)) {
        try {
          const stat = statSync(src);
          cpSync(src, join(targetDir, file));
          totalFiles++;
          totalBytes += stat.size;
          collectedPaths.push(join(label, file));
        } catch { /* skip unreadable files */ }
      }
    }

    // Copy directories (with filtering)
    for (const dir of INCLUDE_DIRS) {
      const srcDir = join(morpheusPath, dir);
      if (existsSync(srcDir) && statSync(srcDir).isDirectory()) {
        try {
          const result = copyFilteredDirectory(srcDir, join(targetDir, dir));
          totalFiles += result.files;
          totalBytes += result.bytes;
          collectedPaths.push(join(label, dir));
        } catch { /* skip */ }
      }
    }

    // Copy recent log files (< 7 days old)
    const logsDir = join(morpheusPath, "data", "logs");
    if (existsSync(logsDir)) {
      const targetLogsDir = join(targetDir, "data", "logs");
      mkdirSync(targetLogsDir, { recursive: true });
      const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

      try {
        for (const file of readdirSync(logsDir)) {
          const src = join(logsDir, file);
          const stat = statSync(src);
          if (stat.isFile() && stat.mtimeMs > sevenDaysAgo) {
            cpSync(src, join(targetLogsDir, file));
            totalFiles++;
            totalBytes += stat.size;
          }
        }
      } catch { /* skip */ }
    }
  }

  return { files: totalFiles, bytes: totalBytes, paths: collectedPaths };
}

/**
 * Copy a directory with filtering (exclude binaries, old logs, temp files)
 */
function copyFilteredDirectory(srcDir, destDir) {
  mkdirSync(destDir, { recursive: true });
  let files = 0;
  let bytes = 0;

  try {
    for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
      const srcPath = join(srcDir, entry.name);
      const destPath = join(destDir, entry.name);

      // Check exclusions
      if (EXCLUDE_PATTERNS.some(pattern => pattern.test(entry.name))) continue;

      if (entry.isDirectory()) {
        const sub = copyFilteredDirectory(srcPath, destPath);
        files += sub.files;
        bytes += sub.bytes;
      } else if (entry.isFile()) {
        try {
          const stat = statSync(srcPath);
          // Skip files > 100MB (likely binaries)
          if (stat.size > 100 * 1024 * 1024) continue;
          cpSync(srcPath, destPath);
          files++;
          bytes += stat.size;
        } catch { /* skip unreadable */ }
      }
    }
  } catch { /* skip unreadable dir */ }

  return { files, bytes };
}

/**
 * Estimate Morpheus state size (for dry-run)
 */
export function estimateMorpheusSize() {
  let totalBytes = 0;
  let totalFiles = 0;

  for (const { path: morpheusPath } of detectMorpheusPaths()) {
    for (const file of INCLUDE_FILES) {
      try {
        const stat = statSync(join(morpheusPath, file));
        totalBytes += stat.size;
        totalFiles++;
      } catch { /* skip */ }
    }
    for (const dir of INCLUDE_DIRS) {
      try {
        const dirPath = join(morpheusPath, dir);
        if (existsSync(dirPath)) {
          const result = dirSize(dirPath);
          totalBytes += result.bytes;
          totalFiles += result.files;
        }
      } catch { /* skip */ }
    }
  }

  return { totalBytes, totalFiles };
}

/**
 * Get directory size recursively
 */
function dirSize(dirPath) {
  let bytes = 0;
  let files = 0;
  try {
    for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        const sub = dirSize(fullPath);
        bytes += sub.bytes;
        files += sub.files;
      } else if (entry.isFile()) {
        bytes += statSync(fullPath).size;
        files++;
      }
    }
  } catch { /* skip */ }
  return { bytes, files };
}

/**
 * Restore Morpheus state from a staging directory to home directory.
 * Handles both morpheus/ and .morpheus/ subdirectories.
 *
 * @param {string} stagingDir - Directory containing morpheus/ or .morpheus/ subdirs
 * @returns {{ restored: string[], files: number, bytes: number, error?: string }}
 */
export function restoreMorpheusState(stagingDir) {
  const restored = [];
  let totalFiles = 0;
  let totalBytes = 0;

  // Restore morpheus/ (primary location)
  const morpheusPrimary = join(stagingDir, "morpheus");
  if (existsSync(morpheusPrimary)) {
    const targetDir = MORPHEUS_PATHS.primary;
    try {
      // Remove existing
      if (existsSync(targetDir)) {
        rmSync(targetDir, { recursive: true, force: true });
      }
      mkdirSync(dirname(targetDir), { recursive: true });
      cpSync(morpheusPrimary, targetDir, { recursive: true });
      
      // Count files
      const count = countDirectory(targetDir);
      totalFiles += count.files;
      totalBytes += count.bytes;
      restored.push("morpheus");
    } catch (err) {
      return { restored, files: totalFiles, bytes: totalBytes, error: `Failed to restore morpheus: ${err.message}` };
    }
  }

  // Restore .morpheus/ (alternate location)
  const morpheusAlt = join(stagingDir, ".morpheus");
  if (existsSync(morpheusAlt)) {
    const targetDir = MORPHEUS_PATHS.alt;
    try {
      // Remove existing
      if (existsSync(targetDir)) {
        rmSync(targetDir, { recursive: true, force: true });
      }
      mkdirSync(dirname(targetDir), { recursive: true });
      cpSync(morpheusAlt, targetDir, { recursive: true });
      
      // Count files
      const count = countDirectory(targetDir);
      totalFiles += count.files;
      totalBytes += count.bytes;
      restored.push(".morpheus");
    } catch (err) {
      return { restored, files: totalFiles, bytes: totalBytes, error: `Failed to restore .morpheus: ${err.message}` };
    }
  }

  return { restored, files: totalFiles, bytes: totalBytes };
}

/**
 * Count files and bytes in a directory recursively
 */
function countDirectory(dirPath) {
  let files = 0;
  let bytes = 0;
  try {
    for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        const sub = countDirectory(fullPath);
        files += sub.files;
        bytes += sub.bytes;
      } else if (entry.isFile()) {
        try {
          bytes += statSync(fullPath).size;
          files++;
        } catch { /* skip */ }
      }
    }
  } catch { /* skip */ }
  return { files, bytes };
}

/**
 * Get Morpheus configuration from .env or config files
 * @returns {{ found: boolean, config?: object, error?: string }}
 */
export function getMorpheusConfig() {
  const morpheusPaths = detectMorpheusPaths();
  
  if (morpheusPaths.length === 0) {
    return { found: false, error: "Morpheus directory not found" };
  }
  
  const morpheusPath = morpheusPaths[0].path;
  const config = {};
  
  // Try .env file
  const envPath = join(morpheusPath, ".env");
  if (existsSync(envPath)) {
    try {
      const envContent = readFileSync(envPath, "utf-8");
      for (const line of envContent.split("\n")) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          const [key, ...valueParts] = trimmed.split("=");
          if (key && valueParts.length > 0) {
            config[key.trim()] = valueParts.join("=").trim().replace(/^["']|["']$/g, "");
          }
        }
      }
    } catch { /* skip */ }
  }
  
  // Try models-config.json
  const modelsConfigPath = join(morpheusPath, "models-config.json");
  if (existsSync(modelsConfigPath)) {
    try {
      const modelsConfig = JSON.parse(readFileSync(modelsConfigPath, "utf-8"));
      config.modelsConfig = modelsConfig;
    } catch { /* skip */ }
  }
  
  return { found: true, config };
}

/**
 * Get current Morpheus session info
 * @returns {{ found: boolean, session?: object, error?: string }}
 */
export function getMorpheusSession() {
  const morpheusPaths = detectMorpheusPaths();
  
  if (morpheusPaths.length === 0) {
    return { found: false, error: "Morpheus directory not found" };
  }
  
  const morpheusPath = morpheusPaths[0].path;
  const session = {};
  
  // Try sessions.json
  const sessionsPath = join(morpheusPath, "sessions.json");
  if (existsSync(sessionsPath)) {
    try {
      const sessions = JSON.parse(readFileSync(sessionsPath, "utf-8"));
      if (Array.isArray(sessions) && sessions.length > 0) {
        // Get the most recent active session
        const activeSession = sessions.find(s => s.active) || sessions[0];
        session.id = activeSession.id || activeSession.sessionId;
        session.address = activeSession.address;
        session.createdAt = activeSession.createdAt || activeSession.created;
      }
    } catch { /* skip */ }
  }
  
  // Check for .cookie file
  const cookiePath = join(morpheusPath, ".cookie");
  if (existsSync(cookiePath)) {
    try {
      session.cookie = readFileSync(cookiePath, "utf-8").trim();
    } catch { /* skip */ }
  }
  
  return { 
    found: Object.keys(session).length > 0, 
    session: Object.keys(session).length > 0 ? session : undefined 
  };
}

/**
 * Check Morpheus health via API endpoint
 * @returns {{ healthy: boolean, address?: string, balance?: number, error?: string }}
 */
export async function checkMorpheusHealth() {
  const morpheusUrl = process.env.MORPHEUS_API_URL || "http://127.0.0.1:8085";
  
  try {
    // Try health endpoint first
    const healthUrl = `${morpheusUrl}/health`;
    const healthResponse = await fetch(healthUrl, { 
      method: "GET",
      signal: AbortSignal.timeout(5000)
    }).catch(() => null);
    
    if (healthResponse?.ok) {
      const health = await healthResponse.json().catch(() => ({}));
      return {
        healthy: true,
        address: health.address,
        balance: health.balance,
      };
    }
    
    // Try v1/models as fallback
    const modelsUrl = `${morpheusUrl}/v1/models`;
    const modelsResponse = await fetch(modelsUrl, { 
      method: "GET",
      signal: AbortSignal.timeout(5000)
    }).catch(() => null);
    
    if (modelsResponse?.ok) {
      // Morpheus is responding
      const result = { healthy: true };
      
      // Try to get session info from local files
      const sessionInfo = getMorpheusSession();
      if (sessionInfo.found && sessionInfo.session?.address) {
        result.address = sessionInfo.session.address;
      }
      
      return result;
    }
    
    return { 
      healthy: false, 
      error: "Morpheus API not responding" 
    };
  } catch (err) {
    return { 
      healthy: false, 
      error: err.message || "Failed to connect to Morpheus" 
    };
  }
}

export { MORPHEUS_PATHS, INCLUDE_FILES };
