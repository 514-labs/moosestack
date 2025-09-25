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

        if (item.hasOwnProperty("rows_with_text") && item.rows_with_text < 1) {
          throw new Error("rows_with_text should be at least 1");
        }

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

        if (item.hasOwnProperty("rows_with_text") && item.rows_with_text < 1) {
          throw new Error("rows_with_text should be at least 1");
        }
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
