import { NextRequest, NextResponse } from "next/server";
import { parseMarkdownContent } from "@/lib/content";
import { cleanContent } from "@/lib/llms-generator";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string[] }> },
) {
  const resolvedParams = await params;
  const slug = resolvedParams.slug.join("/");

  try {
    const content = await parseMarkdownContent(slug);

    const cleaned = cleanContent(content.content);

    return new NextResponse(cleaned, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch (error) {
    console.error(`Failed to fetch markdown for slug: ${slug}`, error);
    return new NextResponse("Content not found", { status: 404 });
  }
}
