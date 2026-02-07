"use client";

import React from "react";
import {
  Snippet,
  SnippetCopyButton,
  SnippetHeader,
  SnippetTabsContent,
  SnippetTabsList,
  SnippetTabsTrigger,
} from "@/components/ui/snippet";

interface ShellSnippetProps {
  code: string;
  language: string;
}

/**
 * Client component for shell/terminal code snippets
 * Displays with "Terminal" label and copy button with syntax highlighting
 */
export function ShellSnippet({ code, language }: ShellSnippetProps) {
  const [value, setValue] = React.useState("terminal");
  const [highlightedCode, setHighlightedCode] = React.useState<string>("");

  React.useEffect(() => {
    const loadHighlightedCode = async () => {
      try {
        const { codeToHtml } = await import("shiki");
        let html = await codeToHtml(code, {
          lang: language,
          themes: {
            light: "vitesse-light",
            dark: "vitesse-dark",
          },
        });

        // Remove background-color from the pre tag to let our theme control it
        html = html.replace(
          /style="[^"]*background-color:[^;"]*;?[^"]*"/g,
          (match) => {
            return match.replace(/background-color:[^;"]*;?/g, "");
          },
        );

        setHighlightedCode(html);
      } catch {
        // Fallback to plain text
        setHighlightedCode(
          `<pre class="shiki"><code>${code.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code></pre>`,
        );
      }
    };

    loadHighlightedCode();
  }, [code, language]);

  if (!highlightedCode) {
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

  return (
    <Snippet value={value} onValueChange={setValue}>
      <SnippetHeader>
        <SnippetTabsList>
          <SnippetTabsTrigger value="terminal">Terminal</SnippetTabsTrigger>
        </SnippetTabsList>
        <SnippetCopyButton value={code} />
      </SnippetHeader>
      <div className="mt-0 bg-muted/50 overflow-x-auto">
        <div
          className="[&_pre]:m-0 [&_pre]:p-4 [&_pre]:bg-transparent [&_code]:text-sm"
          dangerouslySetInnerHTML={{ __html: highlightedCode }}
        />
      </div>
    </Snippet>
  );
}
