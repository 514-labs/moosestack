import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getAllSlugs, parseMarkdownContent } from "@/lib/content";
import { buildDocBreadcrumbs } from "@/lib/breadcrumbs";
import { TOCNav } from "@/components/navigation/toc-nav";
import { MDXRenderer } from "@/components/mdx-renderer";
import { DocBreadcrumbs } from "@/components/navigation/doc-breadcrumbs";
import { MarkdownMenu } from "@/components/markdown-menu";

// Force static generation for optimal performance
export const dynamic = "force-static";

interface PageProps {
  params: Promise<{
    slug: string[];
  }>;
}

export async function generateStaticParams() {
  const slugs = getAllSlugs();

  // Filter out templates and guides slugs (they have their own explicit pages)
  const filteredSlugs = slugs.filter(
    (slug) => !slug.startsWith("templates/") && !slug.startsWith("guides/"),
  );

  // Generate params for each slug
  const allParams: { slug: string[] }[] = filteredSlugs.map((slug) => ({
    slug: slug.split("/"),
  }));

  // Also add section index routes (moosestack, ai, hosting)
  // Note: templates and guides are now explicit pages, so they're excluded here
  allParams.push(
    { slug: ["moosestack"] },
    { slug: ["ai"] },
    { slug: ["hosting"] },
  );

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
      title: "MooseStack Documentation",
      description: "Build data-intensive applications with MooseStack",
    };
  }

  const slug = slugArray.join("/");

  try {
    const content = await parseMarkdownContent(slug);
    return {
      title:
        content.frontMatter.title ?
          `${content.frontMatter.title} | MooseStack Documentation`
        : "MooseStack Documentation",
      description:
        content.frontMatter.description ||
        "Build data-intensive applications with MooseStack",
    };
  } catch (error) {
    return {
      title: "MooseStack Documentation",
      description: "Build data-intensive applications with MooseStack",
    };
  }
}

export default async function DocPage({ params }: PageProps) {
  const resolvedParams = await params;
  const slugArray = resolvedParams.slug;

  // Handle empty slug array (shouldn't happen with [...slug] but be safe)
  if (!slugArray || slugArray.length === 0) {
    notFound();
  }

  const slug = slugArray.join("/");

  // Templates and guides are now explicit pages, so they should not be handled by this catch-all route
  if (slug.startsWith("templates/") || slug.startsWith("guides/")) {
    notFound();
  }

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

  // Copy button is always enabled - it's a client component that works with static pages
  const showCopyButton = true;

  // Hide breadcrumbs for top-level section index pages (e.g., /moosestack, /hosting/overview, /ai/overview)
  const isTopLevelIndex =
    !slug.includes("/") ||
    slug === "hosting/overview" ||
    slug === "ai/overview";

  return (
    <>
      <div className="flex w-full min-w-0 flex-col gap-6 pt-4">
        <div className="flex items-center justify-between">
          {!isTopLevelIndex && <DocBreadcrumbs items={breadcrumbs} />}
          {showCopyButton && (
            <MarkdownMenu
              content={content.content}
              isMDX={content.isMDX ?? false}
            />
          )}
        </div>
        <article className="prose dark:prose-invert max-w-none w-full min-w-0 overflow-x-auto">
          {content.isMDX ?
            <MDXRenderer source={content.content} />
          : <div dangerouslySetInnerHTML={{ __html: content.content }} />}
        </article>
      </div>
      <TOCNav
        headings={content.headings}
        helpfulLinks={content.frontMatter.helpfulLinks}
      />
    </>
  );
}
