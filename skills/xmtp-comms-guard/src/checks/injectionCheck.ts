import { PolicyViolationError } from "../types.js";
import type { AgentMessage } from "../schemas/index.js";

let promptGuard: any = null;

async function getPromptGuard() {
  if (!promptGuard) {
    try {
      // @ts-ignore — peer dep, loaded at runtime
      const mod = await import("prompt-guard");
      promptGuard = (mod as any).promptGuard;
    } catch {
      promptGuard = { scan: async () => ({ injection: false }) };
      console.warn("⚠️ prompt-guard not installed — using noop stub (install it for full protection)");
    }
  }
  return promptGuard;
}

export const injectionCheck = async (msg: AgentMessage) => {
  const guard = await getPromptGuard();
  const scan = await guard.scan(JSON.stringify(msg), { mode: "strict" });
  if (scan.injection) {
    throw new PolicyViolationError("PROMPT_INJECTION", scan.patterns);
  }
};
