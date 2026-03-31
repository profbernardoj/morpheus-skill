/**
 * lib/services.mjs — Service stop/start management
 *
 * Handles stopping and starting:
 * - OpenClaw gateway
 * - Morpheus proxy-router
 * - Morpheus proxy
 * - Gateway Guardian
 *
 * Cross-platform: macOS (launchctl) and Linux (systemd/process)
 */

import { execSync } from "node:child_process";
import { platform } from "node:os";
import { existsSync } from "node:fs";
import { join } from "node:path";

const OS = platform();
const HOME = process.env.HOME || "";

/**
 * Service definitions
 */
const SERVICES = [
  {
    name: "OpenClaw Gateway",
    stopCmd: "openclaw gateway stop",
    startCmd: "openclaw gateway start",
    healthCheck: "openclaw health 2>/dev/null",
    plist: null,
    systemd: null,
    processName: null,
  },
  {
    name: "Morpheus Proxy Router",
    stopCmd: null,
    startCmd: null,
    healthCheck: null,
    plist: join(HOME, "Library/LaunchAgents/com.morpheus.router.plist"),
    systemd: "morpheus-router",
    processName: "proxy-router",
  },
  {
    name: "Morpheus Proxy",
    stopCmd: null,
    startCmd: null,
    healthCheck: "curl -sf http://127.0.0.1:8083/health 2>/dev/null",
    plist: join(HOME, "Library/LaunchAgents/com.morpheus.proxy.plist"),
    systemd: "morpheus-proxy",
    processName: "morpheus-proxy",
  },
  {
    name: "Gateway Guardian",
    stopCmd: null,
    startCmd: null,
    healthCheck: null,
    plist: join(HOME, "Library/LaunchAgents/ai.openclaw.guardian.plist"),
    systemd: "openclaw-guardian",
    processName: "gateway-guardian",
  },
];

/**
 * Check if a service is running
 */
function isServiceRunning(service) {
  // Check via process name
  if (service.processName) {
    try {
      execSync(`pgrep -f "${service.processName}" >/dev/null 2>&1`);
      return true;
    } catch { return false; }
  }

  // Check via health endpoint
  if (service.healthCheck) {
    try {
      execSync(service.healthCheck, { timeout: 5000 });
      return true;
    } catch { return false; }
  }

  return false;
}

/**
 * Stop a single service
 */
function stopService(service) {
  // Try explicit stop command first
  if (service.stopCmd) {
    try {
      execSync(service.stopCmd, { timeout: 15000, stdio: "pipe" });
      return { success: true, method: "command" };
    } catch { /* fall through */ }
  }

  // macOS launchctl
  if (OS === "darwin" && service.plist && existsSync(service.plist)) {
    try {
      execSync(`launchctl unload "${service.plist}" 2>/dev/null`, { stdio: "pipe" });
      return { success: true, method: "launchctl" };
    } catch { /* fall through */ }
  }

  // Linux systemd
  if (OS === "linux" && service.systemd) {
    try {
      execSync(`systemctl --user stop ${service.systemd} 2>/dev/null`, { stdio: "pipe" });
      return { success: true, method: "systemd" };
    } catch { /* fall through */ }
  }

  // Kill by process name
  if (service.processName) {
    try {
      execSync(`pkill -f "${service.processName}" 2>/dev/null || true`, { stdio: "pipe" });
      return { success: true, method: "pkill" };
    } catch { /* ignore */ }
  }

  return { success: false, method: "none" };
}

/**
 * Start a single service
 */
function startService(service) {
  // Try explicit start command
  if (service.startCmd) {
    try {
      execSync(service.startCmd, { timeout: 15000, stdio: "pipe" });
      return { success: true, method: "command" };
    } catch { /* fall through */ }
  }

  // macOS launchctl
  if (OS === "darwin" && service.plist && existsSync(service.plist)) {
    try {
      execSync(`launchctl load "${service.plist}" 2>/dev/null`, { stdio: "pipe" });
      return { success: true, method: "launchctl" };
    } catch { /* fall through */ }
  }

  // Linux systemd
  if (OS === "linux" && service.systemd) {
    try {
      execSync(`systemctl --user start ${service.systemd} 2>/dev/null`, { stdio: "pipe" });
      return { success: true, method: "systemd" };
    } catch { /* fall through */ }
  }

  return { success: false, method: "none" };
}

/**
 * Stop all EverClaw services
 * @returns {{ stopped: string[], failed: string[], skipped: string[] }}
 */
export function stopAllServices() {
  const stopped = [];
  const failed = [];
  const skipped = [];

  for (const service of SERVICES) {
    if (!isServiceRunning(service)) {
      skipped.push(service.name);
      continue;
    }

    const result = stopService(service);
    if (result.success) {
      stopped.push(service.name);
    } else {
      failed.push(service.name);
    }
  }

  return { stopped, failed, skipped };
}

/**
 * Start all EverClaw services (in correct order)
 * @returns {{ started: string[], failed: string[], skipped: string[] }}
 */
export function startAllServices() {
  const started = [];
  const failed = [];
  const skipped = [];

  // Start in reverse order (proxy first, then gateway)
  const reverseServices = [...SERVICES].reverse();

  for (const service of reverseServices) {
    if (isServiceRunning(service)) {
      skipped.push(service.name);
      continue;
    }

    const result = startService(service);
    if (result.success) {
      started.push(service.name);
    } else {
      failed.push(service.name);
    }
  }

  return { started, failed, skipped };
}

/**
 * Get status of all services
 */
export function getServiceStatus() {
  return SERVICES.map(service => ({
    name: service.name,
    running: isServiceRunning(service),
  }));
}

export { SERVICES };
