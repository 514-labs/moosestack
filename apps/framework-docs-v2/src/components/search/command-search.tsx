"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { analytics } from "@/lib/analytics";
import { useLanguage } from "@/hooks/use-language";
import { IconFileText, IconCode } from "@tabler/icons-react";

interface SearchResult {
  id: string;
  url: string;
  title: string;
  excerpt: string;
  language?: string;
}

interface PagefindSearchResult {
  results: Array<{
    data: () => Promise<{
      url: string;
      title: string;
      excerpt: string;
      meta?: {
        title?: string;
        language?: string;
      };
    }>;
  }>;
}

declare global {
  interface Window {
    pagefind?: {
      init: () => Promise<void>;
      search?: (term: string, options?: any) => Promise<PagefindSearchResult>;
      preload?: (term: string, options?: any) => Promise<any>;
      filters?: () => Promise<any>;
      options?: (options: any) => Promise<void>;
      mergeIndex?: (indexPath: string, options?: any) => Promise<any>;
      debouncedSearch?: (
        term: string,
        options?: any,
        debounceTimeoutMs?: number,
      ) => Promise<any>;
      destroy?: () => Promise<void>;
    };
  }
}

interface CommandSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandSearch({ open, onOpenChange }: CommandSearchProps) {
  const router = useRouter();
  const { language } = useLanguage();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagefindReady, setPagefindReady] = useState(false);
  const searchPerformedRef = useRef(false);

  // Initialize Pagefind using the approach from:
  // https://www.petemillspaugh.com/nextjs-search-with-pagefind
  useEffect(() => {
    async function loadPagefind() {
      // Load Pagefind module if not already loaded
      if (typeof window.pagefind === "undefined") {
        try {
          // webpackIgnore prevents Webpack from bundling this file
          const pagefindModule = (await import(
            // @ts-expect-error - pagefind.js is generated at build time
            /* webpackIgnore: true */ "/pagefind/pagefind.js"
          )) as typeof window.pagefind;
          window.pagefind = pagefindModule;
        } catch (e) {
          // Empty or dummy results for local dev (when index doesn't exist)
          window.pagefind = {
            init: async () => {},
            search: async () => ({ results: [] }),
          };
          return;
        }
      }

      // Initialize Pagefind if we have the module
      if (window.pagefind && typeof window.pagefind.init === "function") {
        try {
          await window.pagefind.init();
          setPagefindReady(true);
        } catch (error) {
          // Silently fail - search will show empty state
        }
      }
    }

    loadPagefind();
  }, []);

  // Perform search
  const performSearch = useCallback(
    async (searchQuery: string) => {
      if (!pagefindReady || !searchQuery.trim() || !window.pagefind) {
        setResults([]);
        if (searchQuery.trim() && !searchPerformedRef.current) {
          // Track empty search
          analytics.search({
            query: searchQuery,
            resultCount: 0,
            language,
          });
          searchPerformedRef.current = true;
        }
        return;
      }

      setLoading(true);
      try {
        if (!window.pagefind?.search) {
          setResults([]);
          return;
        }
        const searchResults: PagefindSearchResult =
          await window.pagefind.search(searchQuery, {
            // Limit to one result per page to avoid sub-results
            // We'll deduplicate further by URL normalization
            filters: {},
          });
        const processedResults: SearchResult[] = [];
        // Map to deduplicate results by normalized URL (Pagefind can return multiple results per page)
        const urlMap = new Map<string, SearchResult>();

        for (const result of searchResults.results) {
          try {
            const data = await result.data();

            // Normalize URL - remove .next/server/app prefix and .html extension
            let normalizedUrl = data.url
              .replace(/^\/_next\/static\/chunks\/app\/server\/app/, "")
              .replace(/^\/\.next\/server\/app/, "")
              .replace(/\.html$/, "")
              .replace(/\/index$/, "/")
              // Handle Next.js dynamic route patterns
              .replace(/\/\[.*?\]/g, "")
              // Remove any double slashes
              .replace(/\/+/g, "/");

            // Remove URL fragments (hash) and query parameters for deduplication
            // e.g., /page#section and /page?param=value should be treated as the same page
            const urlWithoutFragment =
              normalizedUrl.split("#")[0] || normalizedUrl;
            const urlWithoutQuery =
              urlWithoutFragment.split("?")[0] || urlWithoutFragment;

            // Normalize trailing slashes (except for root)
            let finalUrl = urlWithoutQuery;
            if (finalUrl !== "/" && finalUrl.endsWith("/")) {
              finalUrl = finalUrl.slice(0, -1);
            }

            // Ensure URL starts with /
            if (!finalUrl.startsWith("/")) {
              finalUrl = "/" + finalUrl;
            }

            // Normalize to lowercase for case-insensitive comparison
            const normalizedKey = finalUrl.toLowerCase();

            // Only add if we haven't seen this URL before
            // Keep the first result for each unique page
            if (!urlMap.has(normalizedKey)) {
              const searchResult: SearchResult = {
                id: finalUrl, // Use normalized URL as ID for React key
                url: finalUrl,
                title: data.title || data.meta?.title || "Untitled",
                excerpt: data.excerpt || "",
                language: data.meta?.language,
              };
              urlMap.set(normalizedKey, searchResult);
              processedResults.push(searchResult);
            }
          } catch (error) {
            // Skip invalid results
          }
        }

        setResults(processedResults);

        // Track search with analytics
        if (!searchPerformedRef.current) {
          analytics.search({
            query: searchQuery,
            resultCount: processedResults.length,
            language,
          });
          searchPerformedRef.current = true;
        }
      } catch (error) {
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [pagefindReady, language],
  );

  // Debounced search
  useEffect(() => {
    if (!open) return;

    searchPerformedRef.current = false;
    const timeoutId = setTimeout(() => {
      performSearch(query);
    }, 150);

    return () => clearTimeout(timeoutId);
  }, [query, performSearch, open]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      searchPerformedRef.current = false;
    }
  }, [open]);

  const handleSelect = useCallback(
    (url: string) => {
      onOpenChange(false);
      router.push(url);
    },
    [onOpenChange, router],
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      commandProps={{
        shouldFilter: false,
        filter: () => 1, // Disable cmdk's internal filtering since we're using Pagefind
      }}
    >
      <CommandInput
        placeholder="Search documentation..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {loading && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Searching...
          </div>
        )}

        {!loading && query && results.length === 0 && (
          <CommandEmpty>No results found.</CommandEmpty>
        )}

        {!loading && results.length > 0 && (
          <CommandGroup
            heading={`${results.length} result${results.length !== 1 ? "s" : ""}`}
          >
            {results.map((result) => (
              <CommandItem
                key={result.id}
                value={result.title}
                onSelect={() => {
                  handleSelect(result.url);
                  // Track result click
                  analytics.search({
                    query,
                    resultCount: results.length,
                    language,
                  });
                }}
                className="flex flex-col items-start gap-1 py-3"
              >
                <div className="flex w-full items-center justify-between">
                  <div className="flex items-center gap-2">
                    <IconFileText className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{result.title}</span>
                  </div>
                  {result.language && (
                    <span className="text-xs text-muted-foreground capitalize flex items-center gap-1">
                      <IconCode className="h-3 w-3" />
                      {result.language}
                    </span>
                  )}
                </div>
                {result.excerpt && (
                  <div
                    className="text-xs text-muted-foreground line-clamp-2 ml-6"
                    dangerouslySetInnerHTML={{ __html: result.excerpt }}
                  />
                )}
                <CommandShortcut>{result.url}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {!query && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            {pagefindReady ?
              "Type to search documentation"
            : <div className="space-y-2">
                <p>Search index not available in dev mode</p>
                <p className="text-xs opacity-75">
                  Run{" "}
                  <code className="px-1 py-0.5 bg-muted rounded">
                    pnpm build
                  </code>{" "}
                  to enable search
                </p>
              </div>
            }
          </div>
        )}
      </CommandList>
    </CommandDialog>
  );
}
