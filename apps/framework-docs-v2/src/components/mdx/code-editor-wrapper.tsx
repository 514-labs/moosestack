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
  code: string;
  language: string;
  filename?: string;
  variant?: "ide" | "terminal";
  writing?: boolean;
  duration?: number;
  delay?: number;
  className?: string;
}

export function CodeEditorWrapper({
  code,
  language,
  filename,
  variant = "ide",
  writing = true,
  duration = 5,
  delay = 0.5,
  className,
}: CodeEditorWrapperProps) {
  // Determine if this should look like a terminal or IDE
  const isTerminal = variant === "terminal" || SHELL_LANGUAGES.has(language);

  // Determine icon based on variant and filename
  const icon =
    isTerminal ?
      <Terminal className="h-3.5 w-3.5" />
    : <FileCode className="h-3.5 w-3.5" />;

  // Determine title
  const title = filename || (isTerminal ? "Terminal" : "Code");

  // Terminal-specific defaults: faster animation, shorter delay
  const terminalDuration = isTerminal ? 3 : duration;
  const terminalDelay = isTerminal ? 0.3 : delay;
  const terminalWriting = isTerminal ? writing : writing;

  return (
    <div className={cn("my-4", className)}>
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
        {code}
      </CodeEditor>
    </div>
  );
}
