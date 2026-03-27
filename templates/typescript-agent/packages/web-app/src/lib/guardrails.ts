import {
  ApplyGuardrailCommand,
  BedrockRuntimeClient,
} from "@aws-sdk/client-bedrock-runtime";
import type {
  AIProvider,
  GuardrailAdapter,
  GuardrailResult,
} from "agent-runtime";
import { createDevelopmentMockGuardrailAdapter } from "@/dev/mock-guardrails";
import { getBedrockGuardrailConfig } from "@/env-vars";

class NoopGuardrailAdapter implements GuardrailAdapter {
  async assessPrompt(): Promise<GuardrailResult> {
    return {
      action: "NONE",
      details: [],
      latencyMs: 0,
    };
  }
}

class BedrockGuardrailAdapter implements GuardrailAdapter {
  private client: BedrockRuntimeClient;

  constructor(
    private readonly guardrailId: string,
    private readonly version: string,
    region: string,
  ) {
    this.client = new BedrockRuntimeClient({ region });
  }

  async assessPrompt(prompt: string): Promise<GuardrailResult> {
    const start = Date.now();

    try {
      const response = await this.client.send(
        new ApplyGuardrailCommand({
          guardrailIdentifier: this.guardrailId,
          guardrailVersion: this.version,
          source: "INPUT",
          content: [{ text: { text: prompt } }],
        }),
      );

      const details =
        response.assessments?.flatMap((assessment) => {
          const items: string[] = [];

          for (const filter of assessment.contentPolicy?.filters ?? []) {
            items.push(`${filter.type}: ${filter.action}`);
          }

          for (const topic of assessment.topicPolicy?.topics ?? []) {
            items.push(`Topic ${topic.name}: ${topic.action}`);
          }

          for (const entity of assessment.sensitiveInformationPolicy
            ?.piiEntities ?? []) {
            items.push(`PII ${entity.type}: ${entity.action}`);
          }

          return items;
        }) ?? [];

      return {
        action:
          response.action === "GUARDRAIL_INTERVENED" ?
            "GUARDRAIL_INTERVENED"
          : "NONE",
        details,
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      console.error("Bedrock guardrail request failed", error);
      return {
        action: "GUARDRAIL_INTERVENED",
        details: [
          "Guardrail assessment failed. Review the request and the Bedrock guardrail configuration before continuing.",
        ],
        latencyMs: Date.now() - start,
      };
    }
  }
}

export function createGuardrailAdapter(provider: AIProvider): GuardrailAdapter {
  if (provider !== "bedrock") {
    return new NoopGuardrailAdapter();
  }

  const config = getBedrockGuardrailConfig();
  if (!config) {
    if (process.env.NODE_ENV !== "production") {
      return createDevelopmentMockGuardrailAdapter();
    }

    return new NoopGuardrailAdapter();
  }

  return new BedrockGuardrailAdapter(config.id, config.version, config.region);
}
