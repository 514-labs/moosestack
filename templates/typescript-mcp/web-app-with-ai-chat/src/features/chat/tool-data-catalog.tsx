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
import { TextFormatter } from "./text-formatter";
import { useState } from "react";

const MILLISECONDS_THRESHOLD = 5000;

function formatDuration(milliseconds: number): string {
  if (milliseconds < MILLISECONDS_THRESHOLD) {
    return `${Math.round(milliseconds)}ms`;
  }

  const seconds = milliseconds / 1000;
  return `${seconds.toFixed(2)}s`;
}

type DataCatalogToolInvocationProps = {
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
      component_type?: string;
      search?: string;
      format?: string;
      [key: string]: any;
    };
    output?: any;
    errorText?: string;
    providerExecuted?: boolean;
  };
  timing?: number;
};

export function DataCatalogToolInvocation({
  part,
  timing,
}: DataCatalogToolInvocationProps) {
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

  // Extract catalog text from output
  const getCatalogText = () => {
    if (!part.output) return null;

    // Handle structured output format
    if (
      typeof part.output === "object" &&
      "structuredContent" in part.output &&
      part.output.structuredContent !== undefined
    ) {
      const structured = part.output.structuredContent;
      if (
        typeof structured === "object" &&
        structured !== null &&
        "catalog" in structured &&
        typeof structured.catalog === "string"
      ) {
        return structured.catalog;
      }
    }

    // Handle content array format
    if (
      typeof part.output === "object" &&
      "content" in part.output &&
      Array.isArray(part.output.content)
    ) {
      const textContent = part.output.content
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("");
      return textContent || null;
    }

    // Handle direct string output
    if (typeof part.output === "string") {
      return part.output;
    }

    return null;
  };

  const catalogText = getCatalogText();
  const input = part.input;

  // Check if output has isError flag
  const hasError =
    part.output &&
    typeof part.output === "object" &&
    "isError" in part.output &&
    part.output.isError;

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
              Data Catalog
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

        <CollapsibleContent className="relative overflow-hidden">
          <div
            className={cn(
              "max-w-[400px] min-w-full px-3 pb-3 pt-2 space-y-2 border-t border-border/50 transition-opacity duration-200 overflow-hidden",
              isLoading && "opacity-60",
            )}
          >
            {/* Input Parameters */}
            {input && Object.keys(input).length > 0 && (
              <div className="">
                <div className="text-sm text-muted-foreground mb-2">
                  Parameters:
                </div>
                <CodeBlock language="json">
                  {JSON.stringify(input, null, 2)}
                </CodeBlock>
              </div>
            )}

            {/* Error */}
            {hasError && (
              <div>
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
                      const textContent = part.output.content
                        .filter((c: any) => c.type === "text")
                        .map((c: any) => c.text)
                        .join("");
                      return textContent || "An error occurred";
                    }
                    if (typeof part.output === "string") {
                      return part.output;
                    }
                    return JSON.stringify(part.output, null, 2);
                  })()}
                </div>
              </div>
            )}

            {/* Catalog Output */}
            {!hasError && catalogText && (
              <div>
                <div className="text-sm text-muted-foreground mb-2">
                  Output:
                </div>
                <div className="rounded-md border bg-muted/50 p-4">
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <TextFormatter text={catalogText} />
                  </div>
                </div>
              </div>
            )}

            {/* Error Text */}
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
