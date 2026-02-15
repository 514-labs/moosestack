"use client";

import React from "react";
import { FullPageCustomizer } from "./full-page-customizer";
import { CustomizeGrid } from "./customize-grid";
import { SelectField } from "./select-field";
import { useGuideSettings } from "@/contexts/guide-settings-context";
import {
  VISIBLE_SETTINGS,
  GUIDE_SETTINGS_CONFIG,
} from "@/config/guide-settings-config";
import { STORAGE_KEY_PREFIX } from "@/lib/guide-settings";

interface GlobalGuideCustomizerProps {
  open: boolean;
  onClose?: () => void;
}

/**
 * GlobalGuideCustomizer - Modal for configuring global guide settings
 *
 * Automatically renders all visible settings from the guide settings config.
 * To add a new setting, just add it to GUIDE_SETTINGS_CONFIG in:
 * @see src/config/guide-settings-config.ts
 */
export function GlobalGuideCustomizer({
  open,
  onClose,
}: GlobalGuideCustomizerProps): React.JSX.Element | null {
  const { setShowCustomizer } = useGuideSettings();

  const handleContinue = () => {
    // Ensure all defaults are persisted to localStorage before closing
    // This prevents the wizard from reappearing when users accept defaults
    if (typeof window !== "undefined") {
      GUIDE_SETTINGS_CONFIG.forEach((setting) => {
        const storageKey = `${STORAGE_KEY_PREFIX}-${setting.id}`;
        const stored = localStorage.getItem(storageKey);

        // Only write default if no value exists (don't overwrite user changes)
        if (stored === null) {
          localStorage.setItem(
            storageKey,
            JSON.stringify(setting.defaultValue),
          );
        }
      });
    }

    setShowCustomizer(false);
    if (onClose) onClose();
  };

  const handleClose = () => {
    setShowCustomizer(false);
    if (onClose) onClose();
  };

  if (!open) return null;

  return (
    <FullPageCustomizer
      title="Customize guides"
      description="Select your preferences to see relevant instructions across all guides"
      onContinue={handleContinue}
      onClose={handleClose}
      buttonText="Continue to guides"
    >
      <CustomizeGrid>
        {VISIBLE_SETTINGS.map((setting) => (
          <SelectField
            key={setting.id}
            id={setting.id}
            label={setting.label}
            options={setting.options}
            defaultValue={setting.defaultValue}
            persist={{ namespace: "global", syncToUrl: false }}
            placeholder={setting.description}
          />
        ))}
      </CustomizeGrid>
    </FullPageCustomizer>
  );
}
