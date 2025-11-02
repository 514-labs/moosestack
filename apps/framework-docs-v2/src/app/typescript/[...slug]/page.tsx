import { notFound } from "next/navigation";
import { getAllSlugs, parseMarkdownContent } from "@/lib/content";
import { TOCNav } from "@/components/navigation/toc-nav";

interface PageProps {
  params: Promise<{
    slug: string[];
  }>;
}

export async function generateStaticParams() {
  const slugs = getAllSlugs("typescript");
  return slugs.map((slug) => ({
    slug: slug.split("/"),
  }));
}

export default async function TypeScriptDocPage({ params }: PageProps) {
  const resolvedParams = await params;
  const slug = resolvedParams.slug.join("/");

  let content;
  try {
    content = await parseMarkdownContent("typescript", slug);
  } catch (error) {
    notFound();
  }

  return (
    <>
      <article className="prose prose-slate dark:prose-invert max-w-none">
        {content.frontMatter.title && (
          <h1>{content.frontMatter.title}</h1>
        )}
        {content.frontMatter.description && (
          <p className="lead">{content.frontMatter.description}</p>
        )}
        <div dangerouslySetInnerHTML={{ __html: content.content }} />
      </article>
      <TOCNav
        headings={content.headings}
        helpfulLinks={content.frontMatter.helpfulLinks}
      />
    </>
  );
}

