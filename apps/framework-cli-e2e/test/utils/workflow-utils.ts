import { SERVER_CONFIG, TEST_ADMIN_BEARER_TOKEN } from "../constants";
import { withRetries } from "./retry-utils";

export const triggerWorkflow = async (name: string) => {
  await withRetries(
    async () => {
      const response = await fetch(
        `${SERVER_CONFIG.url}/admin/workflows/${name}/trigger`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${TEST_ADMIN_BEARER_TOKEN}`,
          },
        },
      );
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${response.status}: ${text}`);
      }
    },
    { attempts: 5, delayMs: 500 },
  );
};
