"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import {
  GuideSettings,
  getGuideSettings,
  saveGuideSettings,
} from "@/lib/guide-settings";

interface GuideSettingsContextType {
  settings: GuideSettings | null;
  updateSettings: (settings: GuideSettings) => void;
  isConfigured: boolean;
  showCustomizer: boolean;
  setShowCustomizer: (show: boolean) => void;
}

const GuideSettingsContext = createContext<
  GuideSettingsContextType | undefined
>(undefined);

export function GuideSettingsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [settings, setSettings] = useState<GuideSettings | null>(null);
  const [showCustomizer, setShowCustomizer] = useState(false);
  const [isClient, setIsClient] = useState(false);

  // Load settings on mount
  useEffect(() => {
    setIsClient(true);
    const stored = getGuideSettings();
    setSettings(stored);

    // Show customizer if no settings exist
    if (!stored || Object.keys(stored).length === 0) {
      setShowCustomizer(true);
    }
  }, []);

  const updateSettings = (newSettings: GuideSettings) => {
    setSettings(newSettings);
    saveGuideSettings(newSettings);
  };

  const isConfigured =
    isClient && settings !== null && Object.keys(settings).length > 0;

  return (
    <GuideSettingsContext.Provider
      value={{
        settings,
        updateSettings,
        isConfigured,
        showCustomizer,
        setShowCustomizer,
      }}
    >
      {children}
    </GuideSettingsContext.Provider>
  );
}

export function useGuideSettings() {
  const context = useContext(GuideSettingsContext);
  if (context === undefined) {
    throw new Error(
      "useGuideSettings must be used within a GuideSettingsProvider",
    );
  }
  return context;
}
