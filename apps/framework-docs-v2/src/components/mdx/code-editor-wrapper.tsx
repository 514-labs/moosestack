"use client";

import React from "react";
import { CodeEditor } from "@/components/ui/shadcn-io/code-editor";
import { Terminal, FileCode } from "lucide-react";
import { cn } from "@/lib/utils";

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

interface CodeEditorWrapperProps {
  code?: string;
  children?: React.ReactNode;
  language: string;
  filename?: string;
  variant?: "ide" | "terminal";
  writing?: boolean;
  duration?: number;
  delay?: number;
  className?: string;
}

function extractCodeFromChildren(children: React.ReactNode): string {
  if (children == null) {
    return "";
  }
  if (typeof children === "string") {
    return children;
  }
  if (typeof children === "number" || typeof children === "boolean") {
    return String(children);
  }

  // Use React.Children utilities to handle all cases
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

      // Handle React fragments
      if (child.type === React.Fragment) {
        parts.push(extractCodeFromChildren(props.children));
        return;
      }
      // Handle rehype-pretty-code's span.line structure
      if (child.type === "span" && props.className?.includes("line")) {
        parts.push(extractCodeFromChildren(props.children) + "\n");
        return;
      }
      // Check if it's dangerouslySetInnerHTML (from rehype-pretty-code)
      if (props.dangerouslySetInnerHTML?.__html) {
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
      // For other elements, extract their children
      parts.push(extractCodeFromChildren(props.children));
      return;
    }
    // Fallback for anything else
    parts.push(String(child));
  });

  return parts.join("");
}

export function CodeEditorWrapper({
  code,
  children,
  language,
  filename,
  variant = "ide",
  writing = true,
  duration = 5,
  delay = 0.5,
  className,
}: CodeEditorWrapperProps) {
  // Use children if provided, otherwise use code prop
  // Extract code from children using React.Children utilities
  const codeContent = children ? extractCodeFromChildren(children) : code || "";

  // Determine if this should look like a terminal or IDE
  const isTerminal = variant === "terminal" || SHELL_LANGUAGES.has(language);

  // Determine icon based on variant and filename
  const icon =
    isTerminal ?
      <Terminal className="h-3.5 w-3.5 shrink-0" />
    : <FileCode className="h-3.5 w-3.5 shrink-0" />;

  // Determine title
  const title = filename || (isTerminal ? "Terminal" : "Code");

  // Terminal-specific defaults: faster animation, shorter delay
  const terminalDuration = isTerminal ? 3 : duration;
  const terminalDelay = isTerminal ? 0.3 : delay;
  const terminalWriting = isTerminal ? writing : writing;

  return (
    <div className={cn("not-prose", className)}>
      <CodeEditor
        lang={language}
        title={title}
        icon={icon}
        dots={isTerminal}
        header={true}
        copyButton={false}
        writing={terminalWriting}
        duration={terminalDuration}
        delay={terminalDelay}
        inView={true}
        inViewMargin="-100px"
        inViewOnce={true}
        cursor={terminalWriting}
        themes={{
          light: "vitesse-light",
          dark: "vitesse-dark",
        }}
        className="w-full"
      >
        {codeContent}
      </CodeEditor>
    </div>
  );
}
