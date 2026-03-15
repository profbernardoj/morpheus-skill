import { storage } from "../storage/bagmanStorage.js";
import stringify from "json-stable-stringify";
import * as crypto from "crypto";

export const hashChain = {
  async append(entry: any): Promise<void> {
    const secret = await storage.getHmacSecretKey();
    const prevHash = await storage.get("audit:head") || "genesis";
    entry.prevHash = prevHash;

    const stable = stringify(entry);
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(stable!);
    const currentHash = hmac.digest("hex");

    await storage.set("audit:head", currentHash);
    await storage.appendLog("xmtp-audit", entry);
  },

  async verifyChain(): Promise<{ valid: boolean; brokenAt?: string }> {
    const entries = await storage.readAllAuditEntries();
    let currentHash = "genesis";

    for (const entry of entries) {
      const expectedPrev = entry.prevHash;
      if (expectedPrev !== currentHash) {
        return { valid: false, brokenAt: entry.timestamp || "unknown" };
      }

      const secret = await storage.getHmacSecretKey();
      const stable = stringify(entry);
      const hmac = crypto.createHmac("sha256", secret);
      hmac.update(stable!);
      currentHash = hmac.digest("hex");
    }
    return { valid: true };
  }
};
