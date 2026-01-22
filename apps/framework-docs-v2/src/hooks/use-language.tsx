"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useTransition,
} from "react";
import { useSearchParams, usePathname, useRouter } from "next/navigation";

export type Language = "typescript" | "python";

const LANGUAGE_STORAGE_KEY = "moose-docs-language";
const DEFAULT_LANGUAGE: Language = "typescript";

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
}

const LanguageContext = createContext<LanguageContextType | undefined>(
  undefined,
);

interface LanguageProviderProps {
  children: React.ReactNode;
}

export function LanguageProvider({ children }: LanguageProviderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [_isPending, startTransition] = useTransition();

  // Get language from URL params first, then localStorage, then default
  // This runs on initial render without causing navigation
  const getInitialLanguage = useCallback((): Language => {
    // Check URL params first
    const urlLang = searchParams?.get("lang");
    if (urlLang === "typescript" || urlLang === "python") {
      return urlLang;
    }

    // Check localStorage (only on client)
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (stored === "typescript" || stored === "python") {
        return stored;
      }
    }

    return DEFAULT_LANGUAGE;
  }, [searchParams]);

  const [language, setLanguageState] = useState<Language>(getInitialLanguage);

  // Sync state with URL params when they change (but don't modify URL)
  useEffect(() => {
    const urlLang = searchParams?.get("lang");
    if (urlLang === "typescript" || urlLang === "python") {
      setLanguageState(urlLang);
    }
  }, [searchParams]);

  // Sync state with localStorage on mount (without modifying URL)
  // This ensures the UI reflects stored preference even if URL lacks lang param
  useEffect(() => {
    const urlLang = searchParams?.get("lang");
    if (!urlLang && typeof window !== "undefined") {
      const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (stored === "typescript" || stored === "python") {
        setLanguageState(stored);
      }
    }
  }, [searchParams]);

  const setLanguage = useCallback(
    (lang: Language) => {
      // Update state immediately
      setLanguageState(lang);

      // Save to localStorage
      if (typeof window !== "undefined") {
        localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
      }

      // Update URL params with transition to avoid blocking UI
      startTransition(() => {
        const params = new URLSearchParams(searchParams?.toString() || "");
        params.set("lang", lang);
        router.push(`${pathname}?${params.toString()}`, { scroll: false });
      });
    },
    [pathname, router, searchParams, startTransition],
  );

  return (
    <LanguageContext.Provider value={{ language, setLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextType {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return context;
}
