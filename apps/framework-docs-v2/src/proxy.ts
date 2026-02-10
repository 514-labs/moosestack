import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest): NextResponse {
  const pathname = request.nextUrl.pathname;

  // Rewrite /path.md to /api/llm/path
  // Rewrite /path.txt to /api/llm-txt/path
  // Why this approach:
  // - Can't use /[...slug].md/route.ts - Next.js doesn't allow static segments after catch-all
  // - Can't use /[...slug]/route.ts - conflicts with existing /[...slug]/page.tsx
  // - This: API route + proxy rewrite keeps pretty URLs without conflicts
  // Note: /llm.md and /llm.txt (root TOC) are handled by their own route.ts files directly
  if (pathname.endsWith(".md")) {
    const contentPath = pathname.slice(0, -".md".length);
    const url = request.nextUrl.clone();
    url.pathname = `/api/llm${contentPath}`;
    return NextResponse.rewrite(url);
  }

  if (pathname.endsWith(".txt")) {
    const contentPath = pathname.slice(0, -".txt".length);
    const url = request.nextUrl.clone();
    url.pathname = `/api/llm-txt${contentPath}`;
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  // Note: matcher must be static strings (no variables) for Next.js compile-time analysis
  matcher: [
    // Match /path.md (individual pages) - excludes /llm.md which has its own route
    "/((?!_next/static|_next/image|favicon.ico|api|llm\\.md).*)\\.md",
    // Match /path.txt (individual pages) - excludes /llm.txt which has its own route
    "/((?!_next/static|_next/image|favicon.ico|api|llm\\.txt).*)\\.txt",
  ],
};
