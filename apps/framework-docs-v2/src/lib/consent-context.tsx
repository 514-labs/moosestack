"use client";

import { createContext, useCallback, useContext, useState } from "react";
import type { ConsentState } from "./consent-cookie";
import { CONSENT_COOKIE_NAME, serializeConsentState } from "./consent-cookie";

interface ConsentContextValue {
  /** Whether the user has made a consent choice (accept or decline) */
  hasConsented: boolean;
  /** Whether analytics tracking is allowed */
  analyticsAllowed: boolean;
  /** Accept all tracking */
  acceptAll: () => void;
  /** Reject all tracking */
  rejectAll: () => void;
  /** Save granular preferences */
  savePreferences: (prefs: { analytics: boolean }) => void;
}

const ConsentContext = createContext<ConsentContextValue | null>(null);

function setConsentCookie(state: ConsentState): void {
  const value = serializeConsentState(state);
  const maxAge = 365 * 24 * 60 * 60; // 1 year
  const secure =
    typeof window !== "undefined" && window.location.protocol === "https:" ?
      ";Secure"
    : "";
  document.cookie = `${CONSENT_COOKIE_NAME}=${encodeURIComponent(value)};path=/;SameSite=Lax;max-age=${maxAge}${secure}`;
}

export function ConsentProvider({
  initialConsent,
  children,
}: {
  initialConsent: ConsentState | null;
  children: React.ReactNode;
}) {
  const [consent, setConsent] = useState<ConsentState | null>(initialConsent);

  const acceptAll = useCallback(() => {
    const state: ConsentState = {
      version: 1,
      analytics: true,
      updatedAt: new Date().toISOString(),
    };
    setConsentCookie(state);
    setConsent(state);
  }, []);

  const rejectAll = useCallback(() => {
    const state: ConsentState = {
      version: 1,
      analytics: false,
      updatedAt: new Date().toISOString(),
    };
    setConsentCookie(state);
    setConsent(state);
  }, []);

  const savePreferences = useCallback((prefs: { analytics: boolean }) => {
    const state: ConsentState = {
      version: 1,
      analytics: prefs.analytics,
      updatedAt: new Date().toISOString(),
    };
    setConsentCookie(state);
    setConsent(state);
  }, []);

  return (
    <ConsentContext.Provider
      value={{
        hasConsented: consent !== null,
        analyticsAllowed: consent?.analytics === true,
        acceptAll,
        rejectAll,
        savePreferences,
      }}
    >
      {children}
    </ConsentContext.Provider>
  );
}

export function useConsent(): ConsentContextValue {
  const context = useContext(ConsentContext);
  if (!context) {
    throw new Error("useConsent must be used within a ConsentProvider");
  }
  return context;
}
