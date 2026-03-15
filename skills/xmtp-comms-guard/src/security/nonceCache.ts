import { LRUCache } from "lru-cache";

const nonceCache = new LRUCache<string, boolean>({
  max: 10000,
  ttl: 1000 * 90,
});

export const nonceCacheService = {
  isUsed(nonce: string): boolean {
    return nonceCache.has(nonce);
  },
  markUsed(nonce: string) {
    nonceCache.set(nonce, true);
  },
};
