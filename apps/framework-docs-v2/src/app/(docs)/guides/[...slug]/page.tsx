import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  getAllSlugs,
  parseMarkdownContent,
  discoverStepFiles,
} from "@/lib/content";
import { buildDocBreadcrumbs } from "@/lib/breadcrumbs";
import { parseGuideManifest } from "@/lib/guide-content";
import { TOCNav } from "@/components/navigation/toc-nav";
import { MDXRenderer } from "@/components/mdx-renderer";
import { DocBreadcrumbs } from "@/components/navigation/doc-breadcrumbs";
import { DynamicGuideBuilder } from "@/components/guides/dynamic-guide-builder";
import { MarkdownMenu } from "@/components/markdown-menu";
import { GuideIcon } from "@/components/guides/guide-header";
import { getGuideMetadataBySlug } from "@/config/navigation";

// Force static generation despite searchParams access
export const dynamic = "force-static";

interface PageProps {
  params: Promise<{
    slug: string[];
  }>;
}

export async function generateStaticParams() {
  // Get all slugs and filter for guides
  const slugs = getAllSlugs();

  // Filter for guides slugs and generate params
  const guideSlugs = slugs.filter((slug) => slug.startsWith("guides/"));

  // Remove the "guides/" prefix and split into array
  const allParams: { slug: string[] }[] = guideSlugs
    .map((slug) => slug.replace(/^guides\//, ""))
    .filter((slug) => slug !== "index") // Exclude the index page
    .map((slug) => ({
      slug: slug.split("/"),
    }));

  return allParams;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const resolvedParams = await params;
  const slugArray = resolvedParams.slug;

  // Handle empty slug array (shouldn't happen with [...slug] but be safe)
  if (!slugArray || slugArray.length === 0) {
    return {
      title: "Guides | MooseStack Documentation",
      description:
        "Comprehensive guides for building applications, managing data, and implementing data warehousing strategies",
    };
  }

  const slug = `guides/${slugArray.join("/")}`;

  try {
    const content = await parseMarkdownContent(slug);
    return {
      title:
        content.frontMatter.title ?
          `${content.frontMatter.title} | MooseStack Documentation`
        : "Guides | MooseStack Documentation",
      description:
        content.frontMatter.description ||
        "Comprehensive guides for building applications, managing data, and implementing data warehousing strategies",
    };
  } catch (error) {
    return {
      title: "Guides | MooseStack Documentation",
      description:
        "Comprehensive guides for building applications, managing data, and implementing data warehousing strategies",
    };
  }
}

export default async function GuidePage({ params }: PageProps) {
  const resolvedParams = await params;
  const slugArray = resolvedParams.slug;

  // Handle empty slug array (shouldn't happen with [...slug] but be safe)
  if (!slugArray || slugArray.length === 0) {
    notFound();
  }

  const slug = `guides/${slugArray.join("/")}`;

  let content;
  try {
    content = await parseMarkdownContent(slug);
  } catch {
    notFound();
  }

  const breadcrumbs = buildDocBreadcrumbs(
    slug,
    typeof content.frontMatter.title === "string" ?
      content.frontMatter.title
    : undefined,
  );

  // Copy button is always enabled - it's a client component that works with static pages
  const showCopyButton = true;
  const showLinear = false; // Can be enabled via environment variable if needed

  // Check if this is a dynamic guide by checking for guide.toml
  const guideManifest = await parseGuideManifest(slug);

  // Get guide metadata (icon) from navigation config
  const guideMetadata = getGuideMetadataBySlug(slug);

  if (guideManifest) {
    // DYNAMIC GUIDE LOGIC
    // Dynamic guides show a form first, steps load based on user selection
    // No steps are pre-rendered - they load when user makes selections

    return (
      <>
        <div className="flex w-full min-w-0 flex-col gap-6 pt-4">
          <div className="flex items-center justify-between">
            <DocBreadcrumbs items={breadcrumbs} />
            {showCopyButton && (
              <MarkdownMenu
                content={content.content}
                isMDX={content.isMDX ?? false}
              />
            )}
          </div>
          <GuideIcon iconName={guideMetadata?.iconName} />
          <article className="prose dark:prose-invert max-w-none w-full min-w-0 overflow-x-auto">
            {content.isMDX ?
              <MDXRenderer source={content.content} />
            : <div dangerouslySetInnerHTML={{ __html: content.content }} />}
          </article>

          <DynamicGuideBuilder manifest={guideManifest} />

          <div className="text-center p-8 text-muted-foreground border rounded-lg border-dashed">
            Select options above to see the guide steps.
          </div>
        </div>
        <TOCNav
          headings={content.headings}
          helpfulLinks={content.frontMatter.helpfulLinks}
          showLinearIntegration={showLinear}
        />
      </>
    );
  }

  // STATIC GUIDE LOGIC
  // Pre-render ALL steps at build time for full static generation

  // Discover step files for this starting point page
  const steps = discoverStepFiles(slug);

  // Pre-render ALL steps (not just the first one)
  const allStepContents: Array<{
    stepNumber: number;
    title: string;
    content: React.ReactNode;
  }> = [];

  for (const step of steps) {
    try {
      const stepData = await parseMarkdownContent(step.slug);
      allStepContents.push({
        stepNumber: step.stepNumber,
        title: step.title,
        content:
          stepData.isMDX ?
            <MDXRenderer source={stepData.content} />
          : <div dangerouslySetInnerHTML={{ __html: stepData.content }} />,
      });
    } catch (error) {
      console.error(`Failed to load step ${step.slug}:`, error);
    }
  }

  // Combine page headings with step headings for TOC
  const allHeadings = [...content.headings];
  if (steps.length > 0) {
    // Add steps as headings in TOC, avoiding duplicates
    const existingIds = new Set(allHeadings.map((h) => h.id));
    steps.forEach((step) => {
      const stepId = `step-${step.stepNumber}`;
      // Only add if ID doesn't already exist
      if (!existingIds.has(stepId)) {
        allHeadings.push({
          level: 2,
          text: `${step.stepNumber}. ${step.title}`,
          id: stepId,
        });
        existingIds.add(stepId);
      }
    });
  }

  return (
    <>
      <div className="flex w-full min-w-0 flex-col gap-6 pt-4">
        <div className="flex items-center justify-between">
          <DocBreadcrumbs items={breadcrumbs} />
          {showCopyButton && (
            <MarkdownMenu
              content={content.content}
              isMDX={content.isMDX ?? false}
            />
          )}
        </div>
        <GuideIcon iconName={guideMetadata?.iconName} />
        <article className="prose dark:prose-invert max-w-none w-full min-w-0 overflow-x-auto">
          {content.isMDX ?
            <MDXRenderer source={content.content} />
          : <div dangerouslySetInnerHTML={{ __html: content.content }} />}
        </article>
        {allStepContents.length > 0 &&
          allStepContents.map((step) => (
            <article
              key={`step-${step.stepNumber}`}
              id={`step-${step.stepNumber}`}
              className="prose dark:prose-invert max-w-none w-full min-w-0 overflow-x-auto scroll-mt-20"
            >
              <h2>
                {step.stepNumber}. {step.title}
              </h2>
              {step.content}
            </article>
          ))}
      </div>
      <TOCNav
        headings={allHeadings}
        helpfulLinks={content.frontMatter.helpfulLinks}
        showLinearIntegration={showLinear}
      />
    </>
  );
}
