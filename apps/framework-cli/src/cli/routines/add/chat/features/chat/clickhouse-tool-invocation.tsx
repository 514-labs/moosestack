import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  CheckCircle,
  AlertCircle,
  Database,
  Loader2,
  ChevronRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CodeBlock } from "./code-block";
import { useState } from "react";

const MILLISECONDS_THRESHOLD = 5000;

function formatDuration(milliseconds: number): string {
  if (milliseconds < MILLISECONDS_THRESHOLD) {
    return `${Math.round(milliseconds)}ms`;
  }

  const seconds = milliseconds / 1000;
  return `${seconds.toFixed(2)}s`;
}

type ClickHouseToolInvocationProps = {
  part: {
    type: `tool-${string}` | "dynamic-tool";
    toolCallId: string;
    toolName?: string;
    state:
      | "input-streaming"
      | "input-available"
      | "output-available"
      | "output-error";
    input?: {
      query?: string;
      [key: string]: any;
    };
    output?: any;
    errorText?: string;
    providerExecuted?: boolean;
  };
  timing?: number;
};

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
    // Check if output has isError flag
    if (
      part.output &&
      typeof part.output === "object" &&
      "isError" in part.output &&
      part.output.isError
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

  // Parse the output to get the data
  const getQueryData = () => {
    if (!part.output) return null;

    // Handle structured output format
    if (
      typeof part.output === "object" &&
      "structuredContent" in part.output &&
      part.output.structuredContent !== undefined
    ) {
      const structured = part.output.structuredContent;

      // Check if structuredContent has a rows field (ClickHouse query result)
      if (
        typeof structured === "object" &&
        structured !== null &&
        "rows" in structured
      ) {
        return structured.rows;
      }
      // Check if structuredContent has a data field
      if (
        typeof structured === "object" &&
        structured !== null &&
        "data" in structured
      ) {
        return structured.data;
      }
      return structured;
    }

    // Handle direct output with rows field (ClickHouse query result)
    if (typeof part.output === "object" && "rows" in part.output) {
      return part.output.rows;
    }

    // Handle direct output with data field
    if (typeof part.output === "object" && "data" in part.output) {
      return part.output.data;
    }

    // Handle direct array output
    if (Array.isArray(part.output)) {
      return part.output;
    }

    return part.output;
  };

  const queryData = getQueryData();
  const query = part.input?.query;
  const input = part.input;

  // Check if output has isError flag
  const hasError =
    part.output &&
    typeof part.output === "object" &&
    "isError" in part.output &&
    part.output.isError;

  // Extract table data if it's an array (and not an error)
  const isTableData =
    !hasError && Array.isArray(queryData) && queryData.length > 0;
  const columns = isTableData ? Object.keys(queryData[0]) : [];

  return (
    <div
      className={cn(
        "mt-2 rounded-lg border transition-all duration-200 border-border",
        isLoading && "opacity-50",
      )}
    >
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <div
            className={cn(
              "flex items-center gap-2 p-3 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors",
              isLoading && "text-muted-foreground",
            )}
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

            {part.state === "output-available" && timing && (
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
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent className="relative overflow-hidden">
          <div
            className={cn(
              "max-w-[400px] min-w-full px-3 pb-3 pt-2 space-y-2 border-t border-border/50 transition-opacity duration-200 overflow-hidden",
              isLoading && "opacity-60",
            )}
          >
            {/* Query or Input Parameters */}
            {query && (
              <div className="">
                <div className="text-sm text-muted-foreground mb-2">Query:</div>
                <CodeBlock language="sql">{query}</CodeBlock>
              </div>
            )}
            {!query && input && Object.keys(input).length > 0 && (
              <div className="">
                <div className="text-sm text-muted-foreground mb-2">
                  Parameters:
                </div>
                <CodeBlock language="json">
                  {JSON.stringify(input, null, 2)}
                </CodeBlock>
              </div>
            )}

            {/* Results Table */}
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
                      {queryData.map((row: any, rowIndex: number) => (
                        <tr
                          key={rowIndex}
                          className="border-b transition-colors hover:bg-muted/50"
                        >
                          {columns.map((column) => (
                            <td
                              key={`${rowIndex}-${column}`}
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
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Non-table output */}
            {part.output && !isTableData && (
              <div>
                {
                  (
                    part.output &&
                    typeof part.output === "object" &&
                    "isError" in part.output &&
                    part.output.isError
                  ) ?
                    // Error format (same as errorText)
                    <>
                      <div className="flex items-center gap-2 mb-2">
                        <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
                        <span className="text-sm text-red-700 dark:text-red-300">
                          Error:
                        </span>
                      </div>
                      <div className="text-sm text-red-700 dark:text-red-300 bg-red-50/50 dark:bg-red-950/20 p-3 rounded border border-red-200/50 dark:border-red-800/30">
                        {(() => {
                          if (
                            part.output &&
                            typeof part.output === "object" &&
                            "content" in part.output &&
                            Array.isArray(part.output.content)
                          ) {
                            // Extract text from content array
                            const textContent = part.output.content
                              .filter((c: any) => c.type === "text")
                              .map((c: any) => c.text)
                              .join("");
                            return textContent || "An error occurred";
                          }
                          if (
                            part.output &&
                            typeof part.output === "object" &&
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
                    // Normal output format
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
                            part.output &&
                            typeof part.output === "object" &&
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

            {/* Error */}
            {part.errorText && (
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
