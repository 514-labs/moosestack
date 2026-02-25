import { NextRequest } from "next/server";
import { UIMessage } from "ai";
import { auth, currentUser } from "@clerk/nextjs/server";
import { getAgentResponse } from "@/features/chat/get-agent-response";

interface ChatBody {
  messages: UIMessage[];
}

export async function POST(request: NextRequest) {
  try {
    const { userId, getToken } = await auth();

    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const [token, user, body] = await Promise.all([
      getToken(),
      currentUser(),
      request.json() as Promise<ChatBody>,
    ]);

    const { messages } = body;

    if (!messages || !Array.isArray(messages)) {
      return new Response(
        JSON.stringify({
          error: "Invalid request body",
          details: "messages must be an array",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    return await getAgentResponse(messages, {
      token: token ?? undefined,
      userContext: {
        userId,
        email: user?.primaryEmailAddress?.emailAddress ?? undefined,
        name: user?.fullName ?? undefined,
      },
    });
  } catch (error) {
    console.error("Tier 2 chat error:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
