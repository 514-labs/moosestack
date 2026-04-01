import type { JSX } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { CodeBlock } from "./code-block";

interface TextFormatterProps {
  text: string;
}

export function TextFormatter({ text }: TextFormatterProps): JSX.Element {
  return (
    <div className="w-full max-w-[400px]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="text-xl font-semibold mt-4 mb-2">{children}</h1>,
          h2: ({ children }) => <h2 className="text-lg font-semibold mt-3 mb-2">{children}</h2>,
          h3: ({ children }) => <h3 className="text-base font-semibold mt-2 mb-1">{children}</h3>,
          p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
          ul: ({ children }) => (
            <ul className="list-disc list-inside mb-2 space-y-1 ml-2">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal list-inside mb-2 space-y-1 ml-2">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          code: ({ className, children, node, ...props }) => {
            const rawChildren = String(children);
            const match = /language-(\w+)/.exec(className || "");
            const hasMultipleLines = node?.position
              ? node.position.start.line !== node.position.end.line
              : rawChildren.includes("\n");
            const isInline = !match && !hasMultipleLines && !rawChildren.endsWith("\n");

            if (isInline) {
              return (
                <code
                  className={cn(
                    "px-1.5 py-0.5 text-xs font-mono bg-muted rounded",
                    "text-foreground",
                  )}
                  {...props}
                >
                  {children}
                </code>
              );
            }

            return (
              <CodeBlock language={match ? match[1] : undefined}>
                {rawChildren.replace(/\n$/, "")}
              </CodeBlock>
            );
          },
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-muted-foreground/30 pl-4 my-2 italic text-muted-foreground">
              {children}
            </blockquote>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              {children}
            </a>
          ),
          hr: () => <hr className="my-4 border-border" />,
          table: ({ children }) => (
            <div className="overflow-x-auto my-2">
              <table className="min-w-full border-collapse border border-border">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-muted">{children}</thead>,
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => <tr className="border-b border-border">{children}</tr>,
          th: ({ children }) => (
            <th className="border border-border px-3 py-2 text-left font-semibold text-sm">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-border px-3 py-2 text-sm">{children}</td>
          ),
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
