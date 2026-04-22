/**
 * lib/detect-bins.mjs — Auto-detect binary paths for exec-approvals
 *
 * Used by setup.mjs and security-tier.mjs to resolve binary names
 * to full paths at install time. Never hardcodes paths — always
 * detects the actual system layout.
 *
 * Detection order:
 * 1. `which <bin>` (respects user's PATH)
 * 2. Manual scan of SEARCH_PATHS (covers missing PATH entries)
 * 3. Skip + warn if not found (don't crash)
 */

import { execSync } from "node:child_process";
import { existsSync, accessSync, constants } from "node:fs";
import { join } from "node:path";
import { platform } from "node:os";

const HOME = process.env.HOME || "";

/**
 * Extended search paths — covers Homebrew (both Intel & ARM), nix, asdf, pyenv, pipx.
 * Order matters: earlier paths take priority.
 */
const SEARCH_PATHS = [
  "/opt/homebrew/bin",                          // macOS Homebrew (Apple Silicon)
  "/usr/local/bin",                             // macOS Intel Homebrew, Linux user installs
  "/usr/bin",                                   // System binaries
  "/bin",                                       // Essential binaries
  "/usr/sbin",                                  // System admin binaries
  "/sbin",                                      // Essential system binaries
  "/run/current-system/sw/bin",                 // NixOS
  "/nix/var/nix/profiles/default/bin",          // Nix (user profile)
  join(HOME, ".nix-profile", "bin"),            // Nix (home-manager)
  join(HOME, ".asdf", "shims"),                 // asdf
  join(HOME, ".pyenv", "shims"),                // pyenv
  join(HOME, ".local", "bin"),                  // pipx, user installs
  join(HOME, ".cargo", "bin"),                  // Rust/cargo
  "/snap/bin",                                  // Snap packages (Ubuntu)
];

/**
 * Resolve a single binary name to its absolute path.
 *
 * @param {string} name - Binary name (e.g. "git", "node")
 * @returns {{ path: string|null, source: string }}
 */
export function resolveBin(name) {
  // 1. Try `which` first — respects user's PATH and aliases
  try {
    const result = execSync(`which "${name}" 2>/dev/null`, {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    if (result && existsSync(result)) {
      return { path: result, source: "which" };
    }
  } catch {
    // `which` failed — fall through to manual search
  }

  // 2. Manual scan of known directories
  for (const dir of SEARCH_PATHS) {
    const candidate = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return { path: candidate, source: "scan" };
    } catch {
      // Not found or not executable in this dir
    }
  }

  // 3. Not found
  return { path: null, source: "missing" };
}

/**
 * Resolve a list of binary names to their absolute paths.
 *
 * @param {string[]} names - Binary names to resolve
 * @param {object} [options]
 * @param {boolean} [options.verbose=false] - Log each resolution
 * @returns {{ found: Array<{name: string, path: string, source: string}>, missing: string[], warnings: string[] }}
 */
export function resolveBins(names, options = {}) {
  const { verbose = false } = options;
  const found = [];
  const missing = [];
  const warnings = [];

  for (const name of names) {
    const result = resolveBin(name);
    if (result.path) {
      found.push({ name, path: result.path, source: result.source });
      if (verbose) {
        console.log(`  ✅ ${name} → ${result.path} (${result.source})`);
      }
    } else {
      missing.push(name);
      warnings.push(`Binary not found: ${name} — skipped (install it later and re-run security setup)`);
      if (verbose) {
        console.log(`  ⚠️  ${name} → not found (skipped)`);
      }
    }
  }

  return { found, missing, warnings };
}

/**
 * Get platform-specific binary list.
 *
 * @param {string[]} common - Cross-platform bins
 * @param {string[]} macBins - macOS-only bins
 * @param {string[]} linuxBins - Linux-only bins
 * @returns {string[]}
 */
export function getPlatformBins(common, macBins, linuxBins) {
  const os = platform();
  const bins = [...common];
  if (os === "darwin") {
    bins.push(...macBins);
  } else if (os === "linux") {
    bins.push(...linuxBins);
  }
  return bins;
}

/**
 * Check if a binary is in the blocked list.
 *
 * @param {string} name - Binary name
 * @param {string[]} blocked - Blocked binary names
 * @returns {boolean}
 */
export function isBlocked(name, blocked) {
  return blocked.includes(name);
}
