import { storage } from "../storage/bagmanStorage.js";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export const erc8004Cache = {
  async get(address: string): Promise<any | null> {
    const cached = await storage.get(`erc8004:${address.toLowerCase()}`);
    if (!cached || Date.now() - cached.timestamp > CACHE_TTL_MS) return null;
    return cached.data;
  },

  isFresh(cached: any): boolean {
    if (!cached) return false;
    return true;
  },

  async set(address: string, data: any) {
    await storage.set(`erc8004:${address.toLowerCase()}`, {
      data,
      timestamp: Date.now(),
    });
  },

  async invalidate(address: string) {
    await storage.delete(`erc8004:${address.toLowerCase()}`);
  },
};
