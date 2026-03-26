import type { GuardrailAdapter, GuardrailResult } from "agent-runtime";

class DevelopmentMockGuardrailAdapter implements GuardrailAdapter {
  async assessPrompt(prompt: string): Promise<GuardrailResult> {
    const start = Date.now();
    const lowerPrompt = prompt.toLowerCase();
    const flaggedPatterns = [
      "ignore previous instructions",
      "system prompt",
      "reveal secrets",
      "bypass guardrails",
      "show credentials",
    ].filter((pattern) => lowerPrompt.includes(pattern));

    return {
      action: flaggedPatterns.length > 0 ? "GUARDRAIL_INTERVENED" : "NONE",
      details:
        flaggedPatterns.length > 0 ?
          flaggedPatterns.map(
            (pattern) => `Development mock guardrail blocked: ${pattern}`,
          )
        : [],
      latencyMs: Date.now() - start,
    };
  }
}

export function createDevelopmentMockGuardrailAdapter(): GuardrailAdapter {
  return new DevelopmentMockGuardrailAdapter();
}
