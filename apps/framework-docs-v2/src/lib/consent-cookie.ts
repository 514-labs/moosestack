export const CONSENT_COOKIE_NAME = "514-cookie-consent";

export interface ConsentState {
  version: number;
  analytics: boolean;
  marketing: boolean;
  updatedAt: string;
}

export function parseConsentCookie(
  value: string | undefined,
): ConsentState | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as ConsentState;
    if (
      typeof parsed.version !== "number" ||
      typeof parsed.analytics !== "boolean" ||
      typeof parsed.marketing !== "boolean"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function serializeConsentState(state: ConsentState): string {
  return JSON.stringify(state);
}

export function hasAnalyticsConsent(value: string | undefined): boolean {
  const state = parseConsentCookie(value);
  return state?.analytics === true;
}

export function hasMarketingConsent(value: string | undefined): boolean {
  const state = parseConsentCookie(value);
  return state?.marketing === true;
}
