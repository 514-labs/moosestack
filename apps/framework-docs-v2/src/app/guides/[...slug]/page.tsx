import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  getAllSlugs,
  parseMarkdownContent,
  discoverStepFiles,
} from "@/lib/content";
import { TOCNav } from "@/components/navigation/toc-nav";
import { MDXRenderer } from "@/components/mdx-renderer";
import { DocBreadcrumbs } from "@/components/navigation/doc-breadcrumbs";
import { buildDocBreadcrumbs } from "@/lib/breadcrumbs";
import { GuideStepsWrapper } from "@/components/guides/guide-steps-wrapper";
import { DynamicGuideBuilder } from "@/components/guides/dynamic-guide-builder";
import { parseGuideManifest, getCachedGuideSteps } from "@/lib/guide-content";

// export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{
    slug: string[];
  }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
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

export default async function GuidePage({ params, searchParams }: PageProps) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const slugArray = resolvedParams.slug;

  // Handle empty slug array (shouldn't happen with [...slug] but be safe)
  if (!slugArray || slugArray.length === 0) {
    notFound();
  }

  const slug = `guides/${slugArray.join("/")}`;

  let content;
  try {
    content = await parseMarkdownContent(slug);
  } catch (error) {
    notFound();
  }

  const breadcrumbs = buildDocBreadcrumbs(
    slug,
    typeof content.frontMatter.title === "string" ?
      content.frontMatter.title
    : undefined,
  );

  // Check if this is a dynamic guide by checking for guide.toml
  const guideManifest = await parseGuideManifest(slug);

  if (guideManifest) {
    // DYNAMIC GUIDE LOGIC

    // Flatten search params to Record<string, string> for our cache function
    const queryParams: Record<string, string> = {};
    Object.entries(resolvedSearchParams).forEach(([key, value]) => {
      if (typeof value === "string") {
        queryParams[key] = value;
      } else if (Array.isArray(value) && value.length > 0) {
        // Take first value if array
        queryParams[key] = value[0];
      }
    });

    // Fetch steps here (cached function)
    const steps = await getCachedGuideSteps(slug, queryParams);

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
        <div className="flex w-full flex-col gap-6 pt-4">
          <DocBreadcrumbs items={breadcrumbs} />
          <article className="prose prose-slate dark:prose-invert max-w-none w-full min-w-0">
            {content.isMDX ?
              <MDXRenderer source={content.content} />
            : <div dangerouslySetInnerHTML={{ __html: content.content }} />}
          </article>

          <DynamicGuideBuilder manifest={guideManifest} />

          {steps.length > 0 ?
            <GuideStepsWrapper
              steps={steps.map(({ content, isMDX, ...step }) => step)}
              stepsWithContent={steps}
              currentSlug={slug}
            />
          : <div className="text-center p-8 text-muted-foreground border rounded-lg border-dashed">
              No steps found for this configuration. Please try different
              options.
            </div>
          }
        </div>
        <TOCNav
          headings={allHeadings}
          helpfulLinks={content.frontMatter.helpfulLinks}
        />
      </>
    );
  }

  // STATIC GUIDE LOGIC (Fallback)

  // Discover step files for this starting point page
  const steps = discoverStepFiles(slug);

  // Load step content server-side and pre-render MDX
  const stepsWithContent = await Promise.all(
    steps.map(async (step) => {
      try {
        const stepContent = await parseMarkdownContent(step.slug);
        return {
          ...step,
          content: stepContent.content,
          isMDX: stepContent.isMDX ?? false,
        };
      } catch (error) {
        console.error(`Failed to load step ${step.slug}:`, error);
        return {
          ...step,
          content: null,
          isMDX: false,
        };
      }
    }),
  );

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
      <div className="flex w-full flex-col gap-6 pt-4">
        <DocBreadcrumbs items={breadcrumbs} />
        <article className="prose prose-slate dark:prose-invert max-w-none w-full min-w-0">
          {content.isMDX ?
            <MDXRenderer source={content.content} />
          : <div dangerouslySetInnerHTML={{ __html: content.content }} />}
        </article>
        {steps.length > 0 && (
          <GuideStepsWrapper
            steps={stepsWithContent.map(
              ({ content: _, isMDX: __, ...step }) => step,
            )}
            stepsWithContent={stepsWithContent}
            currentSlug={slug}
          />
        )}
      </div>
      <TOCNav
        headings={allHeadings}
        helpfulLinks={content.frontMatter.helpfulLinks}
      />
    </>
  );
}
