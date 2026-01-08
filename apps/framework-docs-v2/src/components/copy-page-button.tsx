"use client";

import { useState } from "react";
import { IconCopy, IconCheck } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface CopyPageButtonProps {
  content: string;
}

export function CopyPageButton({ content }: CopyPageButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Copy failed:", error);
    }
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            onClick={handleCopyMarkdown}
            size="sm"
            variant="outline"
            className="gap-2"
          >
            {copied ?
              <IconCheck className="h-4 w-4" />
            : <IconCopy className="h-4 w-4" />}
            <span className="hidden sm:inline">Copy Page</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{copied ? "Copied!" : "Copy as Markdown"}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
