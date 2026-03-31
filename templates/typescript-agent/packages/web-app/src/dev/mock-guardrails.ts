import type { GuardrailAdapter, GuardrailResult } from "agent-runtime";

const MOCK_GUARDRAIL_PATTERNS = [
  /ignore\W+(all\s+)?(previous|prior)\W+instructions?/i,
  /system\W*prompt/i,
  /reveal\W+(the\s+)?secrets?/i,
  /bypass\W+guardrails?/i,
  /show\W+(the\s+)?credentials?/i,
] as const;

class DevelopmentMockGuardrailAdapter implements GuardrailAdapter {
  async assessPrompt(prompt: string): Promise<GuardrailResult> {
    const start = Date.now();
    // Dev-only mock guardrails intentionally use simple regexes. They are easy to
    // evade via substitutions, Unicode confusables, or fuzzy phrasing and should
    // never be treated as production-grade prompt safety.
    const flaggedPatterns = MOCK_GUARDRAIL_PATTERNS.filter((pattern) =>
      pattern.test(prompt),
    );

    return {
      action: flaggedPatterns.length > 0 ? "GUARDRAIL_INTERVENED" : "NONE",
      details:
        flaggedPatterns.length > 0 ?
          flaggedPatterns.map(
            (pattern) =>
              `Development mock guardrail blocked: ${pattern.source}`,
          )
        : [],
      latencyMs: Date.now() - start,
    };
  }
}

export function createDevelopmentMockGuardrailAdapter(): GuardrailAdapter {
  return new DevelopmentMockGuardrailAdapter();
}
