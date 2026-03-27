import { getChatProviderStatus } from "@/lib/provider-status";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const status = await getChatProviderStatus();
    return new Response(JSON.stringify(status), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Failed to load chat status", error);
    return new Response(
      JSON.stringify({
        error: "Failed to load chat status",
        details:
          error instanceof Error ? error.message : "Unknown chat status error.",
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
