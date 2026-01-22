"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
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
  const [isPending, startTransition] = useTransition();
  const hasBootstrapped = useRef(false);

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
  // Only run once per mount, using startTransition to avoid blocking UI
  useEffect(() => {
    if (hasBootstrapped.current) return;

    const urlLang = searchParams?.get("lang");
    if (!urlLang && typeof window !== "undefined") {
      hasBootstrapped.current = true;
      const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
      const langToSet =
        stored === "typescript" || stored === "python" ?
          stored
        : DEFAULT_LANGUAGE;

      // Use startTransition to avoid blocking UI during URL update
      startTransition(() => {
        const params = new URLSearchParams(searchParams?.toString() || "");
        params.set("lang", langToSet);
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      });
    } else if (urlLang) {
      // URL already has lang param, mark as bootstrapped
      hasBootstrapped.current = true;
    }
  }, [pathname, router, searchParams]);

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
