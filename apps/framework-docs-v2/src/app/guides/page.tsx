import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { parseMarkdownContent } from "@/lib/content";
import { TOCNav } from "@/components/navigation/toc-nav";
import { MDXRenderer } from "@/components/mdx-renderer";
import { DocBreadcrumbs } from "@/components/navigation/doc-breadcrumbs";
import { buildDocBreadcrumbs } from "@/lib/breadcrumbs";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  try {
    const content = await parseMarkdownContent("guides/index");
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

export default async function GuidesPage() {
  let content;
  try {
    content = await parseMarkdownContent("guides/index");
  } catch (error) {
    notFound();
  }

  const breadcrumbs = buildDocBreadcrumbs(
    "guides/index",
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
