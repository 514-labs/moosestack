import { type ReactNode } from "react";
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
  ExportRequirement,
  MuxVideo,
  FileTree,
  BulletPointsCard,
  CompareBulletPointsCard,
  ToggleBlock,
  ZoomImg,
  ReleaseHighlights,
  Added,
  Changed,
  Deprecated,
  Fixed,
  Security,
  BreakingChanges,
  TemplatesGridServer,
  CommandSnippet,
} from "@/components/mdx";
import { FileTreeFolder, FileTreeFile } from "@/components/mdx/file-tree";
import { CodeEditor } from "@/components/ui/shadcn-io/code-editor";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { IconTerminal, IconFileCode } from "@tabler/icons-react";
import {
  ServerCodeBlock,
  ServerInlineCode,
} from "@/components/mdx/server-code-block";
import { ServerFigure } from "@/components/mdx/server-figure";
import Link from "next/link";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypePrettyCode from "rehype-pretty-code";
import { rehypeCodeMeta } from "@/lib/rehype-code-meta";

interface MDXRendererProps {
  source: string;
}

export async function MDXRenderer({ source }: MDXRendererProps) {
  "use cache";
  // Create FileTree with nested components
  const FileTreeWithSubcomponents = Object.assign(FileTree, {
    Folder: FileTreeFolder,
    File: FileTreeFile,
  });

  // SourceCodeLink component for linking to GitHub source code
  const SourceCodeLink = ({
    path,
    children,
  }: {
    path: string;
    children: ReactNode;
  }) => {
    const branch = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF || "main";
    const url = `https://github.com/514-labs/moose/blob/${branch}/${path}`;
    return (
      <Link
        href={url}
        className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 underline"
        target="_blank"
        rel="noopener noreferrer"
      >
        {children as any}
      </Link>
    );
  };

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
    ExportRequirement,
    MuxVideo,
    FileTree: FileTreeWithSubcomponents,
    // Also expose sub-components directly for dot notation access
    "FileTree.Folder": FileTreeFolder,
    "FileTree.File": FileTreeFile,
    BulletPointsCard,
    CompareBulletPointsCard,
    ToggleBlock,
    ZoomImg,
    ReleaseHighlights,
    Added,
    Changed,
    Deprecated,
    Fixed,
    Security,
    BreakingChanges,
    TemplatesGridServer,
    CommandSnippet,
    CodeEditor,
    Separator,
    Tabs,
    TabsList,
    TabsTrigger,
    TabsContent,
    Badge,
    Terminal: IconTerminal,
    FileCode: IconFileCode,
    SourceCodeLink,
    Link,

    // Code block handling - server-side rendered
    figure: ServerFigure,
    pre: ServerCodeBlock,
    code: ServerInlineCode,
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
              },
            ],
            // Generic plugin to extract all meta attributes as data-* props
            rehypeCodeMeta,
          ],
        },
      }}
    />
  );
}
