"use client";

import * as React from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { X, MoreHorizontal, Maximize2, Download, Share2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface ChartMenuItem {
  type: "item" | "separator" | "group" | "checkbox";
  label?: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  children?: ChartMenuItem[];
}

export interface ChartDisplayOptions {
  showLabels?: boolean;
  showLegend?: boolean;
  showGrid?: boolean;
  showTooltip?: boolean;
  [key: string]: boolean | undefined;
}

type ChartRenderProps = {
  isExpanded: boolean;
};

interface ExpandableChartContainerProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  children: React.ReactNode | ((props: ChartRenderProps) => React.ReactNode);
  className?: string;
  menuItems?: ChartMenuItem[];
  triggerSize?: "sm" | "md" | "lg";
}

export function ExpandableChartContainer({
  title,
  description,
  icon,
  children,
  className,
  menuItems,
  triggerSize = "md",
}: ExpandableChartContainerProps): React.JSX.Element {
  const [isExpanded, setIsExpanded] = React.useState(false);

  const openFullscreen = React.useCallback(() => {
    setIsExpanded(true);
  }, []);

  const closeFullscreen = React.useCallback(() => {
    setIsExpanded(false);
  }, []);

  // Handle ESC key to close fullscreen
  React.useEffect(() => {
    if (!isExpanded) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeFullscreen();
      }
    };

    document.addEventListener("keydown", handleEscape);
    // Prevent body scroll when fullscreen is open
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [isExpanded, closeFullscreen]);

  const triggerSizeClass = {
    sm: "size-7 sm:size-8",
    md: "size-8",
    lg: "size-9",
  }[triggerSize];

  const renderContent = (expanded: boolean): React.ReactNode => {
    return typeof children === "function" ?
        children({ isExpanded: expanded })
      : children;
  };

  const renderMenuItems = (items: ChartMenuItem[]) => {
    return items.map((item, index) => {
      if (item.type === "separator") {
        return <DropdownMenuSeparator key={`separator-${index}`} />;
      }

      if (item.type === "group") {
        return (
          <DropdownMenuGroup key={`group-${index}`}>
            {item.label && <DropdownMenuLabel>{item.label}</DropdownMenuLabel>}
            {item.children && renderMenuItems(item.children)}
          </DropdownMenuGroup>
        );
      }

      if (item.type === "checkbox") {
        return (
          <DropdownMenuCheckboxItem
            key={`checkbox-${index}`}
            checked={item.checked}
            onCheckedChange={item.onCheckedChange}
          >
            {item.icon && <span className="mr-2">{item.icon}</span>}
            {item.label}
          </DropdownMenuCheckboxItem>
        );
      }

      return (
        <DropdownMenuItem key={`item-${index}`} onClick={item.onClick}>
          {item.icon && <span className="mr-2">{item.icon}</span>}
          {item.label}
        </DropdownMenuItem>
      );
    });
  };

  return (
    <>
      <div className={className}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 sm:gap-2.5">
            {icon && (
              <Button
                variant="outline"
                size="icon"
                className="size-7 sm:size-8"
              >
                {icon}
              </Button>
            )}
            <div>
              <h3 className="text-sm sm:text-base font-semibold">{title}</h3>
              {description && (
                <p className="text-xs sm:text-sm text-muted-foreground">
                  {description}
                </p>
              )}
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                buttonVariants({ variant: "ghost", size: "icon" }),
                triggerSizeClass,
              )}
            >
              <MoreHorizontal className="size-4 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[180px]">
              {menuItems && renderMenuItems(menuItems)}
              {menuItems && menuItems.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem>
                <Download className="size-4 mr-2" />
                Export as PNG
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Share2 className="size-4 mr-2" />
                Share
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={openFullscreen}>
                <Maximize2 className="size-4 mr-2" />
                Full Screen
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {renderContent(false)}
      </div>

      {isExpanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm p-6"
          onClick={closeFullscreen}
        >
          <div
            className="relative w-full max-w-6xl rounded-xl border bg-card p-8 shadow-lg max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-3">
                {icon && <div className="text-muted-foreground">{icon}</div>}
                <h2 className="text-xl font-semibold">{title}</h2>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={closeFullscreen}
                className="size-8"
              >
                <X className="size-4" />
                <span className="sr-only">Close</span>
              </Button>
            </div>

            <div className="w-full">{renderContent(true)}</div>
          </div>
        </div>
      )}
    </>
  );
}
