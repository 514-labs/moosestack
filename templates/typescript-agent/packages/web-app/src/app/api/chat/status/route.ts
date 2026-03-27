import { getChatProviderStatus } from "@/lib/provider-status";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = await getChatProviderStatus();
  return new Response(
    JSON.stringify({
      ...status,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    },
  );
}
