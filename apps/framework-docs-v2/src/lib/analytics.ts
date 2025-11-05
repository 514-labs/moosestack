"use client";

import posthog from "posthog-js";

export interface DocsEvent {
  eventType: string;
  language: "typescript" | "python";
  path: string;
  metadata?: Record<string, unknown>;
}

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
  private mooseEndpoint = "https://moosefood.514.dev/ingest/DocsEvent";

  init() {
    if (this.initialized || typeof window === "undefined") return;

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

    const event: DocsEvent = {
      eventType: "page_view",
      language,
      path,
      metadata: {
        timestamp: new Date().toISOString(),
        referrer: typeof window !== "undefined" ? document.referrer : "",
      },
    };

    // Send to PostHog
    if (posthog) {
      posthog.capture("$pageview", {
        $current_url: window.location.href,
        language,
        path,
      });
    }

    // Send to internal Moose endpoint
    this.sendToMoose(event);
  }

  /**
   * Track code copy
   */
  codeCopy(event: CodeCopyEvent) {
    this.init();

    const docsEvent: DocsEvent = {
      eventType: "code_copy",
      language: event.language as "typescript" | "python",
      path: event.page,
      metadata: {
        codeSnippet: event.code.substring(0, 200), // Truncate for storage
        codeLanguage: event.language,
        timestamp: new Date().toISOString(),
      },
    };

    // Send to PostHog
    if (posthog) {
      posthog.capture("Code Copied", {
        page: event.page,
        language: event.language,
        code_length: event.code.length,
      });
    }

    // Send to internal Moose endpoint
    this.sendToMoose(docsEvent);
  }

  /**
   * Track search query
   */
  search(event: SearchEvent) {
    this.init();

    const docsEvent: DocsEvent = {
      eventType: "search",
      language: event.language,
      path: typeof window !== "undefined" ? window.location.pathname : "",
      metadata: {
        query: event.query,
        resultCount: event.resultCount,
        timestamp: new Date().toISOString(),
      },
    };

    // Send to PostHog
    if (posthog) {
      posthog.capture("Documentation Search", {
        query: event.query,
        result_count: event.resultCount,
        language: event.language,
      });
    }

    // Send to internal Moose endpoint
    this.sendToMoose(docsEvent);
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

    const docsEvent: DocsEvent = {
      eventType: "nav_click",
      language,
      path: fromPath,
      metadata: {
        destination: toPath,
        timestamp: new Date().toISOString(),
      },
    };

    // Send to PostHog
    if (posthog) {
      posthog.capture("Navigation Click", {
        from: fromPath,
        to: toPath,
        language,
      });
    }

    // Send to internal Moose endpoint
    this.sendToMoose(docsEvent);
  }

  /**
   * Send event to internal Moose endpoint
   */
  private async sendToMoose(event: DocsEvent) {
    if (typeof window === "undefined") return;

    // Skip sending to Moose in development
    if (process.env.NODE_ENV === "development") {
      console.log("[Analytics] Skipping Moose in dev:", event.eventType);
      return;
    }

    try {
      await fetch(this.mooseEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...event,
          timestamp: new Date().toISOString(),
          sessionId: this.getSessionId(),
          userAgent: navigator.userAgent,
        }),
        // Don't wait for response
        keepalive: true,
      });
    } catch (error) {
      // Silently fail - don't disrupt user experience
      console.error("Failed to send analytics event:", error);
    }
  }

  /**
   * Get or create session ID
   */
  private getSessionId(): string {
    if (typeof window === "undefined") return "";

    const storageKey = "moose_docs_session_id";
    let sessionId = sessionStorage.getItem(storageKey);

    if (!sessionId) {
      sessionId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
      sessionStorage.setItem(storageKey, sessionId);
    }

    return sessionId;
  }
}

// Export singleton instance
export const analytics = new Analytics();
