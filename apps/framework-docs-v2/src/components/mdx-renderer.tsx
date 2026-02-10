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
  CommunityCallout,
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
  // Interactive components for dynamic guides
  SelectField,
  CheckboxGroup,
  CheckboxGroupContent,
  CustomizePanel,
  CustomizeGrid,
  NumberedAccordion,
  NumberedAccordionItem,
  GuideStepper,
  GuideStepperStep,
  GuideStepperCheckpoint,
  GuideStepperAtAGlance,
  GuideStepperPrompt,
  VerticalProgressSteps,
  VerticalProgressStepItem,
  TabbedCode,
  TabbedCodeContent,
  ConditionalContent,
} from "@/components/mdx";
import { FileTreeFolder, FileTreeFile } from "@/components/mdx/file-tree";
import { CodeEditor } from "@/components/ui/shadcn-io/code-editor";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
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
import { rehypeRestoreCodeMeta } from "@/lib/rehype-restore-code-meta";
import { ensureCodeBlockSpacing } from "@/lib/remark-code-block-spacing";
import { remarkGuideStepperMarkers } from "@/lib/remark-guide-stepper-markers";

// Module-level component wiring (hoisted to avoid per-render allocations)
// Create FileTree with nested components
const FileTreeWithSubcomponents = Object.assign(FileTree, {
  Folder: FileTreeFolder,
  File: FileTreeFile,
});

// Create interactive components with nested sub-components
const CheckboxGroupWithSubcomponents = Object.assign(CheckboxGroup, {
  Content: CheckboxGroupContent,
});
const NumberedAccordionWithSubcomponents = Object.assign(NumberedAccordion, {
  Item: NumberedAccordionItem,
});
const GuideStepperWithSubcomponents = Object.assign(GuideStepper, {
  Step: GuideStepperStep,
  Checkpoint: GuideStepperCheckpoint,
  AtAGlance: GuideStepperAtAGlance,
  Prompt: GuideStepperPrompt,
});
const VerticalProgressStepsWithSubcomponents = Object.assign(
  VerticalProgressSteps,
  {
    Item: VerticalProgressStepItem,
  },
);
const TabbedCodeWithSubcomponents = Object.assign(TabbedCode, {
  Content: TabbedCodeContent,
});

interface MDXRendererProps {
  source: string;
}

export async function MDXRenderer({ source }: MDXRendererProps) {
  // Preprocess content to ensure proper spacing around code blocks
  // This prevents hydration errors from invalid HTML nesting
  const processedSource = ensureCodeBlockSpacing(source);

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
    CommunityCallout,
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
    Accordion,
    AccordionItem,
    AccordionTrigger,
    AccordionContent,
    Terminal: IconTerminal,
    FileCode: IconFileCode,
    SourceCodeLink,
    Link,

    // Interactive components for dynamic guides
    SelectField,
    CheckboxGroup: CheckboxGroupWithSubcomponents,
    "CheckboxGroup.Content": CheckboxGroupContent,
    CustomizePanel,
    CustomizeGrid,
    NumberedAccordion: NumberedAccordionWithSubcomponents,
    "NumberedAccordion.Item": NumberedAccordionItem,
    GuideStepper: GuideStepperWithSubcomponents,
    "GuideStepper.Step": GuideStepperStep,
    "GuideStepper.Checkpoint": GuideStepperCheckpoint,
    "GuideStepper.AtAGlance": GuideStepperAtAGlance,
    "GuideStepper.Prompt": GuideStepperPrompt,
    VerticalProgressSteps: VerticalProgressStepsWithSubcomponents,
    "VerticalProgressSteps.Item": VerticalProgressStepItem,
    TabbedCode: TabbedCodeWithSubcomponents,
    "TabbedCode.Content": TabbedCodeContent,
    ConditionalContent,

    // Code block handling - server-side rendered
    figure: ServerFigure,
    pre: ServerCodeBlock,
    code: ServerInlineCode,
  };

  return (
    <MDXRemote
      source={processedSource}
      components={components}
      options={{
        mdxOptions: {
          remarkPlugins: [remarkGfm, remarkGuideStepperMarkers],
          rehypePlugins: [
            rehypeSlug,
            [rehypeAutolinkHeadings, { behavior: "wrap" }],
            // Extract meta attributes BEFORE rehype-pretty-code consumes them
            rehypeCodeMeta,
            [
              rehypePrettyCode,
              {
                theme: {
                  light: "github-light",
                  dark: "github-dark",
                },
                keepBackground: false,
                defaultLang: "plaintext",
              },
            ],
            // Restore custom meta attributes AFTER rehype-pretty-code
            rehypeRestoreCodeMeta,
          ],
        },
      }}
    />
  );
}
