import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;

  return new Response(
    JSON.stringify({
      anthropicKeyAvailable: hasAnthropicKey,
      status: hasAnthropicKey ? "ready" : "missing_key",
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}
