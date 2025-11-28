"use client";

import * as React from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { IconX } from "@tabler/icons-react";

type LanguageFilter = "typescript" | "python" | null;
type CategoryFilter = ("starter" | "framework" | "example")[];
type TypeFilter = "template" | "app" | null;

export function TemplatesSideNav() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Get filter values from URL params
  const typeFilter = (searchParams.get("type") as TypeFilter) || null;
  const languageFilter =
    (searchParams.get("language") as LanguageFilter) || null;
  const categoryFilter = React.useMemo(() => {
    const categoryParam = searchParams.get("category");
    if (!categoryParam) return [];
    return categoryParam
      .split(",")
      .filter(
        (c): c is "starter" | "framework" | "example" =>
          c === "starter" || c === "framework" || c === "example",
      );
  }, [searchParams]);

  const hasActiveFilters =
    typeFilter !== null || languageFilter !== null || categoryFilter.length > 0;

  // Update URL params when filters change
  const updateFilters = React.useCallback(
    (updates: {
      type?: TypeFilter;
      language?: LanguageFilter;
      category?: CategoryFilter;
    }) => {
      const params = new URLSearchParams(searchParams.toString());

      if (updates.type !== undefined) {
        if (updates.type === null) {
          params.delete("type");
        } else {
          params.set("type", updates.type);
        }
      }

      if (updates.language !== undefined) {
        if (updates.language === null) {
          params.delete("language");
        } else {
          params.set("language", updates.language);
        }
      }

      if (updates.category !== undefined) {
        if (updates.category.length === 0) {
          params.delete("category");
        } else {
          params.set("category", updates.category.join(","));
        }
      }

      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  const clearFilters = () => {
    updateFilters({ type: null, language: null, category: [] });
  };

  return (
    <Sidebar
      className="top-[--header-height] !h-[calc(100svh-var(--header-height))]"
      collapsible="icon"
      variant="sidebar"
    >
      <SidebarContent className="pt-6 lg:pt-8 pl-2">
        <SidebarGroup>
          <SidebarGroupLabel>Filters</SidebarGroupLabel>
          <SidebarMenu>
            {/* Type Filter */}
            <SidebarMenuItem>
              <div className="px-2 py-1.5 space-y-2">
                <Label className="text-xs text-muted-foreground">Type</Label>
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="type-template"
                      checked={typeFilter === "template"}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          updateFilters({ type: "template" });
                        } else {
                          updateFilters({ type: null });
                        }
                      }}
                    />
                    <Label
                      htmlFor="type-template"
                      className="text-sm font-normal cursor-pointer"
                    >
                      Templates
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="type-app"
                      checked={typeFilter === "app"}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          updateFilters({ type: "app" });
                        } else {
                          updateFilters({ type: null });
                        }
                      }}
                    />
                    <Label
                      htmlFor="type-app"
                      className="text-sm font-normal cursor-pointer"
                    >
                      Apps
                    </Label>
                  </div>
                </div>
              </div>
            </SidebarMenuItem>

            {/* Language Filter */}
            <SidebarMenuItem>
              <div className="px-2 py-1.5 space-y-2">
                <Label className="text-xs text-muted-foreground">
                  Language
                </Label>
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="language-typescript"
                      checked={languageFilter === "typescript"}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          updateFilters({ language: "typescript" });
                        } else {
                          updateFilters({ language: null });
                        }
                      }}
                    />
                    <Label
                      htmlFor="language-typescript"
                      className="text-sm font-normal cursor-pointer"
                    >
                      TypeScript
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="language-python"
                      checked={languageFilter === "python"}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          updateFilters({ language: "python" });
                        } else {
                          updateFilters({ language: null });
                        }
                      }}
                    />
                    <Label
                      htmlFor="language-python"
                      className="text-sm font-normal cursor-pointer"
                    >
                      Python
                    </Label>
                  </div>
                </div>
              </div>
            </SidebarMenuItem>

            {/* Category Filter */}
            <SidebarMenuItem>
              <div className="px-2 py-1.5 space-y-2">
                <Label className="text-xs text-muted-foreground">
                  Category
                </Label>
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="category-starter"
                      checked={categoryFilter.includes("starter")}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          updateFilters({
                            category: [...categoryFilter, "starter"],
                          });
                        } else {
                          updateFilters({
                            category: categoryFilter.filter(
                              (c) => c !== "starter",
                            ),
                          });
                        }
                      }}
                    />
                    <Label
                      htmlFor="category-starter"
                      className="text-sm font-normal cursor-pointer"
                    >
                      Starter
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="category-framework"
                      checked={categoryFilter.includes("framework")}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          updateFilters({
                            category: [...categoryFilter, "framework"],
                          });
                        } else {
                          updateFilters({
                            category: categoryFilter.filter(
                              (c) => c !== "framework",
                            ),
                          });
                        }
                      }}
                    />
                    <Label
                      htmlFor="category-framework"
                      className="text-sm font-normal cursor-pointer"
                    >
                      Framework
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="category-example"
                      checked={categoryFilter.includes("example")}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          updateFilters({
                            category: [...categoryFilter, "example"],
                          });
                        } else {
                          updateFilters({
                            category: categoryFilter.filter(
                              (c) => c !== "example",
                            ),
                          });
                        }
                      }}
                    />
                    <Label
                      htmlFor="category-example"
                      className="text-sm font-normal cursor-pointer"
                    >
                      Example
                    </Label>
                  </div>
                </div>
              </div>
            </SidebarMenuItem>

            {/* Clear Filters Button */}
            {hasActiveFilters && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="w-full justify-start"
                  onClick={clearFilters}
                >
                  <IconX className="mr-2 h-4 w-4" />
                  Clear Filters
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
