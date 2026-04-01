/**
 * lib/wallet-crypto.mjs — Shared wallet encryption primitives
 *
 * Used by everclaw-wallet.mjs and bootstrap-client.mjs for:
 * - Argon2id / scrypt key derivation
 * - v2 encrypted file format constants
 * - Passphrase acquisition (env var / file / interactive prompt)
 * - Legacy v1 decryption (for migration)
 */

import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { createDecipheriv, scryptSync } from "node:crypto";

// Argon2id — primary KDF for encrypted file fallback.
// Falls back to scrypt if native addon unavailable (exotic platforms).
let argon2 = null;
try {
  argon2 = await import("argon2");
} catch {
  // argon2 native addon not available — will use scrypt fallback
}

/** v2 encrypted file format version byte */
export const ENC_FORMAT_V2 = 0x02;

/**
 * Derive 32-byte encryption key from passphrase + salt.
 * Argon2id primary (64 MiB, timeCost 4), scrypt fallback (N=131072, r=8, p=1).
 *
 * @param {string} passphrase - User passphrase
 * @param {Buffer} salt - 32-byte random salt
 * @returns {Promise<Buffer>} 32-byte derived key
 */
export async function deriveEncryptionKey(passphrase, salt) {
  if (argon2) {
    try {
      const hash = await argon2.hash(passphrase, {
        type: argon2.argon2id,
        memoryCost: 65536,   // 64 MiB
        timeCost: 4,
        parallelism: 1,
        hashLength: 32,
        salt,
        raw: true,
      });
      return hash;
    } catch (e) {
      console.error("⚠️  Argon2id failed, falling back to scrypt:", e.message);
    }
  }
  // Fallback: scrypt with high cost params (still passphrase-based, still safe)
  return scryptSync(passphrase, salt, 32, { N: 2 ** 17, r: 8, p: 1 });
}

/**
 * Get passphrase from environment variables.
 * Priority: EVERCLAW_WALLET_PASSPHRASE → EVERCLAW_WALLET_PASSPHRASE_FILE
 *
 * @returns {string|null} Passphrase or null if not set
 */
export function getPassphraseFromEnv() {
  if (process.env.EVERCLAW_WALLET_PASSPHRASE) {
    return process.env.EVERCLAW_WALLET_PASSPHRASE;
  }
  if (process.env.EVERCLAW_WALLET_PASSPHRASE_FILE) {
    try {
      return readFileSync(process.env.EVERCLAW_WALLET_PASSPHRASE_FILE, "utf-8").trim();
    } catch (e) {
      console.error(`❌ Cannot read passphrase file: ${e.message}`);
      return null;
    }
  }
  return null;
}

/**
 * Prompt for a single line of input with masked output (for passphrase entry).
 *
 * @param {string} prompt - Prompt text to display on stderr
 * @returns {Promise<string>} User input
 */
export function askLine(prompt) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    rl._writeToOutput = () => {}; // Standard Node.js pattern for masked input
    process.stderr.write(prompt);
    rl.once("line", (answer) => {
      rl.close();
      process.stderr.write("\n");
      resolve(answer);
    });
  });
}

/**
 * Prompt user for wallet passphrase with optional confirmation.
 * Sources: env var → file → interactive prompt (TTY required).
 *
 * @param {boolean} confirm - If true, asks twice and validates match (for first-time setup)
 * @returns {Promise<string|null>} Passphrase or null if unavailable/cancelled
 */
export async function promptPassphrase(confirm = false) {
  // 1. Env var
  const envPass = getPassphraseFromEnv();
  if (envPass) return envPass;

  // 2. Interactive prompt (requires TTY)
  if (!process.stdin.isTTY) {
    console.error("\n❌ Wallet passphrase required but no TTY available.");
    console.error("   Set EVERCLAW_WALLET_PASSPHRASE or EVERCLAW_WALLET_PASSPHRASE_FILE environment variable.");
    console.error("   Docker example: -e EVERCLAW_WALLET_PASSPHRASE=yourStrongPassphrase");
    console.error("   Docker secrets:  -e EVERCLAW_WALLET_PASSPHRASE_FILE=/run/secrets/wallet_pass\n");
    return null;
  }

  const pass = await askLine("🔑 Enter wallet passphrase: ");
  if (!pass || pass.length === 0) {
    console.error("❌ Passphrase cannot be empty.");
    return null;
  }
  if (pass.length < 12) {
    console.error("⚠️  Warning: Passphrase is shorter than 12 characters. A longer passphrase is strongly recommended.");
  }

  if (confirm) {
    const pass2 = await askLine("🔑 Confirm wallet passphrase: ");
    if (pass !== pass2) {
      console.error("❌ Passphrases do not match. Please try again.");
      // Retry once
      const retry = await askLine("🔑 Enter wallet passphrase: ");
      const retry2 = await askLine("🔑 Confirm wallet passphrase: ");
      if (retry !== retry2 || !retry) {
        console.error("❌ Passphrases still do not match. Aborting.");
        return null;
      }
      if (retry.length < 12) {
        console.error("⚠️  Warning: Passphrase is shorter than 12 characters. A longer passphrase is strongly recommended.");
      }
      return retry;
    }
  }

  return pass;
}

/**
 * Decrypt a legacy v1 encrypted wallet file (machine-id based).
 * Used only for one-time migration to v2 format.
 *
 * @param {Buffer} blob - Raw v1 file contents: iv(16) + authTag(16) + ciphertext
 * @param {string} keychainAccount - Keychain account name (for salt derivation)
 * @returns {string|null} Decrypted private key or null on failure
 */
export function decryptLegacyV1(blob, keychainAccount = "everclaw-agent") {
  if (blob.length < 33) return null; // iv(16) + authTag(16) + at least 1 byte
  const iv = blob.subarray(0, 16);
  const authTag = blob.subarray(16, 32);
  const encrypted = blob.subarray(32);

  let machineId = "everclaw-fallback";
  try {
    if (existsSync("/etc/machine-id")) {
      machineId = readFileSync("/etc/machine-id", "utf-8").trim();
    } else if (existsSync("/var/lib/dbus/machine-id")) {
      machineId = readFileSync("/var/lib/dbus/machine-id", "utf-8").trim();
    }
  } catch {}
  const salt = `everclaw-${keychainAccount}-${process.env.USER || "agent"}`;
  const encKey = scryptSync(machineId, salt, 32);

  const decipher = createDecipheriv("aes-256-gcm", encKey, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf-8");
}
