"use client";

import { ReactNode, Suspense } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLanguage } from "@/hooks/use-language";

interface LanguageTabsProps {
  children: ReactNode;
  items?: string[];
}

function LanguageTabsInner({
  children,
  items = ["TypeScript", "Python"],
}: LanguageTabsProps) {
  const { language, setLanguage } = useLanguage();

  const handleValueChange = (value: string) => {
    // Update global language, which will sync all tabs across the page
    const lang = value.toLowerCase() as "typescript" | "python";
    if (lang === "typescript" || lang === "python") {
      setLanguage(lang);
    }
  };

  return (
    <Tabs
      value={language.toLowerCase()}
      onValueChange={handleValueChange}
      className="w-full my-4"
    >
      <TabsList className="grid w-full max-w-md grid-cols-2">
        {items.map((item) => (
          <TabsTrigger key={item} value={item.toLowerCase()}>
            {item}
          </TabsTrigger>
        ))}
      </TabsList>
      {children}
    </Tabs>
  );
}

export function LanguageTabs(props: LanguageTabsProps) {
  return (
    <Suspense
      fallback={
        <Tabs defaultValue="typescript" className="w-full my-4">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            {(props.items || ["TypeScript", "Python"]).map((item) => (
              <TabsTrigger key={item} value={item.toLowerCase()}>
                {item}
              </TabsTrigger>
            ))}
          </TabsList>
          {props.children}
        </Tabs>
      }
    >
      <LanguageTabsInner {...props} />
    </Suspense>
  );
}

export { TabsContent as LanguageTabContent };
