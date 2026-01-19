import { NextResponse } from "next/server";
import { generateLlmToc } from "@/lib/llms-generator";

/**
 * GET /api/llm
 * Returns a table of contents for all documentation with links to /llm.md endpoints
 */
export async function GET() {
  try {
    const toc = generateLlmToc();

    return new NextResponse(toc, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "s-maxage=1800, stale-while-revalidate=300",
      },
    });
  } catch {
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
