"use client";

import * as React from "react";
import { IconChevronRight, IconFile, IconFolder } from "@tabler/icons-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

// ============================================================================
// FileTree Root
// ============================================================================

interface FileTreeProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * FileTree component for MDX documentation
 *
 * Usage in MDX:
 * ```mdx
 * <FileTree>
 *   <FileTree.Folder name="app">
 *     <FileTree.File name="page.tsx" />
 *     <FileTree.Folder name="components">
 *       <FileTree.File name="Button.tsx" />
 *     </FileTree.Folder>
 *   </FileTree.Folder>
 * </FileTree>
 * ```
 */
export function FileTree({ children, className }: FileTreeProps) {
  return (
    <div
      className={cn(
        "not-prose rounded-lg border bg-card p-2 font-mono text-sm",
        className,
      )}
    >
      <ul className="flex w-full min-w-0 flex-col gap-1">{children}</ul>
    </div>
  );
}

// ============================================================================
// FileTreeFolder
// ============================================================================

interface FileTreeFolderProps {
  name: string;
  children?: React.ReactNode;
  defaultOpen?: boolean;
}

export function FileTreeFolder({
  name,
  children,
  defaultOpen = true,
}: FileTreeFolderProps) {
  return (
    <li className="group/menu-item relative">
      <Collapsible
        className="group/collapsible [&[data-state=open]>button>svg:first-child]:rotate-90"
        defaultOpen={defaultOpen}
      >
        <CollapsibleTrigger asChild>
          <button
            className={cn(
              "flex w-full items-center gap-2 rounded-md p-2 text-left text-sm",
              "hover:bg-accent hover:text-accent-foreground",
              "outline-none ring-ring focus-visible:ring-2",
              "[&>svg]:size-4 [&>svg]:shrink-0",
            )}
          >
            <IconChevronRight className="text-muted-foreground transition-transform" />
            <IconFolder className="text-muted-foreground" />
            <span className="truncate">{name}</span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul
            className={cn(
              "mx-3.5 flex min-w-0 translate-x-px flex-col gap-1",
              "border-l border-border px-2.5 pl-4 py-0.5",
            )}
          >
            {children}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

// ============================================================================
// FileTreeFile
// ============================================================================

interface FileTreeFileProps {
  name: string;
}

export function FileTreeFile({ name }: FileTreeFileProps) {
  return (
    <li>
      <div
        className={cn(
          "flex w-full items-center gap-2 rounded-md p-2 text-left text-sm",
          "[&>svg]:size-4 [&>svg]:shrink-0",
        )}
      >
        <IconFile className="text-muted-foreground" />
        <span className="truncate">{name}</span>
      </div>
    </li>
  );
}

// ============================================================================
// Attach sub-components for dot notation
// ============================================================================

FileTree.Folder = FileTreeFolder;
FileTree.File = FileTreeFile;
