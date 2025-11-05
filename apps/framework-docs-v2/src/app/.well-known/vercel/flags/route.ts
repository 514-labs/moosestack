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
      "show-guides-section": {
        description: "Show Guides section in top navigation",
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
    },
  };
});
