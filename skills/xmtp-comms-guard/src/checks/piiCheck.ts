import { PolicyViolationError } from "../types.js";
import type { AgentMessage } from "../schemas/index.js";

let piiGuard: any = null;

async function getPiiGuard() {
  if (!piiGuard) {
    try {
      // @ts-ignore — peer dep, loaded at runtime
      const mod = await import("pii-guard");
      piiGuard = (mod as any).piiGuard;
    } catch {
      piiGuard = { scan: async () => ({ found: false }) };
      console.warn("⚠️ pii-guard not installed — using noop stub (install it for full protection)");
    }
  }
  return piiGuard;
}

export const piiCheck = async (msg: AgentMessage, direction: "inbound" | "outbound") => {
  const guard = await getPiiGuard();
  const scan = await guard.scan(JSON.stringify(msg.payload), {
    whitelistPublicContracts: true,
    redactInsteadOfBlock: direction === "outbound"
  });
  if (scan.found) {
    throw new PolicyViolationError("PII_DETECTED", scan.findings);
  }
};
