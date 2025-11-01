import { MDXRemote } from "next-mdx-remote/rsc";
import {
  IconBadge,
  CTACard,
  CTACards,
  StaggeredCard,
  StaggeredCards,
  StaggeredContent,
  StaggeredCode,
  Callout,
  LanguageTabs,
  LanguageTabContent,
  CodeEditorWrapper,
} from "@/components/mdx";
import { CodeEditor } from "@/components/ui/shadcn-io/code-editor";
import { Terminal, FileCode } from "lucide-react";
import { MDXPre, MDXCode } from "@/components/mdx/code-block-wrapper";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypePrettyCode from "rehype-pretty-code";

interface MDXRendererProps {
  source: string;
}

export async function MDXRenderer({ source }: MDXRendererProps) {
  const components = {
    // Provide custom components to all MDX files
    IconBadge,
    CTACard,
    CTACards,
    StaggeredCard,
    StaggeredCards,
    StaggeredContent,
    StaggeredCode,
    Callout,
    LanguageTabs,
    LanguageTabContent,
    CodeEditorWrapper,
    CodeEditor,
    Terminal,
    FileCode,
    // Custom code block components
    pre: MDXPre,
    code: MDXCode,
  };

  return (
    <MDXRemote
      source={source}
      components={components}
      options={{
        mdxOptions: {
          remarkPlugins: [remarkGfm],
          rehypePlugins: [
            rehypeSlug,
            [rehypeAutolinkHeadings, { behavior: "wrap" }],
            [
              rehypePrettyCode,
              {
                theme: "github-dark",
                keepBackground: false,
                // Keep rehype-pretty-code for now to mark code blocks,
                // but our components will handle the actual rendering
              },
            ],
          ],
        },
      }}
    />
  );
}
