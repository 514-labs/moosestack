import {
  AlertCircle,
  CheckCircle,
  ChevronRight,
  Loader2,
  Wrench,
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
  getToolName,
  hasOutputError,
  isObjectRecord,
  type ToolPart,
} from "../../types/message-parts";
import { CodeBlock } from "../text/code-block";
import { ClickHouseToolInvocation } from "./clickhouse-tool-invocation";
import { DataCatalogToolInvocation } from "./data-catalog-tool-invocation";
import { formatDuration } from "./format-duration";

type ToolInvocationProps = {
  part: ToolPart;
};

export function ToolInvocation({
  part,
  timing,
}: ToolInvocationProps & { timing?: number }) {
  const [isOpen, setIsOpen] = useState(false);

  const toolName = getToolName(part);

  if (toolName === "query_clickhouse") {
    return <ClickHouseToolInvocation part={part} timing={timing} />;
  }

  if (toolName === "get_data_catalog") {
    return <DataCatalogToolInvocation part={part} timing={timing} />;
  }

  const isLoading = part.state === "input-streaming";
  const hasInput = !!part.input;
  const hasOutput = part.output !== undefined && part.output !== null;
  const hasErrorText =
    typeof part.errorText === "string" && part.errorText.length > 0;

  const getStatusIcon = () => {
    if (part.state === "input-streaming") {
      return (
        <Loader2 className="w-3 h-3 animate-spin text-blue-600 dark:text-blue-400" />
      );
    }
    if (part.state === "output-error") {
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
        "mt-2 rounded-lg border transition-all duration-200 border-border overflow-hidden",
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
            <Wrench
              className={cn(
                "w-4 h-4",
                isLoading ?
                  "text-muted-foreground"
                : "text-blue-600 dark:text-blue-400",
              )}
            />
            <span
              className={cn(
                "text-sm font-medium transition-colors",
                isLoading ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {toolName || "Unknown Tool"}
            </span>

            <div className="flex-1" />

            {part.state === "output-available" && timing && (
              <Badge variant="secondary" className="text-xs mr-2">
                {formatDuration(timing)}
              </Badge>
            )}

            {getStatusIcon()}
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div
            className={cn(
              "px-3 pb-3 space-y-3 border-t border-border/50 transition-opacity duration-200",
              isLoading && "opacity-60",
            )}
          >
            {part.providerExecuted !== undefined && (
              <div className="pt-3">
                <div className="text-sm text-muted-foreground mb-1">
                  Provider Executed:
                </div>
                <Badge variant="outline" className="text-xs">
                  {part.providerExecuted ? "Yes" : "No"}
                </Badge>
              </div>
            )}

            {hasInput && (
              <div
                className={part.providerExecuted === undefined ? "pt-3" : ""}
              >
                <div className="text-sm text-muted-foreground mb-2">Input:</div>
                <CodeBlock language="json">
                  {JSON.stringify(part.input, null, 2)}
                </CodeBlock>
              </div>
            )}

            {hasOutput && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  {hasOutputError(part.output) && part.output.isError ?
                    <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
                  : <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
                  }
                  <span className="text-sm text-muted-foreground">Output:</span>
                </div>
                <CodeBlock
                  language={typeof part.output === "string" ? "text" : "json"}
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
