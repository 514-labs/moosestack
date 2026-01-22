import { NextRequest, NextResponse } from "next/server";
import { parseMarkdownContent } from "@/lib/content";
import { remark } from "remark";
import remarkGfm from "remark-gfm";
import remarkHtml from "remark-html";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const slug = searchParams.get("slug");

  if (!slug) {
    return NextResponse.json(
      { error: "Missing slug parameter" },
      { status: 400 },
    );
  }

  try {
    const content = await parseMarkdownContent(slug);

    // For non-MDX content, return as-is (already HTML)
    if (!content.isMDX) {
      return NextResponse.json({
        html: content.content,
      });
    }

    // For MDX/markdown, process to HTML using remark
    // This won't handle custom components but provides basic rendering
    const processedContent = await remark()
      .use(remarkGfm)
      .use(remarkHtml, { sanitize: false })
      .process(content.content);

    return NextResponse.json({
      html: String(processedContent),
    });
  } catch (error) {
    console.error(`Failed to load step content for ${slug}:`, error);
    return NextResponse.json(
      { error: "Failed to load step content" },
      { status: 404 },
    );
  }
}
