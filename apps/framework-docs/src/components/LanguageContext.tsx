import React, {
  createContext,
  useContext,
  useState,
  ReactNode,
  useEffect,
} from "react";
import { useRouter } from "next/router";

type Language = "typescript" | "python";

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
}

const LanguageContext = createContext<LanguageContextType | undefined>(
  undefined,
);

const LANGUAGE_STORAGE_KEY = "moose-docs-language";

// Extract language from URL path (e.g., /typescript/page -> "typescript")
function extractLanguageFromPath(pathname: string): Language | null {
  const segments = pathname.split("/").filter(Boolean);
  const firstSegment = segments[0];

  if (firstSegment === "typescript" || firstSegment === "python") {
    return firstSegment;
  }

  return null;
}

export const LanguageProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const router = useRouter();
  const [language, setLanguage] = useState<Language>("typescript");

  // Initialize language from URL path, then localStorage, then default
  useEffect(() => {
    if (!router.isReady) return;

    const pathLanguage = extractLanguageFromPath(router.pathname);

    if (pathLanguage) {
      setLanguage(pathLanguage);
      localStorage.setItem(LANGUAGE_STORAGE_KEY, pathLanguage);
    } else {
      // No valid path language, check localStorage
      const savedLanguage = localStorage.getItem(
        LANGUAGE_STORAGE_KEY,
      ) as Language;
      if (
        savedLanguage &&
        (savedLanguage === "typescript" || savedLanguage === "python")
      ) {
        setLanguage(savedLanguage);
      }
    }
  }, [router.isReady, router.pathname]);

  // Update URL path prefix and localStorage when language changes
  const handleSetLanguage = (lang: Language) => {
    setLanguage(lang);
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);

    // Replace the language prefix in the current path
    const currentPath = router.asPath;
    const currentLanguage = extractLanguageFromPath(router.pathname);

    let newPath: string;
    if (currentLanguage) {
      // Replace the current language prefix with the new one
      newPath = currentPath.replace(`/${currentLanguage}`, `/${lang}`);
    } else {
      // Add language prefix if it doesn't exist
      newPath = `/${lang}${currentPath}`;
    }

    router.push(newPath);
  };

  return (
    <LanguageContext.Provider
      value={{ language, setLanguage: handleSetLanguage }}
    >
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return context;
};
