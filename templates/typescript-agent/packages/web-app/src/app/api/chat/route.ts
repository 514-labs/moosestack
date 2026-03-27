import {
  formatAgentRuntimeErrorMessage,
  McpServerUnavailableError,
} from "agent-runtime";
import type { UIMessage } from "ai";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { getAgentResponse } from "@/lib/chat-agent";

interface ChatBody {
  messages: UIMessage[];
}

function getChatErrorResponse(error: unknown) {
  if (error instanceof McpServerUnavailableError) {
    return {
      status: 503,
      body: {
        error: "MCP server unavailable",
        details: error.message,
      },
    };
  }

  const details = formatAgentRuntimeErrorMessage(error);
  const errorLabel =
    details.startsWith("Model access denied.") ?
      "Bedrock model access denied"
    : "Internal server error";

  return {
    status: 500,
    body: {
      error: errorLabel,
      details,
    },
  };
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
    const response = getChatErrorResponse(error);

    console.error("Chat error:", error);
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  }
}
