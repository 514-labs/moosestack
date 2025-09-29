import { SERVER_CONFIG, TEST_DATA } from "../constants";

export const triggerWorkflow = async (name: string) => {
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
};
