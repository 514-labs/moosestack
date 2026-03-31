import type { QueryModelBase } from "@514labs/moose-lib";

export type SemanticToolKind = "metrics" | "records";

export interface SemanticToolStructuredContent extends Record<string, unknown> {
  toolName: string;
  title: string;
  kind: SemanticToolKind;
  rows: Record<string, unknown>[];
  rowCount: number;
}

export interface SemanticToolSuccessResult extends Record<string, unknown> {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: SemanticToolStructuredContent;
}

function getSemanticToolKind(model: QueryModelBase): SemanticToolKind {
  return Object.keys(model.metrics ?? {}).length > 0 ? "metrics" : "records";
}

export function createSemanticToolSuccessResult(
  toolName: string,
  toolTitle: string,
  model: QueryModelBase,
  rows: Record<string, unknown>[],
): SemanticToolSuccessResult {
  const structuredContent: SemanticToolStructuredContent = {
    toolName,
    title: toolTitle,
    kind: getSemanticToolKind(model),
    rows,
    rowCount: rows.length,
  };

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(structuredContent, null, 2),
      },
    ],
    structuredContent,
  };
}
