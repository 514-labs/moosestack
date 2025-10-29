"use client";

import { useCallback, useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAnalytics } from "@/lib/analytics";

declare global {
  interface Window {
    pagefind?: {
      search: (query: string) => Promise<{ results: Array<{ data: () => Promise<any> }> }>;
    };
  }
}

export function SearchBar() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const { trackSearch } = useAnalytics();

  // Load Pagefind on mount
  useEffect(() => {
    if (open && !window.pagefind) {
      const script = document.createElement("script");
      script.src = "/pagefind/pagefind.js";
      script.async = true;
      document.body.appendChild(script);
    }
  }, [open]);

  // Handle keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleSearch = useCallback(
    async (searchQuery: string) => {
      if (!searchQuery.trim() || !window.pagefind) {
        setResults([]);
        return;
      }

      setLoading(true);
      try {
        const search = await window.pagefind.search(searchQuery);
        const resultData = await Promise.all(
          search.results.map((r) => r.data())
        );
        setResults(resultData);
        trackSearch(searchQuery, resultData.length);
      } catch (error) {
        console.error("Search error:", error);
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [trackSearch]
  );

  useEffect(() => {
    const debounce = setTimeout(() => {
      if (query) {
        handleSearch(query);
      } else {
        setResults([]);
      }
    }, 300);

    return () => clearTimeout(debounce);
  }, [query, handleSearch]);

  return (
    <>
      <Button
        variant="outline"
        className="w-full md:w-64 justify-start text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <Search className="mr-2 h-4 w-4" />
        <span>Search docs...</span>
        <kbd className="ml-auto pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
          <span className="text-xs">⌘</span>K
        </kbd>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden p-0">
          <DialogHeader className="p-4 pb-0">
            <DialogTitle className="sr-only">Search Documentation</DialogTitle>
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search documentation..."
                className="w-full pl-10 pr-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
            </div>
          </DialogHeader>

          <div className="max-h-[60vh] overflow-y-auto p-4">
            {loading && (
              <div className="text-center py-8 text-muted-foreground">
                Searching...
              </div>
            )}

            {!loading && query && results.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                No results found for "{query}"
              </div>
            )}

            {!loading && results.length > 0 && (
              <div className="space-y-2">
                {results.map((result, index) => (
                  <a
                    key={index}
                    href={result.url}
                    className="block p-3 rounded-lg border hover:bg-accent transition-colors"
                    onClick={() => setOpen(false)}
                  >
                    <div className="font-medium">{result.meta?.title || "Untitled"}</div>
                    {result.excerpt && (
                      <div
                        className="text-sm text-muted-foreground mt-1 line-clamp-2"
                        dangerouslySetInnerHTML={{ __html: result.excerpt }}
                      />
                    )}
                  </a>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

