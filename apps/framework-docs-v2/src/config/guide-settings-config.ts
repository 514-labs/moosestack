/**
 * Guide Settings Configuration
 *
 * This is the SINGLE source of truth for all global guide settings.
 * To add a new setting, just add an entry to this config object.
 */

export interface SettingOption {
  value: string;
  label: string;
  /**
   * Optional shorter label for chip/compact display contexts
   * TODO: Develop a rational truncation strategy for chip labels.
   * Consider: max character limits, abbreviation patterns, mobile breakpoints
   */
  chipLabel?: string;
}

export interface SettingConfig {
  /** Unique ID for this setting (used as storage key) */
  id: string;
  /** Display label for the setting */
  label: string;
  /** Available options for this setting */
  options: SettingOption[];
  /** Default value (must match one of the option values) */
  defaultValue: string;
  /** Description/help text (optional) */
  description?: string;
  /** Whether to show this setting in the UI (useful for phasing out fields) */
  visible?: boolean;
}

/**
 * Global Guide Settings Configuration
 *
 * Add new settings here - they'll automatically appear in:
 * - The customizer modal
 * - The settings summary panel
 * - TypeScript types
 * - Storage/retrieval functions
 */
export const GUIDE_SETTINGS_CONFIG: SettingConfig[] = [
  {
    id: "language",
    label: "Language",
    options: [
      { value: "typescript", label: "TypeScript" },
      { value: "python", label: "Python" },
    ],
    defaultValue: "typescript",
    description: "Your preferred programming language",
    visible: true,
  },
  {
    id: "os",
    label: "Operating System",
    options: [
      { value: "macos", label: "macOS or Linux", chipLabel: "macOS" },
      { value: "windows", label: "Windows (WSL 2)", chipLabel: "WSL 2" },
    ],
    defaultValue: "macos",
    description: "Your development environment",
    visible: true,
  },
  {
    id: "sourceDatabase",
    label: "Source Database",
    options: [
      { value: "postgres", label: "Postgres" },
      { value: "sqlserver", label: "SQL Server" },
      { value: "none", label: "Starting from scratch" },
    ],
    defaultValue: "postgres",
    description: "Database you're migrating from or working with",
    visible: true,
  },
  {
    id: "monorepo",
    label: "Project Structure",
    options: [
      { value: "yes", label: "Monorepo" },
      { value: "no", label: "Single repo" },
    ],
    defaultValue: "no",
    description: "Whether you're using a monorepo setup",
    visible: false, // Hidden until needed in guides
  },
  {
    id: "existingApp",
    label: "Application Setup",
    options: [
      { value: "yes", label: "Add to existing app" },
      { value: "no", label: "New app" },
    ],
    defaultValue: "no",
    description: "Whether you're adding Moose to an existing application",
    visible: false, // Hidden until needed in guides
  },
];

// Auto-generate TypeScript types from config
export type GuideSettingId = (typeof GUIDE_SETTINGS_CONFIG)[number]["id"];
export type GuideSettings = {
  [K in GuideSettingId]?: string;
};

// Auto-generate helper maps
export const GUIDE_SETTINGS_BY_ID = Object.fromEntries(
  GUIDE_SETTINGS_CONFIG.map((config) => [config.id, config]),
) as Record<GuideSettingId, SettingConfig>;

export const GUIDE_SETTINGS_LABELS = Object.fromEntries(
  GUIDE_SETTINGS_CONFIG.map((config) => [config.id, config.label]),
) as Record<GuideSettingId, string>;

export const GUIDE_SETTINGS_VALUE_LABELS = Object.fromEntries(
  GUIDE_SETTINGS_CONFIG.map((config) => [
    config.id,
    Object.fromEntries(config.options.map((opt) => [opt.value, opt.label])),
  ]),
) as Record<GuideSettingId, Record<string, string>>;

// Chip labels use shorter labels when available (for compact display)
export const GUIDE_SETTINGS_CHIP_LABELS = Object.fromEntries(
  GUIDE_SETTINGS_CONFIG.map((config) => [
    config.id,
    Object.fromEntries(
      config.options.map((opt) => [opt.value, opt.chipLabel || opt.label]),
    ),
  ]),
) as Record<GuideSettingId, Record<string, string>>;

export const VALID_VALUES = Object.fromEntries(
  GUIDE_SETTINGS_CONFIG.map((config) => [
    config.id,
    config.options.map((opt) => opt.value),
  ]),
) as Record<GuideSettingId, string[]>;

// Get visible settings (for UI rendering)
export const VISIBLE_SETTINGS = GUIDE_SETTINGS_CONFIG.filter(
  (config) => config.visible !== false,
);
