"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { IconCopy, IconCheck } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function CopyPageButton() {
  const [copied, setCopied] = useState(false);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const pathname = usePathname();

  // Fetch markdown when page loads
  useEffect(() => {
    if (!pathname) return;

    const slug = pathname.replace(/^\//, "");

    const fetchMarkdown = async () => {
      try {
        const response = await fetch(`/api/markdown/${slug}`);
        if (!response.ok) {
          throw new Error("Failed to fetch markdown");
        }
        const text = await response.text();
        setMarkdown(text);
      } catch (error) {
        console.error("Error fetching markdown:", error);
      }
    };

    fetchMarkdown();
  }, [pathname]);

  const handleCopyMarkdown = async () => {
    if (!markdown) return;

    try {
      await navigator.clipboard.writeText(markdown);
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
