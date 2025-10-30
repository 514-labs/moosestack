"use client";

import React, { ReactNode } from "react";
import { useLanguage } from "./LanguageContext";
import { cn } from "@/lib/utils";

interface LanguageProps {
  children: ReactNode;
  inline?: boolean;
}

export const TypeScript: React.FC<LanguageProps> = ({
  children,
  inline = false,
}) => {
  const { language } = useLanguage();
  return inline ?
      <span className={cn(language === "typescript" ? "" : "hidden")}>
        {children}
      </span>
    : <div className={cn(language === "typescript" ? "" : "hidden")}>
        {children}
      </div>;
};

export const Python: React.FC<LanguageProps> = ({
  children,
  inline = false,
}) => {
  const { language } = useLanguage();
  return inline ?
      <span className={cn(language === "python" ? "" : "hidden")}>
        {children}
      </span>
    : <div className={cn(language === "python" ? "" : "hidden")}>
        {children}
      </div>;
};
