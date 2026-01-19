import { NextRequest, NextResponse } from "next/server";
import { parseMarkdownContent, discoverStepFiles } from "@/lib/content";
import { parseGuideManifest, getCachedGuideSteps } from "@/lib/guide-content";
import { cleanContent, filterLanguageContent } from "@/lib/llms-generator";

type ParsedContent = Awaited<ReturnType<typeof parseMarkdownContent>>;

// --- Helpers ---

function cleanMarkdown(content: ParsedContent, lang?: string): string {
  return content.isMDX ?
      cleanContent(filterLanguageContent(content.content, lang))
    : content.content;
}

function markdownResponse(content: string): NextResponse {
  return new NextResponse(content, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "s-maxage=1800, stale-while-revalidate=300",
    },
  });
}

function formatStep(
  stepNumber: number,
  title: string,
  content: string,
): string {
  return `\n\n---\n\n## Step ${stepNumber}: ${title}\n\n${content}`;
}

// --- Route Handler ---

interface RouteParams {
  params: Promise<{ slug: string[] }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { slug: slugArray } = await params;

  if (!slugArray?.length) {
    return new NextResponse("Not Found", { status: 404 });
  }

  try {
    const slug = slugArray.join("/");
    const { searchParams } = new URL(request.url);
    const lang = searchParams.get("lang") ?? undefined;
    const content = await parseMarkdownContent(slug);

    if (slug.startsWith("guides/")) {
      return handleGuide(slug, content, lang, searchParams);
    }

    return markdownResponse(cleanMarkdown(content, lang));
  } catch {
    return new NextResponse("Not Found", { status: 404 });
  }
}

// --- Guide Handler ---

async function handleGuide(
  slug: string,
  content: ParsedContent,
  lang: string | undefined,
  searchParams: URLSearchParams,
): Promise<NextResponse> {
  const parts = [cleanMarkdown(content, lang)];

  const guideManifest = await parseGuideManifest(slug);

  if (guideManifest) {
    // Dynamic guide - load steps based on query params
    const queryParams = Object.fromEntries(
      [...searchParams.entries()].filter(([key]) => key !== "lang"),
    );
    const steps = await getCachedGuideSteps(slug, queryParams);

    for (const step of steps) {
      if (step.content) {
        const cleaned =
          step.isMDX ?
            cleanContent(filterLanguageContent(step.content, lang))
          : step.content;
        parts.push(formatStep(step.stepNumber, step.title, cleaned));
      }
    }
  } else {
    // Static guide - discover and load step files
    const steps = discoverStepFiles(slug);

    for (const step of steps) {
      try {
        const stepContent = await parseMarkdownContent(step.slug);
        parts.push(
          formatStep(
            step.stepNumber,
            step.title,
            cleanMarkdown(stepContent, lang),
          ),
        );
      } catch {
        // Skip steps that fail to load
      }
    }
  }

  return markdownResponse(parts.join(""));
}
