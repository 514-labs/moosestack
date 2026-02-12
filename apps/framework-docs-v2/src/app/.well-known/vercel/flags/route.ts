import { createFlagsDiscoveryEndpoint } from "flags/next";
import { getProviderData as getPostHogProviderData } from "@flags-sdk/posthog";

export const GET = createFlagsDiscoveryEndpoint(async () => {
  // Try PostHog first if credentials available
  if (process.env.POSTHOG_PERSONAL_API_KEY && process.env.POSTHOG_PROJECT_ID) {
    try {
      return await getPostHogProviderData({
        personalApiKey: process.env.POSTHOG_PERSONAL_API_KEY,
        projectId: process.env.POSTHOG_PROJECT_ID,
      });
    } catch (error) {
      console.error("PostHog fetch failed:", error);
    }
  }

  // Fallback to static definitions
  return {
    definitions: {
      "show-hosting-section": {
        description: "Show Hosting section in top navigation",
        origin: "https://us.i.posthog.com",
        options: [
          { value: false, label: "Off" },
          { value: true, label: "On" },
        ],
      },
      "show-ai-section": {
        description: "Show AI section in top navigation",
        origin: "https://us.i.posthog.com",
        options: [
          { value: false, label: "Off" },
          { value: true, label: "On" },
        ],
      },
      "show-data-sources-page": {
        description: "Show Data sources page in navigation",
        origin: "https://us.i.posthog.com",
        options: [
          { value: false, label: "Off" },
          { value: true, label: "On" },
        ],
      },
      "show-copy-as-markdown": {
        description: "Show Copy Page button in doc & guide pages",
        origin: "https://us.i.posthog.com",
        options: [
          { value: false, label: "Off" },
          { value: true, label: "On" },
        ],
      },
      "show-draft-guides": {
        description:
          "Show draft guides (internal WIP, not ready for external users)",
        origin: "https://us.i.posthog.com",
        options: [
          { value: false, label: "Off" },
          { value: true, label: "On" },
        ],
      },
      "show-beta-guides": {
        description:
          "Show beta guides (ready for select external users to preview)",
        origin: "https://us.i.posthog.com",
        options: [
          { value: false, label: "Off" },
          { value: true, label: "On" },
        ],
      },
      "show-linear-integration": {
        description:
          "Show Linear integration (scope selector + add to Linear) on guide pages",
        origin: "https://us.i.posthog.com",
        options: [
          { value: false, label: "Off" },
          { value: true, label: "On" },
        ],
      },
      "show-boreal-guide-sync": {
        description:
          "Show Boreal login and sync options in guide customization (experimental)",
        origin: "https://us.i.posthog.com",
        options: [
          { value: false, label: "Off" },
          { value: true, label: "On" },
        ],
      },
    },
  };
});
