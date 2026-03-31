import type { QueryModelBase } from "@514labs/moose-lib";

export type SemanticToolKind = "metrics" | "records";

export interface SemanticToolStructuredContent {
  toolName: string;
  title: string;
  kind: SemanticToolKind;
  rows: Record<string, unknown>[];
  rowCount: number;
}

function getSemanticToolKind(model: QueryModelBase): SemanticToolKind {
  return Object.keys(model.metrics ?? {}).length > 0 ? "metrics" : "records";
}

export function createSemanticToolSuccessResult(
  toolName: string,
  toolTitle: string,
  model: QueryModelBase,
  rows: Record<string, unknown>[],
) {
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
