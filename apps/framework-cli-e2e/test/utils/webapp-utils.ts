import { SERVER_CONFIG, RETRY_CONFIG } from "../constants";
import { withRetries } from "./retry-utils";

/**
 * Verifies WebApp endpoint responses
 */
export const verifyWebAppEndpoint = async (
  path: string,
  expectedStatus: number = 200,
  expectedResponseCheck?: (json: any) => void,
): Promise<void> => {
  await withRetries(
    async () => {
      const response = await fetch(`${SERVER_CONFIG.url}${path}`);

      if (response.status !== expectedStatus) {
        const text = await response.text();
        throw new Error(
          `Expected status ${expectedStatus}, got ${response.status}: ${text}`,
        );
      }

      if (expectedResponseCheck) {
        const json = await response.json();
        expectedResponseCheck(json);
      }
    },
    {
      attempts: RETRY_CONFIG.API_VERIFICATION_ATTEMPTS,
      delayMs: RETRY_CONFIG.API_VERIFICATION_DELAY_MS,
    },
  );
};

/**
 * Verifies WebApp POST endpoint responses
 */
export const verifyWebAppPostEndpoint = async (
  path: string,
  body: any,
  expectedStatus: number = 200,
  expectedResponseCheck?: (json: any) => void,
): Promise<void> => {
  await withRetries(
    async () => {
      const response = await fetch(`${SERVER_CONFIG.url}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (response.status !== expectedStatus) {
        const text = await response.text();
        throw new Error(
          `Expected status ${expectedStatus}, got ${response.status}: ${text}`,
        );
      }

      if (expectedResponseCheck) {
        const json = await response.json();
        expectedResponseCheck(json);
      }
    },
    {
      attempts: RETRY_CONFIG.API_VERIFICATION_ATTEMPTS,
      delayMs: RETRY_CONFIG.API_VERIFICATION_DELAY_MS,
    },
  );
};

/**
 * Verifies WebApp health check endpoint
 */
export const verifyWebAppHealth = async (
  mountPath: string,
  expectedServiceName?: string,
): Promise<void> => {
  await verifyWebAppEndpoint(`${mountPath}/health`, 200, (json) => {
    if (json.status !== "ok") {
      throw new Error(`Health check failed: status is ${json.status}`);
    }
    if (expectedServiceName && json.service !== expectedServiceName) {
      throw new Error(
        `Expected service name ${expectedServiceName}, got ${json.service}`,
      );
    }
    if (!json.timestamp) {
      throw new Error("Health check missing timestamp");
    }
  });
};

/**
 * Verifies WebApp query endpoint returns data
 */
export const verifyWebAppQuery = async (
  path: string,
  queryParams?: Record<string, string | number>,
): Promise<void> => {
  const url = new URL(`${SERVER_CONFIG.url}${path}`);
  if (queryParams) {
    Object.entries(queryParams).forEach(([key, value]) => {
      url.searchParams.append(key, String(value));
    });
  }

  await withRetries(
    async () => {
      const response = await fetch(url.toString());
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${response.status}: ${text}`);
      }

      const json = await response.json();

      if (!json.success) {
        throw new Error(`Query failed: ${json.error || "Unknown error"}`);
      }

      if (!Array.isArray(json.data)) {
        throw new Error("Expected data to be an array");
      }
    },
    {
      attempts: RETRY_CONFIG.API_VERIFICATION_ATTEMPTS,
      delayMs: RETRY_CONFIG.API_VERIFICATION_DELAY_MS,
    },
  );
};
