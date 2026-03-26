"use client";

import { useEffect, useState } from "react";

export interface ChatProviderStatus {
  provider: "anthropic" | "openai" | "bedrock";
  providerLabel: string;
  providerReady: boolean;
  guardrailsConfigured: boolean;
  status: "ready" | "missing_key";
  details?: string;
}

export function useChatProviderStatus() {
  const [data, setData] = useState<ChatProviderStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchStatus() {
      try {
        const response = await fetch("/api/chat/status");
        if (!response.ok) {
          throw new Error(
            `Failed to fetch chat status: ${response.statusText}`,
          );
        }

        const status = await response.json();
        setData(status);
      } catch (error) {
        console.error("Failed to fetch chat status:", error);
        setData({
          provider: "anthropic",
          providerLabel: "Anthropic",
          providerReady: false,
          guardrailsConfigured: false,
          status: "missing_key",
        });
      } finally {
        setIsLoading(false);
      }
    }

    fetchStatus();
  }, []);

  return { data, isLoading };
}
