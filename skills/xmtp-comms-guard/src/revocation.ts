import { storage } from "./storage/bagmanStorage.js";
import { erc8004Cache } from "./security/erc8004Cache.js";

export async function requestThreeShiftApproval(
  title: string,
  message: string,
  options: { approve: string; redact?: string; block: string }
): Promise<"approve" | "redact" | "block"> {
  console.log(`🛡️ Three-Shift requested: ${title}\n${message}`);
  return "approve";
}

export const revocation = {
  async securityRevoke(peerAddress: string, reason: string) {
    const peer = await storage.getPeer(peerAddress);
    if (!peer) return;

    peer.approved = false;
    peer.blockedAt = new Date().toISOString();
    peer.blockedReason = `Security revocation: ${reason}`;
    peer.keyRotationAt = new Date().toISOString();
    await storage.setPeer(peer);

    await erc8004Cache.invalidate(peerAddress);

    const introducedPeers = await storage.findIntroducedBy(peerAddress);
    for (const introduced of introducedPeers) {
      await requestThreeShiftApproval(
        "Introducer Revoked",
        `Agent ${peer.name} (introducer of ${introduced.name}) was security-revoked.\nRe-evaluate trust for ${introduced.name}?`,
        { approve: "Keep current trust", redact: "Downgrade to public", block: "Revoke" }
      );
    }
  },

  async gracefulRevoke(peerAddress: string, reason: string) {
    const peer = await storage.getPeer(peerAddress);
    if (!peer) return;

    peer.approved = false;
    peer.blockedAt = new Date().toISOString();
    peer.blockedReason = `Graceful revocation: ${reason}`;
    await storage.setPeer(peer);
  },

  async keyRotation(peerAddress: string) {
    const peer = await storage.getPeer(peerAddress);
    if (!peer) return;
    peer.keyRotationAt = new Date().toISOString();
    peer.trustLevel = 0;
    await storage.setPeer(peer);
    await requestThreeShiftApproval(
      "Key Rotation Detected",
      `Peer ${peer.name} has rotated keys. Trust reset to 0. Re-approve?`,
      { approve: "Re-approve at previous level", block: "Revoke" }
    );
  },
};
