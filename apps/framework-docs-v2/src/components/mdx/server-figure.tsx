import React from "react";

interface MDXFigureProps extends React.HTMLAttributes<HTMLElement> {
  "data-rehype-pretty-code-figure"?: string;
  children?: React.ReactNode;
}

type ElementWithProps = React.ReactElement<Record<string, unknown>>;

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
 * Find elements in children array by type or condition
 */
function findElements(
  childrenArray: ReturnType<typeof React.Children.toArray>,
): {
  figcaption: ElementWithProps | null;
  preElement: ElementWithProps | null;
} {
  let figcaption: ElementWithProps | null = null;
  let preElement: ElementWithProps | null = null;

  for (const child of childrenArray) {
    if (React.isValidElement(child)) {
      const childType = child.type;
      const childProps = (child.props as Record<string, unknown>) || {};

      if (typeof childType === "string") {
        if (childType === "figcaption") {
          figcaption = child as ElementWithProps;
        } else if (childType === "pre") {
          preElement = child as ElementWithProps;
        }
      } else {
        const hasCodeBlockAttrs =
          childProps["data-rehype-pretty-code-fragment"] !== undefined ||
          childProps["data-language"] !== undefined ||
          childProps["data-theme"] !== undefined;

        if (hasCodeBlockAttrs || !preElement) {
          preElement = child as ElementWithProps;
        }
      }
    }
  }

  return { figcaption, preElement };
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
  const { figcaption, preElement } = findElements(childrenArray);

  // Extract filename from figcaption (title from markdown)
  let figcaptionTitle: string | undefined;
  if (figcaption) {
    figcaptionTitle = extractTextFromNode(
      figcaption.props.children as React.ReactNode,
    ).trim();
  }

  const preProps = preElement?.props || {};

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
