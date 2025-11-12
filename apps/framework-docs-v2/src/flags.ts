import { flag } from "flags/next";
import { postHogAdapter } from "@flags-sdk/posthog";

/**
 * Optional identify function for user context.
 * Can be used to pass user information to PostHog for targeting.
 * PostHog will automatically generate a distinct ID for anonymous users.
 */
async function identify() {
  // Return user context if available
  // For anonymous users, PostHog will automatically generate a distinct ID
  // If you have user identification, you can return { distinctId: userId } here
  if (typeof window !== "undefined" && (window as any).posthog) {
    const distinctId = (window as any).posthog.get_distinct_id();
    return { distinctId };
  }
  return {};
}

/**
 * Feature flag to control visibility of the Hosting section in the top navigation.
 *
 * To enable this flag in PostHog:
 * 1. Go to PostHog dashboard > Feature Flags
 * 2. Create a new flag with key: "show-hosting-section"
 * 3. Configure rollout percentage or targeting rules
 */
export const showHostingSection = flag<boolean>({
  key: "show-hosting-section",
  adapter: postHogAdapter.isFeatureEnabled(),
  defaultValue: false,
  description: "Show Hosting section in top navigation",
  identify,
});

/**
 * Feature flag to control visibility of the Guides section in the top navigation.
 *
 * To enable this flag in PostHog:
 * 1. Go to PostHog dashboard > Feature Flags
 * 2. Create a new flag with key: "show-guides-section"
 * 3. Configure rollout percentage or targeting rules
 */
export const showGuidesSection = flag<boolean>({
  key: "show-guides-section",
  adapter: postHogAdapter.isFeatureEnabled(),
  defaultValue: false,
  description: "Show Guides section in top navigation",
  identify,
});
