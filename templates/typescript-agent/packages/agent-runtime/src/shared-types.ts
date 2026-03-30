export type AIProvider = "anthropic" | "openai" | "bedrock";

export interface GuardrailResult {
  action: "NONE" | "GUARDRAIL_INTERVENED";
  details: string[];
  latencyMs: number;
}

export interface GuardrailAdapter {
  assessPrompt(prompt: string): Promise<GuardrailResult>;
}
