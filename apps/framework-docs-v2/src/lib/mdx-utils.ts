import type { Language } from "@/lib/content-types";

// Helper to get language-specific path
export function getLanguagePath(path: string, language: Language): string {
  return `/${language}${path}`;
}

// Helper to check if current path matches language
export function isLanguagePath(pathname: string, language: Language): boolean {
  return pathname.startsWith(`/${language}`);
}

// Extract language from pathname
export function extractLanguage(pathname: string): Language {
  if (pathname.startsWith("/python")) {
    return "python";
  }
  return "typescript";
}
