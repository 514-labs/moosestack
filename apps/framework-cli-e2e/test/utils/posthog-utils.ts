/**
 * PostHog utilities for sending events from E2E tests.
 */

import { logger } from "./logger";

const posthogLogger = logger.scope("posthog");

const POSTHOG_HOST = "https://us.i.posthog.com";

export interface PostHogEvent {
  /** Event name (e.g., "llm_docs_automation_test", "e2e_test_run") */
  event: string;
  /** Custom properties for this event */
  properties?: Record<string, unknown>;
  /** Optional distinct ID override (defaults to CI run ID or local timestamp) */
  distinctId?: string;
}

/**
 * Default distinct ID for E2E tests.
 * Using a consistent ID groups all test runs under one "person" in PostHog.
 */
const DEFAULT_DISTINCT_ID = "moose-e2e-tests";

/**
 * Get additional context about the test run environment.
 */
function getRunContext(): Record<string, string | undefined> {
  return {
    // Git/CI context
    git_branch: process.env.GITHUB_REF_NAME || process.env.GITHUB_HEAD_REF,
    git_sha: process.env.GITHUB_SHA,
    ci_run_id: process.env.GITHUB_RUN_ID,
    ci_run_attempt: process.env.GITHUB_RUN_ATTEMPT,
    ci_workflow: process.env.GITHUB_WORKFLOW,
    ci_actor: process.env.GITHUB_ACTOR,

    // Environment
    node_version: process.version,
    platform: process.platform,
    arch: process.arch,
  };
}

/**
 * Send an event to PostHog.
 *
 * @param event - The event to send (name, properties, optional distinctId)
 * @param apiKey - Optional API key override (defaults to POSTHOG_API_KEY env var)
 * @returns true if sent successfully, false otherwise
 */
export async function sendPostHogEvent(
  event: PostHogEvent,
  apiKey?: string,
): Promise<boolean> {
  const key = apiKey || process.env.POSTHOG_API_KEY;

  if (!key) {
    posthogLogger.warn("⚠️  POSTHOG_API_KEY not set, skipping event");
    return false;
  }

  const distinctId = event.distinctId || DEFAULT_DISTINCT_ID;
  const runContext = getRunContext();

  const payload = {
    api_key: key,
    event: event.event,
    distinct_id: distinctId,
    properties: {
      // User-provided properties
      ...event.properties,

      // Run context (can be overridden by user properties)
      ...runContext,

      // Timestamp
      timestamp: new Date().toISOString(),
    },
  };

  try {
    posthogLogger.info(
      `📤 Sending "${event.event}" to PostHog (distinct_id: ${distinctId})`,
    );

    const response = await fetch(`${POSTHOG_HOST}/capture/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      posthogLogger.info("✅ Event sent to PostHog successfully");
      return true;
    } else {
      const errorText = await response.text();
      posthogLogger.error(
        `❌ Failed to send event to PostHog: ${response.status} - ${errorText}`,
      );
      return false;
    }
  } catch (error) {
    posthogLogger.error(`❌ Error sending event to PostHog: ${error}`);
    return false;
  }
}
