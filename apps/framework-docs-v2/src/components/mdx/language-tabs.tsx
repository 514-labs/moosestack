"use client";

import { ReactNode, Suspense, useState, useEffect } from "react";
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
  const { language } = useLanguage();

  // Local state for this tab group - initializes from global language
  const [localLanguage, setLocalLanguage] = useState<string>(
    language.toLowerCase(),
  );

  // Sync local state when global language changes (from sidenav)
  useEffect(() => {
    setLocalLanguage(language.toLowerCase());
  }, [language]);

  const handleValueChange = (value: string) => {
    // Only update local state, don't change global language
    setLocalLanguage(value);
  };

  return (
    <Tabs
      value={localLanguage}
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
