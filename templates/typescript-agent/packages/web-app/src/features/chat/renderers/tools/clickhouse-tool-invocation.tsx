"use client";

import {
  AlertCircle,
  CheckCircle,
  ChevronRight,
  Database,
  Loader2,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  extractTextContentParts,
  hasOutputError,
  isObjectRecord,
  type ToolPart,
} from "../../types/message-parts";
import { CodeBlock } from "../text/code-block";
import { formatDuration } from "./format-duration";

type ClickHouseRow = Record<string, unknown>;

type ClickHouseToolInvocationProps = {
  part: ToolPart;
  timing?: number;
};

function isClickHouseRowArray(value: unknown): value is ClickHouseRow[] {
  return Array.isArray(value) && value.every(isObjectRecord);
}

function createRowKeyFactory(columns: string[]) {
  const keyCounts = new Map<string, number>();

  return (row: ClickHouseRow) => {
    const baseKey = JSON.stringify(
      columns.map((column) => row[column] ?? null),
    );
    const occurrence = keyCounts.get(baseKey) ?? 0;
    keyCounts.set(baseKey, occurrence + 1);
    return `${baseKey}:${occurrence}`;
  };
}

export function ClickHouseToolInvocation({
  part,
  timing,
}: ClickHouseToolInvocationProps) {
  const [isOpen, setIsOpen] = useState(false);

  const isLoading = part.state === "input-streaming";

  const getStatusIcon = () => {
    if (part.state === "input-streaming") {
      return (
        <Loader2 className="w-3 h-3 animate-spin text-blue-600 dark:text-blue-400" />
      );
    }
    if (part.state === "output-error") {
      return <AlertCircle className="w-3 h-3 text-red-600 dark:text-red-400" />;
    }
    if (hasOutputError(part.output) && part.output.isError) {
      return <AlertCircle className="w-3 h-3 text-red-600 dark:text-red-400" />;
    }
    if (part.state === "output-available") {
      return (
        <CheckCircle className="w-3 h-3 text-green-600 dark:text-green-400" />
      );
    }
    return null;
  };

  const getQueryData = () => {
    if (!part.output) {
      return null;
    }

    if (
      isObjectRecord(part.output) &&
      "structuredContent" in part.output &&
      part.output.structuredContent !== undefined
    ) {
      const structured = part.output.structuredContent;
      if (isObjectRecord(structured) && "rows" in structured) {
        return structured.rows;
      }
      if (isObjectRecord(structured) && "data" in structured) {
        return structured.data;
      }
      return structured;
    }

    if (isObjectRecord(part.output) && "rows" in part.output) {
      return part.output.rows;
    }

    if (isObjectRecord(part.output) && "data" in part.output) {
      return part.output.data;
    }

    if (Array.isArray(part.output)) {
      return part.output;
    }

    return part.output;
  };

  const queryData = getQueryData();
  const input = part.input;
  const query = typeof input?.query === "string" ? input.query : undefined;

  const hasInput = !!input && Object.keys(input).length > 0;
  const hasOutput = part.output !== undefined && part.output !== null;
  const hasErrorText =
    typeof part.errorText === "string" && part.errorText.length > 0;
  const hasError = hasOutputError(part.output) && part.output.isError;

  const isTableData =
    !hasError && isClickHouseRowArray(queryData) && queryData.length > 0;
  const columns = isTableData ? Object.keys(queryData[0]) : [];
  const getRowKey = isTableData ? createRowKeyFactory(columns) : undefined;

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
                : "text-purple-600 dark:text-purple-400",
              )}
            />
            <span
              className={cn(
                "text-sm font-medium transition-colors",
                isLoading ? "text-muted-foreground" : "text-foreground",
              )}
            >
              ClickHouse Query
            </span>

            <div className="flex-1" />

            {part.state === "output-available" && timing !== undefined && (
              <Badge variant="secondary" className="text-xs mr-2">
                {formatDuration(timing)}
              </Badge>
            )}

            {isTableData && (
              <Badge variant="outline" className="text-xs mr-2">
                {queryData.length} {queryData.length === 1 ? "row" : "rows"}
              </Badge>
            )}

            {getStatusIcon()}
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent className="relative overflow-hidden">
          <div
            className={cn(
              "max-w-[400px] min-w-full px-3 pb-3 pt-2 space-y-2 border-t border-border/50 transition-opacity duration-200 overflow-hidden",
              isLoading && "opacity-60",
            )}
          >
            {query && (
              <div>
                <div className="text-sm text-muted-foreground mb-2">Query:</div>
                <CodeBlock language="sql">{query}</CodeBlock>
              </div>
            )}
            {!query && hasInput && (
              <div>
                <div className="text-sm text-muted-foreground mb-2">
                  Parameters:
                </div>
                <CodeBlock language="json">
                  {JSON.stringify(input, null, 2)}
                </CodeBlock>
              </div>
            )}

            {part.state === "output-available" && isTableData && (
              <div className="relative overflow-hidden max-w-full">
                <div className="text-sm text-muted-foreground mb-2">
                  Results:
                </div>
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
                      {queryData.map((row) => {
                        const rowKey = getRowKey?.(row) ?? JSON.stringify(row);

                        return (
                          <tr
                            key={rowKey}
                            className="border-b transition-colors hover:bg-muted/50"
                          >
                            {columns.map((column) => (
                              <td
                                key={`${rowKey}:${column}`}
                                className="p-1.5 align-middle font-mono text-xs whitespace-nowrap"
                              >
                                {(
                                  row[column] !== null &&
                                  row[column] !== undefined
                                ) ?
                                  String(row[column])
                                : "null"}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {hasOutput && !isTableData && (
              <div>
                {hasOutputError(part.output) && part.output.isError ?
                  <>
                    <div className="flex items-center gap-2 mb-2">
                      <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
                      <span className="text-sm text-red-700 dark:text-red-300">
                        Error:
                      </span>
                    </div>
                    <div className="text-sm text-red-700 dark:text-red-300 bg-red-50/50 dark:bg-red-950/20 p-3 rounded border border-red-200/50 dark:border-red-800/30">
                      {(() => {
                        const textContent = extractTextContentParts(
                          part.output,
                        );
                        if (textContent) {
                          return textContent;
                        }
                        if (
                          isObjectRecord(part.output) &&
                          "structuredContent" in part.output &&
                          part.output.structuredContent !== undefined
                        ) {
                          return JSON.stringify(
                            part.output.structuredContent,
                            null,
                            2,
                          );
                        }
                        if (typeof part.output === "string") {
                          return part.output;
                        }
                        return JSON.stringify(part.output, null, 2);
                      })()}
                    </div>
                  </>
                : <>
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
                      <span className="text-sm text-muted-foreground">
                        Output:
                      </span>
                    </div>
                    <CodeBlock
                      language={
                        typeof part.output === "string" ? "text" : "json"
                      }
                    >
                      {(() => {
                        if (
                          isObjectRecord(part.output) &&
                          "structuredContent" in part.output &&
                          part.output.structuredContent !== undefined
                        ) {
                          return JSON.stringify(
                            part.output.structuredContent,
                            null,
                            2,
                          );
                        }
                        if (typeof part.output === "string") {
                          return part.output;
                        }
                        return JSON.stringify(part.output, null, 2);
                      })()}
                    </CodeBlock>
                  </>
                }
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
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
