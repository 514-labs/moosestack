import { formatAgentRuntimeErrorMessage, McpServerUnavailableError } from "agent-runtime";
import type { UIMessage } from "ai";
import type { NextAuthRequest } from "next-auth";
import { auth } from "@/auth";
import { getSessionAccess } from "@/authz/session-access";
import { getAgentResponse } from "@/lib/chat-agent";

interface ChatBody {
  messages: UIMessage[];
}

function createJsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getChatErrorResponse(error: unknown) {
  if (error instanceof McpServerUnavailableError) {
    return {
      status: 503,
      body: {
        error: "MCP server unavailable",
        details:
          process.env.NODE_ENV === "production"
            ? "Start the Moose service and verify the custom MCP tools endpoint is reachable."
            : error.message,
      },
    };
  }

  const details = formatAgentRuntimeErrorMessage(error);
  const errorLabel = details.startsWith("Model access denied.")
    ? "Bedrock model access denied"
    : "Internal server error";

  return {
    status: 500,
    body: {
      error: errorLabel,
      details:
        process.env.NODE_ENV !== "production" || errorLabel === "Bedrock model access denied"
          ? details
          : "Check the web app logs for details.",
    },
  };
}

export const POST = auth(async function POST(request: NextAuthRequest): Promise<Response> {
  try {
    const session = request.auth;
    const access = getSessionAccess(session);

    if (!session?.idToken || !access) {
      return createJsonResponse(
        {
          error: "Unauthorized",
          details:
            "Sign in with a local mock account or your OIDC provider before using the agent chat.",
        },
        401,
      );
    }

    let body: ChatBody;
    try {
      body = (await request.json()) as ChatBody;
    } catch {
      return createJsonResponse(
        {
          error: "Invalid request body",
          details: "Request body must be valid JSON.",
        },
        400,
      );
    }

    const { messages } = body;

    if (!messages || !Array.isArray(messages)) {
      return createJsonResponse(
        {
          error: "Invalid request body",
          details: "messages must be an array",
        },
        400,
      );
    }

    return await getAgentResponse({
      messages,
      bearerToken: session.idToken,
      accessScopeId: access.accessScopeId,
    });
  } catch (error) {
    const response = getChatErrorResponse(error);

    console.error("Chat error:", error);
    return createJsonResponse(response.body, response.status);
  }
});
