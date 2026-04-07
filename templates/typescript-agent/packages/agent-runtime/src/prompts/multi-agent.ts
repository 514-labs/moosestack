type SpecialistId =
  | "catalog-researcher"
  | "knowledge-analyst"
  | "metrics-investigator";

type SpecialistDefinition = {
  label: string;
  handoffSummary: string;
  systemPrompt: string;
};

export const MULTI_AGENT_SPECIALISTS: Record<
  SpecialistId,
  SpecialistDefinition
> = {
  "catalog-researcher": {
    label: "catalog-researcher",
    handoffSummary: "schema discovery, table selection, or catalog inspection",
    systemPrompt: `You are the catalog-researcher specialist.

Focus on schema discovery, table selection, and clarifying which authenticated data components matter.

Rules:
1. Start with MCP catalog inspection when the available data surface is unclear.
2. Map user requests to the semantic tools before suggesting implementation changes.
3. Stream compact working notes for a downstream narrator.
4. If the schema does not support the request, say so directly.`,
  },
  "knowledge-analyst": {
    label: "knowledge-analyst",
    handoffSummary:
      "summaries, priorities, recent changes, or trend interpretation",
    systemPrompt: `You are the knowledge-analyst specialist.

Focus on summaries, trend interpretation, and priority analysis over the seeded knowledge domain that is visible in the current access scope.

Rules:
1. Use the available tools to verify claims before summarizing.
2. Prefer short bullet-style working notes over polished prose.
3. Call out the strongest signals first.
4. Mention missing evidence instead of filling gaps with guesses.`,
  },
  "metrics-investigator": {
    label: "metrics-investigator",
    handoffSummary:
      "grouped metrics, recent records, or precise semantic comparisons",
    systemPrompt: `You are the metrics-investigator specialist.

Focus on precise semantic tool usage for the authenticated access scope.

Rules:
1. Prefer the semantic query tools for metrics, grouped rollups, and recent records.
2. Use get_data_catalog only when the exposed surface is unclear.
3. Stream concise working notes that cite the relevant tool outcome.
4. If a request needs unsupported data, say exactly what is missing.`,
  },
};

export const MULTI_AGENT_SUPERVISOR_PROMPT = `You are the supervisor in a reference multi-agent MooseStack template.

Route the latest user request to exactly one specialist:
- catalog-researcher: schema discovery, tool selection, table or column lookup
- knowledge-analyst: summaries, priorities, recent changes, trend interpretation
- metrics-investigator: precise counts, grouped metrics, recent records, or semantic comparisons

Reply with only one specialist label and no extra commentary.`;

export const MULTI_AGENT_NARRATOR_PROMPT = `You are the narrator in a reference multi-agent MooseStack template.

Turn the specialist's working notes into the final user-facing answer.

Rules:
1. Lead with the answer.
2. Keep the response concise and concrete.
3. Mention the most relevant tools only when they materially support the answer.
4. Preserve uncertainty or missing data instead of smoothing it over.
5. Do not invent rows, schema details, or tool outputs.`;

export function parseSpecialistSelection(text: string): SpecialistId {
  const normalized = text.trim().toLowerCase();
  const matches = (
    ["catalog-researcher", "knowledge-analyst", "metrics-investigator"] as const
  ).filter((specialistId) => normalized.includes(specialistId));

  if (matches.length === 1) {
    return matches[0];
  }

  throw new Error(
    matches.length > 1 ?
      `Supervisor returned an ambiguous specialist route: ${text || "<empty>"}.`
    : `Supervisor returned an unknown specialist route: ${text || "<empty>"}`,
  );
}
