"use client";

import { createContext, useContext } from "react";

interface TierConfig {
  tier: 1 | 2 | 3;
  apiPath: string;
  tierLabel: string;
}

const tierConfigs: Record<1 | 2 | 3, TierConfig> = {
  1: { tier: 1, apiPath: "/api/tier1/chat", tierLabel: "Tier 1: API Key" },
  2: {
    tier: 2,
    apiPath: "/api/tier2/chat",
    tierLabel: "Tier 2: JWT Passthrough",
  },
  3: {
    tier: 3,
    apiPath: "/api/tier3/chat",
    tierLabel: "Tier 3: Row-Level Security",
  },
};

const TierContext = createContext<TierConfig | null>(null);

export function TierProvider({
  tier,
  children,
}: {
  tier: 1 | 2 | 3;
  children: React.ReactNode;
}) {
  return (
    <TierContext.Provider value={tierConfigs[tier]}>
      {children}
    </TierContext.Provider>
  );
}

export function useTier(): TierConfig {
  const context = useContext(TierContext);
  if (!context) {
    throw new Error("useTier must be used within a TierProvider");
  }
  return context;
}
