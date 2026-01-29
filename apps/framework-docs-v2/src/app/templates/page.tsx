import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { parseMarkdownContent } from "@/lib/content";
import { TOCNav } from "@/components/navigation/toc-nav";
import { MDXRenderer } from "@/components/mdx-renderer";

// export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  try {
    const content = await parseMarkdownContent("templates/index");
    return {
      title:
        content.frontMatter.title ?
          `${content.frontMatter.title} | MooseStack Documentation`
        : "Templates & Apps | MooseStack Documentation",
      description:
        content.frontMatter.description ||
        "Browse templates and demo apps for MooseStack",
    };
  } catch (error) {
    return {
      title: "Templates & Apps | MooseStack Documentation",
      description: "Browse templates and demo apps for MooseStack",
    };
  }
}

export default async function TemplatesPage() {
  let content;
  try {
    content = await parseMarkdownContent("templates/index");
  } catch (error) {
    notFound();
  }

  return (
    <>
      <div className="flex w-full min-w-0 flex-col gap-6 pt-4">
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
