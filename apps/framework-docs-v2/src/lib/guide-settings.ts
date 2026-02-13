/**
 * Global guide settings management
 *
 * Provides utilities for storing and retrieving guide customization settings
 * that persist across all guide pages.
 */

const STORAGE_KEY = "moose-docs-guide-settings";

export interface GuideSettings {
  language?: "typescript" | "python";
  os?: "macos" | "windows";
  sourceDatabase?: "postgres" | "sqlserver" | "none";
  monorepo?: "yes" | "no";
  existingApp?: "yes" | "no";
}

/**
 * Get current guide settings from localStorage
 */
export function getGuideSettings(): GuideSettings | null {
  if (typeof window === "undefined") return null;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

/**
 * Save guide settings to localStorage
 */
export function saveGuideSettings(settings: GuideSettings): void {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.error("Failed to save guide settings:", error);
  }
}

/**
 * Clear guide settings from localStorage
 */
export function clearGuideSettings(): void {
  if (typeof window === "undefined") return;

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error("Failed to clear guide settings:", error);
  }
}

/**
 * Get a single setting value
 */
export function getSetting<K extends keyof GuideSettings>(
  key: K,
): GuideSettings[K] | null {
  const settings = getGuideSettings();
  return settings?.[key] ?? null;
}

/**
 * Update a single setting value
 */
export function updateSetting<K extends keyof GuideSettings>(
  key: K,
  value: GuideSettings[K],
): void {
  const settings = getGuideSettings() || {};
  settings[key] = value;
  saveGuideSettings(settings);
}
