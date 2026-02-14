"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { GuideSettings, getGuideSettings } from "@/lib/guide-settings";

interface GuideSettingsContextType {
  settings: GuideSettings | null;
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
  const [showCustomizer, setShowCustomizer] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const [settings, setSettings] = useState<GuideSettings | null>(null);

  // Load settings on mount and re-check when customizer closes
  useEffect(() => {
    setIsClient(true);
    const stored = getGuideSettings();
    setSettings(stored);

    // Show customizer if no settings exist
    if (!stored || Object.keys(stored).length === 0) {
      setShowCustomizer(true);
    }
  }, []);

  // Re-read settings when customizer closes
  useEffect(() => {
    if (!showCustomizer && isClient) {
      const stored = getGuideSettings();
      setSettings(stored);
    }
  }, [showCustomizer, isClient]);

  const isConfigured =
    isClient && settings !== null && Object.keys(settings).length > 0;

  return (
    <GuideSettingsContext.Provider
      value={{
        settings,
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
