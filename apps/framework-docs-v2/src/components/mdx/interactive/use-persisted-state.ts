"use client";

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY_PREFIX = "moose-docs-interactive";

/**
 * Custom hook for persistent state with localStorage support.
 * Provides automatic sync across components using the same key.
 *
 * @param key - Unique identifier for this state (without prefix). If undefined, persistence is disabled.
 * @param defaultValue - Default value when no stored value exists
 * @param persist - Whether to actually persist to localStorage (default: false)
 */
export function usePersistedState<T>(
  key: string | undefined,
  defaultValue: T,
  persist: boolean = false,
): [T, (value: T | ((prev: T) => T)) => void] {
  // Build full storage key
  const storageKey = key ? `${STORAGE_KEY_PREFIX}-${key}` : undefined;

  // Initialize state - check localStorage on first render if persisting
  const [value, setValue] = useState<T>(() => {
    if (!persist || !storageKey || typeof window === "undefined") {
      return defaultValue;
    }

    try {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null) {
        return JSON.parse(stored) as T;
      }
    } catch {
      // Ignore parsing errors, use default
    }

    return defaultValue;
  });

  // Sync to localStorage when value changes
  useEffect(() => {
    if (!persist || !storageKey || typeof window === "undefined") {
      return;
    }

    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // Ignore storage errors (quota exceeded, etc.)
    }
  }, [persist, storageKey, value]);

  // Listen for changes from other components/tabs
  useEffect(() => {
    if (!persist || !storageKey || typeof window === "undefined") {
      return;
    }

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === storageKey && event.newValue !== null) {
        try {
          setValue(JSON.parse(event.newValue) as T);
        } catch {
          // Ignore parsing errors
        }
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [persist, storageKey]);

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
 * Helper to clear all interactive component state from localStorage
 */
export function clearInteractiveState(): void {
  if (typeof window === "undefined") return;

  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(STORAGE_KEY_PREFIX)) {
      keysToRemove.push(key);
    }
  }

  keysToRemove.forEach((key) => localStorage.removeItem(key));
}
