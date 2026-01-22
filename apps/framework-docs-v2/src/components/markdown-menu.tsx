"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  IconCopy,
  IconCheck,
  IconChevronDown,
  IconExternalLink,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLanguage } from "@/hooks/use-language";
import { cleanContent, filterLanguageContent } from "@/lib/content-filters";

interface MarkdownMenuProps {
  content: string;
  isMDX: boolean;
}

export function MarkdownMenu({ content, isMDX }: MarkdownMenuProps) {
  const [copied, setCopied] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { language } = useLanguage();
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Filter content client-side based on user's current language preference
  const filteredContent = useMemo(() => {
    if (!isMDX) {
      return content;
    }
    return cleanContent(filterLanguageContent(content, language));
  }, [content, language, isMDX]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const copyToClipboard = async () => {
    if (typeof window === "undefined" || !navigator.clipboard?.writeText) {
      console.error("Clipboard API not available");
      return;
    }

    try {
      await navigator.clipboard.writeText(filteredContent);
      setCopied(true);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  };

  const openMarkdown = () => {
    const query = searchParams.toString();
    const url = `${pathname}.md${query ? `?${query}` : ""}`;
    window.open(url, "_blank");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className="gap-2">
          {copied ?
            <IconCheck className="h-4 w-4" />
          : <IconCopy className="h-4 w-4" />}
          Copy Page
          <IconChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={copyToClipboard} className="cursor-pointer">
          <IconCopy className="h-4 w-4" />
          Copy as Markdown
        </DropdownMenuItem>
        <DropdownMenuItem onClick={openMarkdown} className="cursor-pointer">
          <IconExternalLink className="h-4 w-4" />
          Open Markdown
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
