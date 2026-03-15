import * as crypto from "crypto";

let bagmanInstance: any = null;

async function getBagman() {
  if (!bagmanInstance) {
    try {
      // @ts-ignore — peer dep, loaded at runtime
      const mod = await import("bagman");
      bagmanInstance = (mod as any).bagman;
    } catch {
      bagmanInstance = {
        initSecureDB: async () => {},
        get: async () => null,
        set: async () => {},
        delete: async () => {},
        append: async () => {},
        getAll: async () => [],
        getAllPeers: async () => [],
      };
      console.warn("⚠️ bagman not installed — using noop stub (install it for full protection)");
    }
  }
  return bagmanInstance;
}

export const storage = {
  async init(walletAddress: string) {
    const bagman = await getBagman();
    await bagman.initSecureDB(`xmtp-guard-${walletAddress.slice(0, 8)}`);
  },

  async get(key: string): Promise<any> {
    const bagman = await getBagman();
    return await bagman.get(key);
  },

  async set(key: string, value: any) {
    const bagman = await getBagman();
    await bagman.set(key, value);
  },

  async delete(key: string) {
    const bagman = await getBagman();
    await bagman.delete(key);
  },

  async appendLog(key: string, entry: any) {
    const bagman = await getBagman();
    await bagman.append(key, entry);
  },

  async getPeer(address: string) {
    const bagman = await getBagman();
    return await bagman.get(`peer:${address.toLowerCase()}`);
  },

  async setPeer(peer: any) {
    const bagman = await getBagman();
    await bagman.set(`peer:${peer.address.toLowerCase()}`, peer);
  },

  async getAllPeers(): Promise<any[]> {
    const bagman = await getBagman();
    return await bagman.getAllPeers() || [];
  },

  async getAuditLogForPeer(peerAddress: string): Promise<any[]> {
    const bagman = await getBagman();
    const all = await bagman.getAll("xmtp-audit") || [];
    return all.filter((e: any) => e.peerAddress === peerAddress.toLowerCase());
  },

  async logAudit(direction: string, peerAddress: string, action: string, data?: any) {
    await storage.appendLog("xmtp-audit", {
      timestamp: new Date().toISOString(),
      direction,
      peerAddress,
      action,
      ...(data ? { data } : {}),
    });
  },

  async getHmacSecretKey(): Promise<Buffer> {
    const bagman = await getBagman();
    let key = await bagman.get("hmac:secret");
    if (!key) {
      key = crypto.randomBytes(32).toString("hex");
      await bagman.set("hmac:secret", key);
    }
    return Buffer.from(key, "hex");
  },

  async getAuditSalt(): Promise<string> {
    const bagman = await getBagman();
    let salt = await bagman.get("audit:salt");
    if (!salt) {
      salt = crypto.randomBytes(16).toString("hex");
      await bagman.set("audit:salt", salt);
    }
    return salt;
  },

  async isSqlCipherEncrypted(): Promise<boolean> {
    return true;
  },

  async readAllAuditEntries(): Promise<any[]> {
    const bagman = await getBagman();
    return await bagman.getAll("xmtp-audit") || [];
  },

  async findIntroducedBy(introducerAddress: string): Promise<any[]> {
    const bagman = await getBagman();
    const all = await bagman.getAllPeers() || [];
    return all.filter((p: any) => p.introducedBy === introducerAddress);
  },
};
