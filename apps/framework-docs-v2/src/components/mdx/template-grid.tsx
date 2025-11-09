"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TemplateCard } from "./template-card";
import type { ItemMetadata, TemplateMetadata } from "@/lib/templates";
import { IconSearch, IconX } from "@tabler/icons-react";

interface TemplateGridProps {
  items: ItemMetadata[];
  className?: string;
}

type LanguageFilter = "typescript" | "python" | null;
type CategoryFilter = ("starter" | "framework" | "example")[];
type TypeFilter = "template" | "app" | null;

export function TemplateGrid({ items, className }: TemplateGridProps) {
  const [searchQuery, setSearchQuery] = React.useState("");
  const [languageFilter, setLanguageFilter] =
    React.useState<LanguageFilter>(null);
  const [categoryFilter, setCategoryFilter] = React.useState<CategoryFilter>(
    [],
  );
  const [typeFilter, setTypeFilter] = React.useState<TypeFilter>(null);

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

  const clearFilters = () => {
    setSearchQuery("");
    setLanguageFilter(null);
    setCategoryFilter([]);
    setTypeFilter(null);
  };

  return (
    <div className={cn("w-full", className)}>
      {/* Filters */}
      <div className="mb-6 space-y-4">
        {/* Search */}
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

        {/* Type Filter */}
        <div>
          <label className="text-sm font-medium mb-2 block">Type</label>
          <ToggleGroup
            type="single"
            value={typeFilter || ""}
            onValueChange={(value) => {
              if (value === "" || value === undefined) {
                setTypeFilter(null);
              } else if (value === "template" || value === "app") {
                setTypeFilter(value as TypeFilter);
              }
            }}
            variant="outline"
            className="w-full"
          >
            <ToggleGroupItem
              value="template"
              className="flex-1"
              aria-label="Templates"
            >
              Templates
            </ToggleGroupItem>
            <ToggleGroupItem value="app" className="flex-1" aria-label="Apps">
              Apps
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        {/* Language and Category Filters */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <label className="text-sm font-medium mb-2 block">Language</label>
            <ToggleGroup
              type="single"
              value={languageFilter || ""}
              onValueChange={(value) => {
                if (value === "" || value === undefined) {
                  setLanguageFilter(null);
                } else if (value === "typescript" || value === "python") {
                  setLanguageFilter(value as LanguageFilter);
                }
              }}
              variant="outline"
              className="w-full"
            >
              <ToggleGroupItem
                value="typescript"
                className="flex-1"
                aria-label="TypeScript"
              >
                TypeScript
              </ToggleGroupItem>
              <ToggleGroupItem
                value="python"
                className="flex-1"
                aria-label="Python"
              >
                Python
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className="flex-1">
            <label className="text-sm font-medium mb-2 block">Category</label>
            <ToggleGroup
              type="multiple"
              value={categoryFilter}
              onValueChange={(value) => {
                setCategoryFilter(value as CategoryFilter);
              }}
              variant="outline"
              className="w-full"
            >
              <ToggleGroupItem
                value="starter"
                className="flex-1"
                aria-label="Starter templates"
              >
                Starter
              </ToggleGroupItem>
              <ToggleGroupItem
                value="framework"
                className="flex-1"
                aria-label="Framework templates"
              >
                Framework
              </ToggleGroupItem>
              <ToggleGroupItem
                value="example"
                className="flex-1"
                aria-label="Example templates"
              >
                Example
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>

        {/* Clear filters button */}
        {hasActiveFilters && (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="h-8"
            >
              <IconX className="h-3 w-3 mr-1" />
              Clear filters
            </Button>
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
