"use client";

import React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { IconArrowRight } from "@tabler/icons-react";
import { CustomizeGrid } from "./customize-grid";
import { SelectField } from "./select-field";
import { CheckboxGroup } from "./checkbox-group";
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
}: GlobalGuideCustomizerProps): React.JSX.Element {
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

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) handleClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl">Customize guides</DialogTitle>
          <DialogDescription>
            Select your preferences to see relevant instructions across all
            guides
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6 py-4">
          <CustomizeGrid columns={1}>
            <SelectField
              id="language"
              label="Language"
              options={[
                { value: "typescript", label: "TypeScript" },
                { value: "python", label: "Python" },
              ]}
              defaultValue="typescript"
              persist
              globalSetting
            />
            <SelectField
              id="os"
              label="Operating System"
              options={[
                { value: "macos", label: "macOS or Linux" },
                { value: "windows", label: "Windows (WSL 2)" },
              ]}
              defaultValue="macos"
              persist
              globalSetting
            />
            <CheckboxGroup
              id="sources"
              label="Sources"
              options={[
                { value: "postgres", label: "Postgres", defaultChecked: true },
                { value: "mysql", label: "MySQL" },
                { value: "sqlserver", label: "SQL Server" },
                { value: "api", label: "REST APIs" },
                { value: "kafka", label: "Kafka" },
                { value: "s3", label: "S3 / Parquet" },
              ]}
              persist
              globalSetting
            />
            <SelectField
              id="monorepo"
              label="Project Structure"
              options={[
                { value: "yes", label: "Monorepo" },
                { value: "no", label: "Single repo" },
              ]}
              defaultValue="no"
              persist
              globalSetting
            />
            <SelectField
              id="existingApp"
              label="Application Setup"
              options={[
                { value: "yes", label: "Add to existing app" },
                { value: "no", label: "New app" },
              ]}
              defaultValue="no"
              persist
              globalSetting
            />
          </CustomizeGrid>
        </div>
        <DialogFooter className="flex-col sm:flex-row gap-3">
          <Button
            onClick={handleContinue}
            className="w-full sm:w-auto"
            size="lg"
          >
            Continue to guides
            <IconArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
