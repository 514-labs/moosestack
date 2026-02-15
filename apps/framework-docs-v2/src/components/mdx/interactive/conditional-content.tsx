"use client";

import { Suspense, ReactNode, useState, useEffect } from "react";
import {
  INTERACTIVE_STATE_CHANGE_EVENT,
  STORAGE_KEY_PREFIX_PAGE,
  STORAGE_KEY_PREFIX_GLOBAL,
  type InteractiveStateChangeDetail,
} from "./use-persisted-state";
import { getSetting, normalizeFieldId } from "@/lib/guide-settings";

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

  // Check both page and global storage keys
  const pageStorageKey = `${STORAGE_KEY_PREFIX_PAGE}-${whenId}`;

  // For global storage, use normalized (camelCase) key if this field maps to a global setting
  const normalizedFieldId = normalizeFieldId(whenId);
  const globalStorageKey =
    normalizedFieldId ?
      `${STORAGE_KEY_PREFIX_GLOBAL}-${normalizedFieldId}`
    : `${STORAGE_KEY_PREFIX_GLOBAL}-${whenId}`;

  useEffect(() => {
    if (typeof window === "undefined") return;

    const readStoredValue = () => {
      try {
        // Priority 1: Check page-level localStorage (allows per-page overrides)
        const pageStored = localStorage.getItem(pageStorageKey);
        if (pageStored !== null) {
          const value = JSON.parse(pageStored);
          setCurrentValue(value);
          return;
        }

        // Priority 2: Check global guide settings (fallback to user's global preferences)
        if (normalizedFieldId) {
          const globalValue = getSetting(normalizedFieldId);
          if (globalValue !== null && globalValue !== undefined) {
            setCurrentValue(globalValue);
            return;
          }
        }

        // Priority 3: Check global storage with raw key (legacy support)
        const globalStored = localStorage.getItem(globalStorageKey);
        if (globalStored !== null) {
          const value = JSON.parse(globalStored);
          setCurrentValue(value);
        }
      } catch {
        // Ignore parsing errors
      }
    };

    // Initial read
    readStoredValue();

    // Listen for storage changes from other tabs (both page and global keys)
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === pageStorageKey || event.key === globalStorageKey) {
        // Reset to null if key was removed, otherwise read the new value
        if (event.newValue === null) {
          setCurrentValue(null);
        } else {
          readStoredValue();
        }
      }
    };

    window.addEventListener("storage", handleStorageChange);

    // Listen for same-page state changes via custom event (matches either key)
    // TODO: If CustomizePanel remains in use, add UI warning when page-level
    // settings conflict with global settings (e.g., badge showing "Page override active")
    const handleStateChange = (event: Event) => {
      const customEvent = event as CustomEvent<InteractiveStateChangeDetail>;
      if (
        customEvent.detail?.key === pageStorageKey ||
        customEvent.detail?.key === globalStorageKey
      ) {
        // Re-evaluate priority chain to respect page → global → legacy order
        // This ensures same-page updates behave consistently with cross-tab updates
        readStoredValue();
      }
    };

    window.addEventListener(INTERACTIVE_STATE_CHANGE_EVENT, handleStateChange);

    // Note: handleStorageChange now covers both page and global storage

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener(
        INTERACTIVE_STATE_CHANGE_EVENT,
        handleStateChange,
      );
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
