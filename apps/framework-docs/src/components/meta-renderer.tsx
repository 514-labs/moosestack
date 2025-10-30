import { SmallText } from "@/components/typography";
import React from "react";
import { Button } from "@/components/ui/button";
import { ArrowUpRight } from "lucide-react";

/**
 * Meta item definition for sidebar navigation
 */
interface MetaItem {
  type?: string;
  title?: string | React.ReactNode;
  theme?: Record<string, any>;
  display?: string;
  href?: string;
  Icon?: React.ElementType;
  newWindow?: boolean;
  isMoose?: boolean;
}

/**
 * Reusable JSX elements for consistent rendering
 */
const UI = {
  // Standard text with hover effect
  HoverText: ({ children }: { children: React.ReactNode }) => (
    <SmallText className="my-0 text-muted-foreground hover:text-primary transition-colors">
      {children}
    </SmallText>
  ),

  // Standard small text for navigation items
  NavText: ({ children }: { children: React.ReactNode }) => (
    <SmallText className="text-inherit transition-colors">{children}</SmallText>
  ),

  // Icon with text layout
  IconWithText: ({
    icon,
    text,
    isMoose = false,
    showExternalIcon = false,
  }: {
    icon?: React.ReactElement;
    text: React.ReactNode;
    isMoose?: boolean;
    showExternalIcon?: boolean;
  }) => (
    <div className="flex items-center gap-2 text-primary my-0">
      {icon}
      <SmallText className="text-inherit my-0 inline-flex items-center gap-1">
        {isMoose ?
          <span className="text-muted-foreground">Moose </span>
        : ""}
        {text}
        {showExternalIcon ?
          <ArrowUpRight className="w-3 h-3 text-muted-foreground" />
        : null}
      </SmallText>
    </div>
  ),

  Separator: ({
    children,
    showLine = false,
  }: {
    children: React.ReactNode;
    showLine: boolean;
  }) => (
    <div className={`${showLine ? "border-t border-border" : ""} my-0`}>
      <p className="text-muted-foreground text-sm font-normal mb-0 mt-2">
        {children}
      </p>
    </div>
  ),
};

/**
 * Renders a string item as a paragraph with styles
 */
const renderStringItem = (item: string): MetaItem => {
  return {
    title: <UI.HoverText>{item}</UI.HoverText>,
  };
};

/**
 * Renders a page type item
 */
const renderPageItem = (item: MetaItem): MetaItem => {
  return {
    ...item,
    title: <UI.NavText>{item.title}</UI.NavText>,
  };
};

/**
 * Renders an object item with icon
 */
const renderObjectWithIcon = (item: MetaItem): MetaItem => {
  const isExternal = Boolean(
    item.newWindow ||
      (typeof item.href === "string" && /^https?:\/\//.test(item.href)),
  );

  return {
    ...item,
    title: (
      <UI.IconWithText
        icon={item.Icon ? <item.Icon className="w-4 h-4" /> : undefined}
        text={item.title}
        isMoose={item.isMoose}
        showExternalIcon={isExternal}
      />
    ),
  };
};

/**
 * Renders a standard object item
 */
const renderStandardObject = (item: MetaItem): MetaItem => {
  // If title is already a React element, return as is
  if (React.isValidElement(item.title)) {
    return item;
  }

  // Otherwise, wrap the title in our component
  return {
    ...item,
    title: <UI.HoverText>{item.title}</UI.HoverText>,
  };
};

/**
 * Renders an index item with theme
 */
const renderIndexWithTheme = (item: MetaItem): MetaItem => {
  if (item.Icon) {
    return {
      ...item,
      title: (
        <UI.IconWithText
          text={item.title}
          icon={<item.Icon className="w-4 h-4" />}
        />
      ),
    };
  }

  return { ...item, title: <UI.HoverText>{item.title}</UI.HoverText> };
};

/**
 * Renders an item with display or theme properties
 */
const renderDisplayOrTheme = (item: MetaItem): MetaItem => {
  const processedItem = { ...item };

  if (typeof item.title === "string") {
    processedItem.title = <UI.HoverText>{item.title}</UI.HoverText>;
  }

  return processedItem;
};

const renderSeparatorItem = (
  item: MetaItem,
  separatorLine: boolean = false,
): MetaItem => {
  return {
    ...item,
    title: <UI.Separator showLine={separatorLine}>{item.title}</UI.Separator>,
  };
};

/**
 * Determines the type of item and delegates to the appropriate renderer
 */
const renderItem = (
  item: string | MetaItem,
  key?: string,
  separatorLine: boolean = false,
): MetaItem => {
  // Handle string item
  if (typeof item === "string") {
    return renderStringItem(item);
  }

  // Handle page type
  if (item.type === "page") {
    return renderPageItem(item);
  }

  if (item.type === "separator") {
    return renderSeparatorItem(item, separatorLine);
  }

  // Handle object with non-React element title
  if (typeof item === "object" && !React.isValidElement(item.title)) {
    return renderObjectWithIcon(item);
  }

  // Handle object with title
  if (item.title) {
    return renderStandardObject(item);
  }

  // Default case
  return item;
};

/**
 * Process the meta object structure using specialized renderers
 */
export const render = (
  items: Record<string, any>,
  separatorLine: boolean = false,
): Record<string, any> => {
  const result: Record<string, any> = {};

  for (const key in items) {
    const item = items[key];

    // Skip undefined or null items
    if (!item) continue;

    // Determine the type of item and render appropriately
    if (typeof item === "object" && !React.isValidElement(item)) {
      // Special case: index item with theme
      if (key === "index" && item.theme) {
        result[key] = renderIndexWithTheme(item);
      }
      // Items with display or theme properties
      else if (item.display || item.theme) {
        result[key] = renderDisplayOrTheme(item);
      }
      // Standard object items
      else {
        result[key] = renderItem(item, key, separatorLine);
      }
    }
    // String or React element items
    else {
      result[key] = renderItem(item, key, separatorLine);
    }
  }

  return result;
};
