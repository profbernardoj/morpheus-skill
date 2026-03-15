import { createCommsGuardMiddleware } from "./middleware/commsGuard.js";
import { storage } from "./storage/bagmanStorage.js";
import { hashChain } from "./security/hashChain.js";

export { createCommsGuardMiddleware } from "./middleware/commsGuard.js";
export { AgentMessageSchema, type AgentMessage } from "./schemas/index.js";
export { storage } from "./storage/bagmanStorage.js";
export { hashChain } from "./security/hashChain.js";
export { nonceCacheService } from "./security/nonceCache.js";
export { erc8004Cache } from "./security/erc8004Cache.js";
export { revocation } from "./revocation.js";
export { PolicyViolationError, TOPICS, type Peer, type Topic, type TrustLevel, type ContextProfile, type MessageSensitivity, type RevocationType } from "./types.js";

export async function createGuardedXmtpClient(baseClient: any, userWalletAddress: string) {
  await storage.init(userWalletAddress);

  const chainStatus = await hashChain.verifyChain();
  if (!chainStatus.valid || !(await storage.isSqlCipherEncrypted())) {
    throw new Error("Critical integrity check failed — refusing to start");
  }

  const middleware = createCommsGuardMiddleware();

  console.log("✅ xmtp-comms-guard v6.0 active — full deterministic pipeline");
  return { client: baseClient, middleware };
}
