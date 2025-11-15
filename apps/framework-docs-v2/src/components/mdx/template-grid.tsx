"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TemplateCard } from "./template-card";
import type { ItemMetadata, TemplateMetadata } from "@/lib/template-types";
import { IconSearch, IconX } from "@tabler/icons-react";

interface TemplateGridProps {
  items: ItemMetadata[];
  className?: string;
}

type LanguageFilter = "typescript" | "python" | null;
type CategoryFilter = ("starter" | "framework" | "example")[];
type TypeFilter = "template" | "app" | null;

export function TemplateGrid({ items, className }: TemplateGridProps) {
  const searchParams = useSearchParams();
  const [searchQuery, setSearchQuery] = React.useState("");

  // Read filters from URL params (set by TemplatesSideNav)
  const typeFilter = React.useMemo(() => {
    const type = searchParams.get("type");
    return (type === "template" || type === "app" ? type : null) as TypeFilter;
  }, [searchParams]);

  const languageFilter = React.useMemo(() => {
    const language = searchParams.get("language");
    return (
      language === "typescript" || language === "python" ?
        language
      : null) as LanguageFilter;
  }, [searchParams]);

  const categoryFilter = React.useMemo(() => {
    const categoryParam = searchParams.get("category");
    if (!categoryParam) return [];
    return categoryParam
      .split(",")
      .filter(
        (c): c is "starter" | "framework" | "example" =>
          c === "starter" || c === "framework" || c === "example",
      ) as CategoryFilter;
  }, [searchParams]);

  const filteredItems = React.useMemo(() => {
    return items.filter((item) => {
      // Type filter (template vs app)
      if (typeFilter !== null && item.type !== typeFilter) {
        return false;
      }

      // Language filter
      if (languageFilter !== null) {
        const itemLanguage =
          item.type === "template" ?
            (item as TemplateMetadata).language
          : (item as any).language;
        if (!itemLanguage || itemLanguage !== languageFilter) {
          return false;
        }
      }

      // Category filter (only applies to templates, apps pass through)
      if (categoryFilter.length > 0 && item.type === "template") {
        const template = item as TemplateMetadata;
        if (!categoryFilter.includes(template.category)) {
          return false;
        }
      }

      // Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesName = item.name.toLowerCase().includes(query);
        const matchesDescription = item.description
          .toLowerCase()
          .includes(query);
        const matchesFrameworks = item.frameworks.some((f) =>
          f.toLowerCase().includes(query),
        );
        const matchesFeatures = item.features.some((f) =>
          f.toLowerCase().includes(query),
        );

        if (
          !matchesName &&
          !matchesDescription &&
          !matchesFrameworks &&
          !matchesFeatures
        ) {
          return false;
        }
      }

      return true;
    });
  }, [items, searchQuery, languageFilter, categoryFilter, typeFilter]);

  const hasActiveFilters =
    searchQuery.trim() !== "" ||
    languageFilter !== null ||
    categoryFilter.length > 0 ||
    typeFilter !== null;

  return (
    <div className={cn("w-full", className)}>
      {/* Search - kept in main content area */}
      <div className="mb-6">
        <div className="relative">
          <IconSearch className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search templates and apps..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 pr-9"
          />
          {searchQuery && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
            >
              <IconX className="h-4 w-4" />
            </Button>
          )}
        </div>
        {/* Results count */}
        {hasActiveFilters && (
          <div className="mt-3 flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              {filteredItems.length} item{filteredItems.length !== 1 ? "s" : ""}
            </Badge>
          </div>
        )}
      </div>

      {/* Results */}
      {filteredItems.length === 0 ?
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-lg font-medium mb-2">No items found</p>
          <p className="text-sm">Try adjusting your filters or search query</p>
        </div>
      : <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filteredItems.map((item) => (
            <TemplateCard key={item.slug} item={item} />
          ))}
        </div>
      }
    </div>
  );
}
