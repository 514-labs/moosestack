import { notFound } from "next/navigation";
import { getAllDocSlugs, getDocBySlug, getBreadcrumbs } from "@/lib/content";
import { TOCNav } from "@/components/navigation/TOCNav";
import { CodeBlock } from "@/components/CodeBlock";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

export async function generateStaticParams() {
  const slugs = await getAllDocSlugs("python");
  return slugs.map((slug) => ({
    slug: slug.length === 0 ? undefined : slug,
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug = [] } = await params;
  const doc = await getDocBySlug("python", slug);

  if (!doc) {
    return {
      title: "Not Found",
    };
  }

  return {
    title: `${doc.frontmatter.title || "Documentation"} | MooseStack`,
    description: doc.frontmatter.description,
  };
}

export default async function PythonDocPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug = [] } = await params;
  const doc = await getDocBySlug("python", slug);

  if (!doc) {
    notFound();
  }

  const breadcrumbs = await getBreadcrumbs("python", slug);

  return (
    <div className="flex w-full">
      <div className="flex-1 px-8 py-6 max-w-4xl">
        {/* Breadcrumbs */}
        <nav className="flex items-center space-x-2 text-sm text-muted-foreground mb-6">
          {breadcrumbs.map((crumb, index) => (
            <div key={crumb.slug.join("/")} className="flex items-center">
              {index > 0 && <ChevronRight className="h-4 w-4 mx-2" />}
              <Link
                href={`/python/${crumb.slug.join("/")}`}
                className="hover:text-foreground transition-colors"
              >
                {crumb.title}
              </Link>
            </div>
          ))}
        </nav>

        {/* Page Title */}
        {doc.frontmatter.title && (
          <h1 className="scroll-m-20 text-4xl font-bold tracking-tight lg:text-5xl mb-4">
            {doc.frontmatter.title}
          </h1>
        )}

        {/* Description */}
        {doc.frontmatter.description && (
          <p className="text-lg text-muted-foreground mb-8">
            {doc.frontmatter.description}
          </p>
        )}

        {/* Content */}
        <article
          className="prose prose-slate max-w-none"
          dangerouslySetInnerHTML={{ __html: doc.html }}
        />
      </div>

      {/* TOC Nav */}
      <TOCNav
        headings={doc.headings}
        helpfulLinks={doc.frontmatter.helpfulLinks}
      />
    </div>
  );
}

