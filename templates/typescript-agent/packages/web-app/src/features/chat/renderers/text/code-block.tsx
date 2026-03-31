import type { JSX } from "react";
import { cn } from "@/lib/utils";

interface CodeBlockProps {
  children: string;
  language?: string;
}

export function CodeBlock({
  children,
  language = "json",
}: CodeBlockProps): JSX.Element {
  return (
    <pre
      data-language={language}
      className={cn(
        "mt-2 p-3 rounded-md text-xs font-mono",
        "bg-muted/50 border border-border",
        "overflow-x-auto whitespace-pre-wrap break-words",
      )}
    >
      <code>{children}</code>
    </pre>
  );
}
