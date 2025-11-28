"use client";

import * as React from "react";
import { IconCopy, IconCheck } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CodeBlock,
  CodeBlockBody,
  CodeBlockItem,
  CodeBlockContent,
} from "@/components/ui/shadcn-io/code-block";

/**
 * Parsed substring highlight with optional occurrence filter
 */
interface SubstringHighlight {
  pattern: string;
  occurrences?: number[];
}

interface CodeSnippetProps {
  code: string;
  language?: string;
  filename?: string;
  copyButton?: boolean;
  lineNumbers?: boolean;
  highlightLines?: number[];
  highlightStrings?: SubstringHighlight[];
  isAnsi?: boolean;
  className?: string;
}

function CopyButton({
  content,
  onCopy,
}: {
  content: string;
  onCopy?: (content: string) => void;
}) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    if (typeof window === "undefined" || !navigator.clipboard.writeText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      onCopy?.(content);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  };

  return (
    <Button
      className="absolute right-2 top-2 h-7 w-7 z-10"
      onClick={handleCopy}
      size="icon"
      variant="ghost"
    >
      {copied ?
        <IconCheck className="h-3 w-3" />
      : <IconCopy className="h-3 w-3" />}
      <span className="sr-only">Copy code</span>
    </Button>
  );
}

/**
 * Parse ANSI escape codes and convert to styled HTML
 */
function parseAnsi(text: string): string {
  const colors: Record<number, string> = {
    30: "color: #000",
    31: "color: #c00",
    32: "color: #0a0",
    33: "color: #a50",
    34: "color: #00a",
    35: "color: #a0a",
    36: "color: #0aa",
    37: "color: #aaa",
    90: "color: #555",
    91: "color: #f55",
    92: "color: #5f5",
    93: "color: #ff5",
    94: "color: #55f",
    95: "color: #f5f",
    96: "color: #5ff",
    97: "color: #fff",
  };

  const bgColors: Record<number, string> = {
    40: "background-color: #000",
    41: "background-color: #c00",
    42: "background-color: #0a0",
    43: "background-color: #a50",
    44: "background-color: #00a",
    45: "background-color: #a0a",
    46: "background-color: #0aa",
    47: "background-color: #aaa",
    100: "background-color: #555",
    101: "background-color: #f55",
    102: "background-color: #5f5",
    103: "background-color: #ff5",
    104: "background-color: #55f",
    105: "background-color: #f5f",
    106: "background-color: #5ff",
    107: "background-color: #fff",
  };

  // biome-ignore lint/complexity/useRegexLiterals: Using constructor to avoid control character lint error
  const ansiPattern = new RegExp("\\x1b\\[([0-9;]*)m", "g");
  let result = "";
  let lastIndex = 0;
  let currentStyles: string[] = [];

  let match = ansiPattern.exec(text);
  while (match !== null) {
    const textBefore = text.slice(lastIndex, match.index);
    if (textBefore) {
      const escapedText = textBefore
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

      if (currentStyles.length > 0) {
        result += `<span style="${currentStyles.join("; ")}">${escapedText}</span>`;
      } else {
        result += escapedText;
      }
    }

    const codes = match[1] ? match[1].split(";").map(Number) : [0];

    for (const code of codes) {
      if (code === 0) {
        currentStyles = [];
      } else if (code === 1) {
        currentStyles.push("font-weight: bold");
      } else if (code === 2) {
        currentStyles.push("opacity: 0.75");
      } else if (code === 3) {
        currentStyles.push("font-style: italic");
      } else if (code === 4) {
        currentStyles.push("text-decoration: underline");
      } else if (code === 9) {
        currentStyles.push("text-decoration: line-through");
      } else if (colors[code]) {
        currentStyles.push(colors[code]);
      } else if (bgColors[code]) {
        currentStyles.push(bgColors[code]);
      }
    }

    lastIndex = ansiPattern.lastIndex;
    match = ansiPattern.exec(text);
  }

  const remainingText = text.slice(lastIndex);
  if (remainingText) {
    const escapedText = remainingText
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    if (currentStyles.length > 0) {
      result += `<span style="${currentStyles.join("; ")}">${escapedText}</span>`;
    } else {
      result += escapedText;
    }
  }

  return result;
}

/**
 * Custom CodeBlockContent that supports line and substring highlighting
 */
function HighlightedCodeBlockContent({
  code,
  language,
  highlightLines,
  highlightStrings,
}: {
  code: string;
  language: string;
  highlightLines: number[];
  highlightStrings: SubstringHighlight[];
}) {
  const [highlightedCode, setHighlightedCode] = React.useState<string>("");
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    const loadHighlightedCode = async () => {
      try {
        const { codeToHtml } = await import("shiki");

        const languageMap: Record<string, string> = {
          gitignore: "text",
          env: "text",
          dotenv: "text",
        };
        const mappedLanguage = languageMap[language.toLowerCase()] || language;

        const html = await codeToHtml(code, {
          lang: mappedLanguage,
          themes: {
            light: "vitesse-light",
            dark: "vitesse-dark",
          },
          transformers: [
            {
              line(node, line) {
                // Add highlighted class to specified lines
                if (highlightLines.includes(line)) {
                  this.addClassToHast(node, "highlighted");
                }
              },
            },
          ],
        });

        // Apply substring highlighting if needed
        let finalHtml = html;
        if (highlightStrings.length > 0) {
          finalHtml = applySubstringHighlighting(html, highlightStrings);
        }

        setHighlightedCode(finalHtml);
        setIsLoading(false);
      } catch {
        // Fallback
        try {
          const { codeToHtml } = await import("shiki");
          const html = await codeToHtml(code, {
            lang: "text",
            themes: {
              light: "vitesse-light",
              dark: "vitesse-dark",
            },
          });
          setHighlightedCode(html);
        } catch {
          const lines = code.split("\n");
          const html = `<pre class="shiki"><code>${lines.map((line) => `<span class="line">${line.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</span>`).join("\n")}</code></pre>`;
          setHighlightedCode(html);
        }
        setIsLoading(false);
      }
    };

    loadHighlightedCode();
  }, [code, language, highlightLines, highlightStrings]);

  if (isLoading) {
    return (
      <pre className="overflow-x-auto">
        <code className="whitespace-pre">
          {code.split("\n").map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: Static code lines have no unique ID
            <span className="line" key={i}>
              {line}
            </span>
          ))}
        </code>
      </pre>
    );
  }

  return (
    <div
      className="min-w-0 w-full"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML is generated by shiki syntax highlighter
      dangerouslySetInnerHTML={{ __html: highlightedCode }}
    />
  );
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applySubstringHighlighting(
  html: string,
  highlightStrings: SubstringHighlight[],
): string {
  let result = html;

  for (const { pattern, occurrences } of highlightStrings) {
    const escapedPattern = escapeRegExp(pattern);
    let occurrenceCount = 0;

    // Replace pattern occurrences, respecting occurrence filter
    result = result.replace(
      new RegExp(`(?<=>)([^<]*?)${escapedPattern}`, "g"),
      (match, prefix) => {
        occurrenceCount++;
        const shouldHighlight =
          !occurrences || occurrences.includes(occurrenceCount);

        if (shouldHighlight) {
          return `>${prefix}<span class="highlighted-word">${pattern}</span>`;
        }
        return match;
      },
    );
  }

  return result;
}

export function CodeSnippet({
  code,
  language = "typescript",
  filename,
  copyButton = true,
  lineNumbers = true,
  highlightLines = [],
  highlightStrings = [],
  isAnsi = false,
  className,
}: CodeSnippetProps) {
  // For ANSI blocks, render with ANSI parsing
  if (isAnsi) {
    const lines = code.split("\n");
    return (
      <div
        className={cn(
          "relative my-4 rounded-lg border bg-muted/50 overflow-hidden w-full max-w-full",
          className,
        )}
      >
        {copyButton && <CopyButton content={code} />}
        {filename && (
          <div className="border-b border-border/75 bg-muted/50 px-4 py-2 text-sm text-muted-foreground">
            {filename}
          </div>
        )}
        <div className="bg-muted/30 rounded-b-lg overflow-x-auto min-w-0 max-w-full">
          <pre className="py-4 px-4 overflow-x-auto">
            <code className="text-sm font-mono">
              {lines.map((line, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: Static code lines have no unique ID
                <span className="line block" key={i}>
                  <span
                    // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML is generated by internal ANSI parser
                    dangerouslySetInnerHTML={{ __html: parseAnsi(line) }}
                  />
                </span>
              ))}
            </code>
          </pre>
        </div>
      </div>
    );
  }

  // Check if we need custom highlighting
  const needsCustomHighlighting =
    highlightLines.length > 0 || highlightStrings.length > 0;

  return (
    <div
      className={cn(
        "relative my-4 rounded-lg border bg-muted/50 overflow-hidden w-full max-w-full",
        className,
      )}
    >
      {copyButton && <CopyButton content={code} />}
      {filename && (
        <div className="border-b border-border/75 bg-muted/50 px-4 py-2 text-sm text-muted-foreground">
          {filename}
        </div>
      )}
      <div className="bg-muted/30 rounded-b-lg overflow-x-auto min-w-0 max-w-full">
        <CodeBlock
          data={[
            {
              language,
              filename: filename || "",
              code,
            },
          ]}
          defaultValue={language}
          className="bg-transparent border-0"
        >
          <CodeBlockBody>
            {(item) => (
              <CodeBlockItem
                key={item.language}
                value={item.language}
                lineNumbers={lineNumbers}
              >
                {needsCustomHighlighting ?
                  <HighlightedCodeBlockContent
                    code={item.code}
                    language={item.language}
                    highlightLines={highlightLines}
                    highlightStrings={highlightStrings}
                  />
                : <CodeBlockContent
                    language={item.language as any}
                    themes={{
                      light: "vitesse-light",
                      dark: "vitesse-dark",
                    }}
                    syntaxHighlighting={true}
                  >
                    {item.code}
                  </CodeBlockContent>
                }
              </CodeBlockItem>
            )}
          </CodeBlockBody>
        </CodeBlock>
      </div>
    </div>
  );
}
