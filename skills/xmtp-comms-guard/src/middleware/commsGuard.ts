import { AgentMessageSchema } from "../schemas/index.js";
import { storage } from "../storage/bagmanStorage.js";
import { PolicyViolationError } from "../types.js";
import * as checks from "../checks/index.js";
import { hashChain } from "../security/hashChain.js";
import { nonceCacheService } from "../security/nonceCache.js";
import * as crypto from "crypto";

const MAX_SIZE_BYTES = 64 * 1024;

export const createCommsGuardMiddleware = () => {
  return async (context: any, next: () => Promise<void>) => {
    const { message, direction, peerAddress } = context;

    try {
      // 1. Size check (real bytes)
      if (Buffer.byteLength(JSON.stringify(message), "utf8") > MAX_SIZE_BYTES) {
        throw new PolicyViolationError("SIZE_EXCEEDED");
      }

      // 2. Schema + version + nonce format
      const validated = AgentMessageSchema.parse(message);

      // 3. Nonce replay protection (90s TTL)
      if (nonceCacheService.isUsed(validated.nonce)) {
        throw new PolicyViolationError("REPLAY_DETECTED");
      }
      nonceCacheService.markUsed(validated.nonce);

      // 4. Peer auth
      await checks.peerAuth(peerAddress, direction);

      // 5. Rate limit
      await checks.rateLimit(peerAddress, Buffer.byteLength(JSON.stringify(validated), "utf8"));

      // 6. PII Guard
      await checks.piiCheck(validated, direction);

      // 7. Prompt Injection Guard
      await checks.injectionCheck(validated);

      // 8. Trust & Context (pure rules)
      await checks.trustContextCheck(validated, peerAddress);

      // All passed — audit log
      await hashChain.append({
        timestamp: new Date().toISOString(),
        direction,
        peerAddress,
        action: "PASS",
        messageType: validated.messageType,
        topics: validated.topics,
      });

      await next();

    } catch (err: any) {
      // Generic external message only — no code leakage
      const userFacingError = "Message could not be delivered.";

      // Salted hash for ALL blocked messages (both directions)
      const salt = await storage.getAuditSalt();
      const contentHash = crypto
        .createHash("sha256")
        .update(salt + JSON.stringify(message))
        .digest("hex")
        .slice(0, 16);

      await hashChain.append({
        timestamp: new Date().toISOString(),
        direction,
        peerAddress,
        action: "BLOCKED",
        code: err.code || "UNKNOWN",
        contentHash,
        reason: err.message,
      });

      throw new PolicyViolationError("BLOCKED", userFacingError);
    }
  };
};
