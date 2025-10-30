"use client";

import {
  createContext,
  useContext,
  useState,
  ReactNode,
  Suspense,
} from "react";
import { useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Language = "typescript" | "python";

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
}

const LanguageContext = createContext<LanguageContextType | undefined>(
  undefined,
);

export function LanguageProvider({
  children,
  initialLanguage = "typescript",
}: {
  children: ReactNode;
  initialLanguage?: Language;
}) {
  const [language, setLanguage] = useState<Language>(initialLanguage);

  return (
    <LanguageContext.Provider value={{ language, setLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within LanguageProvider");
  }
  return context;
}

interface LanguageTabsProps {
  children: ReactNode;
  items?: string[];
}

function LanguageTabsInner({
  children,
  items = ["TypeScript", "Python"],
}: LanguageTabsProps) {
  const searchParams = useSearchParams();

  // Get language from URL query params, default to typescript
  const langParam = searchParams?.get("lang");
  const currentLanguage = langParam === "python" ? "python" : "typescript";

  return (
    <Tabs defaultValue={currentLanguage} className="w-full my-4">
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
