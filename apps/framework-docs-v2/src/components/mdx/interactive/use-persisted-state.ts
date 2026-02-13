"use client";

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY_PREFIX = "moose-docs-interactive";

// Custom event name for same-page state updates
export const INTERACTIVE_STATE_CHANGE_EVENT = "moose-interactive-state-change";

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
 * Custom hook for persistent state with localStorage and URL support.
 * Provides automatic sync across components using the same key.
 * Priority order: URL params → localStorage → defaultValue
 *
 * @param key - Unique identifier for this state (without prefix). If undefined, persistence is disabled.
 * @param defaultValue - Default value when no stored value exists
 * @param persist - Whether to actually persist to localStorage and URL (default: false)
 */
export function usePersistedState<T>(
  key: string | undefined,
  defaultValue: T,
  persist: boolean = false,
): [T, (value: T | ((prev: T) => T)) => void] {
  // Build full storage key
  const storageKey = key ? `${STORAGE_KEY_PREFIX}-${key}` : undefined;

  // Track if this is the first render
  const [isFirstRender, setIsFirstRender] = useState(true);

  // Initialize state - check URL params first, then localStorage, then default
  const [value, setValue] = useState<T>(() => {
    if (!persist || !key || typeof window === "undefined") {
      return defaultValue;
    }

    // Priority 1: Check URL params
    const urlValue = getValueFromURL<T>(key);
    if (urlValue !== null) {
      return urlValue;
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

  // Sync to localStorage and URL when value changes (skip initial mount)
  useEffect(() => {
    if (!persist || !key || typeof window === "undefined") {
      return;
    }

    // Skip on first render to avoid polluting URL with defaults
    if (isFirstRender) {
      setIsFirstRender(false);
      return;
    }

    try {
      // Update localStorage
      if (storageKey) {
        localStorage.setItem(storageKey, JSON.stringify(value));
      }

      // Update URL param (for deep linking)
      updateURLParam(key, JSON.stringify(value));

      // Dispatch custom event for same-page synchronization
      if (storageKey) {
        dispatchStateChange(storageKey, value);
      }
    } catch {
      // Ignore storage errors (quota exceeded, etc.)
    }
  }, [persist, key, storageKey, value, isFirstRender]);

  // Listen for changes from other components/tabs and browser navigation
  useEffect(() => {
    if (!persist || !storageKey || !key || typeof window === "undefined") {
      return;
    }

    // Handle storage events from other tabs
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === storageKey && event.newValue !== null) {
        try {
          setValue(JSON.parse(event.newValue) as T);
        } catch {
          // Ignore parsing errors
        }
      }
    };

    // Handle browser back/forward navigation (popstate)
    const handlePopState = () => {
      const urlValue = getValueFromURL<T>(key);
      if (urlValue !== null) {
        setValue(urlValue);
      }
    };

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("popstate", handlePopState);
    };
  }, [persist, storageKey, key]);

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
 * Helper to clear all interactive component state from localStorage and URL
 */
export function clearInteractiveState(): void {
  if (typeof window === "undefined") return;

  // Clear localStorage
  const storageKeysToRemove: string[] = [];
  const urlParamsToRemove: string[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(STORAGE_KEY_PREFIX)) {
      storageKeysToRemove.push(key);
      // Extract the param key (without prefix) for URL cleanup
      const paramKey = key.substring(STORAGE_KEY_PREFIX.length + 1); // +1 for the hyphen
      urlParamsToRemove.push(paramKey);
    }
  }

  storageKeysToRemove.forEach((key) => localStorage.removeItem(key));

  // Clear only the URL params that correspond to interactive state
  try {
    const url = new URL(window.location.href);
    urlParamsToRemove.forEach((paramKey) => url.searchParams.delete(paramKey));
    window.history.replaceState({}, "", url.toString());
  } catch {
    // Ignore URL update errors
  }
}
