import { flag } from "flags/next";
import { postHogAdapter } from "@flags-sdk/posthog";

async function identify() {
  if (typeof window !== "undefined" && (window as any).posthog) {
    const distinctId = (window as any).posthog.get_distinct_id();
    return { distinctId };
  }
  return {};
}

export const showAiSection = flag<boolean>({
  key: "show-ai-section",
  adapter: postHogAdapter.isFeatureEnabled(),
  defaultValue: false,
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

export const showCopyAsMarkdown = flag<boolean>({
  key: "show-copy-as-markdown",
  adapter: postHogAdapter.isFeatureEnabled(),
  defaultValue: false,
  description: "Show Copy Page button in doc & guide pages",
  origin: "https://us.i.posthog.com",
  identify,
});

export const showDraftGuides = flag<boolean>({
  key: "show-draft-guides",
  adapter: postHogAdapter.isFeatureEnabled(),
  defaultValue: false,
  description: "Show draft guides (internal WIP, not ready for external users)",
  origin: "https://us.i.posthog.com",
  identify,
});

export const showBetaGuides = flag<boolean>({
  key: "show-beta-guides",
  adapter: postHogAdapter.isFeatureEnabled(),
  defaultValue: false,
  description: "Show beta guides (ready for select external users to preview)",
  origin: "https://us.i.posthog.com",
  identify,
});

export const showLinearIntegration = flag<boolean>({
  key: "show-linear-integration",
  adapter: postHogAdapter.isFeatureEnabled(),
  defaultValue: false,
  description:
    "Show Linear integration (scope selector + add to Linear) on guide pages",
  origin: "https://us.i.posthog.com",
  identify,
});
