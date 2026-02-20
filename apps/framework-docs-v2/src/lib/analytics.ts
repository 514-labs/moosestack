"use client";

import posthog from "posthog-js";
import { CONSENT_COOKIE_NAME, hasAnalyticsConsent } from "./consent-cookie";

export interface CodeCopyEvent {
  code: string;
  language: string;
  page: string;
}

export interface SearchEvent {
  query: string;
  resultCount: number;
  language: "typescript" | "python";
}

class Analytics {
  private initialized = false;

  private hasConsent(): boolean {
    if (typeof document === "undefined") return false;
    const match = document.cookie.match(
      new RegExp(`(?:^|; )${CONSENT_COOKIE_NAME}=([^;]*)`),
    );
    return hasAnalyticsConsent(match?.[1]);
  }

  init() {
    if (this.initialized || typeof window === "undefined") return;
    if (!this.hasConsent()) return;

    const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const posthogHost =
      process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

    if (posthogKey) {
      posthog.init(posthogKey, {
        api_host: posthogHost,
        ui_host: "https://us.posthog.com",
        capture_pageview: false, // We'll handle this manually
        loaded: (posthogInstance) => {
          if (process.env.NODE_ENV === "development") {
            posthogInstance.debug();
          }
        },
      });
    }

    this.initialized = true;
  }

  /**
   * Track page view
   */
  pageView(path: string, language: "typescript" | "python") {
    this.init();
    if (!this.initialized) return;

    // Send to PostHog
    if (posthog) {
      posthog.capture("$pageview", {
        $current_url: window.location.href,
        language,
        path,
      });
    }
  }

  /**
   * Track code copy
   */
  codeCopy(event: CodeCopyEvent) {
    this.init();
    if (!this.initialized) return;

    // Send to PostHog
    if (posthog) {
      posthog.capture("Code Copied", {
        page: event.page,
        language: event.language,
        code_length: event.code.length,
      });
    }
  }

  /**
   * Track search query
   */
  search(event: SearchEvent) {
    this.init();
    if (!this.initialized) return;

    // Send to PostHog
    if (posthog) {
      posthog.capture("Documentation Search", {
        query: event.query,
        result_count: event.resultCount,
        language: event.language,
      });
    }
  }

  /**
   * Track navigation clicks
   */
  navClick(
    fromPath: string,
    toPath: string,
    language: "typescript" | "python",
  ) {
    this.init();
    if (!this.initialized) return;

    // Send to PostHog
    if (posthog) {
      posthog.capture("Navigation Click", {
        from: fromPath,
        to: toPath,
        language,
      });
    }
  }
}

// Export singleton instance
export const analytics = new Analytics();
