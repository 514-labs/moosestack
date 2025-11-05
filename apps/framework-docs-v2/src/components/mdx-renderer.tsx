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
} from "@/components/mdx";
import { FileTreeFolder, FileTreeFile } from "@/components/mdx/file-tree";
import { CodeEditor } from "@/components/ui/shadcn-io/code-editor";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
    CodeEditor,
    Separator,
    Tabs,
    TabsList,
    TabsTrigger,
    TabsContent,
    Terminal: IconTerminal,
    FileCode: IconFileCode,

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
