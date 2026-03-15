export const TOPICS = [
  "everclaw", "smartagent", "morpheus", "github", "infrastructure",
  "family", "health", "personal-schedule", "portfolio", "balances",
  "general", "public-projects"
] as const;

export type Topic = typeof TOPICS[number];

export type TrustLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export type ContextProfile = "public" | "business" | "personal" | "financial" | "full" | "custom";
export type MessageSensitivity = "public" | "guarded" | "technical" | "personal" | "financial";
export type RevocationType = "graceful" | "security";

export interface Peer {
  address: string;
  inboxId: string;
  name: string;
  owner: string;
  trustLevel: TrustLevel;
  contextProfile: ContextProfile;
  approved: boolean;
  approvedAt: string;
  approvedBy: string;
  blockedAt?: string;
  blockedReason?: string;
  introducedBy?: string;
  erc8004Registered: boolean;
  keyRotationAt?: string;
  signature: string;
}

export class PolicyViolationError extends Error {
  constructor(public code: string, public details?: any) {
    super("Policy violation");
  }
}
