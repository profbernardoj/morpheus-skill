/**
 * lib/docker.mjs — Docker container detection and volume handling
 *
 * Auto-detects EverClaw containers via:
 * 1. --container-name flag
 * 2. EVERCLAW_CONTAINER_NAME env var
 * 3. Docker label: com.everclaw.instance=true
 * 4. /proc/self/cgroup parsing (inside container)
 * 5. /.dockerenv file
 *
 * Does NOT hardcode container names or paths.
 * Detects current user dynamically for chown operations.
 */

import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { detectCurrentUser } from "./keychain.mjs";

/**
 * Validate Docker container name
 * Docker names must match [a-zA-Z0-9][a-zA-Z0-9_.-]* and max 63 chars
 * @param {string} name
 * @returns {boolean}
 */
export function isValidContainerName(name) {
  if (!name || typeof name !== "string") return false;
  if (name.length > 63) return false;
  return /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name);
}

/**
 * Detect if running inside a Docker container
 */
export function isInsideContainer() {
  // Check /.dockerenv
  if (existsSync("/.dockerenv")) return true;
  
  // Check /proc/self/cgroup
  try {
    const cgroup = readFileSync("/proc/self/cgroup", "utf-8");
    if (cgroup.includes("docker") || cgroup.includes("containerd") || cgroup.includes("lxc")) return true;
  } catch { /* not linux */ }

  // Check container env vars
  if (process.env.container === "docker" || process.env.OPENCLAW_CONTAINER) return true;

  return false;
}

/**
 * Detect EverClaw container name (from host)
 * @param {string|null} overrideName - Explicit container name override
 * @returns {{ found: boolean, name?: string, method?: string }}
 */
export function detectContainerName(overrideName = null) {
  // 1. Explicit override
  if (overrideName) {
    return { found: true, name: overrideName, method: "override" };
  }

  // 2. Env var
  if (process.env.EVERCLAW_CONTAINER_NAME) {
    return { found: true, name: process.env.EVERCLAW_CONTAINER_NAME, method: "env" };
  }

  // 3. Docker label
  try {
    const result = execSync(
      'docker ps --filter "label=com.everclaw.instance=true" --format "{{.Names}}" 2>/dev/null',
      { encoding: "utf-8" }
    ).trim();
    if (result) {
      const names = result.split("\n").filter(Boolean);
      if (names.length === 1) return { found: true, name: names[0], method: "label" };
      if (names.length > 1) return { found: true, name: names[0], method: "label", multiple: names };
    }
  } catch { /* docker not available or no matching containers */ }

  // 4. Look for containers with "everclaw" in the name
  try {
    const result = execSync(
      'docker ps --format "{{.Names}}" 2>/dev/null',
      { encoding: "utf-8" }
    ).trim();
    if (result) {
      const names = result.split("\n").filter(n => n.toLowerCase().includes("everclaw"));
      if (names.length === 1) return { found: true, name: names[0], method: "name-match" };
      if (names.length > 1) return { found: true, name: names[0], method: "name-match", multiple: names };
    }
  } catch { /* docker not available */ }

  return { found: false };
}

/**
 * Detect the home directory inside a container
 * Uses spawn with args array to avoid shell injection.
 */
export function detectContainerHome(containerName) {
  if (!isValidContainerName(containerName)) {
    return "/home/node";
  }
  try {
    const result = spawnSync("docker", ["exec", containerName, "sh", "-c", "echo $HOME"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    const home = result.stdout?.trim();
    return home || "/home/node";
  } catch {
    return "/home/node"; // EverClaw Docker default
  }
}

/**
 * Detect the running user inside a Docker container (for chown operations).
 * Uses spawn with args array to avoid shell injection.
 */
export function detectContainerUser(containerName) {
  if (!isValidContainerName(containerName)) {
    return "node";
  }
  try {
    const result = spawnSync("docker", ["exec", containerName, "whoami"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    const user = result.stdout?.trim();
    return user || "node";
  } catch {
    return "node";
  }
}

/**
 * Get Docker volume mount paths for an EverClaw container
 * Uses spawn with args array to avoid shell injection.
 */
export function getContainerVolumes(containerName) {
  if (!isValidContainerName(containerName)) {
    return [];
  }
  try {
    const result = spawnSync("docker", ["inspect", "--format", "{{json .Mounts}}", containerName], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    const raw = result.stdout?.trim();
    if (!raw) return [];
    const mounts = JSON.parse(raw);
    return mounts.filter(m => 
      m.Destination.includes(".openclaw") ||
      m.Destination.includes(".morpheus") ||
      m.Destination.includes(".everclaw") ||
      m.Destination.includes("everclaw")
    );
  } catch {
    return [];
  }
}

/**
 * Estimate size of Docker volumes
 * Uses spawn with args array to avoid shell injection.
 * @returns {{ totalBytes: number, volumes: { path: string, bytes: number }[] }}
 */
export function estimateVolumeSize(containerName) {
  if (!isValidContainerName(containerName)) {
    return { totalBytes: 0, volumes: [] };
  }
  const home = detectContainerHome(containerName);
  const paths = [
    `${home}/.openclaw`,
    `${home}/.morpheus`,
    `${home}/.everclaw`,
  ];

  try {
    const result = spawnSync("docker", ["exec", containerName, "sh", "-c", `du -sb ${paths.join(" ")} 2>/dev/null || true`], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    const output = result.stdout?.trim() || "";

    let totalBytes = 0;
    const volumes = [];
    for (const line of output.split("\n").filter(Boolean)) {
      const [size, path] = line.split("\t");
      const bytes = parseInt(size, 10);
      if (!isNaN(bytes)) {
        totalBytes += bytes;
        volumes.push({ path, bytes });
      }
    }
    return { totalBytes, volumes };
  } catch {
    return { totalBytes: 0, volumes: [] };
  }
}

/**
 * Export Docker volumes to a tar.zst file
 *
 * @param {string} containerName - Docker container name
 * @param {string} outputPath - Output tar.zst file path
 * @param {object} options - { compression: "zstd", verbose: false }
 * @returns {Promise<{ success: boolean, bytes: number }>}
 */
export function exportVolumes(containerName, outputPath, options = {}) {
  const { compression = "zstd" } = options;
  const home = detectContainerHome(containerName);
  const user = detectContainerUser(containerName);

  const compressFlag = compression === "zstd" ? "--zstd" : (compression === "gzip" ? "--gzip" : "");
  const paths = ".openclaw .morpheus .everclaw";

  if (isInsideContainer()) {
    // Inside container: direct tar
    try {
      execSync(
        `tar ${compressFlag} -cf "${outputPath}" -C "${home}" ${paths} 2>/dev/null`,
        { stdio: "pipe" }
      );
      const stats = statSync(outputPath);
      return { success: true, bytes: stats.size };
    } catch (err) {
      return { success: false, error: err.message };
    }
  } else {
    // From host: use helper container
    const helperImage = "ubuntu:24.04";
    const outputDir = outputPath.substring(0, outputPath.lastIndexOf("/")) || ".";
    const outputFile = outputPath.substring(outputPath.lastIndexOf("/") + 1);

    try {
      execSync(
        `docker run --rm ` +
        `--volumes-from "${containerName}" ` +
        `-v "${outputDir}:/backup" ` +
        `${helperImage} ` +
        `tar ${compressFlag} -cf "/backup/${outputFile}" -C "${home}" ${paths}`,
        { stdio: "pipe" }
      );
      const stats = statSync(outputPath);
      return { success: true, bytes: stats.size };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

/**
 * Restore Docker volumes from a tar.zst file
 */
export function restoreVolumes(containerName, archivePath, options = {}) {
  const home = detectContainerHome(containerName);
  const user = detectContainerUser(containerName);

  // Detect compression from extension
  let decompressFlag = "";
  if (archivePath.includes(".zst")) decompressFlag = "--zstd";
  else if (archivePath.includes(".gz")) decompressFlag = "--gzip";

  if (isInsideContainer()) {
    try {
      execSync(`tar ${decompressFlag} -xf "${archivePath}" -C "${home}"`, { stdio: "pipe" });
      execSync(`chown -R ${user}:${user} "${home}/.openclaw" "${home}/.morpheus" 2>/dev/null || true`);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  } else {
    const helperImage = "ubuntu:24.04";
    const archiveDir = archivePath.substring(0, archivePath.lastIndexOf("/")) || ".";
    const archiveFile = archivePath.substring(archivePath.lastIndexOf("/") + 1);

    try {
      execSync(
        `docker run --rm ` +
        `--volumes-from "${containerName}" ` +
        `-v "${archiveDir}:/backup" ` +
        `${helperImage} ` +
        `sh -c 'tar ${decompressFlag} -xf "/backup/${archiveFile}" -C "${home}" && chown -R ${user}:${user} "${home}/.openclaw" "${home}/.morpheus" "${home}/.everclaw" 2>/dev/null || true'`,
        { stdio: "pipe" }
      );
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

// detectContainerHome and detectContainerUser already exported above
