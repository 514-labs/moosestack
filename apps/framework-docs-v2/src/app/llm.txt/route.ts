import { NextResponse } from "next/server";
import { generateLlmToc, LLM_TXT_SUFFIX } from "@/lib/llms-generator";

// Force static generation
export const dynamic = "force-static";

/**
 * GET /llm.txt
 * Returns a table of contents for all documentation with links to .txt endpoints
 */
export async function GET(): Promise<NextResponse> {
  try {
    const toc = generateLlmToc(LLM_TXT_SUFFIX);

    return new NextResponse(toc, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "s-maxage=1800, stale-while-revalidate=300",
      },
    });
  } catch (error) {
    console.error("Failed to generate LLM TOC:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
