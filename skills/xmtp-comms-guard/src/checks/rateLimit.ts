import { PolicyViolationError } from "../types.js";

const RATE_LIMITS = new Map<string, { count: number; windowStart: number }>();
const MAX_MSG_PER_MIN = 10;
const MAX_SIZE_BYTES = 64 * 1024;

export const rateLimit = async (peerAddress: string, messageSize: number) => {
  if (messageSize > MAX_SIZE_BYTES) {
    throw new PolicyViolationError("SIZE_EXCEEDED");
  }

  const now = Date.now();
  const key = peerAddress.toLowerCase();
  let entry = RATE_LIMITS.get(key) || { count: 0, windowStart: now };

  if (now - entry.windowStart > 60_000) {
    entry = { count: 0, windowStart: now };
  }
  if (entry.count >= MAX_MSG_PER_MIN) {
    throw new PolicyViolationError("RATE_LIMIT");
  }
  entry.count++;
  RATE_LIMITS.set(key, entry);
};
