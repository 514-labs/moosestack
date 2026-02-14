/**
 * Global guide settings management
 *
 * Settings are stored in individual localStorage keys (one per setting)
 * using the pattern: moose-docs-guide-settings-{key}
 *
 * This matches the storage pattern used by usePersistedState with namespace: "global"
 */

const STORAGE_KEY_PREFIX = "moose-docs-guide-settings";

export interface GuideSettings {
  language?: "typescript" | "python";
  os?: "macos" | "windows";
  sourceDatabase?: "postgres" | "sqlserver" | "none";
  monorepo?: "yes" | "no";
  existingApp?: "yes" | "no";
}

/**
 * Valid values for each setting field
 */
const VALID_VALUES: Record<keyof GuideSettings, string[]> = {
  language: ["typescript", "python"],
  os: ["macos", "windows"],
  sourceDatabase: ["postgres", "sqlserver", "none"],
  monorepo: ["yes", "no"],
  existingApp: ["yes", "no"],
};

/**
 * Validate a setting value against its expected type
 */
function isValidSetting<K extends keyof GuideSettings>(
  key: K,
  value: unknown,
): value is GuideSettings[K] {
  return typeof value === "string" && VALID_VALUES[key].includes(value);
}

/**
 * Get current guide settings from localStorage (reads from individual keys)
 */
export function getGuideSettings(): GuideSettings | null {
  if (typeof window === "undefined") return null;

  try {
    const settings: GuideSettings = {};
    const keys: (keyof GuideSettings)[] = [
      "language",
      "os",
      "sourceDatabase",
      "monorepo",
      "existingApp",
    ];

    for (const key of keys) {
      const storageKey = `${STORAGE_KEY_PREFIX}-${key}`;
      const stored = localStorage.getItem(storageKey);
      if (stored !== null) {
        try {
          const parsed = JSON.parse(stored);
          if (isValidSetting(key, parsed)) {
            settings[key] = parsed;
          }
        } catch {
          // Ignore parsing errors
        }
      }
    }

    return Object.keys(settings).length > 0 ? settings : null;
  } catch {
    return null;
  }
}

/**
 * Get a single setting value (reads from individual key)
 */
export function getSetting<K extends keyof GuideSettings>(
  key: K,
): GuideSettings[K] | null {
  if (typeof window === "undefined") return null;

  try {
    const storageKey = `${STORAGE_KEY_PREFIX}-${key}`;
    const stored = localStorage.getItem(storageKey);
    if (stored !== null) {
      const parsed = JSON.parse(stored);
      if (isValidSetting(key, parsed)) {
        return parsed;
      }
    }
  } catch {
    // Ignore parsing errors
  }

  return null;
}

/**
 * Clear all guide settings from localStorage
 */
export function clearGuideSettings(): void {
  if (typeof window === "undefined") return;

  try {
    const keys: (keyof GuideSettings)[] = [
      "language",
      "os",
      "sourceDatabase",
      "monorepo",
      "existingApp",
    ];

    for (const key of keys) {
      const storageKey = `${STORAGE_KEY_PREFIX}-${key}`;
      localStorage.removeItem(storageKey);
    }
  } catch (error) {
    console.error("Failed to clear guide settings:", error);
  }
}
