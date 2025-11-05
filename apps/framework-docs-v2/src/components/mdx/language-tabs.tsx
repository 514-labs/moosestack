"use client";

import { ReactNode, Suspense, useState, useEffect, useRef } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLanguage } from "@/hooks/use-language";
import { toast } from "sonner";

interface LanguageTabsProps {
  children: ReactNode;
  items?: string[];
}

function LanguageTabsInner({
  children,
  items = ["TypeScript", "Python"],
}: LanguageTabsProps) {
  const { language, setLanguage } = useLanguage();

  // Local state for this tab group - initializes from global language
  const [localLanguage, setLocalLanguage] = useState<string>(
    language.toLowerCase(),
  );

  // Track if this is the initial mount to avoid showing toast on mount
  const isInitialMount = useRef(true);

  // Sync local state when global language changes (from top nav)
  useEffect(() => {
    setLocalLanguage(language.toLowerCase());
    // Reset initial mount flag after first sync
    if (isInitialMount.current) {
      isInitialMount.current = false;
    }
  }, [language]);

  const handleValueChange = (value: string) => {
    const newLang = value.toLowerCase() as "typescript" | "python";
    setLocalLanguage(newLang);

    // Only show toast if the language is different from global language
    if (newLang !== language.toLowerCase()) {
      const languageName = newLang === "typescript" ? "TypeScript" : "Python";
      toast(`Switched to ${languageName}`, {
        description: "Would you like to set this as your default language?",
        action: {
          label: "Set as default",
          onClick: () => {
            setLanguage(newLang);
          },
        },
        duration: 5000,
      });
    }
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
