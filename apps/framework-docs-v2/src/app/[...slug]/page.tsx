import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getAllSlugs, parseMarkdownContent } from "@/lib/content";
import { TOCNav } from "@/components/navigation/toc-nav";
import { MDXRenderer } from "@/components/mdx-renderer";

interface PageProps {
  params: Promise<{
    slug: string[];
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateStaticParams() {
  const slugs = getAllSlugs();

  // Generate params for each slug
  const allParams: { slug: string[] }[] = slugs.map((slug) => ({
    slug: slug.split("/"),
  }));

  // Also add section index routes (moosestack, ai, hosting)
  // These map to section/index.mdx files
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

  let content;
  try {
    content = await parseMarkdownContent(slug);
  } catch (error) {
    notFound();
  }

  return (
    <>
      <article className="prose prose-slate dark:prose-invert max-w-none">
        {content.isMDX ?
          <MDXRenderer source={content.content} />
        : <div dangerouslySetInnerHTML={{ __html: content.content }} />}
      </article>
      <TOCNav
        headings={content.headings}
        helpfulLinks={content.frontMatter.helpfulLinks}
      />
    </>
  );
}
