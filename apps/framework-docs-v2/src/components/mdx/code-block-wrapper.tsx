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

// Config/data file languages that should always use static CodeSnippet (not animated CodeEditor)
const CONFIG_LANGUAGES = new Set([
  "toml",
  "yaml",
  "yml",
  "json",
  "jsonc",
  "ini",
  "properties",
  "config",
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
  "data-rehype-pretty-code-title"?: string;
  "data-filename"?: string;
  children?: React.ReactNode;
}

interface MDXFigureProps extends React.HTMLAttributes<HTMLElement> {
  "data-rehype-pretty-code-figure"?: string;
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
 * This function recursively extracts all text content, handling fragments, arrays, and nested elements
 * Uses React.Children utilities to ensure all children are processed
 */
function extractTextContent(children: React.ReactNode): string {
  if (children == null) {
    return "";
  }

  if (typeof children === "string") {
    return children;
  }

  if (typeof children === "number" || typeof children === "boolean") {
    return String(children);
  }

  // Use React.Children utilities to handle all cases, including arrays and fragments
  const parts: string[] = [];

  React.Children.forEach(children, (child) => {
    if (child == null) {
      return;
    }

    if (typeof child === "string") {
      parts.push(child);
      return;
    }

    if (typeof child === "number" || typeof child === "boolean") {
      parts.push(String(child));
      return;
    }

    if (React.isValidElement(child)) {
      const props = child.props as any;
      const childType = child.type;

      // Handle React fragments
      if (childType === React.Fragment) {
        parts.push(extractTextContent(props.children));
        return;
      }

      // Handle rehype-pretty-code's span.line structure
      // Important: Add newline after the line content to preserve line breaks
      if (childType === "span" && props.className?.includes("line")) {
        const lineContent = extractTextContent(props.children);
        parts.push(lineContent + "\n");
        return;
      }

      // Check if it's dangerouslySetInnerHTML (from rehype-pretty-code)
      if (props.dangerouslySetInnerHTML?.__html) {
        // For pre-rendered HTML, extract text by removing HTML tags
        const html = props.dangerouslySetInnerHTML.__html;
        const htmlResult = html
          .replace(/<[^>]*>/g, "")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"');
        parts.push(htmlResult);
        return;
      }

      // For other elements (including other span types, divs, etc.),
      // recursively extract from their children
      // This ensures we don't miss any nested content
      parts.push(extractTextContent(props.children));
      return;
    }

    // Fallback for anything else
    parts.push(String(child));
  });

  return parts.join("");
}

/**
 * Extracts text content from a React node (for figcaption titles)
 */
function extractTextFromNode(node: React.ReactNode): string {
  if (typeof node === "string") {
    return node;
  }
  if (typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(extractTextFromNode).join("");
  }
  if (React.isValidElement(node)) {
    const props = node.props as any;
    return extractTextFromNode(props.children);
  }
  return "";
}

/**
 * Handles the figure wrapper from rehype-pretty-code
 * Extracts the title from figcaption and passes it to the pre element
 */
export function MDXFigure({ children, ...props }: MDXFigureProps) {
  // Only handle code block figures
  // data-rehype-pretty-code-figure is present (even if empty string) for code blocks
  if (props["data-rehype-pretty-code-figure"] === undefined) {
    return <figure {...props}>{children}</figure>;
  }

  // For code blocks, extract figcaption title and pass to pre
  const childrenArray = React.Children.toArray(children);

  // Find figcaption and pre elements
  // Note: child.type might be a React component, so we check the element's actual tag
  let figcaption: React.ReactElement | null = null;
  let preElement: React.ReactElement | null = null;

  childrenArray.forEach((child) => {
    if (React.isValidElement(child)) {
      const childType = child.type;
      const childProps = (child.props as any) || {};

      // Check if it's a native HTML element by checking if type is a string
      if (typeof childType === "string") {
        if (childType === "figcaption") {
          figcaption = child;
        } else if (childType === "pre") {
          preElement = child;
        }
      } else {
        // For React components (like MDXPre)
        // Inside a code block figure, we typically have figcaption and pre
        // Check if it has code block attributes (data-language, data-theme, etc.)
        // These attributes are set by rehype-pretty-code on code block pre elements
        const hasCodeBlockAttrs =
          childProps["data-rehype-pretty-code-fragment"] !== undefined ||
          childProps["data-language"] !== undefined ||
          childProps["data-theme"] !== undefined;

        // If it has code block attributes, it's the pre element
        // Otherwise, if we haven't found a pre yet and we're in a code block figure,
        // assume this component is the pre (since figures typically only have figcaption + pre)
        if (hasCodeBlockAttrs || !preElement) {
          preElement = child;
        }
      }
    }
  });

  // Extract filename from figcaption (title from markdown)
  // The figcaption contains the title that was specified in the code block meta
  const figcaptionTitle =
    figcaption ?
      extractTextFromNode(
        (figcaption as React.ReactElement<any>).props.children,
      ).trim()
    : undefined;
  const preProps =
    preElement ? ((preElement as React.ReactElement<any>).props as any) : {};

  // Prioritize figcaption title (from markdown title="...") over any existing attributes
  // This ensures the title from the figcaption is used as the filename
  const filename =
    figcaptionTitle ||
    preProps["data-rehype-pretty-code-title"] ||
    preProps["data-filename"];

  // If we have a pre element, ensure the filename is set on both attributes
  // so MDXPre can pick it up
  // IMPORTANT: Preserve all existing props including data-rehype-pretty-code-fragment
  if (preElement) {
    // If we're in a code block figure and have data-language/data-theme, ensure fragment is set
    // This is needed for MDXPre to recognize it as a code block
    const hasCodeBlockAttrs =
      preProps["data-language"] !== undefined ||
      preProps["data-theme"] !== undefined;
    const fragmentValue =
      preProps["data-rehype-pretty-code-fragment"] !== undefined ?
        preProps["data-rehype-pretty-code-fragment"]
      : hasCodeBlockAttrs ? ""
      : undefined; // Empty string if code block, undefined otherwise

    const updatedPre = React.cloneElement(
      preElement as React.ReactElement<any>,
      {
        ...preProps, // Preserve all existing props first
        "data-filename": filename || undefined, // Set filename attribute from title
        "data-rehype-pretty-code-title": filename || undefined, // Also set title attribute
        // Ensure data-rehype-pretty-code-fragment is set so MDXPre recognizes it as a code block
        ...(fragmentValue !== undefined ?
          { "data-rehype-pretty-code-fragment": fragmentValue }
        : {}),
      },
    );
    return <>{updatedPre}</>;
  }

  // Fallback: render children (shouldn't happen for code blocks)
  return <>{children}</>;
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

  /**
   * Recursively searches for a code element in children
   * Skips over rendered components and focuses on finding the original code element from rehype-pretty-code
   */
  function findCodeElement(
    node: React.ReactNode,
    depth = 0,
  ): React.ReactElement<MDXCodeProps> | undefined {
    // Limit recursion depth to avoid infinite loops
    if (depth > 10) {
      return undefined;
    }

    // Handle arrays - search through all items
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = findCodeElement(item, depth + 1);
        if (found) {
          return found;
        }
      }
      return undefined;
    }

    if (!React.isValidElement(node)) {
      return undefined;
    }

    const nodeType = node.type;
    const nodeProps = (node.props as any) || {};

    // Handle React fragments - search in their children
    if (nodeType === React.Fragment) {
      if (nodeProps.children) {
        return findCodeElement(nodeProps.children, depth + 1);
      }
      return undefined;
    }

    // Check if this element is a code element (native HTML or component)
    if (typeof nodeType === "string" && nodeType === "code") {
      return node as React.ReactElement<MDXCodeProps>;
    }

    // Skip over already-rendered components (like CodeSnippet, CodeBlock, etc.)
    // These are React components that would have already processed the code
    // We want to find the original code element from rehype-pretty-code
    if (typeof nodeType === "function" || typeof nodeType === "object") {
      // Skip if it's a rendered component (has complex className or structure)
      // But continue searching in its children if it might wrap the original code
      const skipComponents = [
        "CodeSnippet",
        "CodeBlock",
        "CodeEditorWrapper",
        "Snippet",
      ];

      // Check if this might be a wrapper component by checking for specific props
      // If it has dangerouslySetInnerHTML, it's likely already processed
      if (nodeProps.dangerouslySetInnerHTML) {
        return undefined;
      }

      // Continue searching in children of component wrappers
      if (nodeProps.children) {
        const childrenArray = React.Children.toArray(nodeProps.children);
        for (const child of childrenArray) {
          const found = findCodeElement(child, depth + 1);
          if (found) {
            return found;
          }
        }
      }
      return undefined;
    }

    // For native HTML elements, check if it's a code element or search children
    if (typeof nodeType === "string") {
      if (nodeType === "code") {
        return node as React.ReactElement<MDXCodeProps>;
      }

      // For other native elements, search children
      if (nodeProps.children) {
        const childrenArray = React.Children.toArray(nodeProps.children);
        for (const child of childrenArray) {
          const found = findCodeElement(child, depth + 1);
          if (found) {
            return found;
          }
        }
      }
    }

    return undefined;
  }

  // Find the code element inside pre (recursively, since it might be nested)
  const codeElement = findCodeElement(children);

  if (!codeElement) {
    // If we can't find the code element, we might already have rendered content
    // Try to extract language and code from props or children directly
    // This handles cases where the element structure is different
    const fallbackLanguage = props["data-language"] || "";
    const fallbackCode =
      typeof children === "string" ? children : (
        extractTextContent(children).trim()
      );

    // If we have language info in props, use it even without finding code element
    if (fallbackLanguage || fallbackCode) {
      const language = fallbackLanguage.toLowerCase();
      const codeText = fallbackCode;
      const filename =
        props["data-rehype-pretty-code-title"] ||
        props["data-filename"] ||
        props["title"];
      const hasCopy = props["data-copy"] !== undefined;
      const isShell = SHELL_LANGUAGES.has(language);
      const isConfigFile = CONFIG_LANGUAGES.has(language);

      // Use the same routing logic as below
      if (isConfigFile) {
        return (
          <div className="not-prose">
            <CodeSnippet
              code={codeText}
              language={language}
              filename={filename || undefined}
              copyButton={true}
            />
          </div>
        );
      }

      if (isShell && filename && !hasCopy) {
        return (
          <div className="not-prose">
            <CodeEditorWrapper
              code={codeText}
              language={language}
              filename={filename}
              variant="terminal"
              writing={true}
              duration={3}
              delay={0.3}
            />
          </div>
        );
      }

      if (isShell) {
        return (
          <div className="not-prose">
            <ShellSnippet code={codeText} language={language} />
          </div>
        );
      }

      if (filename && !hasCopy) {
        const isTerminalLang = SHELL_LANGUAGES.has(language);
        return (
          <div className="not-prose">
            <CodeEditorWrapper
              code={codeText}
              language={language || "typescript"}
              filename={filename}
              variant={isTerminalLang ? "terminal" : "ide"}
              writing={true}
              duration={isTerminalLang ? 3 : 5}
              delay={isTerminalLang ? 0.3 : 0.5}
            />
          </div>
        );
      }

      return (
        <div className="not-prose">
          <CodeSnippet
            code={codeText}
            language={language || "typescript"}
            filename={filename || undefined}
            copyButton={true}
          />
        </div>
      );
    }

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
  // rehype-pretty-code uses "title" in markdown which becomes data-rehype-pretty-code-title
  // We check for both title and filename for backwards compatibility
  const filename =
    props["data-rehype-pretty-code-title"] ||
    props["data-filename"] ||
    props["title"]; // Also check for title prop directly
  const hasCopy = props["data-copy"] !== undefined;
  const isShell = SHELL_LANGUAGES.has(language);
  const isConfigFile = CONFIG_LANGUAGES.has(language);

  // Routing logic:
  // 1. Config files (TOML, YAML, etc.) → Always use CodeSnippet (static, never animated)
  // 2. Shell languages with filename → Use CodeEditor (animated terminal)
  // 3. Shell languages without filename → Use Snippet (copyable, clearly marked as Terminal)
  // 4. filename attribute + no copy → Use CodeEditor (animated, non-editable)
  // 5. copy attribute → Use CodeSnippet (editable)
  // 6. Default → Use CodeSnippet (editable by default)

  // Config files should always use static CodeSnippet (never animated)
  if (isConfigFile) {
    return (
      <div className="not-prose">
        <CodeSnippet
          code={codeText}
          language={language}
          filename={filename || undefined}
          copyButton={true}
        />
      </div>
    );
  }

  // Shell commands with filename should be animated terminals
  if (isShell && filename && !hasCopy) {
    return (
      <div className="not-prose">
        <CodeEditorWrapper
          code={codeText}
          language={language}
          filename={filename}
          variant="terminal"
          writing={true}
          duration={3}
          delay={0.3}
        />
      </div>
    );
  }

  // Shell commands without filename should be copyable snippets with Terminal label
  if (isShell) {
    return (
      <div className="not-prose">
        <ShellSnippet code={codeText} language={language} />
      </div>
    );
  }

  // If filename is provided and no copy attribute, use animated CodeEditor
  if (filename && !hasCopy) {
    // Determine if this is a terminal based on language
    const isTerminalLang = SHELL_LANGUAGES.has(language);
    return (
      <div className="not-prose">
        <CodeEditorWrapper
          code={codeText}
          language={language || "typescript"}
          filename={filename}
          variant={isTerminalLang ? "terminal" : "ide"}
          writing={true}
          duration={isTerminalLang ? 3 : 5}
          delay={isTerminalLang ? 0.3 : 0.5}
        />
      </div>
    );
  }

  // Default to CodeSnippet for editable code blocks (with or without copy attribute)
  return (
    <div className="not-prose">
      <CodeSnippet
        code={codeText}
        language={language || "typescript"}
        filename={filename || undefined}
        copyButton={true}
      />
    </div>
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
  const isConfigFile = CONFIG_LANGUAGES.has(language);

  // Config files and shell commands use appropriate components
  if (isConfigFile || isShell) {
    if (isShell) {
      // Use Snippet for shell commands with Terminal label
      return (
        <div className="not-prose">
          <ShellSnippet code={codeText} language={language} />
        </div>
      );
    }

    // Config files use CodeSnippet
    const filename =
      props["data-rehype-pretty-code-title"] || props["data-filename"];

    return (
      <div className="not-prose">
        <CodeSnippet
          code={codeText}
          language={language}
          filename={filename}
          copyButton={true}
        />
      </div>
    );
  }

  // Default to CodeSnippet for editable code blocks
  return (
    <div className="not-prose">
      <CodeSnippet
        code={codeText}
        language={language || "typescript"}
        copyButton={true}
      />
    </div>
  );
}
