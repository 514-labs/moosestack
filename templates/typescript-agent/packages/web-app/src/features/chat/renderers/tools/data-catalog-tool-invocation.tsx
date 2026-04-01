"use client";

import { AlertCircle, CheckCircle, ChevronRight, Database, Loader2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  extractTextContentParts,
  hasOutputError,
  isObjectRecord,
  type ToolPart,
} from "../../types/message-parts";
import { CodeBlock } from "../text/code-block";
import { TextFormatter } from "../text/text-formatter";
import { formatDuration } from "./format-duration";

type DataCatalogToolInvocationProps = {
  part: ToolPart;
  timing?: number;
};

export function DataCatalogToolInvocation({ part, timing }: DataCatalogToolInvocationProps) {
  const [isOpen, setIsOpen] = useState(false);

  const isLoading = part.state === "input-streaming";

  const getStatusIcon = () => {
    if (part.state === "input-streaming") {
      return <Loader2 className="w-3 h-3 animate-spin text-blue-600 dark:text-blue-400" />;
    }
    if (part.state === "output-error") {
      return <AlertCircle className="w-3 h-3 text-red-600 dark:text-red-400" />;
    }
    if (hasOutputError(part.output) && part.output.isError) {
      return <AlertCircle className="w-3 h-3 text-red-600 dark:text-red-400" />;
    }
    if (part.state === "output-available") {
      return <CheckCircle className="w-3 h-3 text-green-600 dark:text-green-400" />;
    }
    return null;
  };

  const getCatalogText = () => {
    if (!part.output) {
      return null;
    }

    if (
      isObjectRecord(part.output) &&
      "structuredContent" in part.output &&
      part.output.structuredContent !== undefined
    ) {
      const structured = part.output.structuredContent;
      if (
        isObjectRecord(structured) &&
        "catalog" in structured &&
        typeof structured.catalog === "string"
      ) {
        return structured.catalog;
      }
    }

    const textContent = extractTextContentParts(part.output);
    if (textContent) {
      return textContent;
    }

    if (typeof part.output === "string") {
      return part.output;
    }

    return null;
  };

  const catalogText = getCatalogText();
  const input = part.input;

  const hasInput = !!input && Object.keys(input).length > 0;
  const hasErrorText = typeof part.errorText === "string" && part.errorText.length > 0;
  const hasError = hasOutputError(part.output) && part.output.isError;

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
                isLoading ? "text-muted-foreground" : "text-purple-600 dark:text-purple-400",
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

            {part.state === "output-available" && timing !== undefined && (
              <Badge variant="secondary" className="text-xs mr-2">
                {formatDuration(timing)}
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
            {hasInput && (
              <div>
                <div className="text-sm text-muted-foreground mb-2">Parameters:</div>
                <CodeBlock language="json">{JSON.stringify(input, null, 2)}</CodeBlock>
              </div>
            )}

            {hasError && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
                  <span className="text-sm text-red-700 dark:text-red-300">Error:</span>
                </div>
                <div className="text-sm text-red-700 dark:text-red-300 bg-red-50/50 dark:bg-red-950/20 p-3 rounded border border-red-200/50 dark:border-red-800/30">
                  {(() => {
                    const textContent = extractTextContentParts(part.output);
                    if (textContent) {
                      return textContent;
                    }
                    if (typeof part.output === "string") {
                      return part.output;
                    }
                    return JSON.stringify(part.output, null, 2);
                  })()}
                </div>
              </div>
            )}

            {!hasError && catalogText && (
              <div>
                <div className="text-sm text-muted-foreground mb-2">Output:</div>
                <div className="rounded-md border bg-muted/50 p-4">
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <TextFormatter text={catalogText} />
                  </div>
                </div>
              </div>
            )}

            {hasErrorText && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
                  <span className="text-sm text-red-700 dark:text-red-300">Error:</span>
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
