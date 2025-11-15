import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getAllSlugs, parseMarkdownContent } from "@/lib/content";
import { TOCNav } from "@/components/navigation/toc-nav";
import { MDXRenderer } from "@/components/mdx-renderer";
import { DocBreadcrumbs } from "@/components/navigation/doc-breadcrumbs";
import { buildDocBreadcrumbs } from "@/lib/breadcrumbs";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{
    slug: string[];
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateStaticParams() {
  const slugs = getAllSlugs();

  // Generate params for each slug
  // Note: templates is excluded from getAllSlugs() as it is now an explicit page
  const allParams: { slug: string[] }[] = slugs.map((slug) => ({
    slug: slug.split("/"),
  }));

  // Also add section index routes (moosestack, ai, hosting, guides)
  // Note: templates is now an explicit page, so it's excluded here
  allParams.push(
    { slug: ["moosestack"] },
    { slug: ["ai"] },
    { slug: ["hosting"] },
    { slug: ["guides"] },
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

  // Templates is now an explicit page, so it should not be handled by this catch-all route
  if (slug.startsWith("templates/")) {
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

  return (
    <>
      <div className="flex w-full flex-col gap-6 pt-4">
        <DocBreadcrumbs items={breadcrumbs} />
        <article className="prose prose-slate dark:prose-invert max-w-none w-full min-w-0">
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
