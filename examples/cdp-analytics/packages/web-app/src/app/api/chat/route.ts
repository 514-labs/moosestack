import { NextRequest } from "next/server";
import { UIMessage } from "ai";
import { getAgentResponse } from "@/features/chat/get-agent-response";

interface ChatBody {
  messages: UIMessage[];
}

export async function POST(request: NextRequest) {
  try {
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

    return await getAgentResponse(messages);
  } catch (error) {
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
