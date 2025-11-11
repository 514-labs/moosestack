import { useState, useEffect } from "react";

interface AnthropicStatus {
  anthropicKeyAvailable: boolean;
  status: "ready" | "missing_key";
}

export function useAnthropicStatus() {
  const [data, setData] = useState<AnthropicStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchStatus() {
      try {
        const response = await fetch(`/api/chat/status`);
        if (!response.ok) {
          throw new Error(
            `Failed to fetch Anthropic status: ${response.statusText}`,
          );
        }
        const status = await response.json();
        setData(status);
      } catch (error) {
        console.error("Failed to fetch Anthropic status:", error);
        setData({ anthropicKeyAvailable: false, status: "missing_key" });
      } finally {
        setIsLoading(false);
      }
    }

    fetchStatus();
  }, []);

  return { data, isLoading };
}
