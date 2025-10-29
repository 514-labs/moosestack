export type Language = "typescript" | "python";

export interface FrontMatter {
  title?: string;
  description?: string;
  order?: number;
  category?: string;
  helpfulLinks?: Array<{
    title: string;
    url: string;
  }>;
}

export interface Heading {
  level: number;
  text: string;
  id: string;
}

export interface ParsedContent {
  frontMatter: FrontMatter;
  content: string;
  headings: Heading[];
  slug: string;
}

export interface NavItem {
  title: string;
  slug: string;
  order: number;
  category?: string;
  children?: NavItem[];
}
