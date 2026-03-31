/**
 * lib/manifest.mjs — Archive manifest generation and validation
 *
 * Manifest lives INSIDE the encrypted payload (no metadata leak).
 * Records versions, platform info, component checksums, and encryption details.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { execSync } from "node:child_process";
import { platform, arch, hostname } from "node:os";

const MANIFEST_VERSION = "3.0";

/**
 * Detect EverClaw version from package.json or SKILL.md
 */
function detectEverclawVersion() {
  const locations = [
    join(process.env.HOME || "", ".openclaw", "workspace", "skills", "everclaw", "package.json"),
    join(process.env.HOME || "", "everclaw", "package.json"),
    "/app/package.json",
  ];
  for (const loc of locations) {
    try {
      const pkg = JSON.parse(readFileSync(loc, "utf-8"));
      return { version: `v${pkg.version}`, commit: getGitCommit(loc) };
    } catch { /* skip */ }
  }
  return { version: "unknown", commit: "unknown" };
}

/**
 * Detect OpenClaw version
 */
function detectOpenclawVersion() {
  try {
    const out = execSync("openclaw --version 2>/dev/null", { encoding: "utf-8" }).trim();
    // Format: "OpenClaw 2026.3.24 (cff6dc9)" or similar
    const match = out.match(/([\d.]+)\s*\(([a-f0-9]+)\)/);
    if (match) return { version: match[1], commit: match[2] };
    return { version: out.replace(/[^\d.]/g, ""), commit: "unknown" };
  } catch {
    return { version: "unknown", commit: "unknown" };
  }
}

/**
 * Get git short commit hash for a file's repo
 */
function getGitCommit(filePath) {
  try {
    const dir = filePath.includes("/") ? filePath.substring(0, filePath.lastIndexOf("/")) : ".";
    return execSync(`git -C "${dir}" rev-parse --short HEAD 2>/dev/null`, { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

/**
 * Detect if running inside Docker
 */
function detectDocker() {
  try {
    if (process.env.OPENCLAW_CONTAINER) return { docker: true, containerName: process.env.OPENCLAW_CONTAINER };
    if (process.env.EVERCLAW_CONTAINER_NAME) return { docker: true, containerName: process.env.EVERCLAW_CONTAINER_NAME };
    try { readFileSync("/.dockerenv"); return { docker: true, containerName: "unknown" }; } catch { /* not docker */ }
    try {
      const cgroup = readFileSync("/proc/self/cgroup", "utf-8");
      if (cgroup.includes("docker") || cgroup.includes("containerd")) return { docker: true, containerName: "unknown" };
    } catch { /* not linux/docker */ }
    return { docker: false, containerName: null };
  } catch {
    return { docker: false, containerName: null };
  }
}

/**
 * Calculate SHA-256 checksum of a file
 */
export function checksumFile(filePath) {
  const hash = createHash("sha256");
  hash.update(readFileSync(filePath));
  return `sha256:${hash.digest("hex")}`;
}

/**
 * Calculate SHA-256 checksum of a directory (all files concatenated)
 */
export function checksumDirectory(dirPath) {
  const hash = createHash("sha256");
  let fileCount = 0;
  let totalBytes = 0;

  function walkDir(dir) {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (entry.isFile()) {
          const content = readFileSync(fullPath);
          hash.update(relative(dirPath, fullPath));
          hash.update(content);
          fileCount++;
          totalBytes += content.length;
        }
      }
    } catch { /* skip unreadable dirs */ }
  }

  walkDir(dirPath);
  return { checksum: `sha256:${hash.digest("hex")}`, files: fileCount, bytes: totalBytes };
}

/**
 * Generate manifest for a backup
 */
export function generateManifest(components) {
  const dockerInfo = detectDocker();
  const everclaw = detectEverclawVersion();
  const openclaw = detectOpenclawVersion();

  return {
    version: MANIFEST_VERSION,
    created: new Date().toISOString(),
    hostname: hostname(),
    platform: {
      os: platform(),
      arch: arch(),
      docker: dockerInfo.docker,
      ...(dockerInfo.containerName && { containerName: dockerInfo.containerName }),
    },
    everclaw,
    openclaw,
    components,
    encryption: {
      algorithm: "age-encryption.org/v1",
      compression: "zstd",
    },
  };
}

/**
 * Validate a manifest from an archive
 */
export function validateManifest(manifest) {
  const errors = [];

  if (!manifest.version) errors.push("Missing manifest version");
  if (!manifest.created) errors.push("Missing creation timestamp");
  if (!manifest.components) errors.push("Missing components section");

  // Version compatibility check
  const majorVersion = manifest.version ? manifest.version.split(".")[0] : "0";
  if (majorVersion !== MANIFEST_VERSION.split(".")[0]) {
    errors.push(`Major version mismatch: archive=${manifest.version}, expected=${MANIFEST_VERSION}`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Check version compatibility between archive and current system
 */
export function checkVersionCompatibility(manifest) {
  const current = {
    everclaw: detectEverclawVersion(),
    openclaw: detectOpenclawVersion(),
  };

  const warnings = [];
  let compatible = true;

  // EverClaw version check
  if (manifest.everclaw?.version && current.everclaw.version !== "unknown") {
    const archiveVer = manifest.everclaw.version.replace("v", "");
    const currentVer = current.everclaw.version.replace("v", "");
    if (archiveVer !== currentVer) {
      warnings.push(`EverClaw version: archive=${manifest.everclaw.version}, current=${current.everclaw.version}`);
    }
  }

  // OpenClaw version check
  if (manifest.openclaw?.version && current.openclaw.version !== "unknown") {
    if (manifest.openclaw.version !== current.openclaw.version) {
      warnings.push(`OpenClaw version: archive=${manifest.openclaw.version}, current=${current.openclaw.version}`);
    }
  }

  return { compatible, warnings, current };
}

export { MANIFEST_VERSION, detectDocker, detectEverclawVersion, detectOpenclawVersion };
