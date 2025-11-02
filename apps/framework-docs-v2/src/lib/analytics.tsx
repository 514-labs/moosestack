"use client";

import { useEffect, useCallback } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";

interface DocsEvent {
  eventType: string;
  timestamp: Date;
  language?: string;
  path?: string;
  metadata?: Record<string, any>;
}

class DocsAnalytics {
  private static instance: DocsAnalytics;
  private initialized = false;
  private mooseEndpoint =
    process.env.NODE_ENV === "development" ?
      "http://localhost:4000"
    : "https://moosefood.514.dev";

  private constructor() {}

  static getInstance(): DocsAnalytics {
    if (!DocsAnalytics.instance) {
      DocsAnalytics.instance = new DocsAnalytics();
    }
    return DocsAnalytics.instance;
  }

  init() {
    if (this.initialized) return;

    // Initialize PostHog
    if (process.env.NEXT_PUBLIC_POSTHOG_KEY) {
      posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
        api_host:
          process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
        ui_host: "https://us.posthog.com",
        loaded: (posthogInstance) => {
          if (process.env.NODE_ENV === "development") {
            posthogInstance.debug();
          }
        },
      });
    }

    this.initialized = true;
  }

  private async sendToMoose(event: DocsEvent) {
    try {
      await fetch(`${this.mooseEndpoint}/ingest/DocsEvent/0.1`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(event),
      });
    } catch (error) {
      console.error("Failed to send event to Moose:", error);
    }
  }

  trackPageView(path: string, language?: string) {
    const event: DocsEvent = {
      eventType: "pageview",
      timestamp: new Date(),
      language,
      path,
    };

    // Send to PostHog
    if (typeof posthog !== "undefined" && posthog) {
      posthog.capture("$pageview", {
        $current_url: window.location.href,
        language,
      });
    }

    // Send to Moose
    this.sendToMoose(event);
  }

  trackCodeCopy(code: string, language?: string, path?: string) {
    const event: DocsEvent = {
      eventType: "code_copy",
      timestamp: new Date(),
      language,
      path,
      metadata: {
        code_length: code.length,
        code_preview: code.substring(0, 100),
      },
    };

    // Send to PostHog
    if (typeof posthog !== "undefined" && posthog) {
      posthog.capture("Code Copied", {
        language,
        code_length: code.length,
        page_path: path,
      });
    }

    // Send to Moose
    this.sendToMoose(event);
  }

  trackSearch(query: string, resultCount?: number, language?: string) {
    const event: DocsEvent = {
      eventType: "search",
      timestamp: new Date(),
      language,
      metadata: {
        query,
        result_count: resultCount,
      },
    };

    // Send to PostHog
    if (typeof posthog !== "undefined" && posthog) {
      posthog.capture("Search", {
        query,
        result_count: resultCount,
        language,
      });
    }

    // Send to Moose
    this.sendToMoose(event);
  }

  trackNavigation(from: string, to: string, language?: string) {
    const event: DocsEvent = {
      eventType: "navigation",
      timestamp: new Date(),
      language,
      metadata: {
        from,
        to,
      },
    };

    // Send to PostHog
    if (typeof posthog !== "undefined" && posthog) {
      posthog.capture("Navigation", {
        from,
        to,
        language,
      });
    }

    // Send to Moose
    this.sendToMoose(event);
  }

  trackLanguageSwitch(from: string, to: string) {
    const event: DocsEvent = {
      eventType: "language_switch",
      timestamp: new Date(),
      metadata: {
        from,
        to,
      },
    };

    // Send to PostHog
    if (typeof posthog !== "undefined" && posthog) {
      posthog.capture("Language Switch", {
        from,
        to,
      });
    }

    // Send to Moose
    this.sendToMoose(event);
  }
}

export const analytics = DocsAnalytics.getInstance();

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    analytics.init();
  }, []);

  useEffect(() => {
    if (!pathname) return;

    // Detect language from path
    const language =
      pathname.startsWith("/typescript") ? "typescript"
      : pathname.startsWith("/python") ? "python"
      : undefined;

    analytics.trackPageView(pathname, language);
  }, [pathname, searchParams]);

  return <>{children}</>;
}

export function useAnalytics() {
  const pathname = usePathname();

  const trackCodeCopy = useCallback(
    (code: string) => {
      const language =
        pathname?.startsWith("/typescript") ? "typescript"
        : pathname?.startsWith("/python") ? "python"
        : undefined;
      analytics.trackCodeCopy(code, language, pathname || undefined);
    },
    [pathname],
  );

  const trackSearch = useCallback(
    (query: string, resultCount?: number) => {
      const language =
        pathname?.startsWith("/typescript") ? "typescript"
        : pathname?.startsWith("/python") ? "python"
        : undefined;
      analytics.trackSearch(query, resultCount, language);
    },
    [pathname],
  );

  return {
    trackCodeCopy,
    trackSearch,
    trackNavigation: analytics.trackNavigation.bind(analytics),
    trackLanguageSwitch: analytics.trackLanguageSwitch.bind(analytics),
  };
}

