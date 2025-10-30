"use client";

import * as React from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface SnippetTabProps {
  value: string;
  label: string;
  copyText: string;
  children: React.ReactNode;
}

export interface SnippetProps {
  defaultValue?: string;
  className?: string;
  children:
    | React.ReactElement<SnippetTabProps>
    | React.ReactElement<SnippetTabProps>[];
}

const SnippetContext = React.createContext<{
  activeValue: string;
  setActiveValue: (value: string) => void;
}>({
  activeValue: "",
  setActiveValue: () => {},
});

function SnippetTab({ value, label, copyText, children }: SnippetTabProps) {
  const { activeValue } = React.useContext(SnippetContext);

  if (activeValue !== value) {
    return null;
  }

  return (
    <div className="relative">
      <SnippetCopyButton copyText={copyText} />
      <div className="overflow-hidden rounded-b-md bg-muted/50">{children}</div>
    </div>
  );
}

function SnippetCopyButton({ copyText }: { copyText: string }) {
  const [isCopied, setIsCopied] = React.useState(false);

  const copyToClipboard = async () => {
    if (typeof window === "undefined" || !navigator.clipboard.writeText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(copyText);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  };

  return (
    <Button
      className="absolute right-2 top-2 h-7 w-7"
      onClick={copyToClipboard}
      size="icon"
      variant="ghost"
    >
      {isCopied ?
        <CheckIcon className="h-3 w-3" />
      : <CopyIcon className="h-3 w-3" />}
      <span className="sr-only">Copy code</span>
    </Button>
  );
}

export function Snippet({ defaultValue, className, children }: SnippetProps) {
  const [activeValue, setActiveValue] = React.useState(defaultValue || "");

  const tabs = React.Children.toArray(
    children,
  ) as React.ReactElement<SnippetTabProps>[];
  const firstTabValue = tabs[0]?.props.value || "";

  React.useEffect(() => {
    if (!activeValue && firstTabValue) {
      setActiveValue(firstTabValue);
    }
  }, [activeValue, firstTabValue]);

  const activeTab = tabs.find((tab) => tab.props.value === activeValue);
  const copyText = activeTab?.props.copyText || "";

  if (tabs.length === 1) {
    // Single tab - no tabs UI needed
    return (
      <SnippetContext.Provider value={{ activeValue, setActiveValue }}>
        <div
          className={cn("relative rounded-lg border bg-muted/50", className)}
        >
          {tabs.map((tab) => (
            <SnippetTab key={tab.props.value} {...tab.props} />
          ))}
        </div>
      </SnippetContext.Provider>
    );
  }

  return (
    <SnippetContext.Provider value={{ activeValue, setActiveValue }}>
      <Tabs
        value={activeValue}
        onValueChange={setActiveValue}
        className="w-full"
      >
        <div
          className={cn(
            "rounded-lg border bg-muted/50 overflow-hidden",
            className,
          )}
        >
          <TabsList className="h-9 rounded-t-lg rounded-b-none border-b bg-transparent">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.props.value} value={tab.props.value}>
                {tab.props.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="relative bg-muted/50">
            <SnippetCopyButton copyText={copyText} />
            {tabs.map((tab) => (
              <TabsContent
                key={tab.props.value}
                value={tab.props.value}
                className="mt-0"
              >
                {tab.props.children}
              </TabsContent>
            ))}
          </div>
        </div>
      </Tabs>
    </SnippetContext.Provider>
  );
}

// Export SnippetTab as a component that can be used in MDX
export { SnippetTab };
