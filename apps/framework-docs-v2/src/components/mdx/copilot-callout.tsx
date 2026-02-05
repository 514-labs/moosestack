"use client";

import { useState, useRef } from "react";
import { IconCheck, IconCopy, IconRobot } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { cleanContent } from "@/lib/content-filters";

interface CopilotCalloutProps {
  /** System instruction preamble prepended to the copied markdown */
  systemPrompt: string;
  /** Raw markdown content injected by the preprocessor (used for copy) */
  rawContent?: string;
  /** Path to the content file (used by preprocessor only, ignored at runtime) */
  contentFile?: string;
  /** Callout title */
  title?: string;
  /** Label for the copy button */
  buttonLabel?: string;
  children: React.ReactNode;
}

export function CopilotCallout({
  systemPrompt,
  rawContent = "",
  title = "AI Copilot",
  buttonLabel = "Copy Prompt",
  children,
}: CopilotCalloutProps) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleCopy = async () => {
    if (typeof window === "undefined" || !navigator.clipboard?.writeText) {
      return;
    }

    try {
      const cleaned = cleanContent(rawContent);
      const prompt = `${systemPrompt.trim()}\n\n---\n\n${cleaned}`;
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy prompt:", error);
    }
  };

  return (
    <Alert variant="default" className="my-4">
      <IconRobot className="h-4 w-4" />
      <div className="flex items-center justify-between">
        <AlertTitle>{title}</AlertTitle>
        <Button
          size="sm"
          variant="secondary"
          onClick={handleCopy}
          className="gap-1.5 shrink-0"
        >
          {copied ?
            <IconCheck className="h-3.5 w-3.5" />
          : <IconCopy className="h-3.5 w-3.5" />}
          {copied ? "Copied!" : buttonLabel}
        </Button>
      </div>
      <AlertDescription className="text-muted-foreground">
        {children}
      </AlertDescription>
    </Alert>
  );
}
