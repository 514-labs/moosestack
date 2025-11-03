import { SERVER_CONFIG } from "../constants";
import { withRetries } from "./retry-utils";

export const triggerWorkflow = async (name: string) => {
  await withRetries(
    async () => {
      const response = await fetch(
        `${SERVER_CONFIG.url}/workflows/${name}/trigger`,
        {
          method: "POST",
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
