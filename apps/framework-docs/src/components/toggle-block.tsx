"use client";
import React, { useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Button,
} from "@/components/ui";
import { ChevronRight } from "lucide-react";
import { SmallText } from "@/components/typography";
import { cn } from "@/lib/utils";

interface ToggleBlockProps {
  openText: string;
  closeText: string;
  children: React.ReactNode;
  open?: boolean;
}

export function ToggleBlock({
  openText,
  closeText,
  children,
  open,
}: ToggleBlockProps) {
  const [isOpen, setIsOpen] = useState(open);

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className="w-full space-y-2 mt-4"
    >
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="flex flex-row items-center justify-start mb-4 w-full"
        >
          <ChevronRight
            className={cn(
              "mr-2 h-4 w-4 transition-transform duration-200",
              isOpen && "transform rotate-90",
            )}
          />
          <SmallText>{isOpen ? closeText : openText}</SmallText>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pl-8 ml-2">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
