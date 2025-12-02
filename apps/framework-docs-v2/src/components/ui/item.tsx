"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const itemVariants = cva(
  "flex items-start gap-3 rounded-md transition-colors",
  {
    variants: {
      variant: {
        default: "",
        outline: "border",
        muted: "bg-muted",
      },
      size: {
        default: "p-3",
        sm: "p-2",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ItemProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof itemVariants> {
  asChild?: boolean;
}

const Item = React.forwardRef<HTMLDivElement, ItemProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "div";
    return (
      <Comp
        className={cn(itemVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Item.displayName = "Item";

const ItemGroup = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("flex flex-col gap-1", className)} {...props} />
));
ItemGroup.displayName = "ItemGroup";

const ItemSeparator = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("h-px bg-border", className)} {...props} />
));
ItemSeparator.displayName = "ItemSeparator";

const ItemMedia = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    variant?: "default" | "icon" | "image";
  }
>(({ className, variant = "default", ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "shrink-0",
      variant === "icon" && "flex h-10 w-10 items-center justify-center",
      variant === "image" && "h-10 w-10 overflow-hidden rounded-md",
      className,
    )}
    {...props}
  />
));
ItemMedia.displayName = "ItemMedia";

const ItemContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("flex-1 min-w-0", className)} {...props} />
));
ItemContent.displayName = "ItemContent";

const ItemTitle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("font-medium leading-none", className)}
    {...props}
  />
));
ItemTitle.displayName = "ItemTitle";

const ItemDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("mt-1.5 text-sm text-muted-foreground", className)}
    {...props}
  />
));
ItemDescription.displayName = "ItemDescription";

const ItemActions = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex shrink-0 items-center gap-1", className)}
    {...props}
  />
));
ItemActions.displayName = "ItemActions";

const ItemHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("mb-1 text-xs font-medium text-muted-foreground", className)}
    {...props}
  />
));
ItemHeader.displayName = "ItemHeader";

const ItemFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("mt-1 text-xs text-muted-foreground", className)}
    {...props}
  />
));
ItemFooter.displayName = "ItemFooter";

export {
  Item,
  ItemGroup,
  ItemSeparator,
  ItemMedia,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemActions,
  ItemHeader,
  ItemFooter,
};
