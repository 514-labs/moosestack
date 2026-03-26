import { getProviderStatus } from "@/lib/provider-status";

export async function GET() {
  const status = getProviderStatus();
  return new Response(
    JSON.stringify({
      ...status,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}
