import { z } from "zod";
import { TOPICS, type MessageSensitivity } from "../types.js";

export const AgentMessageSchema = z.object({
  messageType: z.enum(["HANDSHAKE", "RESPONSE", "COMMAND", "DATA", "BYE", "INTRODUCTION"]),
  version: z.literal("6.0"),
  payload: z.record(z.any()),
  topics: z.array(z.enum(TOPICS)).min(1),
  sensitivity: z.enum(["public", "guarded", "technical", "personal", "financial"]) as z.ZodType<MessageSensitivity>,
  intent: z.enum(["query", "update", "introduce"]),
  correlationId: z.string().uuid(),
  timestamp: z.string().datetime(),
  nonce: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
});

export type AgentMessage = z.infer<typeof AgentMessageSchema>;
