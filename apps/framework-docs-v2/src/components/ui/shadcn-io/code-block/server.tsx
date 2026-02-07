import {
  transformerNotationDiff,
  transformerNotationErrorLevel,
  transformerNotationFocus,
  transformerNotationHighlight,
  transformerNotationWordHighlight,
} from "@shikijs/transformers";
import type { HTMLAttributes } from "react";
import {
  type BundledLanguage,
  type CodeOptionsMultipleThemes,
  codeToHtml,
} from "shiki";

export type CodeBlockContentProps = HTMLAttributes<HTMLDivElement> & {
  themes?: CodeOptionsMultipleThemes["themes"];
  language?: BundledLanguage;
  children: string;
  syntaxHighlighting?: boolean;
};

export const CodeBlockContent = async ({
  children,
  themes,
  language,
  syntaxHighlighting = true,
  ...props
}: CodeBlockContentProps) => {
  // Map unsupported languages to supported ones
  const languageMap: Record<string, string> = {
    gitignore: "text",
    env: "text",
    dotenv: "text",
  };
  const mappedLanguage =
    language ? languageMap[language.toLowerCase()] || language : "typescript";

  const html =
    syntaxHighlighting ?
      await codeToHtml(children as string, {
        lang: mappedLanguage,
        themes: themes ?? {
          light: "vitesse-light",
          dark: "vitesse-dark",
        },
        transformers: [
          transformerNotationDiff({
            matchAlgorithm: "v3",
          }),
          transformerNotationHighlight({
            matchAlgorithm: "v3",
          }),
          transformerNotationWordHighlight({
            matchAlgorithm: "v3",
          }),
          transformerNotationFocus({
            matchAlgorithm: "v3",
          }),
          transformerNotationErrorLevel({
            matchAlgorithm: "v3",
          }),
        ],
      }).catch(() => {
        // Fallback to text if language is not supported
        return codeToHtml(children as string, {
          lang: "text",
          themes: themes ?? {
            light: "vitesse-light",
            dark: "vitesse-dark",
          },
          transformers: [
            transformerNotationDiff({
              matchAlgorithm: "v3",
            }),
            transformerNotationHighlight({
              matchAlgorithm: "v3",
            }),
            transformerNotationWordHighlight({
              matchAlgorithm: "v3",
            }),
            transformerNotationFocus({
              matchAlgorithm: "v3",
            }),
            transformerNotationErrorLevel({
              matchAlgorithm: "v3",
            }),
          ],
        });
      })
    : children;

  return (
    <div
      // biome-ignore lint/security/noDangerouslySetInnerHtml: "Kinda how Shiki works"
      dangerouslySetInnerHTML={{ __html: html }}
      {...props}
    />
  );
};
