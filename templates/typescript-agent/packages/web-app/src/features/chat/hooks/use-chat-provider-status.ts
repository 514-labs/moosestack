"use client";

import { useEffect, useState } from "react";

export interface ChatProviderStatus {
  provider: "anthropic" | "openai" | "bedrock";
  providerLabel: string;
  providerReady: boolean;
  guardrailsConfigured: boolean;
  status: "ready" | "missing_key";
  details?: string;
  mcpReady: boolean;
  mcpStatus: "ready" | "unavailable";
  mcpUrl: string | null;
  mcpDetails?: string;
}

function isChatProviderStatus(value: unknown): value is ChatProviderStatus {
  return (
    typeof value === "object" &&
    value !== null &&
    "provider" in value &&
    typeof value.provider === "string" &&
    "providerLabel" in value &&
    typeof value.providerLabel === "string" &&
    "providerReady" in value &&
    typeof value.providerReady === "boolean" &&
    "guardrailsConfigured" in value &&
    typeof value.guardrailsConfigured === "boolean" &&
    "status" in value &&
    typeof value.status === "string" &&
    "mcpReady" in value &&
    typeof value.mcpReady === "boolean" &&
    "mcpStatus" in value &&
    typeof value.mcpStatus === "string" &&
    "mcpUrl" in value &&
    (typeof value.mcpUrl === "string" || value.mcpUrl === null)
  );
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
        if (!isChatProviderStatus(status)) {
          throw new Error(
            "Chat status response did not match the expected shape.",
          );
        }

        setData(status);
      } catch (error) {
        console.error("Failed to fetch chat status:", error);
        setData({
          provider: "anthropic",
          providerLabel: "Chat",
          providerReady: true,
          guardrailsConfigured: false,
          status: "ready",
          mcpReady: false,
          mcpStatus: "unavailable",
          mcpUrl: null,
          mcpDetails:
            "Failed to load chat status. Check the web app and Moose service logs.",
        });
      } finally {
        setIsLoading(false);
      }
    }

    fetchStatus();
  }, []);

  return { data, isLoading };
}
