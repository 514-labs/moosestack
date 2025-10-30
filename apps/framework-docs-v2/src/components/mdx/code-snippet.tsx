"use client";

import React from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CodeBlock,
  CodeBlockBody,
  CodeBlockItem,
  CodeBlockContent,
} from "@/components/ui/shadcn-io/code-block";

interface CodeSnippetProps {
  code: string;
  language?: string;
  filename?: string;
  copyButton?: boolean;
  className?: string;
}

function CopyButton({
  content,
  onCopy,
}: {
  content: string;
  onCopy?: (content: string) => void;
}) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    if (typeof window === "undefined" || !navigator.clipboard.writeText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      onCopy?.(content);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  };

  return (
    <Button
      className="absolute right-2 top-2 h-7 w-7 z-10"
      onClick={handleCopy}
      size="icon"
      variant="ghost"
    >
      {copied ?
        <Check className="h-3 w-3" />
      : <Copy className="h-3 w-3" />}
      <span className="sr-only">Copy code</span>
    </Button>
  );
}

export function CodeSnippet({
  code,
  language = "typescript",
  filename,
  copyButton = true,
  className,
}: CodeSnippetProps) {
  return (
    <div
      className={cn("relative my-4 rounded-lg border bg-muted/50", className)}
    >
      {copyButton && <CopyButton content={code} />}
      {filename && (
        <div className="border-b border-border/75 bg-muted/50 px-4 py-2 text-sm text-muted-foreground">
          {filename}
        </div>
      )}
      <div className="bg-muted/30 rounded-b-lg">
        <CodeBlock
          data={[
            {
              language,
              filename: filename || "",
              code,
            },
          ]}
          defaultValue={language}
          className="bg-transparent border-0"
        >
          <CodeBlockBody>
            {(item) => (
              <CodeBlockItem
                key={item.language}
                value={item.language}
                lineNumbers={true}
              >
                <CodeBlockContent
                  language={item.language as any}
                  themes={{
                    light: "vitesse-light",
                    dark: "vitesse-dark",
                  }}
                  syntaxHighlighting={true}
                >
                  {item.code}
                </CodeBlockContent>
              </CodeBlockItem>
            )}
          </CodeBlockBody>
        </CodeBlock>
      </div>
    </div>
  );
}
