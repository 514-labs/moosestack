"use client";

import { LanguageProvider } from "@/hooks/use-language";

export function LanguageProviderWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  return <LanguageProvider>{children}</LanguageProvider>;
}
