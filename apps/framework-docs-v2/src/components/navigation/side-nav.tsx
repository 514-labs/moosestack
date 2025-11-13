"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { IconChevronRight } from "@tabler/icons-react";
import type { NavItem, NavPage } from "@/config/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useLanguage } from "@/hooks/use-language";
import {
  buildNavItems,
  getNavigationConfig,
  getSectionFromPathname,
} from "@/config/navigation";

interface SideNavProps {
  // Optional: can pass filtered items or let component filter by language
  items?: NavItem[];
}

export function SideNav({ items }: SideNavProps) {
  const pathname = usePathname();
  const { language } = useLanguage();

  // Determine active section and get its navigation config
  const activeSection = getSectionFromPathname(pathname);
  const sectionNavConfig =
    activeSection !== null ? getNavigationConfig(activeSection) : [];

  // Filter by language if items not provided
  const filteredItems = React.useMemo(
    () => items ?? buildNavItems(sectionNavConfig, language),
    [items, language, sectionNavConfig],
  );

  // Group items: pages that appear between separators should be in the same SidebarGroup
  const renderNavItems = () => {
    const elements: React.ReactNode[] = [];
    let currentGroup: NavItem[] = [];
    let currentLabel: string | null = null;

    const flushGroup = () => {
      if (currentGroup.length > 0) {
        const pages = currentGroup.filter(
          (item): item is NavPage => item.type === "page",
        );
        if (pages.length > 0) {
          elements.push(
            <SidebarGroup key={`group-${elements.length}`}>
              {currentLabel && (
                <SidebarGroupLabel className="text-xs text-muted-foreground py-1.5">
                  {currentLabel}
                </SidebarGroupLabel>
              )}
              <SidebarMenu>
                {pages.map((page) => (
                  <NavItemComponent key={page.slug} item={page} />
                ))}
              </SidebarMenu>
            </SidebarGroup>,
          );
        }
        currentGroup = [];
        currentLabel = null;
      }
    };

    filteredItems.forEach((item, index) => {
      if (item.type === "separator") {
        flushGroup();
        // Separators are skipped - only flush the group for proper grouping
      } else if (item.type === "label") {
        flushGroup();
        currentLabel = item.title;
      } else if (item.type === "page") {
        currentGroup.push(item);
      } else if (item.type === "section") {
        flushGroup();
        elements.push(
          <SidebarGroup key={`section-${index}`}>
            <SidebarGroupLabel>
              {item.icon && <item.icon className="mr-2 h-4 w-4" />}
              {item.title}
            </SidebarGroupLabel>
            <SidebarMenu>
              {item.items.map((pageItem) => {
                if (pageItem.type === "page") {
                  return (
                    <NavItemComponent key={pageItem.slug} item={pageItem} />
                  );
                }
                return null;
              })}
            </SidebarMenu>
          </SidebarGroup>,
        );
      }
    });

    flushGroup();
    return elements;
  };

  return (
    <Sidebar
      className="top-[--header-height] !h-[calc(100svh-var(--header-height))]"
      collapsible="icon"
      variant="sidebar"
    >
      <SidebarContent className="pt-6 lg:pt-8">
        {renderNavItems()}
      </SidebarContent>
    </Sidebar>
  );
}

function NavItemComponent({ item }: { item: NavPage }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { language } = useLanguage();

  const href = (() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("lang", language);
    return `/${item.slug}?${params.toString()}`;
  })();

  const isActive = pathname === `/${item.slug}`;
  const hasChildren = item.children && item.children.length > 0;
  const hasActiveChild =
    hasChildren &&
    item.children?.some(
      (child) => child.type === "page" && pathname === `/${child.slug}`,
    );
  const defaultOpen = isActive || hasActiveChild;

  if (hasChildren) {
    return (
      <Collapsible key={item.slug} asChild defaultOpen={defaultOpen}>
        <SidebarMenuItem>
          <SidebarMenuButton asChild tooltip={item.title}>
            <Link href={href}>
              {item.icon && <item.icon className="mr-2 h-4 w-4" />}
              <span>{item.title}</span>
            </Link>
          </SidebarMenuButton>
          {item.children?.length ?
            <>
              <CollapsibleTrigger asChild>
                <SidebarMenuAction className="data-[state=open]:rotate-90">
                  <IconChevronRight />
                  <span className="sr-only">Toggle</span>
                </SidebarMenuAction>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SidebarMenuSub>
                  {(() => {
                    const elements: React.ReactNode[] = [];
                    let currentGroup: NavPage[] = [];
                    let currentLabel: string | null = null;

                    const flushGroup = () => {
                      if (currentGroup.length > 0) {
                        currentGroup.forEach((child: NavPage) => {
                          const childHref = (() => {
                            const params = new URLSearchParams(
                              searchParams.toString(),
                            );
                            params.set("lang", language);
                            return `/${child.slug}?${params.toString()}`;
                          })();
                          const childIsActive = pathname === `/${child.slug}`;
                          elements.push(
                            <SidebarMenuSubItem key={child.slug}>
                              <SidebarMenuSubButton
                                asChild
                                isActive={childIsActive}
                              >
                                <Link href={childHref}>
                                  {child.icon && (
                                    <child.icon className="mr-2 h-4 w-4" />
                                  )}
                                  <span>{child.title}</span>
                                </Link>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>,
                          );
                        });
                        currentGroup = [];
                      }
                    };

                    item.children?.forEach((child) => {
                      if (child.type === "separator") {
                        flushGroup();
                        currentLabel = null;
                      } else if (child.type === "label") {
                        flushGroup();
                        currentLabel = child.title;
                      } else if (child.type === "page") {
                        if (currentLabel && currentGroup.length === 0) {
                          // Add label before first item in group
                          elements.push(
                            <SidebarGroupLabel
                              key={`label-${currentLabel}`}
                              className="text-xs text-muted-foreground py-1.5"
                            >
                              {currentLabel}
                            </SidebarGroupLabel>,
                          );
                        }
                        currentGroup.push(child);
                      }
                    });
                    flushGroup();
                    return elements;
                  })()}
                </SidebarMenuSub>
              </CollapsibleContent>
            </>
          : null}
        </SidebarMenuItem>
      </Collapsible>
    );
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild tooltip={item.title} isActive={isActive}>
        <Link href={href}>
          {item.icon && <item.icon className="mr-2 h-4 w-4" />}
          <span>{item.title}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
