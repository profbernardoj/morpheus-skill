/**
 * lib/keychain.mjs — Cross-platform keychain access for wallet keys
 *
 * Supports:
 * - macOS: Keychain (security command)
 * - Linux: libsecret (secret-tool)
 * - Docker: File-based (WALLET_KEY_FILE env)
 * - Fallback: Encrypted file (~/.everclaw/wallet.enc)
 *
 * Reuses patterns from everclaw-wallet.mjs
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { platform } from "node:os";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const OS = platform();
const KEYCHAIN_SERVICE = process.env.EVERCLAW_KEYCHAIN_SERVICE || "everclaw-wallet-key";
const KEYCHAIN_ACCOUNT = process.env.EVERCLAW_KEYCHAIN_ACCOUNT || "everclaw-agent";
const KEY_STORE_PATH = process.env.EVERCLAW_KEY_STORE || join(process.env.HOME || "", ".everclaw", "wallet.enc");

/**
 * Detect the current user (for chown operations)
 */
export function detectCurrentUser() {
  try {
    return execSync("whoami 2>/dev/null", { encoding: "utf-8" }).trim();
  } catch {
    return process.env.USER || process.env.USERNAME || "node";
  }
}

/**
 * Read wallet private key from platform keychain
 * @returns {{ found: boolean, key?: string, address?: string, source: string }}
 */
export function readWalletKey() {
  // 1. Check Docker file-based storage
  if (process.env.WALLET_KEY_FILE) {
    try {
      const key = readFileSync(process.env.WALLET_KEY_FILE, "utf-8").trim();
      if (key) return { found: true, key, source: "WALLET_KEY_FILE" };
    } catch { /* fall through */ }
  }

  // 2. macOS Keychain
  if (OS === "darwin") {
    try {
      const key = execSync(
        `security find-generic-password -s "${KEYCHAIN_SERVICE}" -a "${KEYCHAIN_ACCOUNT}" -w 2>/dev/null`,
        { encoding: "utf-8" }
      ).trim();
      if (key) return { found: true, key, source: "macOS Keychain" };
    } catch { /* fall through */ }
  }

  // 3. Linux libsecret
  if (OS === "linux") {
    try {
      const key = execSync(
        `secret-tool lookup service "${KEYCHAIN_SERVICE}" account "${KEYCHAIN_ACCOUNT}" 2>/dev/null`,
        { encoding: "utf-8" }
      ).trim();
      if (key) return { found: true, key, source: "libsecret" };
    } catch { /* fall through */ }
  }

  // 4. Encrypted file fallback
  if (existsSync(KEY_STORE_PATH)) {
    return { found: true, key: null, source: "encrypted-file", path: KEY_STORE_PATH };
  }

  return { found: false, source: "none" };
}

/**
 * Write wallet private key to platform keychain
 * @param {string} key - Private key to store
 * @returns {{ success: boolean, source: string }}
 */
export function writeWalletKey(key) {
  // macOS Keychain
  if (OS === "darwin") {
    try {
      // Delete existing first (ignore errors)
      try {
        execSync(
          `security delete-generic-password -s "${KEYCHAIN_SERVICE}" -a "${KEYCHAIN_ACCOUNT}" 2>/dev/null`
        );
      } catch { /* doesn't exist yet */ }

      execSync(
        `security add-generic-password -s "${KEYCHAIN_SERVICE}" -a "${KEYCHAIN_ACCOUNT}" -w "${key}" 2>/dev/null`
      );
      return { success: true, source: "macOS Keychain" };
    } catch (err) {
      return { success: false, source: "macOS Keychain", error: err.message };
    }
  }

  // Linux libsecret
  if (OS === "linux") {
    try {
      execSync(
        `echo -n "${key}" | secret-tool store --label="EverClaw Wallet" service "${KEYCHAIN_SERVICE}" account "${KEYCHAIN_ACCOUNT}" 2>/dev/null`
      );
      return { success: true, source: "libsecret" };
    } catch { /* fall through to file */ }
  }

  // Docker / file-based fallback
  if (process.env.WALLET_KEY_FILE) {
    try {
      writeFileSync(process.env.WALLET_KEY_FILE, key, { mode: 0o600 });
      return { success: true, source: "WALLET_KEY_FILE" };
    } catch (err) {
      return { success: false, source: "WALLET_KEY_FILE", error: err.message };
    }
  }

  // Last resort: encrypted file
  try {
    const dir = join(process.env.HOME || "", ".everclaw");
    mkdirSync(dir, { recursive: true, mode: 0o700 });

    // Encrypt with a machine-derived key (not ideal but better than plaintext)
    const machineId = getMachineId();
    const salt = randomBytes(16);
    const iv = randomBytes(16);
    const derivedKey = scryptSync(machineId, salt, 32);
    const cipher = createCipheriv("aes-256-gcm", derivedKey, iv);
    const encrypted = Buffer.concat([cipher.update(key, "utf-8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const payload = JSON.stringify({
      v: 1,
      salt: salt.toString("hex"),
      iv: iv.toString("hex"),
      authTag: authTag.toString("hex"),
      data: encrypted.toString("hex"),
    });

    writeFileSync(KEY_STORE_PATH, payload, { mode: 0o600 });
    return { success: true, source: "encrypted-file" };
  } catch (err) {
    return { success: false, source: "encrypted-file", error: err.message };
  }
}

/**
 * Get a machine-specific identifier for file-based encryption fallback
 */
function getMachineId() {
  try {
    // macOS
    if (OS === "darwin") {
      return execSync("ioreg -rd1 -c IOPlatformExpertDevice | awk '/IOPlatformUUID/ { print $3 }'", { encoding: "utf-8" }).trim().replace(/"/g, "");
    }
    // Linux
    if (existsSync("/etc/machine-id")) {
      return readFileSync("/etc/machine-id", "utf-8").trim();
    }
    if (existsSync("/var/lib/dbus/machine-id")) {
      return readFileSync("/var/lib/dbus/machine-id", "utf-8").trim();
    }
  } catch { /* fallback */ }
  // Fallback: hostname + user
  return `${process.env.HOME || ""}:${process.env.USER || "unknown"}`;
}

/**
 * Get wallet address from a private key (using viem if available)
 */
export async function getWalletAddress(privateKey) {
  try {
    const { privateKeyToAccount } = await import("viem/accounts");
    const account = privateKeyToAccount(privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`);
    return account.address;
  } catch {
    // Fallback: return truncated key hint
    return `0x${privateKey.substring(0, 4)}...${privateKey.substring(privateKey.length - 4)}`;
  }
}

/**
 * Encrypt a wallet private key with a passphrase for inclusion in backup archives.
 *
 * Uses AES-256-GCM with scrypt-derived key (N=131072, r=8, p=1) for strong
 * passphrase-based encryption. The encrypted payload includes salt, IV, auth tag,
 * and KDF parameters for future compatibility.
 *
 * SECURITY: Wallet key is NEVER written plaintext to disk. Always encrypted.
 *
 * @param {string} key - Wallet private key (hex, with or without 0x prefix)
 * @param {string} passphrase - Encryption passphrase (same as archive passphrase)
 * @returns {string} JSON-encoded encrypted payload for wallet/wallet.enc
 * @example
 * const encrypted = encryptWalletKey("0xabc123...", "my-secure-passphrase");
 * fs.writeFileSync("wallet/wallet.enc", encrypted);
 */
export function encryptWalletKey(key, passphrase) {
  const salt = randomBytes(32);
  const iv = randomBytes(16);
  const derivedKey = scryptSync(passphrase, salt, 32, { N: 2 ** 17, r: 8, p: 1 });
  const cipher = createCipheriv("aes-256-gcm", derivedKey, iv);
  const encrypted = Buffer.concat([cipher.update(key, "utf-8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return JSON.stringify({
    v: 2,
    kdf: "scrypt",
    kdfParams: { N: 131072, r: 8, p: 1 },
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
    data: encrypted.toString("hex"),
  });
}

/**
 * Decrypt a wallet key with a passphrase
 */
export function decryptWalletKey(encryptedPayload, passphrase) {
  const payload = typeof encryptedPayload === "string" ? JSON.parse(encryptedPayload) : encryptedPayload;
  
  const salt = Buffer.from(payload.salt, "hex");
  const iv = Buffer.from(payload.iv, "hex");
  const authTag = Buffer.from(payload.authTag, "hex");
  const data = Buffer.from(payload.data, "hex");

  const kdfParams = payload.kdfParams || { N: 131072, r: 8, p: 1 };
  const derivedKey = scryptSync(passphrase, salt, 32, kdfParams);
  const decipher = createDecipheriv("aes-256-gcm", derivedKey, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf-8");
}

export { KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, KEY_STORE_PATH };
