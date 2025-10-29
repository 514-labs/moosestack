"use client";

import * as React from "react";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface SnippetProps extends React.ComponentProps<typeof Tabs> {
  className?: string;
}

export function Snippet({ className, children, ...props }: SnippetProps) {
  return (
    <Tabs {...props} className="w-full">
      <div
        className={cn(
          "rounded-lg border bg-muted/50 overflow-hidden my-4",
          className,
        )}
      >
        {children}
      </div>
    </Tabs>
  );
}

export interface SnippetHeaderProps {
  className?: string;
  children: React.ReactNode;
}

export function SnippetHeader({ className, children }: SnippetHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between border-b bg-transparent px-3 h-12 rounded-t-lg",
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface SnippetTabsListProps
  extends React.ComponentProps<typeof TabsList> {}

export function SnippetTabsList({ className, ...props }: SnippetTabsListProps) {
  return (
    <TabsList
      className={cn("h-auto border-0 bg-transparent p-0", className)}
      {...props}
    />
  );
}

export interface SnippetTabsTriggerProps
  extends React.ComponentProps<typeof TabsTrigger> {}

export function SnippetTabsTrigger(props: SnippetTabsTriggerProps) {
  return <TabsTrigger {...props} />;
}

export interface SnippetTabsContentProps
  extends React.ComponentProps<typeof TabsContent> {}

export function SnippetTabsContent({
  className,
  children,
  ...props
}: SnippetTabsContentProps) {
  return (
    <TabsContent className={cn("mt-0 bg-muted/50", className)} {...props}>
      <pre className="not-prose overflow-x-auto rounded-md p-4">
        <code className="text-sm font-mono whitespace-pre text-foreground">
          {children}
        </code>
      </pre>
    </TabsContent>
  );
}

export interface SnippetCopyButtonProps {
  value: string;
  onCopy?: (value: string) => void;
  onError?: (error: Error) => void;
  className?: string;
}

export function SnippetCopyButton({
  value,
  onCopy,
  onError,
  className,
}: SnippetCopyButtonProps) {
  const [isCopied, setIsCopied] = React.useState(false);

  const copyToClipboard = async () => {
    if (typeof window === "undefined" || !navigator.clipboard.writeText) {
      const error = new Error("Clipboard API not available");
      onError?.(error);
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      setIsCopied(true);
      onCopy?.(value);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      onError?.(err);
      console.error("Failed to copy:", err);
    }
  };

  return (
    <Button
      className={cn("h-7 w-7 ml-auto", className)}
      onClick={copyToClipboard}
      size="icon"
      variant="ghost"
    >
      {isCopied ?
        <IconCheck className="h-3 w-3" />
      : <IconCopy className="h-3 w-3" />}
      <span className="sr-only">Copy code</span>
    </Button>
  );
}
