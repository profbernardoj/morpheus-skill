import { PolicyViolationError } from "../types.js";
import { storage } from "../storage/bagmanStorage.js";

export const peerAuth = async (peerAddress: string, direction: "inbound" | "outbound") => {
  const peer = await storage.getPeer(peerAddress);
  if (!peer) {
    throw new PolicyViolationError("UNAUTHORIZED", "Peer not in registry");
  }
  if (!peer.approved) {
    throw new PolicyViolationError("BLOCKED", `Peer blocked: ${peer.blockedReason || "unknown"}`);
  }
};
