"use client";

import React, { useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface ToggleBlockProps {
  openText: string;
  closeText: string;
  children: React.ReactNode;
  open?: boolean;
  className?: string;
}

export function ToggleBlock({
  openText,
  closeText,
  children,
  open,
  className,
}: ToggleBlockProps) {
  const [isOpen, setIsOpen] = useState(open ?? false);

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className={cn("w-full space-y-2 my-4", className)}
    >
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="flex flex-row items-center justify-start mb-2 w-full text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronRight
            className={cn(
              "mr-2 h-4 w-4 transition-transform duration-200",
              isOpen && "rotate-90",
            )}
          />
          <span>{isOpen ? closeText : openText}</span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pl-6 ml-2">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
