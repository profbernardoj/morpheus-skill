import express from "express";
import Database from "better-sqlite3";
import { randomBytes } from "crypto";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import helmet from "helmet";
import cors from "cors";

// --- Config ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PORT = process.env.EVERCLAW_API_PORT || 3000;
const DB_PATH = process.env.EVERCLAW_DB_PATH || join(__dirname, "data", "keys.db");
const SECRET = process.env.EVERCLAW_ADMIN_SECRET;

// --- Input validation ---
const MAX_FINGERPRINT_LENGTH = 128;
const FINGERPRINT_PATTERN = /^[a-zA-Z0-9._:@-]+$/;
const MAX_VERSION_LENGTH = 32;

// --- IP rate limiting ---
const KEY_REQUEST_WINDOW_MS = 60 * 1000; // 1 minute
const KEY_REQUEST_MAX_PER_WINDOW = 10;
const ipRequestCounts = new Map();

function checkIpRateLimit(ip) {
  const now = Date.now();
  const entry = ipRequestCounts.get(ip);
  if (!entry || now - entry.windowStart > KEY_REQUEST_WINDOW_MS) {
    ipRequestCounts.set(ip, { windowStart: now, count: 1 });
    return true;
  }
  entry.count++;
  return entry.count <= KEY_REQUEST_MAX_PER_WINDOW;
}

// Clean up stale IP entries every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - KEY_REQUEST_WINDOW_MS * 2;
  for (const [ip, entry] of ipRequestCounts) {
    if (entry.windowStart < cutoff) ipRequestCounts.delete(ip);
  }
}, 5 * 60 * 1000).unref();

// --- Database ---
const db = new Database(DB_PATH);
db.exec(`CREATE TABLE IF NOT EXISTS keys (
  id INTEGER PRIMARY KEY,
  api_key TEXT UNIQUE,
  device_fingerprint TEXT UNIQUE,
  everclaw_version TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  last_renewed_at DATETIME,
  request_count_today INTEGER DEFAULT 0,
  request_count_total INTEGER DEFAULT 0,
  last_request_at DATETIME,
  last_reset_at DATETIME,
  rate_limit_daily INTEGER DEFAULT 1000,
  is_revoked BOOLEAN DEFAULT 0,
  revoke_reason TEXT
)`);

// --- App ---
const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "16kb" }));
app.set("trust proxy", 1);

// --- Helpers ---
const genKey = () => "evcl_" + randomBytes(16).toString("hex");
const exp = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

// --- Routes ---

// Health check
app.get("/health", (req, res) => res.json({ status: "ok" }));

// Request or renew an API key
app.post("/api/keys/request", (req, res) => {
  // Rate limit by IP
  const clientIp = req.ip || req.socket.remoteAddress;
  if (!checkIpRateLimit(clientIp)) {
    return res.status(429).json({
      error: "too many requests",
      retry_after_seconds: Math.ceil(KEY_REQUEST_WINDOW_MS / 1000),
    });
  }

  const { device_fingerprint: f, everclaw_version: v } = req.body;

  // Validate fingerprint
  if (!f) {
    return res.status(400).json({ error: "missing fingerprint" });
  }
  if (typeof f !== "string") {
    return res.status(400).json({ error: "fingerprint must be a string" });
  }
  if (f.length > MAX_FINGERPRINT_LENGTH) {
    return res.status(400).json({ error: `fingerprint too long (max ${MAX_FINGERPRINT_LENGTH} chars)` });
  }
  if (!FINGERPRINT_PATTERN.test(f)) {
    return res.status(400).json({ error: "fingerprint contains invalid characters (allowed: a-z, A-Z, 0-9, . _ : @ -)" });
  }

  // Validate version (optional)
  if (v != null && (typeof v !== "string" || v.length > MAX_VERSION_LENGTH)) {
    return res.status(400).json({ error: "invalid everclaw_version" });
  }

  // Check for existing key by device fingerprint
  let k = db.prepare("SELECT * FROM keys WHERE device_fingerprint = ?").get(f);

  if (k) {
    if (k.is_revoked) {
      return res.status(403).json({ error: "revoked" });
    }

    // Auto-renew if expired
    if (new Date(k.expires_at) < new Date()) {
      db.prepare("UPDATE keys SET expires_at = ?, last_renewed_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(exp(), k.id);
      k = db.prepare("SELECT * FROM keys WHERE id = ?").get(k.id);
    }

    return res.json({
      api_key: k.api_key,
      expires_at: k.expires_at,
      rate_limit: {
        daily: k.rate_limit_daily,
        remaining: k.rate_limit_daily - k.request_count_today,
      },
    });
  }

  // New device — issue key
  const key = genKey();
  db.prepare("INSERT INTO keys (api_key, device_fingerprint, everclaw_version, expires_at) VALUES (?, ?, ?, ?)")
    .run(key, f, v || null, exp());

  console.log("[ISSUE]", key.substring(0, 12));

  res.status(201).json({
    api_key: key,
    expires_at: exp(),
    rate_limit: { daily: 1000, remaining: 1000 },
  });
});

// Admin stats (requires EVERCLAW_ADMIN_SECRET)
app.get("/api/stats", (req, res) => {
  if (!SECRET || req.headers["x-admin-secret"] !== SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const stats = db.prepare(
    "SELECT COUNT(*) as total, SUM(CASE WHEN is_revoked = 0 THEN 1 ELSE 0 END) as active FROM keys"
  ).get();

  res.json(stats);
});

// --- Start ---
app.listen(PORT, () => console.log(`EverClaw Key API on port ${PORT}`));
