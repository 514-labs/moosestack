import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    {
      source:
        "/((?!monitoring-tunnel|api|_next/static|images|favicon.ico|opengraph-image.*|wp-*|apple-*|cgi-*|robots.txt).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};

/**
 * Validates if the host is allowed
 * Allowed hosts are:
 * - docs.fiveonefour.com
 * - *.vercel.app
 * - localhost:<port>
 */
function isValidHost(host: string): boolean {
  return (
    host === "docs.fiveonefour.com" ||
    host.endsWith(".vercel.app") ||
    /^localhost:[0-9]+$/.test(host)
  );
}

export async function middleware(request: NextRequest) {
  // Check if the host is docs.getmoose.dev and redirect
  if (request.nextUrl.host === "docs.getmoose.dev") {
    return NextResponse.redirect(
      new URL("/moose", "https://docs.fiveonefour.com"),
    );
  }

  const ip = request.ip ? request.ip : request.headers.get("X-Forwarded-For");
  const originalHost = request.nextUrl.host;
  const referrer = headers().get("referer") ?? request.referrer;
  const pathname = request.nextUrl.pathname;

  const env = process.env.NODE_ENV;

  try {
    // Validate protocol - only allow http: or https:
    const protocol =
      ["http:", "https:"].includes(request.nextUrl.protocol) ?
        request.nextUrl.protocol
      : "https:";

    // Validate host against allowed domains
    // Use a safe default if host is invalid
    const host =
      isValidHost(originalHost) ? originalHost : "docs.fiveonefour.com";

    // Using validated protocol and host for same-origin request
    const response = await fetch(`${protocol}//${host}/api/event`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "page_view",
        host,
        referrer,
        env,
        ip,
        pathname,
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to send event");
    }
  } catch (error) {
    console.error(error);
  }

  // Replace all instances of "aurora" with "sloan" in the pathname (case-insensitive)
  if (pathname.toLowerCase().includes("aurora")) {
    const newUrl = request.nextUrl.clone();
    newUrl.pathname = pathname.replace(/aurora/gi, "sloan");
    return NextResponse.redirect(newUrl, { status: 301 });
  }

  return NextResponse.next();
}
