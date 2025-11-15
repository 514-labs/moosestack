import { SERVER_CONFIG, RETRY_CONFIG } from "../constants";
import { withRetries } from "./retry-utils";

/**
 * Verifies consumption API responses
 */
export const verifyConsumptionApi = async (
  endpoint: string,
  expectedResponse: any,
): Promise<void> => {
  await withRetries(
    async () => {
      const response = await fetch(`${SERVER_CONFIG.url}/api/${endpoint}`);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${response.status}: ${text}`);
      }
      console.log("Test request sent successfully");
      const json = (await response.json()) as any[];

      console.log("API response:", json);

      if (!Array.isArray(json)) {
        throw new Error("Expected array response");
      }

      if (json.length < 1) {
        throw new Error("Expected at least one item in response");
      }

      json.forEach((item: any) => {
        Object.keys(expectedResponse[0]).forEach((key) => {
          if (!item.hasOwnProperty(key)) {
            throw new Error(`Missing property ${key} in response`);
          }
          if (item[key] === null) {
            throw new Error(`Property ${key} should not be null`);
          }
        });

        // Generator uses faker, it may not add any rows with text
        // if (item.hasOwnProperty("rows_with_text") && item.rows_with_text < 1) {
        //   throw new Error("rows_with_text should be at least 1");
        // }

        if (item.hasOwnProperty("total_rows") && item.total_rows < 1) {
          throw new Error("total_rows should be at least 1");
        }
      });
    },
    {
      attempts: RETRY_CONFIG.API_VERIFICATION_ATTEMPTS,
      delayMs: RETRY_CONFIG.API_VERIFICATION_DELAY_MS,
    },
  );
};

/**
 * Verifies versioned consumption API responses
 */
export const verifyVersionedConsumptionApi = async (
  endpoint: string,
  expectedResponse: any,
): Promise<void> => {
  await withRetries(
    async () => {
      const response = await fetch(`${SERVER_CONFIG.url}/api/${endpoint}`);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${response.status}: ${text}`);
      }
      console.log("Versioned API test request sent successfully");
      const json = (await response.json()) as any[];

      if (!Array.isArray(json)) {
        throw new Error("Expected array response");
      }

      if (json.length < 1) {
        throw new Error("Expected at least one item in response");
      }

      json.forEach((item: any, index: number) => {
        const expected = expectedResponse[index] || expectedResponse[0];

        Object.keys(expected).forEach((key) => {
          const expectedValue = expected[key];
          if (!item.hasOwnProperty(key)) {
            throw new Error(`Missing property ${key} in response`);
          }

          if (
            typeof expectedValue === "object" &&
            expectedValue !== null &&
            !Array.isArray(expectedValue)
          ) {
            if (typeof item[key] !== "object") {
              throw new Error(`Expected ${key} to be an object`);
            }

            Object.keys(expectedValue).forEach((nestedKey) => {
              const nestedExpected = expectedValue[nestedKey];
              if (
                typeof nestedExpected === "object" &&
                nestedExpected !== null
              ) {
                const camelCaseKey = nestedKey;
                const snakeCaseKey = nestedKey
                  .replace(/([A-Z])/g, "_$1")
                  .toLowerCase();
                const hasCamelCase = item[key].hasOwnProperty(camelCaseKey);
                const hasSnakeCase = item[key].hasOwnProperty(snakeCaseKey);
                if (!hasCamelCase && !hasSnakeCase) {
                  throw new Error(
                    `Missing nested property ${nestedKey} in ${key}`,
                  );
                }
                const nestedField =
                  item[key][camelCaseKey] || item[key][snakeCaseKey];
                if (typeof nestedField !== "object") {
                  throw new Error(`Expected ${nestedKey} to be an object`);
                }
              } else {
                if (!item[key].hasOwnProperty(nestedKey)) {
                  throw new Error(
                    `Missing nested property ${nestedKey} in ${key}`,
                  );
                }
                if (
                  typeof nestedExpected === "string" &&
                  item[key][nestedKey] !== nestedExpected
                ) {
                  throw new Error(
                    `Expected ${nestedKey} to equal ${nestedExpected}`,
                  );
                }
              }
            });
          } else {
            if (item[key] === null) {
              throw new Error(`Property ${key} should not be null`);
            }
          }
        });

        // Generator uses faker, it may not add any rows with text
        // if (item.hasOwnProperty("rows_with_text") && item.rows_with_text < 1) {
        //   throw new Error("rows_with_text should be at least 1");
        // }
        if (item.hasOwnProperty("total_rows") && item.total_rows < 1) {
          throw new Error("total_rows should be at least 1");
        }
      });
    },
    {
      attempts: RETRY_CONFIG.API_VERIFICATION_ATTEMPTS,
      delayMs: RETRY_CONFIG.API_VERIFICATION_DELAY_MS,
    },
  );
};

/**
 * Verifies the proxy health endpoint (/health) returns expected healthy/unhealthy services
 */
export const verifyProxyHealth = async (
  expectedHealthy: string[],
  expectedUnhealthy: string[] = [],
): Promise<void> => {
  await withRetries(
    async () => {
      const response = await fetch(`${SERVER_CONFIG.url}/health`);

      // If we expect unhealthy services, status should be 503
      // Otherwise it should be 200
      const expectedStatus = expectedUnhealthy.length > 0 ? 503 : 200;
      if (response.status !== expectedStatus) {
        const text = await response.text();
        throw new Error(
          `Expected status ${expectedStatus}, got ${response.status}: ${text}`,
        );
      }

      const json = (await response.json()) as {
        healthy: string[];
        unhealthy: string[];
      };

      console.log("Health check response:", json);

      // Verify healthy list
      for (const service of expectedHealthy) {
        if (!json.healthy.includes(service)) {
          throw new Error(
            `Expected "${service}" in healthy list, got: ${json.healthy.join(", ")}`,
          );
        }
      }

      // Verify unhealthy list
      for (const service of expectedUnhealthy) {
        if (!json.unhealthy.includes(service)) {
          throw new Error(
            `Expected "${service}" in unhealthy list, got: ${json.unhealthy.join(", ")}`,
          );
        }
      }

      // Note: We don't enforce exact counts because services are conditionally
      // checked based on feature flags (features.apis, features.olap, features.streaming_engine).
      // The test verifies that expected services are present in the correct state,
      // but allows for additional services that may be enabled in the environment.
    },
    {
      attempts: RETRY_CONFIG.API_VERIFICATION_ATTEMPTS,
      delayMs: RETRY_CONFIG.API_VERIFICATION_DELAY_MS,
    },
  );
};

/**
 * Verifies the consumption API internal health endpoint (/_moose_internal/health)
 */
export const verifyConsumptionApiInternalHealth = async (): Promise<void> => {
  await withRetries(
    async () => {
      // Note: The internal health endpoint runs on the consumption API port (4001 by default)
      // which is the same as SERVER_CONFIG.consumptionApiUrl but without the /api prefix
      const consumptionApiPort = new URL(SERVER_CONFIG.url).port || "4000";
      const consumptionPort = parseInt(consumptionApiPort) + 1; // Default: 4001
      const healthUrl = `http://localhost:${consumptionPort}/_moose_internal/health`;

      const response = await fetch(healthUrl);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${response.status}: ${text}`);
      }

      const json = (await response.json()) as {
        status: string;
        timestamp: string;
      };

      console.log("Internal health check response:", json);

      if (json.status !== "healthy") {
        throw new Error(`Expected status "healthy", got "${json.status}"`);
      }

      if (!json.timestamp) {
        throw new Error("Missing timestamp in response");
      }

      // Verify timestamp is a valid ISO 8601 string
      const timestamp = new Date(json.timestamp);
      if (isNaN(timestamp.getTime())) {
        throw new Error(`Invalid timestamp: ${json.timestamp}`);
      }
    },
    {
      attempts: RETRY_CONFIG.API_VERIFICATION_ATTEMPTS,
      delayMs: RETRY_CONFIG.API_VERIFICATION_DELAY_MS,
    },
  );
};
