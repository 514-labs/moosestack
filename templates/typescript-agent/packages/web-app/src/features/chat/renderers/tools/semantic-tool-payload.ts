import { extractTextContentParts, isObjectRecord, type ToolPart } from "../../types/message-parts";

const METRIC_COLUMN_ORDER = [
  "category",
  "priority",
  "source",
  "totalRecords",
  "highPriorityRecords",
] as const;

const RECORD_META_FIELDS = ["category", "priority", "source", "timestamp"] as const;

export type SemanticToolName = `query_${string}` | `list_${string}`;
export type SemanticToolKind = "metrics" | "records";

export interface SemanticToolStructuredContent {
  toolName: string;
  title?: string;
  kind?: SemanticToolKind;
  rows: Record<string, unknown>[];
  rowCount?: number;
}

export interface SemanticToolPayload {
  toolName: SemanticToolName;
  title: string;
  kind: SemanticToolKind;
  rows: Record<string, unknown>[];
  rowCount: number;
}

export interface SemanticToolDetail {
  label: string;
  value: string;
}

export function isSemanticToolName(name: string | undefined): name is SemanticToolName {
  return typeof name === "string" && (name.startsWith("query_") || name.startsWith("list_"));
}

export function getSemanticToolTitle(toolName: SemanticToolName): string {
  return toolName
    .replace(/^query_/, "Query ")
    .replace(/^list_/, "List ")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getSemanticToolKind(toolName: SemanticToolName): SemanticToolKind {
  return toolName === "query_tenant_knowledge_metrics" ? "metrics" : "records";
}

function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function getStructuredValue(output: unknown): unknown {
  if (
    isObjectRecord(output) &&
    "structuredContent" in output &&
    output.structuredContent !== undefined
  ) {
    return output.structuredContent;
  }

  const textContent = extractTextContentParts(output);
  if (textContent) {
    return parseJsonText(textContent);
  }

  if (typeof output === "string") {
    return parseJsonText(output);
  }

  return output;
}

export function parseSemanticToolPayload(
  toolName: string | undefined,
  output: ToolPart["output"],
): SemanticToolPayload | null {
  if (!isSemanticToolName(toolName) || output === undefined || output === null) {
    return null;
  }

  const structured = getStructuredValue(output);
  if (!isObjectRecord(structured) || !Array.isArray(structured.rows)) {
    return null;
  }

  const rows = structured.rows.filter(isObjectRecord);

  return {
    toolName,
    title:
      typeof structured.title === "string" && structured.title.length > 0
        ? structured.title
        : getSemanticToolTitle(toolName),
    kind:
      structured.kind === "metrics" || structured.kind === "records"
        ? structured.kind
        : getSemanticToolKind(toolName),
    rows,
    rowCount: typeof structured.rowCount === "number" ? structured.rowCount : rows.length,
  };
}

function humanizeFilterName(name: string): string {
  return name
    .replace(/_not_in$/, " not in")
    .replace(/_gte$/, " >=")
    .replace(/_lte$/, " <=")
    .replace(/_gt$/, " >")
    .replace(/_lt$/, " <")
    .replace(/_in$/, " in")
    .replace(/_ilike$/, " contains")
    .replace(/_like$/, " matches")
    .replace(/_/g, " ");
}

export function formatSemanticValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => formatSemanticValue(item)).join(", ");
  }
  if (typeof value === "string") {
    return value;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null ||
    value === undefined
  ) {
    return String(value);
  }
  return JSON.stringify(value);
}

export function getSemanticToolDetails(
  toolName: SemanticToolName,
  input: ToolPart["input"],
): SemanticToolDetail[] {
  if (!input) {
    return [];
  }

  const details: SemanticToolDetail[] = [];

  if (Array.isArray(input.metrics) && input.metrics.length > 0) {
    details.push({
      label: "Metrics",
      value: input.metrics.map((value) => formatSemanticValue(value)).join(", "),
    });
  }

  if (Array.isArray(input.dimensions) && input.dimensions.length > 0) {
    details.push({
      label: "Group By",
      value: input.dimensions.map((value) => formatSemanticValue(value)).join(", "),
    });
  }

  if (Array.isArray(input.columns) && input.columns.length > 0) {
    details.push({
      label: "Columns",
      value: input.columns.map((value) => formatSemanticValue(value)).join(", "),
    });
  }

  const filterEntries = Object.entries(input).filter(([key]) => {
    return !["metrics", "dimensions", "columns", "limit"].includes(key);
  });

  if (filterEntries.length > 0) {
    details.push({
      label: "Filters",
      value: filterEntries
        .map(([key, value]) => `${humanizeFilterName(key)} ${formatSemanticValue(value)}`)
        .join(" • "),
    });
  }

  if (typeof input.limit === "number") {
    details.push({
      label: "Limit",
      value: String(input.limit),
    });
  }

  if (details.length === 0) {
    details.push({
      label: toolName === "query_tenant_knowledge_metrics" ? "Selection" : "View",
      value: toolName === "query_tenant_knowledge_metrics" ? "Default metrics" : "Recent records",
    });
  }

  return details;
}

export function getMetricColumns(rows: Record<string, unknown>[]): string[] {
  const rowKeys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const orderedKeys = METRIC_COLUMN_ORDER.filter((key) => rowKeys.includes(key));
  const remainingKeys = rowKeys.filter(
    (key) => !orderedKeys.includes(key as (typeof METRIC_COLUMN_ORDER)[number]),
  );
  return [...orderedKeys, ...remainingKeys];
}

export function getRecordMetaFields(row: Record<string, unknown>): SemanticToolDetail[] {
  return RECORD_META_FIELDS.flatMap((field) => {
    const value = row[field];
    if (value === undefined || value === null || value === "") {
      return [];
    }

    return [
      {
        label: field,
        value: formatSemanticValue(value),
      },
    ];
  });
}

export function getRecordTitle(row: Record<string, unknown>, index: number): string {
  const headline = row.headline;
  if (typeof headline === "string" && headline.length > 0) {
    return headline;
  }

  const recordId = row.recordId;
  if (typeof recordId === "string" && recordId.length > 0) {
    return `Record ${recordId}`;
  }

  return `Record ${index + 1}`;
}
