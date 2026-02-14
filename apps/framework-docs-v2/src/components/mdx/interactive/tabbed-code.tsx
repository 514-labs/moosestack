"use client";

import { Suspense, ReactNode, useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  INTERACTIVE_STATE_CHANGE_EVENT,
  STORAGE_KEY_PREFIX_PAGE,
  useStorageSync,
  type InteractiveStateChangeDetail,
} from "./use-persisted-state";

interface CodeVariant {
  /** Unique value for this variant */
  value: string;
  /** Display label in the tab */
  label: string;
}

interface TabbedCodeProps {
  /** Available code variants */
  variants: CodeVariant[];
  /** Default selected variant */
  defaultValue?: string;
  /** Sync key for persisting and sharing state across TabbedCode components */
  syncKey?: string;
  /** Tab content (use TabbedCode.Content components) */
  children: ReactNode;
  /** Additional CSS classes */
  className?: string;
}

interface TabbedCodeContentProps {
  /** Value matching one of the variants */
  value: string;
  /** Content for this variant (usually code blocks) */
  children: ReactNode;
  /** Additional CSS classes */
  className?: string;
}

function TabbedCodeInner({
  variants,
  defaultValue,
  syncKey,
  children,
  className,
}: TabbedCodeProps) {
  const initialValue = defaultValue || variants[0]?.value || "";
  const [activeTab, setActiveTab] = useState(initialValue);

  // Sync with localStorage if syncKey is provided
  useEffect(() => {
    if (!syncKey || typeof window === "undefined") return;

    const storageKey = `${STORAGE_KEY_PREFIX_PAGE}-tabbed-${syncKey}`;

    // Read initial value from storage
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null) {
        const value = JSON.parse(stored) as string;
        if (variants.some((v) => v.value === value)) {
          setActiveTab(value);
        }
      }
    } catch {
      // Ignore parsing errors
    }
  }, [syncKey, variants]);

  // Sync with storage changes (cross-tab and same-page)
  useStorageSync<string>(
    syncKey ? `${STORAGE_KEY_PREFIX_PAGE}-tabbed-${syncKey}` : undefined,
    (value) => {
      if (
        value !== null &&
        typeof value === "string" &&
        variants.some((v) => v.value === value)
      ) {
        setActiveTab(value);
      }
    },
    [syncKey, variants],
  );

  const handleTabChange = (value: string) => {
    setActiveTab(value);

    // Persist to localStorage if syncKey is provided
    if (syncKey && typeof window !== "undefined") {
      const storageKey = `${STORAGE_KEY_PREFIX_PAGE}-tabbed-${syncKey}`;
      try {
        localStorage.setItem(storageKey, JSON.stringify(value));
        // Dispatch custom event for same-page synchronization
        const event = new CustomEvent<InteractiveStateChangeDetail>(
          INTERACTIVE_STATE_CHANGE_EVENT,
          {
            detail: { key: storageKey, value },
          },
        );
        window.dispatchEvent(event);
      } catch {
        // Ignore storage errors
      }
    }
  };

  return (
    <Tabs
      value={activeTab}
      onValueChange={handleTabChange}
      className={cn("my-4", className)}
    >
      <TabsList
        className="grid w-full max-w-md"
        style={{
          gridTemplateColumns: `repeat(${variants.length}, minmax(0, 1fr))`,
        }}
      >
        {variants.map((variant) => (
          <TabsTrigger key={variant.value} value={variant.value}>
            {variant.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {children}
    </Tabs>
  );
}

/**
 * Content panel for a specific code variant.
 * Use inside TabbedCode.
 */
function TabbedCodeContent({
  value,
  children,
  className,
}: TabbedCodeContentProps) {
  return (
    <TabsContent value={value} className={cn("mt-2", className)}>
      {children}
    </TabsContent>
  );
}

/**
 * TabbedCode - Tabbed code blocks for showing different language variants.
 *
 * Similar to LanguageTabs but more flexible:
 * - Custom variant labels (not just TypeScript/Python)
 * - Optional sync across components via syncKey
 * - Designed for use within accordion sections
 *
 * @example
 * ```tsx
 * <TabbedCode
 *   variants={[
 *     { value: "ts", label: "TypeScript" },
 *     { value: "py", label: "Python" }
 *   ]}
 *   syncKey="code-language"
 * >
 *   <TabbedCode.Content value="ts">
 *     ```typescript
 *     const x = 1;
 *     ```
 *   </TabbedCode.Content>
 *   <TabbedCode.Content value="py">
 *     ```python
 *     x = 1
 *     ```
 *   </TabbedCode.Content>
 * </TabbedCode>
 * ```
 */
function TabbedCodeRoot(props: TabbedCodeProps) {
  // Wrap in Suspense to handle hydration safely
  return (
    <Suspense
      fallback={
        <div className={cn("my-4", props.className)}>
          <div className="inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1">
            {props.variants.map((variant) => (
              <div
                key={variant.value}
                className="px-3 py-1 text-sm text-muted-foreground"
              >
                {variant.label}
              </div>
            ))}
          </div>
          <div className="mt-2">{props.children}</div>
        </div>
      }
    >
      <TabbedCodeInner {...props} />
    </Suspense>
  );
}

// Compose with sub-components using Object.assign pattern
export const TabbedCode = Object.assign(TabbedCodeRoot, {
  Content: TabbedCodeContent,
});

// Export sub-component separately for MDX renderer registration
export { TabbedCodeContent };

export type { TabbedCodeProps, TabbedCodeContentProps, CodeVariant };
