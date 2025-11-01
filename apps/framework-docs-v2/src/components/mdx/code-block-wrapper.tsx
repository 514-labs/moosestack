"use client";

import React from "react";
import {
  CodeBlock,
  CodeBlockBody,
  CodeBlockItem,
  CodeBlockContent,
} from "@/components/ui/shadcn-io/code-block";
import {
  Snippet,
  SnippetCopyButton,
  SnippetHeader,
  SnippetTabsContent,
  SnippetTabsList,
  SnippetTabsTrigger,
} from "@/components/ui/snippet";
import { CodeSnippet } from "./code-snippet";
import { CodeEditorWrapper } from "./code-editor-wrapper";
import { cn } from "@/lib/utils";

// Shell languages that should use Snippet (copyable) or CodeEditor (animated with filename)
const SHELL_LANGUAGES = new Set([
  "bash",
  "sh",
  "shell",
  "zsh",
  "fish",
  "powershell",
  "cmd",
]);

// Helper component for shell snippets using the new API
function ShellSnippet({ code, language }: { code: string; language: string }) {
  const [value, setValue] = React.useState("terminal");

  return (
    <Snippet value={value} onValueChange={setValue}>
      <SnippetHeader>
        <SnippetTabsList>
          <SnippetTabsTrigger value="terminal">Terminal</SnippetTabsTrigger>
        </SnippetTabsList>
        <SnippetCopyButton value={code} />
      </SnippetHeader>
      <SnippetTabsContent value="terminal">{code}</SnippetTabsContent>
    </Snippet>
  );
}

interface MDXCodeBlockProps extends React.HTMLAttributes<HTMLPreElement> {
  "data-language"?: string;
  "data-theme"?: string;
  "data-rehype-pretty-code-fragment"?: string;
  "data-rehype-pretty-code-title"?: string;
  "data-filename"?: string;
  "data-copy"?: string;
  children?: React.ReactNode;
}

interface MDXCodeProps extends React.HTMLAttributes<HTMLElement> {
  "data-language"?: string;
  "data-theme"?: string;
  "data-rehype-pretty-code-fragment"?: string;
  children?: React.ReactNode;
}

/**
 * Extracts the language from data attributes or className
 * rehype-pretty-code sets data-language on the code element
 */
function getLanguage(props: MDXCodeProps | MDXCodeBlockProps): string {
  // rehype-pretty-code adds data-language attribute
  const dataLang = props["data-language"];
  if (dataLang) {
    return dataLang.toLowerCase();
  }

  // Fallback to className if present
  if (typeof props.className === "string") {
    const match = props.className.match(/language-(\w+)/);
    if (match?.[1]) {
      return match[1].toLowerCase();
    }
  }

  return "";
}

/**
 * Extracts text content from children, handling rehype-pretty-code's HTML structure
 */
function extractTextContent(children: React.ReactNode): string {
  if (typeof children === "string") {
    return children;
  }
  if (Array.isArray(children)) {
    return children.map(extractTextContent).join("");
  }
  if (React.isValidElement(children)) {
    const props = children.props as any;
    // Handle rehype-pretty-code's span.line structure
    if (children.type === "span" && props.className?.includes("line")) {
      return extractTextContent(props.children) + "\n";
    }
    // Check if it's dangerouslySetInnerHTML (from rehype-pretty-code)
    if (props.dangerouslySetInnerHTML?.__html) {
      // For pre-rendered HTML, extract text by removing HTML tags
      const html = props.dangerouslySetInnerHTML.__html;
      return html
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"');
    }
    return extractTextContent(props.children);
  }
  return "";
}

/**
 * Component that wraps pre/code elements and routes to appropriate component
 * rehype-pretty-code transforms code blocks into pre[data-rehype-pretty-code-fragment]>code[data-language]
 */
export function MDXPre({ children, ...props }: MDXCodeBlockProps) {
  // rehype-pretty-code adds data-rehype-pretty-code-fragment to pre elements
  const isCodeBlock = props["data-rehype-pretty-code-fragment"] !== undefined;

  if (!isCodeBlock) {
    // Not a code block, render as-is
    const { className, ...restProps } = props;
    return (
      <pre className={cn("not-prose", className)} {...restProps}>
        {children}
      </pre>
    );
  }

  // Find the code element inside pre
  const codeElement = React.Children.toArray(children).find(
    (child) => React.isValidElement(child) && child.type === "code",
  ) as React.ReactElement<MDXCodeProps> | undefined;

  if (!codeElement) {
    // Fallback: render as-is if no code element
    const { className, ...restProps } = props;
    return (
      <pre className={cn("not-prose", className)} {...restProps}>
        {children}
      </pre>
    );
  }

  const language = getLanguage(codeElement.props);
  const codeText = extractTextContent(codeElement.props.children).trim();
  const filename =
    props["data-rehype-pretty-code-title"] || props["data-filename"];
  const hasCopy = props["data-copy"] !== undefined;
  const isShell = SHELL_LANGUAGES.has(language);

  // Routing logic:
  // 1. Shell languages with filename → Use CodeEditor (animated terminal)
  // 2. Shell languages without filename → Use Snippet (copyable, clearly marked as Terminal)
  // 3. filename attribute + no copy → Use CodeEditor (animated, non-editable)
  // 4. copy attribute → Use CodeSnippet (editable)
  // 5. Default → Use CodeSnippet (editable by default)

  // Shell commands with filename should be animated terminals
  if (isShell && filename && !hasCopy) {
    return (
      <CodeEditorWrapper
        code={codeText}
        language={language}
        filename={filename}
        variant="terminal"
        writing={true}
        duration={3}
        delay={0.3}
      />
    );
  }

  // Shell commands without filename should be copyable snippets with Terminal label
  if (isShell) {
    return <ShellSnippet code={codeText} language={language} />;
  }

  // If filename is provided and no copy attribute, use animated CodeEditor
  if (filename && !hasCopy) {
    // Determine if this is a terminal based on language
    const isTerminalLang = SHELL_LANGUAGES.has(language);
    return (
      <CodeEditorWrapper
        code={codeText}
        language={language || "typescript"}
        filename={filename}
        variant={isTerminalLang ? "terminal" : "ide"}
        writing={true}
        duration={isTerminalLang ? 3 : 5}
        delay={isTerminalLang ? 0.3 : 0.5}
      />
    );
  }

  // Default to CodeSnippet for editable code blocks (with or without copy attribute)
  return (
    <CodeSnippet
      code={codeText}
      language={language || "typescript"}
      filename={filename}
      copyButton={true}
    />
  );
}

// For backwards compatibility and direct usage
export function MDXCode({ children, className, ...props }: MDXCodeProps) {
  // Check if this is inline code (no language class) vs code block
  const isInline = !className?.includes("language-") && !props["data-language"];

  if (isInline) {
    // Inline code - render as normal code element
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }

  // This is a code block - should normally be wrapped in pre by MDXPre
  // But handle it here as fallback
  const language = getLanguage({ className, ...props });
  const codeText = extractTextContent(children).trim();
  const isShell = SHELL_LANGUAGES.has(language);

  if (isShell) {
    // Use Snippet for shell commands with Terminal label
    return <ShellSnippet code={codeText} language={language} />;
  }

  // Default to CodeSnippet for editable code blocks
  return (
    <CodeSnippet
      code={codeText}
      language={language || "typescript"}
      copyButton={true}
    />
  );
}
