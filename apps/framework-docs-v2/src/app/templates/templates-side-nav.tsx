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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
  const typeParam = searchParams.get("type");
  const typeFilter: TypeFilter =
    typeParam === "template" || typeParam === "app" ? typeParam : null;
  const languageParam = searchParams.get("language");
  const languageFilter: LanguageFilter =
    languageParam === "typescript" || languageParam === "python" ?
      languageParam
    : null;
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
  const searchQuery = searchParams.get("q") || "";

  const hasActiveFilters =
    typeFilter !== null ||
    languageFilter !== null ||
    categoryFilter.length > 0 ||
    searchQuery.trim() !== "";

  // Update URL params when filters change
  const updateFilters = React.useCallback(
    (updates: {
      type?: TypeFilter;
      language?: LanguageFilter;
      category?: CategoryFilter;
      q?: string;
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

      if (updates.q !== undefined) {
        if (updates.q === "") {
          params.delete("q");
        } else {
          params.set("q", updates.q);
        }
      }

      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  const clearFilters = () => {
    updateFilters({ type: null, language: null, category: [], q: "" });
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
                <RadioGroup
                  value={typeFilter || ""}
                  onValueChange={(value: string) => {
                    if (value === "") {
                      updateFilters({ type: null });
                    } else {
                      updateFilters({
                        type:
                          value === "template" || value === "app" ?
                            value
                          : null,
                      });
                    }
                  }}
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="template" id="type-template" />
                    <Label
                      htmlFor="type-template"
                      className="text-sm font-normal cursor-pointer"
                    >
                      Templates
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="app" id="type-app" />
                    <Label
                      htmlFor="type-app"
                      className="text-sm font-normal cursor-pointer"
                    >
                      Apps
                    </Label>
                  </div>
                </RadioGroup>
              </div>
            </SidebarMenuItem>

            {/* Language Filter */}
            <SidebarMenuItem>
              <div className="px-2 py-1.5 space-y-2">
                <Label className="text-xs text-muted-foreground">
                  Language
                </Label>
                <RadioGroup
                  value={languageFilter || ""}
                  onValueChange={(value: string) => {
                    if (value === "") {
                      updateFilters({ language: null });
                    } else {
                      updateFilters({
                        language:
                          value === "typescript" || value === "python" ?
                            value
                          : null,
                      });
                    }
                  }}
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem
                      value="typescript"
                      id="language-typescript"
                    />
                    <Label
                      htmlFor="language-typescript"
                      className="text-sm font-normal cursor-pointer"
                    >
                      TypeScript
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="python" id="language-python" />
                    <Label
                      htmlFor="language-python"
                      className="text-sm font-normal cursor-pointer"
                    >
                      Python
                    </Label>
                  </div>
                </RadioGroup>
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
