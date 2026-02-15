/**
 * Global guide settings management
 *
 * Settings are stored in individual localStorage keys (one per setting)
 * using the pattern: moose-docs-guide-settings-{key}
 *
 * This matches the storage pattern used by usePersistedState with namespace: "global"
 */

import {
  type GuideSettings,
  type GuideSettingId,
  GUIDE_SETTINGS_LABELS,
  GUIDE_SETTINGS_VALUE_LABELS,
  GUIDE_SETTINGS_CHIP_LABELS,
  VALID_VALUES,
  GUIDE_SETTINGS_CONFIG,
} from "@/config/guide-settings-config";

// Re-export types and constants for backward compatibility
export type { GuideSettings, GuideSettingId };
export {
  GUIDE_SETTINGS_LABELS,
  GUIDE_SETTINGS_VALUE_LABELS,
  GUIDE_SETTINGS_CHIP_LABELS,
};

export const STORAGE_KEY_PREFIX = "moose-docs-guide-settings";

/**
 * Normalize field ID from kebab-case to camelCase for GuideSettings compatibility
 * Used to map page-level field IDs (e.g., "source-database") to global setting keys (e.g., "sourceDatabase")
 */
export function normalizeFieldId(fieldId: string): GuideSettingId | null {
  const normalized = fieldId.replace(/-([a-z])/g, (_, letter) =>
    letter.toUpperCase(),
  );

  const allSettingIds = GUIDE_SETTINGS_CONFIG.map((config) => config.id);

  return allSettingIds.includes(normalized) ?
      (normalized as GuideSettingId)
    : null;
}

/**
 * Validate a setting value against its expected type
 */
function isValidSetting(key: GuideSettingId, value: unknown): value is string {
  return (
    typeof value === "string" && Boolean(VALID_VALUES[key]?.includes(value))
  );
}

/**
 * Get current guide settings from localStorage (reads from individual keys)
 */
export function getGuideSettings(): GuideSettings | null {
  if (typeof window === "undefined") return null;

  try {
    const settings: GuideSettings = {};

    // Iterate over all configured settings
    for (const config of GUIDE_SETTINGS_CONFIG) {
      const storageKey = `${STORAGE_KEY_PREFIX}-${config.id}`;
      const stored = localStorage.getItem(storageKey);
      if (stored !== null) {
        try {
          const parsed = JSON.parse(stored);
          if (isValidSetting(config.id, parsed)) {
            settings[config.id] = parsed;
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
export function getSetting(key: GuideSettingId): string | null {
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
    // Clear all configured settings
    for (const config of GUIDE_SETTINGS_CONFIG) {
      const storageKey = `${STORAGE_KEY_PREFIX}-${config.id}`;
      localStorage.removeItem(storageKey);
    }
  } catch (error) {
    console.error("Failed to clear guide settings:", error);
  }
}
