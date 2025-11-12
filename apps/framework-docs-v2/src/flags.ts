import { flag } from "flags/next";
import { postHogAdapter } from "@flags-sdk/posthog";

async function identify() {
  if (typeof window !== "undefined" && (window as any).posthog) {
    const distinctId = (window as any).posthog.get_distinct_id();
    return { distinctId };
  }
  return {};
}

export const showHostingSection = flag<boolean>({
  key: "show-hosting-section",
  adapter: postHogAdapter.isFeatureEnabled(),
  defaultValue: false,
  description: "Show Hosting section in top navigation",
  origin: "https://us.i.posthog.com",
  identify,
});

export const showGuidesSection = flag<boolean>({
  key: "show-guides-section",
  adapter: postHogAdapter.isFeatureEnabled(),
  defaultValue: false,
  description: "Show Guides section in top navigation",
  origin: "https://us.i.posthog.com",
  identify,
});

export const showAiSection = flag<boolean>({
  key: "show-ai-section",
  adapter: postHogAdapter.isFeatureEnabled(),
  defaultValue: true,
  description: "Show AI section in top navigation",
  origin: "https://us.i.posthog.com",
  identify,
});

export const showDataSourcesPage = flag<boolean>({
  key: "show-data-sources-page",
  adapter: postHogAdapter.isFeatureEnabled(),
  defaultValue: false,
  description: "Show Data sources page in navigation",
  origin: "https://us.i.posthog.com",
  identify,
});
