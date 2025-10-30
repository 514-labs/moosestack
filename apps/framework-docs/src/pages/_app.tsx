import "@/styles/globals.css";
import RootLayout from "@/components/layouts";
import { useEffect } from "react";
import { useRouter } from "next/router";
import Router from "next/router";
import posthog from "posthog-js";
import Script from "next/script";
import type { AppProps } from "next/app";

// Global type declaration for Athena telemetry
declare global {
  interface Window {
    athenaTelemetryQueue: any[];
  }
}

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();

  useEffect(() => {
    // Wait until Next.js router is ready to ensure query params are populated.
    if (!router.isReady) return;

    // Extract cross-site tracking params from Next.js router query.
    // These are added by TrackLink as 'ph_distinct_id' and 'ph_session_id'.
    const { ph_distinct_id, ph_session_id } = router.query;
    let bootstrapData = {};

    if (ph_distinct_id || ph_session_id) {
      bootstrapData = {
        ...(ph_distinct_id && { distinct_id: ph_distinct_id }),
        ...(ph_session_id && { session_id: ph_session_id }),
      };
    }

    if (process.env.NEXT_PUBLIC_POSTHOG_KEY) {
      posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
        api_host:
          process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
        ui_host: "https://us.posthog.com",
        bootstrap: bootstrapData, // Bootstrap with IDs from the URL if provided.
        // Enable debug mode in development
        loaded: (posthogInstance) => {
          if (process.env.NODE_ENV === "development") posthogInstance.debug();
        },
      });
    }

    // Track page views
    const handleRouteChange = () => {
      if (process.env.NEXT_PUBLIC_POSTHOG_KEY) {
        const url = window.location.origin + router.asPath;
        posthog?.capture("$pageview", {
          $current_url: url,
        });
      }
    };

    // Track initial page view
    handleRouteChange();

    Router.events.on("routeChangeComplete", handleRouteChange);

    return () => {
      Router.events.off("routeChangeComplete", handleRouteChange);
    };
  }, [router.isReady, router.asPath]);

  // Add code copy logging functionality
  useEffect(() => {
    const setupCopyLogging = () => {
      const logCodeCopy = (content: string) => {
        const trimmedContent = content.trim();
        // Send PostHog event instead of console log
        if (typeof posthog !== "undefined" && posthog) {
          posthog.capture("Code Copied", {
            code_content: trimmedContent,
            page_path: router.asPath,
          });
        }
      };

      // Function to handle copy button clicks
      const handleCopyClick = (event: Event) => {
        const copyButton = event.target as HTMLElement;

        // Find the code block associated with this copy button
        const codeContainer = copyButton.closest(".nextra-code");
        if (!codeContainer) return;

        const codeElement = codeContainer.querySelector("pre code");
        if (!codeElement) return;

        const codeText = codeElement.textContent || "";
        if (codeText.trim()) {
          logCodeCopy(codeText);
        }
      };

      // Function to handle manual text selection and copy
      const handleCopy = (event: ClipboardEvent) => {
        const selection = document.getSelection();
        const selectedText = selection?.toString();

        if (!selectedText) return;

        // Check if the copied text is from within a code block
        const range = selection?.getRangeAt(0);
        if (!range) return;

        const container = range.commonAncestorContainer;
        const codeBlock =
          container.nodeType === Node.TEXT_NODE ?
            container.parentElement?.closest("pre code, code")
          : (container as Element)?.closest("pre code, code");

        if (codeBlock && selectedText.trim()) {
          logCodeCopy(selectedText);
        }
      };

      // Add event listeners for copy buttons (Nextra's copy buttons)
      const addCopyButtonListeners = () => {
        const copyButtons = document.querySelectorAll(".nextra-code button");
        copyButtons.forEach((button) => {
          button.addEventListener("click", handleCopyClick);
        });
      };

      // Add copy event listener for manual copying
      document.addEventListener("copy", handleCopy);

      addCopyButtonListeners();

      // Cleanup function
      return () => {
        document.removeEventListener("copy", handleCopy);

        // Remove copy button listeners using the same selector as when adding
        const copyButtons = document.querySelectorAll(".nextra-code button");
        copyButtons.forEach((button) => {
          button.removeEventListener("click", handleCopyClick);
        });
      };
    };

    return setupCopyLogging();
  }, [router.asPath]);

  return (
    <RootLayout>
      <Script
        id="apollo-tracking"
        strategy="beforeInteractive"
        dangerouslySetInnerHTML={{
          __html: `
              function initApollo() {
                var n = Math.random().toString(36).substring(7);
                var o = document.createElement("script");
                o.src = "https://assets.apollo.io/micro/website-tracker/tracker.iife.js?nocache=" + n;
                o.async = true;
                o.defer = true;
                o.onload = function() {
                  window.trackingFunctions.onLoad({
                    appId: "66316b76c8e6ae01afde8c2d"
                  });
                };
                document.head.appendChild(o);
              }
              initApollo();
            `,
        }}
      />
      {process.env.NEXT_PUBLIC_ATHENA_TRACKING_TOKEN && (
        <Script
          id="athena-telemetry-secure"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                window.athenaTelemetryQueue = window.athenaTelemetryQueue || [];
                
                var script = document.createElement('script');
                script.async = true;
                script.src = 'https://app.athenahq.ai/api/tracking/${process.env.NEXT_PUBLIC_ATHENA_TRACKING_TOKEN}';
                
                var firstScript = document.getElementsByTagName('script')[0];
                if (firstScript && firstScript.parentNode) {
                  firstScript.parentNode.insertBefore(script, firstScript);
                } else {
                  document.head.appendChild(script);
                }
              })();
            `,
          }}
        />
      )}
      <Component {...pageProps} />
    </RootLayout>
  );
}
