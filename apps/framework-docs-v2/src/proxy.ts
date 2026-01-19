import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Rewrite /path/to/doc/llm.md to /api/llm/path/to/doc
  // Why this approach:
  // - Can't use /[...slug]/llm.md/route.ts - Next.js doesn't allow static segments after catch-all
  // - Can't use /[...slug]/route.ts - conflicts with existing /[...slug]/page.tsx
  // - Solution: API route + proxy rewrite keeps pretty URLs without conflicts
  if (pathname.endsWith("/llm.md")) {
    const contentPath = pathname.slice(0, -"/llm.md".length);
    const url = request.nextUrl.clone();
    url.pathname = `/api/llm${contentPath}`;
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match paths ending in /llm.md
    "/((?!_next/static|_next/image|favicon.ico).*)/llm.md",
  ],
};
