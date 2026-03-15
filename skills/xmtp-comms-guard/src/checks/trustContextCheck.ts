import { PolicyViolationError, TOPICS } from "../types.js";
import { storage } from "../storage/bagmanStorage.js";
import type { AgentMessage } from "../schemas/index.js";
import type { Topic } from "../types.js";

const SENSITIVITY_ORDER: Record<string, number> = {
  public: 0,
  technical: 1,
  guarded: 2,
  personal: 3,
  financial: 4,
};

const PROFILE_RULES: Record<string, { allowed: readonly Topic[] | readonly ["*"]; maxSensitivity: string }> = {
  public: { allowed: ["general", "public-projects"] as const, maxSensitivity: "public" },
  business: { allowed: ["everclaw", "smartagent", "morpheus", "github", "infrastructure", "general", "public-projects"] as const, maxSensitivity: "technical" },
  personal: { allowed: ["family", "health", "personal-schedule", "general", "public-projects"] as const, maxSensitivity: "personal" },
  financial: { allowed: ["portfolio", "balances", "general", "public-projects"] as const, maxSensitivity: "financial" },
  full: { allowed: ["*"] as const, maxSensitivity: "financial" },
};

export const trustContextCheck = async (msg: AgentMessage, peerAddress: string) => {
  const peer = await storage.getPeer(peerAddress);
  if (!peer) throw new PolicyViolationError("TRUST_EXCEEDED");

  const rules = PROFILE_RULES[peer.contextProfile] || PROFILE_RULES.public;

  const topicOK = msg.topics.every((t: string) =>
    (rules.allowed as readonly string[]).includes("*") || (rules.allowed as readonly string[]).includes(t)
  );

  const msgSensitivity = SENSITIVITY_ORDER[msg.sensitivity] ?? 999;
  const maxSensitivity = SENSITIVITY_ORDER[rules.maxSensitivity] ?? 0;
  const sensitivityOK = msgSensitivity <= maxSensitivity;

  if (!topicOK || !sensitivityOK) {
    throw new PolicyViolationError("TRUST_EXCEEDED");
  }
};
