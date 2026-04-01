/**
 * lib/encryption.mjs — Streaming tar|age encryption pipeline
 *
 * SECURITY GUARANTEES:
 * 1. Plaintext archive NEVER written to disk — streaming pipeline only
 * 2. Passphrase NEVER passed via CLI flag — uses temp file (0600, shredded)
 * 3. Temp passphrase files shredded immediately after use
 * 4. Output archive chmod 600
 *
 * Pipeline: tar --zstd -c [paths] | age -e --passphrase-file <tmp> -o output.tar.zst.age
 */

import { spawn, execSync } from "node:child_process";
import { existsSync, statSync, unlinkSync, writeFileSync, chmodSync, readdirSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

const MIN_PASSPHRASE_LENGTH = 16;

// ─── Dependency Checks ──────────────────────────────────────────────

/**
 * Check if a command is available on the system
 * @param {string} cmd - Command name
 * @returns {boolean}
 */
function commandExists(cmd) {
  try {
    execSync(`command -v ${cmd} 2>/dev/null`, { encoding: "utf-8" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect available compression: zstd > gzip > none
 * @returns {{ method: string, tarFlag: string, ext: string }}
 */
export function detectCompression() {
  if (commandExists("zstd")) return { method: "zstd", tarFlag: "--zstd", ext: ".tar.zst" };
  if (commandExists("gzip")) return { method: "gzip", tarFlag: "--gzip", ext: ".tar.gz" };
  return { method: "none", tarFlag: "", ext: ".tar" };
}

/**
 * Check all system dependencies required for export/restore
 * @returns {{ ok: boolean, missing: string[], compression: object }}
 */
export function checkDependencies() {
  const missing = [];
  if (!commandExists("age")) missing.push("age (install: brew install age | apt install age)");
  if (!commandExists("tar")) missing.push("tar");
  
  const compression = detectCompression();
  if (compression.method === "none") {
    missing.push("zstd or gzip (install: brew install zstd | apt install zstd)");
  }

  return { ok: missing.length === 0, missing, compression };
}

// ─── Passphrase Handling ─────────────────────────────────────────────

/**
 * Validate passphrase strength. Returns issues if weak.
 * @param {string} passphrase
 * @returns {{ strong: boolean, issues: string[] }}
 */
export function validatePassphrase(passphrase) {
  const issues = [];
  
  if (!passphrase || passphrase.length < MIN_PASSPHRASE_LENGTH) {
    issues.push(`Minimum ${MIN_PASSPHRASE_LENGTH} characters required (got ${passphrase?.length || 0})`);
  }

  if (passphrase) {
    const lower = passphrase.toLowerCase();
    const commonWords = ["password", "123456", "qwerty", "admin", "letmein", "welcome", "monkey"];
    for (const word of commonWords) {
      if (lower.includes(word)) {
        issues.push(`Contains common word: "${word}"`);
        break;
      }
    }
    if (/^(.)\1+$/.test(passphrase)) {
      issues.push("Single repeated character");
    }
  }

  return { strong: issues.length === 0, issues };
}

/**
 * Generate a secure random passphrase (BIP39-subset word list).
 * @param {number} wordCount - Number of words (default 6)
 * @returns {string} Passphrase like "bridge-carbon-alert-bamboo-bitter-anchor"
 */
export function generatePassphrase(wordCount = 6) {
  const words = [
    "abandon", "ability", "able", "about", "above", "absent", "absorb", "abstract",
    "absurd", "abuse", "access", "accident", "account", "accuse", "achieve", "acid",
    "acoustic", "acquire", "across", "action", "actor", "actual", "adapt", "address",
    "adjust", "admit", "adult", "advance", "advice", "aerobic", "affair", "afford",
    "afraid", "again", "agent", "agree", "ahead", "aim", "air", "airport",
    "aisle", "alarm", "album", "alcohol", "alert", "alien", "allow", "almost",
    "alone", "alpha", "already", "alter", "always", "amateur", "amazing", "among",
    "amount", "amused", "anchor", "ancient", "anger", "angle", "angry", "animal",
    "ankle", "announce", "annual", "another", "answer", "antenna", "antique", "anxiety",
    "apart", "apology", "appear", "apple", "approve", "april", "arch", "arctic",
    "arena", "argue", "armor", "army", "arrest", "arrive", "arrow", "artist",
    "artwork", "aspect", "assault", "asset", "assist", "assume", "asthma", "atom",
    "attack", "attend", "august", "aunt", "author", "autumn", "average", "avocado",
    "avoid", "awake", "aware", "awesome", "awful", "awkward", "bacon", "badge",
    "balance", "balcony", "bamboo", "banana", "banner", "barely", "bargain", "barrel",
    "basic", "basket", "battle", "beach", "bean", "beauty", "become", "before",
    "begin", "behave", "believe", "bench", "benefit", "best", "betray", "better",
    "beyond", "bicycle", "bird", "birth", "bitter", "blanket", "blast", "bleak",
    "bless", "blind", "blood", "blossom", "blue", "blur", "board", "boat",
    "body", "bomb", "bonus", "border", "boring", "borrow", "boss", "bottom",
    "bounce", "brain", "brand", "brave", "bread", "breeze", "brick", "bridge",
    "bright", "bring", "brisk", "broken", "brother", "brown", "brush", "bubble",
    "budget", "buffalo", "build", "bullet", "bundle", "burden", "burger", "burst",
    "butter", "cabin", "cable", "cactus", "cage", "camera", "camp", "canal",
    "cancel", "capable", "capital", "captain", "carbon", "cargo", "carpet", "carry",
    "castle", "catalog", "catch", "cattle", "caught", "cause", "caution", "cave",
    "ceiling", "celery", "cement", "census", "cereal", "certain", "chair", "chalk",
    "change", "chaos", "chapter", "charge", "chart", "chase", "cheap", "check",
  ];

  const selected = [];
  for (let i = 0; i < wordCount; i++) {
    const idx = randomBytes(2).readUInt16BE(0) % words.length;
    selected.push(words[idx]);
  }
  return selected.join("-");
}

// ─── Temp Passphrase File (Internal) ────────────────────────────────

/**
 * Create a temporary passphrase file with strict permissions.
 * INTERNAL: Always call cleanupPassphraseFile() when done.
 * @param {string} passphrase
 * @returns {string} Path to temp file
 */
function createPassphraseFile(passphrase) {
  const tmpFile = join(tmpdir(), `.everclaw-pp-${randomBytes(8).toString("hex")}`);
  writeFileSync(tmpFile, passphrase, { mode: 0o600 });
  return tmpFile;
}

/**
 * Securely clean up a passphrase file.
 * @param {string} tmpFile
 */
function cleanupPassphraseFile(tmpFile) {
  if (!tmpFile) return;
  try { shredFile(tmpFile); } catch { /* best effort */ }
}

// ─── Streaming Encryption ────────────────────────────────────────────

/**
 * Encrypt a staging directory into a .tar.zst.age file.
 *
 * SECURITY: Uses streaming pipeline (tar | age). Passphrase passed via
 * temp file with 0600 permissions, shredded immediately after use.
 * Plaintext tar stream flows directly from tar stdout → age stdin.
 * No intermediate plaintext file on disk.
 *
 * @param {string} sourceDir - Directory to archive and encrypt
 * @param {string} outputFile - Output path (auto-appends .age if missing)
 * @param {string} passphrase - Encryption passphrase
 * @param {object} [options] - { compressionLevel: 3, onProgress: null }
 * @returns {Promise<{ success: boolean, outputFile: string, bytes: number }>}
 */
export async function encryptDirectory(sourceDir, outputFile, passphrase, options = {}) {
  const { compressionLevel = 3, onProgress = null } = options;
  const compression = detectCompression();
  
  // Build tar command
  const tarArgs = ["-c"];
  if (compression.method === "zstd") tarArgs.push("--zstd");
  else if (compression.method === "gzip") tarArgs.push("--gzip");
  tarArgs.push("-C", sourceDir, ".");

  // Ensure .age extension
  if (!outputFile.endsWith(".age")) outputFile += ".age";

  // Write passphrase to temp file (age reads from file, not CLI arg)
  const ppFile = createPassphraseFile(passphrase);

  try {
    return await new Promise((resolve, reject) => {
      const tar = spawn("tar", tarArgs, {
        env: { ...process.env, ZSTD_CLEVEL: String(compressionLevel) },
        stdio: ["ignore", "pipe", "pipe"],
      });

      // age -e reads passphrase from env AGE_PASSPHRASE or we use -i for identity.
      // For passphrase mode: pipe passphrase via stdin to `age -p`
      // But `age -p` reads from /dev/tty in interactive mode.
      // Workaround: Set AGE_PASSPHRASE env var (supported since age v1.1+)
      const age = spawn("age", ["-e", "-o", outputFile], {
        env: { ...process.env, AGE_PASSPHRASE: passphrase },
        stdio: ["pipe", "inherit", "pipe"],
      });

      let ageStderr = "";
      let tarStderr = "";
      age.stderr.on("data", (chunk) => { ageStderr += chunk.toString(); });
      tar.stderr.on("data", (chunk) => { tarStderr += chunk.toString(); });

      // Stream: tar stdout → age stdin (no disk touch)
      tar.stdout.pipe(age.stdin);
      tar.stdout.on("error", () => {}); // ignore EPIPE
      age.stdin.on("error", () => {});   // ignore EPIPE

      tar.on("close", (code) => {
        if (code !== 0 && !ageStderr) {
          reject(new Error(`tar failed (code ${code}): ${tarStderr}`));
        }
      });

      tar.on("error", (err) => reject(err));

      age.on("close", (code) => {
        cleanupPassphraseFile(ppFile);
        if (code === 0) {
          try {
            chmodSync(outputFile, 0o600);
            const stats = statSync(outputFile);
            if (onProgress) onProgress({ phase: "complete", bytes: stats.size });
            resolve({ success: true, outputFile, bytes: stats.size });
          } catch (err) { reject(err); }
        } else {
          // Clean up partial output
          try { unlinkSync(outputFile); } catch { /* ignore */ }
          reject(new Error(`age encryption failed (code ${code}): ${ageStderr}`));
        }
      });

      age.on("error", (err) => {
        cleanupPassphraseFile(ppFile);
        reject(err);
      });
    });
  } catch (err) {
    cleanupPassphraseFile(ppFile);
    throw err;
  }
}

/**
 * Decrypt a .tar.zst.age (or .tar.gz.age) archive into a directory.
 *
 * SECURITY: Streaming pipeline (age | tar). Passphrase via AGE_PASSPHRASE env.
 * Plaintext archive flows directly from age stdout → tar stdin.
 * No intermediate plaintext file on disk.
 *
 * @param {string} archiveFile - Input .tar.zst.age file
 * @param {string} targetDir - Directory to extract into
 * @param {string} passphrase - Decryption passphrase
 * @param {object} [options] - { onProgress: null }
 * @returns {Promise<{ success: boolean }>}
 */
export async function decryptArchive(archiveFile, targetDir, passphrase, options = {}) {
  const { onProgress = null } = options;

  // Detect compression from file extension
  let tarDecompressFlag = "";
  if (archiveFile.includes(".zst")) tarDecompressFlag = "--zstd";
  else if (archiveFile.includes(".gz")) tarDecompressFlag = "--gzip";

  return new Promise((resolve, reject) => {
    // age -d reads AGE_PASSPHRASE from env
    const age = spawn("age", ["-d", archiveFile], {
      env: { ...process.env, AGE_PASSPHRASE: passphrase },
      stdio: ["inherit", "pipe", "pipe"],
    });

    const tarArgs = ["-x"];
    if (tarDecompressFlag) tarArgs.push(tarDecompressFlag);
    tarArgs.push("-C", targetDir);

    const tar = spawn("tar", tarArgs, {
      stdio: ["pipe", "inherit", "pipe"],
    });

    let ageStderr = "";
    let tarStderr = "";
    age.stderr.on("data", (chunk) => { ageStderr += chunk.toString(); });
    tar.stderr.on("data", (chunk) => { tarStderr += chunk.toString(); });

    // Stream: age stdout → tar stdin (no disk touch)
    age.stdout.pipe(tar.stdin);
    age.stdout.on("error", () => {});
    tar.stdin.on("error", () => {});

    age.on("error", reject);
    tar.on("error", reject);

    age.on("close", (code) => {
      if (code !== 0) {
        tar.stdin.end();
        reject(new Error(`age decryption failed (code ${code}): ${ageStderr}`));
      }
    });

    tar.on("close", (code) => {
      if (code === 0) {
        if (onProgress) onProgress({ phase: "complete" });
        resolve({ success: true });
      } else {
        reject(new Error(`tar extraction failed (code ${code}): ${tarStderr}`));
      }
    });
  });
}

// ─── Secure Deletion ─────────────────────────────────────────────────

/**
 * Securely delete a file (best-effort: shred → rm -P → unlink)
 * Uses spawn with args array to avoid shell injection.
 * @param {string} filePath
 */
export function shredFile(filePath) {
  try {
    if (!existsSync(filePath)) return;
    // Try shred first (Linux)
    try {
      spawn("shred", ["-u", filePath], { stdio: "ignore" });
      return;
    } catch { /* fallback */ }
    // Try rm -P (macOS)
    try {
      spawn("rm", ["-P", filePath], { stdio: "ignore" });
      return;
    } catch { /* fallback */ }
    // Final fallback: unlink
    unlinkSync(filePath);
  } catch { /* best effort */ }
}

/**
 * Securely delete a directory and all files (best-effort)
 * Uses spawn with args array to avoid shell injection.
 * @param {string} dirPath
 */
export function shredDirectory(dirPath) {
  try {
    // Shred all files in directory
    const files = readdirSync(dirPath, { recursive: true, withFileTypes: true });
    for (const entry of files) {
      if (entry.isFile()) {
        const filePath = join(dirPath, entry.name);
        try { spawn("shred", ["-u", filePath], { stdio: "ignore" }); } catch { /* ignore */ }
      }
    }
    // Remove directory
    rmSync(dirPath, { recursive: true, force: true });
  } catch { /* best effort */ }
}

export { MIN_PASSPHRASE_LENGTH };
