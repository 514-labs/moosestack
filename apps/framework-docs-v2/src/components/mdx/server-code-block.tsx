import React from "react";
import { cn } from "@/lib/utils";
import { CodeSnippet } from "./code-snippet";
import { CodeEditorWrapper } from "./code-editor-wrapper";
import { ShellSnippet } from "./shell-snippet";
import { extractTextContent } from "@/lib/extract-text-content";

// Shell languages that should use terminal styling
const SHELL_LANGUAGES = new Set([
  "bash",
  "sh",
  "shell",
  "zsh",
  "fish",
  "powershell",
  "cmd",
]);

// Config/data file languages that should always use static CodeSnippet
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

/**
 * Props interface for server-side code block
 * All data-* attributes from markdown are available here
 */
export interface ServerCodeBlockProps
  extends React.HTMLAttributes<HTMLPreElement> {
  // Standard rehype-pretty-code attributes
  "data-language"?: string;
  "data-theme"?: string;
  "data-rehype-pretty-code-fragment"?: string;
  "data-rehype-pretty-code-title"?: string;

  // Custom attributes from markdown meta
  "data-filename"?: string;
  "data-copy"?: string;
  "data-variant"?: string;
  "data-duration"?: string;
  "data-delay"?: string;
  "data-writing"?: string;
  "data-linenumbers"?: string;

  children?: React.ReactNode;
}

/**
 * Extracts the language from data attributes or className
 */
function getLanguage(props: ServerCodeBlockProps): string {
  const dataLang = props["data-language"];
  if (dataLang) {
    return dataLang.toLowerCase();
  }

  if (typeof props.className === "string") {
    const match = props.className.match(/language-(\w+)/);
    if (match?.[1]) {
      return match[1].toLowerCase();
    }
  }

  return "";
}

/**
 * Find the code element in children
 */
function findCodeElement(
  node: React.ReactNode,
  depth = 0,
): React.ReactElement | undefined {
  if (depth > 10) return undefined;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findCodeElement(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }

  if (!React.isValidElement(node)) return undefined;

  const nodeType = node.type;
  const nodeProps = (node.props as Record<string, unknown>) || {};

  if (nodeType === React.Fragment && nodeProps.children) {
    return findCodeElement(nodeProps.children as React.ReactNode, depth + 1);
  }

  if (typeof nodeType === "string" && nodeType === "code") {
    return node;
  }

  if (nodeProps.children) {
    return findCodeElement(nodeProps.children as React.ReactNode, depth + 1);
  }

  return undefined;
}

/**
 * Server-side code block component
 *
 * Extracts all code block attributes and routes to the appropriate
 * client-side component based on language and attributes.
 */
export function ServerCodeBlock({
  children,
  ...props
}: ServerCodeBlockProps): React.ReactElement {
  // Check if this is a code block processed by rehype-pretty-code
  const isCodeBlock = props["data-rehype-pretty-code-fragment"] !== undefined;

  if (!isCodeBlock) {
    // Not a code block, render as regular pre element
    const { className, ...restProps } = props;
    return (
      <pre className={cn("not-prose", className)} {...restProps}>
        {children}
      </pre>
    );
  }

  // Extract code content
  const codeElement = findCodeElement(children);
  const codeText =
    codeElement ?
      extractTextContent(
        (codeElement.props as Record<string, unknown>)
          .children as React.ReactNode,
      ).trim()
    : extractTextContent(children).trim();

  // Extract all attributes (supports multiple sources for backwards compat)
  const language = getLanguage(props);

  // Filename: check title (from rehype-pretty-code), filename, or direct title
  const filename =
    props["data-rehype-pretty-code-title"] ||
    props["data-filename"] ||
    ((props as Record<string, unknown>)["title"] as string | undefined);

  // Copy button: defaults to true unless explicitly set to "false"
  const showCopy = props["data-copy"] !== "false";

  // Variant: "terminal" or "ide"
  const variant = props["data-variant"] as "terminal" | "ide" | undefined;

  // Animation settings
  const duration =
    props["data-duration"] ? parseFloat(props["data-duration"]) : undefined;
  const delay =
    props["data-delay"] ? parseFloat(props["data-delay"]) : undefined;
  const writing = props["data-writing"] !== "false";

  // Line numbers: defaults to true unless explicitly set to "false"
  const lineNumbers = props["data-linenumbers"] !== "false";

  // Determine component type based on language and attributes
  const isShell = SHELL_LANGUAGES.has(language);
  const isConfigFile = CONFIG_LANGUAGES.has(language);

  // Routing logic:
  // 1. Config files → Always static CodeSnippet (never animated)
  // 2. Shell + filename + copy=false → Animated CodeEditorWrapper (terminal style)
  // 3. Shell (all other cases) → ShellSnippet (copyable Terminal tab UI)
  // 4. Non-shell + filename + no copy attr → Animated CodeEditorWrapper
  // 5. Default → Static CodeSnippet

  // Config files always use static CodeSnippet (never animated)
  if (isConfigFile) {
    return (
      <div className="not-prose">
        <CodeSnippet
          code={codeText}
          language={language}
          filename={filename}
          copyButton={showCopy}
          lineNumbers={lineNumbers}
        />
      </div>
    );
  }

  // Shell commands: Use animated terminal only when explicitly copy=false with filename
  // Otherwise, always use ShellSnippet (the Terminal tab UI with copy button)
  if (isShell) {
    // Only use animated terminal when explicitly no copy button wanted
    if (filename && props["data-copy"] === "false") {
      return (
        <div className="not-prose">
          <CodeEditorWrapper
            code={codeText}
            language={language}
            filename={filename}
            variant="terminal"
            writing={writing}
            duration={duration ?? 3}
            delay={delay ?? 0.3}
          />
        </div>
      );
    }

    // All other shell commands use ShellSnippet (Terminal tab with copy)
    return (
      <div className="not-prose">
        <ShellSnippet code={codeText} language={language} />
      </div>
    );
  }

  // Non-shell: animate if filename present and copy not explicitly set
  const shouldAnimate = filename && props["data-copy"] === undefined;

  if (shouldAnimate) {
    return (
      <div className="not-prose">
        <CodeEditorWrapper
          code={codeText}
          language={language || "typescript"}
          filename={filename}
          variant={variant ?? "ide"}
          writing={writing}
          duration={duration ?? 5}
          delay={delay ?? 0.5}
        />
      </div>
    );
  }

  // Default: static CodeSnippet
  return (
    <div className="not-prose">
      <CodeSnippet
        code={codeText}
        language={language || "typescript"}
        filename={filename}
        copyButton={showCopy}
        lineNumbers={lineNumbers}
      />
    </div>
  );
}

/**
 * Server-side inline code component
 */
export function ServerInlineCode({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>): React.ReactElement {
  const isCodeBlock =
    className?.includes("language-") ||
    (props as Record<string, unknown>)["data-language"];

  if (isCodeBlock) {
    // This is a code block that should be handled by ServerCodeBlock
    // This is a fallback for when code is not wrapped in pre
    const language = getLanguage(props as ServerCodeBlockProps);
    const codeText = extractTextContent(children).trim();

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

  // Inline code - simple styled element
  return (
    <code
      className={cn(
        "relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm text-foreground not-prose",
        className,
      )}
      {...props}
    >
      {children}
    </code>
  );
}
