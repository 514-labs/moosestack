"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
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

  // Get language from URL params first, then localStorage, then default
  const getInitialLanguage = useCallback((): Language => {
    // Check URL params first
    const urlLang = searchParams?.get("lang");
    if (urlLang === "typescript" || urlLang === "python") {
      return urlLang;
    }

    // Check localStorage
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (stored === "typescript" || stored === "python") {
        return stored;
      }
    }

    return DEFAULT_LANGUAGE;
  }, [searchParams]);

  const [language, setLanguageState] = useState<Language>(getInitialLanguage);

  // Sync with URL params when they change
  useEffect(() => {
    const urlLang = searchParams?.get("lang");
    if (urlLang === "typescript" || urlLang === "python") {
      setLanguageState(urlLang);
    }
  }, [searchParams]);

  // Bootstrap URL with language from localStorage on mount if not in URL
  useEffect(() => {
    const urlLang = searchParams?.get("lang");
    if (!urlLang && typeof window !== "undefined") {
      const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (stored === "typescript" || stored === "python") {
        // Add language param to URL
        const params = new URLSearchParams(searchParams?.toString() || "");
        params.set("lang", stored);
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      } else {
        // No stored preference, default to typescript and add to URL
        const params = new URLSearchParams(searchParams?.toString() || "");
        params.set("lang", DEFAULT_LANGUAGE);
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      }
    }
  }, [pathname, router, searchParams]);

  const setLanguage = useCallback(
    (lang: Language) => {
      // Update state
      setLanguageState(lang);

      // Save to localStorage
      if (typeof window !== "undefined") {
        localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
      }

      // Update URL params
      const params = new URLSearchParams(searchParams?.toString() || "");
      params.set("lang", lang);
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
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
