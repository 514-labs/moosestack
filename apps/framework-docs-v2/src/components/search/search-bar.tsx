"use client";

import { useEffect, useState, useCallback } from "react";
import { IconSearch } from "@tabler/icons-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface SearchResult {
  id: string;
  url: string;
  title: string;
  excerpt: string;
  language?: string;
}

interface PagefindInstance {
  search: (query: string) => Promise<{
    results: Array<{
      data: () => Promise<{
        url: string;
        title: string;
        excerpt: string;
        meta?: {
          language?: string;
        };
      }>;
    }>;
  }>;
}

declare global {
  interface Window {
    pagefind?: {
      init: () => Promise<PagefindInstance>;
    };
  }
}

export function SearchBar() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagefind, setPagefind] = useState<PagefindInstance | null>(null);

  // Initialize Pagefind
  useEffect(() => {
    const loadPagefind = async () => {
      if (window.pagefind) {
        const instance = await window.pagefind.init();
        setPagefind(instance);
      }
    };

    loadPagefind();
  }, []);

  // Handle keyboard shortcut
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  // Perform search
  const performSearch = useCallback(
    async (searchQuery: string) => {
      if (!pagefind || !searchQuery.trim()) {
        setResults([]);
        return;
      }

      setLoading(true);
      try {
        const searchResults = await pagefind.search(searchQuery);
        const processedResults: SearchResult[] = [];

        for (const result of searchResults.results) {
          const data = await result.data();
          processedResults.push({
            id: data.url,
            url: data.url,
            title: data.title || "Untitled",
            excerpt: data.excerpt || "",
            language: data.meta?.language,
          });
        }

        setResults(processedResults);
      } catch (error) {
        console.error("Search error:", error);
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [pagefind],
  );

  // Debounced search
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      performSearch(query);
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [query, performSearch]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl p-0">
        <div className="flex flex-col">
          {/* Search Input */}
          <div className="flex items-center border-b px-4">
            <IconSearch className="h-4 w-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search documentation..."
              className="flex h-14 w-full bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
              autoFocus
            />
          </div>

          {/* Search Results */}
          <div className="max-h-96 overflow-y-auto">
            {loading && (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                Searching...
              </div>
            )}

            {!loading && query && results.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                No results found
              </div>
            )}

            {!loading && results.length > 0 && (
              <div className="py-2">
                {results.map((result) => (
                  <a
                    key={result.id}
                    href={result.url}
                    onClick={() => setOpen(false)}
                    className="block px-4 py-3 hover:bg-accent transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-medium">{result.title}</div>
                      {result.language && (
                        <span className="text-xs text-muted-foreground capitalize">
                          {result.language}
                        </span>
                      )}
                    </div>
                    {result.excerpt && (
                      <div
                        className="mt-1 text-sm text-muted-foreground line-clamp-2"
                        dangerouslySetInnerHTML={{ __html: result.excerpt }}
                      />
                    )}
                  </a>
                ))}
              </div>
            )}

            {!query && (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                Type to search documentation
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
            <div>
              Press <kbd className="rounded bg-muted px-1.5 py-0.5">ESC</kbd> to
              close
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
