import type { MDXComponents } from "mdx/types";
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
} from "@/components/mdx";
import { MDXPre, MDXCode } from "@/components/mdx/code-block-wrapper";

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
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
    // Custom code block components
    pre: MDXPre,
    code: MDXCode,
    ...components,
  };
}
