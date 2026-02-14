"use client";

import { Suspense, ReactNode, useState, useEffect } from "react";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { STORAGE_KEY_PREFIX_PAGE, useStorageSync } from "./use-persisted-state";

const STORAGE_KEY_PREFIX = STORAGE_KEY_PREFIX_PAGE;

interface NumberedAccordionItemProps {
  /** Unique ID for this accordion item (used for visibility control) */
  id: string;
  /** Display number shown in the badge */
  number: number;
  /** Title displayed next to the number badge */
  title: string;
  /** Content shown when expanded */
  children: ReactNode;
}

interface NumberedAccordionProps {
  /** Accordion items */
  children: ReactNode;
  /** ID of the CheckboxGroup that controls visibility */
  controlledBy?: string;
  /** Directly specify which items are visible (alternative to controlledBy) */
  visibleItems?: string[];
  /** Allow multiple items to be open at once (default: true) */
  multiple?: boolean;
  /** Default expanded items */
  defaultExpanded?: string[];
  /** Additional CSS classes */
  className?: string;
}

/**
 * Accordion item with a numbered badge.
 * Use as a child of NumberedAccordion.
 */
function NumberedAccordionItemComponent({
  id,
  number,
  title,
  children,
}: NumberedAccordionItemProps) {
  return (
    <AccordionItem value={id} className="border rounded-lg px-4 mb-3">
      <AccordionTrigger className="hover:no-underline py-4">
        <div className="flex items-center gap-3">
          <Badge
            variant="secondary"
            className="h-6 w-6 rounded-full p-0 flex items-center justify-center text-xs font-semibold"
          >
            {number}
          </Badge>
          <span className="font-medium text-base">{title}</span>
        </div>
      </AccordionTrigger>
      <AccordionContent className="pt-2 pb-4">{children}</AccordionContent>
    </AccordionItem>
  );
}

function NumberedAccordionInner({
  children,
  controlledBy,
  visibleItems: directVisibleItems,
  multiple = true,
  defaultExpanded,
  className,
}: NumberedAccordionProps) {
  // Track visible items from controlled checkbox group
  const [controlledVisibleItems, setControlledVisibleItems] = useState<
    string[]
  >([]);

  // Read checkbox state from localStorage if controlledBy is specified
  useEffect(() => {
    if (!controlledBy || typeof window === "undefined") return;

    const storageKey = `${STORAGE_KEY_PREFIX}-${controlledBy}`;

    const readStoredValues = () => {
      try {
        const stored = localStorage.getItem(storageKey);
        if (stored !== null) {
          const values = JSON.parse(stored) as string[];
          setControlledVisibleItems(values);
        }
      } catch {
        // Ignore parsing errors
      }
    };

    // Initial read
    readStoredValues();
  }, [controlledBy]);

  // Sync with storage changes (cross-tab and same-page)
  useStorageSync<string[]>(
    controlledBy ? `${STORAGE_KEY_PREFIX}-${controlledBy}` : undefined,
    (value) => {
      if (value === null) {
        setControlledVisibleItems([]);
      } else if (Array.isArray(value)) {
        setControlledVisibleItems(value);
      }
    },
    [controlledBy],
  );

  // Determine visible items
  const visibleItems = directVisibleItems || controlledVisibleItems;
  const hasVisibilityControl = controlledBy || directVisibleItems;

  // Filter children based on visibility
  const filteredChildren =
    hasVisibilityControl ?
      filterAccordionChildren(children, visibleItems)
    : children;

  // Get default expanded value(s)
  const defaultValue = defaultExpanded || [];

  if (multiple) {
    return (
      <Accordion
        type="multiple"
        defaultValue={defaultValue}
        className={cn("my-4", className)}
      >
        {filteredChildren}
      </Accordion>
    );
  }

  return (
    <Accordion
      type="single"
      collapsible
      defaultValue={defaultValue[0]}
      className={cn("my-4", className)}
    >
      {filteredChildren}
    </Accordion>
  );
}

/**
 * Filter accordion children to only show visible items.
 * Handles both direct AccordionItem children and NumberedAccordion.Item children.
 */
function filterAccordionChildren(
  children: ReactNode,
  visibleItems: string[],
): ReactNode {
  if (!Array.isArray(children)) {
    // Single child case
    const child = children as React.ReactElement<{ id?: string }>;
    if (child?.props?.id && visibleItems.includes(child.props.id)) {
      return child;
    }
    // If no id prop or not visible, hide it
    if (child?.props?.id) {
      return null;
    }
    // If no id, show it (fallback for uncontrolled items)
    return children;
  }

  // Multiple children case
  return children.filter((child) => {
    if (!child || typeof child !== "object") return true;
    const element = child as React.ReactElement<{ id?: string }>;
    if (element?.props?.id) {
      return visibleItems.includes(element.props.id);
    }
    return true; // Show items without an id
  });
}

/**
 * NumberedAccordion - Expandable sections with numbered badges.
 *
 * Features:
 * - Numbered badges matching Figma design
 * - Can be controlled by a CheckboxGroup for show/hide
 * - Multiple or single expand mode
 * - Built on shadcn/ui Accordion
 *
 * @example
 * ```tsx
 * <NumberedAccordion controlledBy="steps">
 *   <NumberedAccordion.Item id="step1" number={1} title="Getting Started">
 *     Content for step 1...
 *   </NumberedAccordion.Item>
 *   <NumberedAccordion.Item id="step2" number={2} title="Configuration">
 *     Content for step 2...
 *   </NumberedAccordion.Item>
 * </NumberedAccordion>
 * ```
 */
function NumberedAccordionRoot(props: NumberedAccordionProps) {
  // Wrap in Suspense to handle hydration safely
  return (
    <Suspense
      fallback={
        <div className={cn("my-4 space-y-3", props.className)}>
          <div className="border rounded-lg px-4 py-4">
            <div className="flex items-center gap-3">
              <div className="h-6 w-6 rounded-full bg-muted" />
              <div className="h-4 w-32 bg-muted rounded" />
            </div>
          </div>
        </div>
      }
    >
      <NumberedAccordionInner {...props} />
    </Suspense>
  );
}

// Compose with sub-components using Object.assign pattern
export const NumberedAccordion = Object.assign(NumberedAccordionRoot, {
  Item: NumberedAccordionItemComponent,
});

// Export sub-component separately for MDX renderer registration
export { NumberedAccordionItemComponent as NumberedAccordionItem };

export type { NumberedAccordionProps, NumberedAccordionItemProps };
