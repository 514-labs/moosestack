"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// Storage key prefixes (exported for use in other components)
export const STORAGE_KEY_PREFIX_PAGE = "moose-docs-interactive";
export const STORAGE_KEY_PREFIX_GLOBAL = "moose-docs-guide-settings";

// Custom event name for same-page state updates
export const INTERACTIVE_STATE_CHANGE_EVENT = "moose-interactive-state-change";

// Persistence options
export interface PersistOptions {
  /** Storage scope: "page" for per-page settings, "global" for cross-page settings */
  namespace?: "page" | "global";
  /** Whether to sync this field to URL params for deep linking (default: false) */
  syncToUrl?: boolean;
  /** Whether to sync across tabs via storage events (default: true) */
  syncCrossTabs?: boolean;
}

// Custom event detail type
export interface InteractiveStateChangeDetail<T = string | string[] | null> {
  key: string;
  value: T;
}

/**
 * Dispatch a custom event for same-page state synchronization.
 * This replaces the need for polling in ConditionalContent.
 */
function dispatchStateChange<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;

  const event = new CustomEvent<InteractiveStateChangeDetail<T>>(
    INTERACTIVE_STATE_CHANGE_EVENT,
    {
      detail: { key, value },
    },
  );
  window.dispatchEvent(event);
}

/**
 * Read value from URL search params
 * Attempts JSON parse first, falls back to raw string if parsing fails
 */
function getValueFromURL<T>(key: string): T | null {
  if (typeof window === "undefined") return null;

  try {
    const params = new URLSearchParams(window.location.search);
    const value = params.get(key);
    if (value !== null) {
      try {
        // Try JSON parse first (for objects/arrays)
        return JSON.parse(value) as T;
      } catch {
        // If JSON parse fails, return raw string
        return value as T;
      }
    }
  } catch {
    // Ignore URL parsing errors
  }

  return null;
}

/**
 * Update URL search params without adding to history
 */
function updateURLParam(key: string, value: string): void {
  if (typeof window === "undefined") return;

  try {
    const url = new URL(window.location.href);
    url.searchParams.set(key, value);
    window.history.replaceState({}, "", url.toString());
  } catch {
    // Ignore URL update errors
  }
}

/**
 * Custom hook for persistent state with localStorage and optional URL support.
 * Provides automatic sync across components using the same key.
 * Priority order: URL params (if enabled) → localStorage → defaultValue
 *
 * @param key - Unique identifier for this state (without prefix). If undefined, persistence is disabled.
 * @param defaultValue - Default value when no stored value exists
 * @param options - Persistence options (can pass boolean for backwards compat or PersistOptions object)
 */
export function usePersistedState<T>(
  key: string | undefined,
  defaultValue: T,
  options: boolean | PersistOptions = false,
): [T, (value: T | ((prev: T) => T)) => void] {
  // Normalize options (backwards compat: boolean → { namespace: "page", syncToUrl: true })
  const opts: PersistOptions =
    typeof options === "boolean" ?
      { namespace: "page", syncToUrl: options, syncCrossTabs: true }
    : { namespace: "page", syncToUrl: false, syncCrossTabs: true, ...options };

  const persist = typeof options === "boolean" ? options : true;

  // Build full storage key based on namespace
  const prefix =
    opts.namespace === "global" ?
      STORAGE_KEY_PREFIX_GLOBAL
    : STORAGE_KEY_PREFIX_PAGE;
  const storageKey = key ? `${prefix}-${key}` : undefined;

  // Track if this is the first render using a ref (doesn't cause re-render)
  const isFirstRenderRef = useRef(true);

  // Initialize state - check URL params first, then localStorage, then default
  const [value, setValue] = useState<T>(() => {
    if (!persist || !key || typeof window === "undefined") {
      return defaultValue;
    }

    // Priority 1: Check URL params (only if syncToUrl is enabled)
    if (opts.syncToUrl) {
      const urlValue = getValueFromURL<T>(key);
      if (urlValue !== null) {
        return urlValue;
      }
    }

    // Priority 2: Check localStorage
    try {
      const stored = localStorage.getItem(storageKey!);
      if (stored !== null) {
        return JSON.parse(stored) as T;
      }
    } catch {
      // Ignore parsing errors, use default
    }

    // Priority 3: Use default
    return defaultValue;
  });

  // Sync to localStorage and URL when value changes (skip initial mount with defaults)
  useEffect(() => {
    if (!persist || !key || typeof window === "undefined") {
      return;
    }

    // Skip on first render ONLY if value equals default (avoid polluting URL with defaults)
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      // Skip only if value is the default value
      if (JSON.stringify(value) === JSON.stringify(defaultValue)) {
        return;
      }
      // If value came from URL, we still need to sync to localStorage and dispatch
    }

    try {
      // Update localStorage
      if (storageKey) {
        localStorage.setItem(storageKey, JSON.stringify(value));
      }

      // Update URL param (for deep linking) - only if syncToUrl is enabled
      if (opts.syncToUrl) {
        updateURLParam(
          key,
          typeof value === "string" ? value : JSON.stringify(value),
        );
      }

      // Dispatch custom event for same-page synchronization
      if (storageKey) {
        dispatchStateChange(storageKey, value);
      }
    } catch {
      // Ignore storage errors (quota exceeded, etc.)
    }
  }, [persist, key, storageKey, value, defaultValue]);

  // Listen for changes from other components/tabs and browser navigation
  useEffect(() => {
    if (!persist || !storageKey || !key || typeof window === "undefined") {
      return;
    }

    // Handle storage events from other tabs (only if cross-tab sync enabled)
    const handleStorageChange =
      opts.syncCrossTabs ?
        (event: StorageEvent) => {
          if (event.key === storageKey && event.newValue !== null) {
            try {
              setValue(JSON.parse(event.newValue) as T);
            } catch {
              // Ignore parsing errors
            }
          }
        }
      : null;

    // Handle browser back/forward navigation (popstate) - only if URL sync enabled
    const handlePopState =
      opts.syncToUrl ?
        () => {
          const urlValue = getValueFromURL<T>(key);
          if (urlValue !== null) {
            setValue(urlValue);
          } else {
            // URL param missing - check localStorage or use default
            try {
              const stored = localStorage.getItem(storageKey!);
              if (stored !== null) {
                setValue(JSON.parse(stored) as T);
              } else {
                setValue(defaultValue);
              }
            } catch {
              setValue(defaultValue);
            }
          }
        }
      : null;

    if (handleStorageChange) {
      window.addEventListener("storage", handleStorageChange);
    }
    if (handlePopState) {
      window.addEventListener("popstate", handlePopState);
    }
    return () => {
      if (handleStorageChange) {
        window.removeEventListener("storage", handleStorageChange);
      }
      if (handlePopState) {
        window.removeEventListener("popstate", handlePopState);
      }
    };
  }, [
    persist,
    storageKey,
    key,
    defaultValue,
    opts.syncToUrl,
    opts.syncCrossTabs,
  ]);

  // Wrapped setter that handles both direct values and updater functions
  const setPersistedValue = useCallback((newValue: T | ((prev: T) => T)) => {
    setValue((prev) => {
      const resolved =
        typeof newValue === "function" ?
          (newValue as (prev: T) => T)(prev)
        : newValue;
      return resolved;
    });
  }, []);

  return [value, setPersistedValue];
}

/**
 * Hook to sync state with localStorage across tabs and same-page components.
 * Handles both cross-tab (storage event) and same-page (custom event) synchronization.
 *
 * @param storageKey - Full storage key to watch
 * @param onValueChange - Callback when value changes from storage/events
 * @param deps - Dependency array for useEffect
 */
export function useStorageSync<T>(
  storageKey: string | undefined,
  onValueChange: (value: T | null) => void,
  deps: React.DependencyList = [],
): void {
  // Use ref to avoid stale closure issues
  const onValueChangeRef = useRef(onValueChange);
  onValueChangeRef.current = onValueChange;

  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;

    // Listen for storage changes from other tabs
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === storageKey) {
        if (event.newValue === null) {
          onValueChangeRef.current(null);
        } else {
          try {
            const value = JSON.parse(event.newValue) as T;
            onValueChangeRef.current(value);
          } catch {
            // Ignore parsing errors
          }
        }
      }
    };

    // Listen for same-page state changes via custom event
    const handleStateChange = (event: Event) => {
      const customEvent = event as CustomEvent<InteractiveStateChangeDetail<T>>;
      if (customEvent.detail?.key === storageKey) {
        onValueChangeRef.current(customEvent.detail.value);
      }
    };

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener(INTERACTIVE_STATE_CHANGE_EVENT, handleStateChange);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener(
        INTERACTIVE_STATE_CHANGE_EVENT,
        handleStateChange,
      );
    };
  }, [storageKey, ...deps]);
}

/**
 * Helper to clear all interactive component state from localStorage and URL
 */
export function clearInteractiveState(): void {
  if (typeof window === "undefined") return;

  // Clear localStorage
  const storageKeysToRemove: string[] = [];
  const urlParamsToRemove: string[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (
      key?.startsWith(STORAGE_KEY_PREFIX_PAGE) ||
      key?.startsWith(STORAGE_KEY_PREFIX_GLOBAL)
    ) {
      storageKeysToRemove.push(key);
      // Extract the param key (without prefix) for URL cleanup
      const prefix =
        key?.startsWith(STORAGE_KEY_PREFIX_GLOBAL) ?
          STORAGE_KEY_PREFIX_GLOBAL
        : STORAGE_KEY_PREFIX_PAGE;
      const paramKey = key.substring(prefix.length + 1); // +1 for the hyphen
      urlParamsToRemove.push(paramKey);
    }
  }

  storageKeysToRemove.forEach((key) => {
    localStorage.removeItem(key);
  });

  // Clear only the URL params that correspond to interactive state
  try {
    const url = new URL(window.location.href);
    urlParamsToRemove.forEach((paramKey) => {
      url.searchParams.delete(paramKey);
    });
    window.history.replaceState({}, "", url.toString());
  } catch {
    // Ignore URL update errors
  }
}
