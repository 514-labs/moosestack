"use client";

import {
  AlertCircle,
  CheckCircle,
  ChevronRight,
  Database,
  Loader2,
} from "lucide-react";
import { useState, type JSX } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  extractTextContentParts,
  getToolName,
  hasOutputError,
  isObjectRecord,
  type ToolPart,
} from "../../types/message-parts";
import { CodeBlock } from "../text/code-block";
import { formatDuration } from "./format-duration";
import {
  formatSemanticValue,
  getMetricColumns,
  getRecordMetaFields,
  getRecordTitle,
  getSemanticToolDetails,
  getSemanticToolTitle,
  isSemanticToolName,
  parseSemanticToolPayload,
  type SemanticToolPayload,
} from "./semantic-tool-payload";

type SemanticToolInvocationProps = {
  part: ToolPart;
  timing?: number;
};

type SemanticToolInvocationContentProps = {
  part: ToolPart;
  payload: SemanticToolPayload | null;
};

function getOutputText(output: ToolPart["output"]): string {
  const textContent = extractTextContentParts(output);
  if (textContent) {
    return textContent;
  }

  if (
    isObjectRecord(output) &&
    "structuredContent" in output &&
    output.structuredContent !== undefined
  ) {
    return JSON.stringify(output.structuredContent, null, 2);
  }

  if (typeof output === "string") {
    return output;
  }

  return JSON.stringify(output, null, 2) ?? "";
}

function MetricResults({
  payload,
}: {
  payload: SemanticToolPayload;
}): JSX.Element {
  const columns = getMetricColumns(payload.rows);

  if (payload.rows.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No metric rows matched the current filters.
      </div>
    );
  }

  return (
    <div className="w-full rounded-md border overflow-x-auto max-h-[400px] overflow-y-auto">
      <table className="w-full caption-bottom text-sm">
        <thead className="[&_tr]:border-b">
          <tr className="border-b transition-colors hover:bg-muted/50">
            {columns.map((column) => (
              <th
                key={column}
                className="p-1.5 text-left align-middle font-semibold text-muted-foreground whitespace-nowrap"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_tr:last-child]:border-0">
          {payload.rows.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              className="border-b transition-colors hover:bg-muted/50"
            >
              {columns.map((column) => (
                <td
                  key={column}
                  className="p-1.5 align-middle font-mono text-xs whitespace-nowrap"
                >
                  {formatSemanticValue(row[column])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecordResults({
  payload,
}: {
  payload: SemanticToolPayload;
}): JSX.Element {
  if (payload.rows.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No records matched the current filters.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {payload.rows.map((row, index) => {
        const title = getRecordTitle(row, index);
        const metaFields = getRecordMetaFields(row);
        const details = typeof row.details === "string" ? row.details : null;

        return (
          <div
            key={`${title}:${index}`}
            className="rounded-md border bg-muted/30 p-3 space-y-2"
          >
            <div className="flex flex-wrap items-start gap-2 justify-between">
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">
                  {title}
                </div>
                {typeof row.recordId === "string" &&
                  row.recordId.length > 0 && (
                    <div className="text-xs text-muted-foreground">
                      ID: {row.recordId}
                    </div>
                  )}
              </div>
              {metaFields.length > 0 && (
                <div className="flex flex-wrap gap-1 justify-end">
                  {metaFields.map((field) => (
                    <Badge
                      key={`${title}:${field.label}`}
                      variant="outline"
                      className="text-[11px]"
                    >
                      {field.label}: {field.value}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            {details && (
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {details}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function SemanticToolInvocationContent({
  part,
  payload,
}: SemanticToolInvocationContentProps): JSX.Element {
  const toolName = getToolName(part);
  const details =
    payload ? getSemanticToolDetails(payload.toolName, part.input) : [];
  const hasOutput = part.output !== undefined && part.output !== null;
  const hasErrorText =
    typeof part.errorText === "string" && part.errorText.length > 0;
  const hasError = hasOutputError(part.output) && part.output.isError;

  return (
    <div className="max-w-[400px] min-w-full px-3 pb-3 pt-2 space-y-3 border-t border-border/50 overflow-hidden">
      {part.providerExecuted !== undefined && (
        <div className="pt-1">
          <div className="text-sm text-muted-foreground mb-1">
            Provider Executed:
          </div>
          <Badge variant="outline" className="text-xs">
            {part.providerExecuted ? "Yes" : "No"}
          </Badge>
        </div>
      )}

      {details.length > 0 && (
        <div>
          <div className="text-sm text-muted-foreground mb-2">Parameters:</div>
          <div className="rounded-md border bg-muted/30 divide-y">
            {details.map((detail) => (
              <div
                key={`${toolName}:${detail.label}`}
                className="px-3 py-2 text-sm"
              >
                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                  {detail.label}
                </div>
                <div className="text-foreground break-words">
                  {detail.value}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {hasError && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
            <span className="text-sm text-red-700 dark:text-red-300">
              Error:
            </span>
          </div>
          <div className="text-sm text-red-700 dark:text-red-300 bg-red-50/50 dark:bg-red-950/20 p-3 rounded border border-red-200/50 dark:border-red-800/30 whitespace-pre-wrap">
            {getOutputText(part.output)}
          </div>
        </div>
      )}

      {!hasError && payload && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
            <span className="text-sm text-muted-foreground">Results:</span>
          </div>
          {payload.kind === "metrics" ?
            <MetricResults payload={payload} />
          : <RecordResults payload={payload} />}
        </div>
      )}

      {!hasError && !payload && hasOutput && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
            <span className="text-sm text-muted-foreground">Output:</span>
          </div>
          <CodeBlock
            language={typeof part.output === "string" ? "text" : "json"}
          >
            {getOutputText(part.output)}
          </CodeBlock>
        </div>
      )}

      {hasErrorText && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
            <span className="text-sm text-red-700 dark:text-red-300">
              Error:
            </span>
          </div>
          <div className="text-sm text-red-700 dark:text-red-300 bg-red-50/50 dark:bg-red-950/20 p-3 rounded border border-red-200/50 dark:border-red-800/30">
            {part.errorText}
          </div>
        </div>
      )}
    </div>
  );
}

export function SemanticToolInvocation({
  part,
  timing,
}: SemanticToolInvocationProps): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const toolName = getToolName(part);
  const payload = parseSemanticToolPayload(toolName, part.output);
  const semanticToolName =
    payload?.toolName ?? (isSemanticToolName(toolName) ? toolName : null);
  const title =
    semanticToolName ?
      getSemanticToolTitle(semanticToolName)
    : toolName || "Semantic Tool";
  const isLoading = part.state === "input-streaming";

  const getStatusIcon = () => {
    if (part.state === "input-streaming") {
      return (
        <Loader2 className="w-3 h-3 animate-spin text-blue-600 dark:text-blue-400" />
      );
    }
    if (
      part.state === "output-error" ||
      (hasOutputError(part.output) && part.output.isError)
    ) {
      return <AlertCircle className="w-3 h-3 text-red-600 dark:text-red-400" />;
    }
    if (part.state === "output-available") {
      return (
        <CheckCircle className="w-3 h-3 text-green-600 dark:text-green-400" />
      );
    }
    return null;
  };

  return (
    <div
      className={cn(
        "mt-2 rounded-lg border transition-all duration-200 border-border",
        isLoading && "opacity-50",
      )}
    >
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <button
            aria-disabled={isLoading}
            className={cn(
              "flex w-full items-center gap-2 border-0 bg-transparent p-3 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5 disabled:cursor-default",
              isLoading && "text-muted-foreground",
            )}
            disabled={isLoading}
            type="button"
          >
            <ChevronRight
              className={cn(
                "w-4 h-4 text-muted-foreground transition-transform",
                isOpen && "rotate-90",
              )}
            />
            <Database
              className={cn(
                "w-4 h-4",
                isLoading ?
                  "text-muted-foreground"
                : "text-emerald-600 dark:text-emerald-400",
              )}
            />
            <span
              className={cn(
                "text-sm font-medium transition-colors",
                isLoading ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {title}
            </span>

            <div className="flex-1" />

            {payload && (
              <Badge variant="outline" className="text-xs mr-2">
                {payload.rowCount}{" "}
                {payload.rowCount === 1 ? "result" : "results"}
              </Badge>
            )}

            {part.state === "output-available" && timing !== undefined && (
              <Badge variant="secondary" className="text-xs mr-2">
                {formatDuration(timing)}
              </Badge>
            )}

            {getStatusIcon()}
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent className="relative overflow-hidden">
          <SemanticToolInvocationContent part={part} payload={payload} />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
