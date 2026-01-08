"use client";

import { useState } from "react";
import { IconCopy, IconCheck } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";

interface CopyPageButtonProps {
  content: string;
}

export function CopyPageButton({ content }: CopyPageButtonProps) {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async () => {
    if (typeof window === "undefined" || !navigator.clipboard.writeText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Copy failed:", error);
    }
  };

  return (
    <Button
      onClick={copyToClipboard}
      size="sm"
      variant="outline"
      className="gap-2"
    >
      {copied ?
        <IconCheck className="h-4 w-4" />
      : <IconCopy className="h-4 w-4" />}
      Copy Page
      <span className="sr-only">Copy Page</span>
    </Button>
  );
}
