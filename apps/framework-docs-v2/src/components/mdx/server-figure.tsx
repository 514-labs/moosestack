import React from "react";

interface MDXFigureProps extends React.HTMLAttributes<HTMLElement> {
  "data-rehype-pretty-code-figure"?: string;
  children?: React.ReactNode;
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
    const props = node.props as Record<string, unknown>;
    return extractTextFromNode(props.children as React.ReactNode);
  }
  return "";
}

/**
 * Server-side component that handles figure wrapper from rehype-pretty-code
 * Extracts the title from figcaption and passes it to the pre element
 */
export function ServerFigure({
  children,
  ...props
}: MDXFigureProps): React.ReactElement {
  // Only handle code block figures
  // data-rehype-pretty-code-figure is present (even if empty string) for code blocks
  if (props["data-rehype-pretty-code-figure"] === undefined) {
    return <figure {...props}>{children}</figure>;
  }

  // For code blocks, extract figcaption title and pass to pre
  const childrenArray = React.Children.toArray(children);

  // Find figcaption and pre elements
  let figcaption: React.ReactElement | null = null;
  let preElement: React.ReactElement | null = null;

  childrenArray.forEach((child) => {
    if (React.isValidElement(child)) {
      const childType = child.type;
      const childProps = (child.props as Record<string, unknown>) || {};

      // Check if it's a native HTML element by checking if type is a string
      if (typeof childType === "string") {
        if (childType === "figcaption") {
          figcaption = child;
        } else if (childType === "pre") {
          preElement = child;
        }
      } else {
        // For React components (like ServerCodeBlock)
        // Check if it has code block attributes
        const hasCodeBlockAttrs =
          childProps["data-rehype-pretty-code-fragment"] !== undefined ||
          childProps["data-language"] !== undefined ||
          childProps["data-theme"] !== undefined;

        // If it has code block attributes, it's the pre element
        if (hasCodeBlockAttrs || !preElement) {
          preElement = child;
        }
      }
    }
  });

  // Extract filename from figcaption (title from markdown)
  const figcaptionTitle =
    figcaption ?
      extractTextFromNode(
        (figcaption.props as Record<string, unknown>)
          .children as React.ReactNode,
      ).trim()
    : undefined;

  const preProps =
    preElement ? (preElement.props as Record<string, unknown>) || {} : {};

  // Prioritize figcaption title (from markdown title="...") over any existing attributes
  const filename =
    figcaptionTitle ||
    (preProps["data-rehype-pretty-code-title"] as string | undefined) ||
    (preProps["data-filename"] as string | undefined);

  // If we have a pre element, ensure the filename is set on both attributes
  if (preElement) {
    const hasCodeBlockAttrs =
      preProps["data-language"] !== undefined ||
      preProps["data-theme"] !== undefined;
    const fragmentValue =
      preProps["data-rehype-pretty-code-fragment"] !== undefined ?
        preProps["data-rehype-pretty-code-fragment"]
      : hasCodeBlockAttrs ? ""
      : undefined;

    const updatedPre = React.cloneElement(preElement, {
      ...preProps,
      "data-filename": filename || undefined,
      "data-rehype-pretty-code-title": filename || undefined,
      ...(fragmentValue !== undefined ?
        { "data-rehype-pretty-code-fragment": fragmentValue }
      : {}),
    });
    return <>{updatedPre}</>;
  }

  // Fallback: render children
  return <>{children}</>;
}
