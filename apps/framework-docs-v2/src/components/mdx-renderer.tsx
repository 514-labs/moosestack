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
} from "@/components/mdx";
import { FileTreeFolder, FileTreeFile } from "@/components/mdx/file-tree";
import { CodeEditor } from "@/components/ui/shadcn-io/code-editor";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  IconTerminal,
  IconFileCode,
  IconRocket,
  IconDatabase,
  IconDeviceLaptop,
  IconBrandGithub,
  IconInfoCircle,
  IconCheck,
  IconClock,
} from "@tabler/icons-react";
import {
  MDXPre,
  MDXCode,
  MDXFigure,
} from "@/components/mdx/code-block-wrapper";
import { PathConfig } from "@/lib/path-config";
import Link from "next/link";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypePrettyCode from "rehype-pretty-code";

interface MDXRendererProps {
  source: string;
}

export async function MDXRenderer({ source }: MDXRendererProps) {
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

    figure: MDXFigure,
    // wrap with not-prose class
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
