import { McpServerUnavailableError } from "agent-runtime";
import type { UIMessage } from "ai";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { getAgentResponse } from "@/lib/chat-agent";

interface ChatBody {
  messages: UIMessage[];
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.idToken || !session.user?.tenantId) {
      return new Response(
        JSON.stringify({
          error: "Unauthorized",
          details: "Sign in before using the agent chat.",
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const body: ChatBody = await request.json();
    const { messages } = body;

    if (!messages || !Array.isArray(messages)) {
      return new Response(
        JSON.stringify({
          error: "Invalid request body",
          details: "messages must be an array",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    return await getAgentResponse({
      messages,
      bearerToken: session.idToken,
      tenantId: session.user.tenantId,
    });
  } catch (error) {
    if (error instanceof McpServerUnavailableError) {
      return new Response(
        JSON.stringify({
          error: "MCP server unavailable",
          details: error.message,
        }),
        {
          status: 503,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    console.error("Chat error:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
