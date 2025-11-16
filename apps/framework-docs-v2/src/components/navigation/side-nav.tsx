"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { IconChevronRight, IconArrowRight } from "@tabler/icons-react";
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
  filterNavItemsByFlags,
} from "@/config/navigation";

interface SideNavProps {
  // Optional: can pass filtered items or let component filter by language
  items?: NavItem[];
  // Optional: feature flags to filter navigation items
  flags?: { showDataSourcesPage?: boolean };
}

export function SideNav({ items, flags }: SideNavProps) {
  const pathname = usePathname();
  const { language } = useLanguage();

  // Determine active section and get its navigation config
  const activeSection = getSectionFromPathname(pathname);
  const sectionNavConfig =
    activeSection !== null ? getNavigationConfig(activeSection) : [];

  // Filter by language if items not provided
  const languageFilteredItems = React.useMemo(
    () => items ?? buildNavItems(sectionNavConfig, language),
    [items, language, sectionNavConfig],
  );

  // Filter by feature flags if flags are provided
  const filteredItems = React.useMemo(() => {
    if (flags) {
      return filterNavItemsByFlags(languageFilteredItems, flags);
    }
    return languageFilteredItems;
  }, [languageFilteredItems, flags]);

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
      <SidebarContent className="pt-6 lg:pt-8 pl-2">
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

  // Recursively check if any descendant is active
  const hasActiveDescendant = React.useMemo(() => {
    if (!hasChildren) return false;

    const checkDescendant = (children: NavItem[]): boolean => {
      return children.some((child) => {
        if (child.type === "page") {
          if (pathname === `/${child.slug}`) return true;
          if (child.children) return checkDescendant(child.children);
        }
        return false;
      });
    };

    return checkDescendant(item.children!);
  }, [hasChildren, item.children, pathname]);

  const defaultOpen = isActive || hasActiveDescendant;

  if (hasChildren) {
    return (
      <Collapsible key={item.slug} asChild defaultOpen={defaultOpen}>
        <SidebarMenuItem>
          <SidebarMenuButton asChild tooltip={item.title} isActive={isActive}>
            <Link href={href}>
              {item.icon && <item.icon className="mr-2 h-4 w-4" />}
              <span>{item.title}</span>
              {item.external && <IconArrowRight className="ml-auto h-4 w-4" />}
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
                  {renderNavChildren(
                    item.children,
                    pathname,
                    searchParams,
                    language,
                  )}
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
          {item.external && <IconArrowRight className="ml-auto h-4 w-4" />}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function renderNavChildren(
  children: NavItem[],
  pathname: string,
  searchParams: URLSearchParams,
  language: string,
): React.ReactNode[] {
  const elements: React.ReactNode[] = [];
  let currentGroup: NavPage[] = [];
  let currentLabel: string | null = null;

  const flushGroup = () => {
    if (currentGroup.length > 0) {
      currentGroup.forEach((child: NavPage) => {
        const childHasChildren = child.children && child.children.length > 0;
        const childHref = (() => {
          const params = new URLSearchParams(searchParams.toString());
          params.set("lang", language);
          return `/${child.slug}?${params.toString()}`;
        })();
        const childIsActive = pathname === `/${child.slug}`;

        // Recursively check if any descendant is active
        const checkDescendant = (children: NavItem[]): boolean => {
          return children.some((c) => {
            if (c.type === "page") {
              if (pathname === `/${c.slug}`) return true;
              if (c.children) return checkDescendant(c.children);
            }
            return false;
          });
        };
        const hasActiveDescendant =
          childHasChildren ? checkDescendant(child.children!) : false;
        const defaultOpen = childIsActive || hasActiveDescendant;

        if (childHasChildren) {
          // Render nested collapsible item - using same pattern as top-level
          // SidebarMenuSubItem needs relative positioning for SidebarMenuAction
          elements.push(
            <Collapsible key={child.slug} asChild defaultOpen={defaultOpen}>
              <SidebarMenuSubItem className="group/menu-item ">
                <SidebarMenuSubButton
                  asChild
                  isActive={childIsActive}
                  className="peer/menu-button"
                >
                  <Link href={childHref}>
                    {child.icon && <child.icon className="mr-2 h-4 w-4" />}
                    <span>{child.title}</span>
                  </Link>
                </SidebarMenuSubButton>
                <CollapsibleTrigger asChild>
                  <SidebarMenuAction className="data-[state=open]:rotate-90">
                    <IconChevronRight />
                    <span className="sr-only">Toggle</span>
                  </SidebarMenuAction>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {renderNavChildren(
                      child.children!,
                      pathname,
                      searchParams,
                      language,
                    )}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuSubItem>
            </Collapsible>,
          );
        } else {
          // Render simple link for leaf nodes
          elements.push(
            <SidebarMenuSubItem key={child.slug}>
              <SidebarMenuSubButton asChild isActive={childIsActive}>
                <Link href={childHref}>
                  {child.icon && <child.icon className="mr-2 h-4 w-4" />}
                  <span>{child.title}</span>
                </Link>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>,
          );
        }
      });
      currentGroup = [];
    }
  };

  children.forEach((child) => {
    if (child.type === "separator") {
      flushGroup();
      currentLabel = null;
    } else if (child.type === "label") {
      flushGroup();
      currentLabel = child.title;
    } else if (child.type === "section") {
      flushGroup();
      // Check if any item in the section is active to determine default open state
      const hasActiveItem = child.items.some((item) => {
        if (item.type === "page") {
          return pathname === `/${item.slug}`;
        }
        return false;
      });

      // Render collapsible section within the submenu
      // We need to render the trigger and items as siblings, not nested
      const sectionItems: React.ReactNode[] = [];
      child.items.forEach((item) => {
        if (item.type === "page") {
          const itemHref = (() => {
            const params = new URLSearchParams(searchParams.toString());
            params.set("lang", language);
            return `/${item.slug}?${params.toString()}`;
          })();
          const itemIsActive = pathname === `/${item.slug}`;
          sectionItems.push(
            <SidebarMenuSubItem key={item.slug}>
              <SidebarMenuSubButton asChild isActive={itemIsActive}>
                <Link href={itemHref}>
                  {item.icon && <item.icon className="mr-2 h-4 w-4" />}
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>,
          );
        }
      });

      elements.push(
        <Collapsible
          key={`section-${child.title}`}
          defaultOpen={hasActiveItem}
          className="group/collapsible-section"
        >
          <SidebarMenuSubItem>
            <CollapsibleTrigger asChild>
              <SidebarMenuSubButton className="w-full justify-between">
                <span className="flex items-center">
                  {child.icon && (
                    <child.icon className="mr-2 h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="text-xs text-muted-foreground font-medium">
                    {child.title}
                  </span>
                </span>
                <IconChevronRight className="h-4 w-4 transition-transform group-data-[state=open]/collapsible-section:rotate-90" />
              </SidebarMenuSubButton>
            </CollapsibleTrigger>
          </SidebarMenuSubItem>
          <CollapsibleContent className="contents">
            {sectionItems}
          </CollapsibleContent>
        </Collapsible>,
      );
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
}
