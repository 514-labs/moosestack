"use client";

import React from "react";
import { FullPageCustomizer } from "./full-page-customizer";
import { CustomizeGrid } from "./customize-grid";
import { SelectField } from "./select-field";
import { useGuideSettings } from "@/contexts/guide-settings-context";

interface GlobalGuideCustomizerProps {
  open: boolean;
  onClose?: () => void;
}

/**
 * GlobalGuideCustomizer - Modal for configuring global guide settings
 *
 * Manages settings that apply across all guide pages:
 * - Language (TypeScript/Python)
 * - Operating System (macOS/Windows)
 * - Source Database (Postgres/SQL Server/None)
 * - Monorepo (Yes/No)
 * - Existing App (Yes/No)
 */
export function GlobalGuideCustomizer({
  open,
  onClose,
}: GlobalGuideCustomizerProps): React.JSX.Element | null {
  const { updateSettings, setShowCustomizer } = useGuideSettings();

  const handleContinue = () => {
    // Settings are automatically saved via SelectField persist prop
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
        <SelectField
          id="language"
          label="Language"
          options={[
            { value: "typescript", label: "TypeScript" },
            { value: "python", label: "Python" },
          ]}
          defaultValue="typescript"
          persist={{ namespace: "global", syncToUrl: false }}
        />
        <SelectField
          id="os"
          label="Operating System"
          options={[
            { value: "macos", label: "macOS or Linux" },
            { value: "windows", label: "Windows (WSL 2)" },
          ]}
          defaultValue="macos"
          persist={{ namespace: "global", syncToUrl: false }}
        />
        <SelectField
          id="sourceDatabase"
          label="Source Database"
          options={[
            { value: "postgres", label: "Postgres" },
            { value: "sqlserver", label: "SQL Server" },
            { value: "none", label: "Starting from scratch" },
          ]}
          defaultValue="postgres"
          persist={{ namespace: "global", syncToUrl: false }}
        />
        {/* Hidden for now - not used in current guides */}
        {/* <SelectField
          id="monorepo"
          label="Project Structure"
          options={[
            { value: "yes", label: "Monorepo" },
            { value: "no", label: "Single repo" },
          ]}
          defaultValue="no"
          persist={{ namespace: "global", syncToUrl: false }}
        />
        <SelectField
          id="existingApp"
          label="Application Setup"
          options={[
            { value: "yes", label: "Add to existing app" },
            { value: "no", label: "New app" },
          ]}
          defaultValue="no"
          persist={{ namespace: "global", syncToUrl: false }}
        /> */}
      </CustomizeGrid>
    </FullPageCustomizer>
  );
}
