import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { LLM_MD_SUFFIX } from "@/lib/llms-generator";

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Rewrite /path/to/doc/llm.md to /api/llm/path/to/doc
  // Why this approach:
  // - Can't use /[...slug]/llm.md/route.ts - Next.js doesn't allow static segments after catch-all
  // - Can't use /[...slug]/route.ts - conflicts with existing /[...slug]/page.tsx
  // - This: API route + proxy rewrite keeps pretty URLs without conflicts
  if (pathname.endsWith(LLM_MD_SUFFIX)) {
    const contentPath = pathname.slice(0, -LLM_MD_SUFFIX.length);
    const url = request.nextUrl.clone();
    url.pathname = `/api/llm${contentPath}`;
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  // Note: matcher must be static strings (no variables) for Next.js compile-time analysis
  matcher: [
    // Match /llm.md (root TOC)
    "/llm.md",
    // Match /path/to/doc/llm.md (individual pages)
    "/((?!_next/static|_next/image|favicon.ico).*)/llm.md",
  ],
};
