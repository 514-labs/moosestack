"use client";

import { Suspense, ReactNode, useState, useEffect } from "react";

const STORAGE_KEY_PREFIX = "moose-docs-interactive";

interface ConditionalContentProps {
  /** ID of the SelectField or CheckboxGroup to watch */
  whenId: string;
  /** Value(s) that should trigger showing this content */
  whenValue: string | string[];
  /** How to match the value: "equals" for SelectField, "includes" for CheckboxGroup */
  match?: "equals" | "includes";
  /** Content to show when condition is met */
  children: ReactNode;
  /** Content to show when condition is NOT met (optional) */
  fallback?: ReactNode;
}

function ConditionalContentInner({
  whenId,
  whenValue,
  match = "equals",
  children,
  fallback,
}: ConditionalContentProps) {
  const [currentValue, setCurrentValue] = useState<string | string[] | null>(
    null,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const storageKey = `${STORAGE_KEY_PREFIX}-${whenId}`;

    const readStoredValue = () => {
      try {
        const stored = localStorage.getItem(storageKey);
        if (stored !== null) {
          const value = JSON.parse(stored);
          setCurrentValue(value);
        }
      } catch {
        // Ignore parsing errors
      }
    };

    // Initial read
    readStoredValue();

    // Listen for storage changes from other tabs
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === storageKey) {
        readStoredValue();
      }
    };

    window.addEventListener("storage", handleStorageChange);

    // Poll for same-page updates (storage events don't fire on same page)
    const pollInterval = setInterval(readStoredValue, 100);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      clearInterval(pollInterval);
    };
  }, [whenId]);

  // Determine if content should be visible
  const isVisible = (() => {
    if (currentValue === null) return false;

    const targetValues = Array.isArray(whenValue) ? whenValue : [whenValue];

    if (match === "includes") {
      // For CheckboxGroup: check if any target value is in the array
      if (Array.isArray(currentValue)) {
        return targetValues.some((v) => currentValue.includes(v));
      }
      return false;
    } else {
      // For SelectField: check if current value equals any target value
      if (typeof currentValue === "string") {
        return targetValues.includes(currentValue);
      }
      return false;
    }
  })();

  if (isVisible) {
    return <>{children}</>;
  }

  return fallback ? <>{fallback}</> : null;
}

/**
 * ConditionalContent - Show/hide content based on SelectField or CheckboxGroup values.
 *
 * Works with any component that persists to localStorage with the standard key format.
 *
 * @example
 * ```tsx
 * // With SelectField (match="equals" is default)
 * <SelectField id="language" options={[...]} persist />
 * <ConditionalContent whenId="language" whenValue="typescript">
 *   TypeScript-specific content here...
 * </ConditionalContent>
 * <ConditionalContent whenId="language" whenValue="python">
 *   Python-specific content here...
 * </ConditionalContent>
 *
 * // With CheckboxGroup (use match="includes")
 * <CheckboxGroup id="features" options={[...]} persist />
 * <ConditionalContent whenId="features" whenValue="analytics" match="includes">
 *   Analytics content shown when checkbox is checked...
 * </ConditionalContent>
 * ```
 */
export function ConditionalContent(props: ConditionalContentProps) {
  return (
    <Suspense fallback={null}>
      <ConditionalContentInner {...props} />
    </Suspense>
  );
}

export type { ConditionalContentProps };
