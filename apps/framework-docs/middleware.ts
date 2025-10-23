import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const match = matchLlmPath(request.nextUrl.pathname);

  if (!match) {
    return NextResponse.next();
  }

  const rewriteUrl = request.nextUrl.clone();
  rewriteUrl.pathname = `/api/llm/${match.language}`;

  if (match.scope) {
    rewriteUrl.searchParams.set("scope", match.scope);
  } else {
    rewriteUrl.searchParams.delete("scope");
  }

  return NextResponse.rewrite(rewriteUrl);
}

interface LlmPathMatch {
  language: "py" | "ts";
  scope?: string;
}

function matchLlmPath(pathname: string): LlmPathMatch | null {
  const trimmed = pathname.replace(/\/+$/, "");
  if (!trimmed) {
    return null;
  }

  const segments = trimmed.split("/").filter(Boolean);
  if (segments.length === 0) {
    return null;
  }

  const filename = segments.pop();
  if (!filename) {
    return null;
  }
  const language = extractLanguage(filename);
  if (!language) {
    return null;
  }

  const scopeSegments = segments.slice();
  const scopeSuffix = extractScopeSuffix(filename, language);

  if (scopeSuffix) {
    scopeSegments.push(scopeSuffix);
  }

  const scope = scopeSegments.join("/");

  return {
    language,
    scope: scope || undefined,
  };
}

function extractLanguage(filename: string): "py" | "ts" | null {
  if (filename.endsWith("llm-py.txt")) {
    return "py";
  }

  if (filename.endsWith("llm-ts.txt")) {
    return "ts";
  }

  return null;
}

function extractScopeSuffix(
  filename: string,
  language: "py" | "ts",
): string | undefined {
  const suffix = `llm-${language}.txt`;

  if (filename === suffix) {
    return undefined;
  }

  const scopePart = filename.slice(0, filename.length - suffix.length);
  return scopePart.replace(/^-+|-+$/g, "") || undefined;
}

export const config = {
  matcher: ["/((?!api/|_next/|static/|favicon\\.ico).*)"],
};
