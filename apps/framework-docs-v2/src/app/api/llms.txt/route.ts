import { NextRequest, NextResponse } from "next/server";
import { generateLLMsTxt } from "@/lib/llms-generator";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const language = searchParams.get("lang") || "typescript";

  try {
    const content = generateLLMsTxt(language as "typescript" | "python");

    return new NextResponse(content, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "s-maxage=1800, stale-while-revalidate=300",
      },
    });
  } catch (error) {
    console.error("Failed to generate llms.txt:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
