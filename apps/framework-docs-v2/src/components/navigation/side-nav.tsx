"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { IconChevronRight, IconArrowRight } from "@tabler/icons-react";
import type { NavItem, NavPage, NavFilterFlags } from "@/config/navigation";
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
  SidebarMenuSubLabel,
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
  flags?: NavFilterFlags;
}

// Context to share navigation state without prop drilling hooks
interface NavContextValue {
  pathname: string;
  baseHref: string; // Pre-computed href base with lang param
  activeDescendants: Set<string>; // Pre-computed set of all active descendant slugs
}

const NavContext = React.createContext<NavContextValue | null>(null);

function useNavContext() {
  const context = React.useContext(NavContext);
  if (!context) {
    throw new Error("useNavContext must be used within NavContext.Provider");
  }
  return context;
}

// Pre-compute all active descendant slugs for the entire tree
function computeActiveDescendants(
  items: NavItem[],
  pathname: string,
): Set<string> {
  const activeSet = new Set<string>();

  function findActiveAndMarkAncestors(
    navItems: NavItem[],
    ancestors: string[],
  ): boolean {
    let hasActiveChild = false;

    for (const item of navItems) {
      if (item.type === "page") {
        const isActive = pathname === `/${item.slug}`;
        let childHasActive = false;

        if (item.children) {
          childHasActive = findActiveAndMarkAncestors(item.children, [
            ...ancestors,
            item.slug,
          ]);
        }

        if (isActive || childHasActive) {
          hasActiveChild = true;
          // Mark all ancestors as having active descendants
          for (const ancestor of ancestors) {
            activeSet.add(ancestor);
          }
          if (childHasActive) {
            activeSet.add(item.slug);
          }
        }
      } else if (item.type === "section" && item.items) {
        if (findActiveAndMarkAncestors(item.items, ancestors)) {
          hasActiveChild = true;
        }
      }
    }

    return hasActiveChild;
  }

  findActiveAndMarkAncestors(items, []);
  return activeSet;
}

export function SideNav({ items, flags }: SideNavProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
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

  // Pre-compute base href with lang param (done once, not per item)
  const baseHref = React.useMemo(() => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("lang", language);
    return `?${params.toString()}`;
  }, [searchParams, language]);

  // Pre-compute all active descendants for the entire tree
  const activeDescendants = React.useMemo(
    () => computeActiveDescendants(filteredItems, pathname),
    [filteredItems, pathname],
  );

  // Memoize context value to prevent unnecessary re-renders
  const navContextValue = React.useMemo(
    () => ({ pathname, baseHref, activeDescendants }),
    [pathname, baseHref, activeDescendants],
  );

  // Memoize the rendered nav items
  const renderedNavItems = React.useMemo(() => {
    const elements: React.ReactNode[] = [];
    let currentGroup: NavPage[] = [];
    let currentLabel: string | null = null;

    const flushGroup = () => {
      if (currentGroup.length > 0) {
        elements.push(
          <SidebarGroup key={`group-${elements.length}`}>
            {currentLabel && (
              <SidebarGroupLabel className="text-xs text-muted-foreground py-1.5">
                {currentLabel}
              </SidebarGroupLabel>
            )}
            <SidebarMenu>
              {currentGroup.map((page) => (
                <MemoizedNavItemComponent key={page.slug} item={page} />
              ))}
            </SidebarMenu>
          </SidebarGroup>,
        );
        currentGroup = [];
        currentLabel = null;
      }
    };

    filteredItems.forEach((item, index) => {
      if (item.type === "separator") {
        flushGroup();
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
                    <MemoizedNavItemComponent
                      key={pageItem.slug}
                      item={pageItem}
                    />
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
  }, [filteredItems]);

  return (
    <NavContext.Provider value={navContextValue}>
      <Sidebar
        className="top-[--header-height] !h-[calc(100svh-var(--header-height))]"
        collapsible="icon"
        variant="sidebar"
      >
        <SidebarContent className="pt-6 lg:pt-8 pl-2">
          {renderedNavItems}
        </SidebarContent>
      </Sidebar>
    </NavContext.Provider>
  );
}

interface NavItemComponentProps {
  item: NavPage;
}

function NavItemComponent({ item }: NavItemComponentProps) {
  const { pathname, baseHref, activeDescendants } = useNavContext();

  // Use pre-computed href base
  const href = `/${item.slug}${baseHref}`;
  const isActive = pathname === `/${item.slug}`;
  const hasChildren = item.children && item.children.length > 0;

  // Use pre-computed active descendants
  const hasActiveDescendant = activeDescendants.has(item.slug);

  const defaultOpen = isActive || hasActiveDescendant;
  const [isOpen, setIsOpen] = React.useState(defaultOpen);

  // Update open state when active state changes
  React.useEffect(() => {
    if (isActive || hasActiveDescendant) {
      setIsOpen(true);
    }
  }, [isActive, hasActiveDescendant]);

  if (hasChildren) {
    return (
      <Collapsible asChild open={isOpen} onOpenChange={setIsOpen}>
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
                  <MemoizedNavChildren items={item.children} />
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

// Memoize to prevent re-renders when parent context changes but item props are same
const MemoizedNavItemComponent = React.memo(NavItemComponent);

interface NestedNavItemComponentProps {
  item: NavPage;
}

function NestedNavItemComponent({ item }: NestedNavItemComponentProps) {
  const { pathname, baseHref, activeDescendants } = useNavContext();

  const childHasChildren = item.children && item.children.length > 0;
  const childHref = `/${item.slug}${baseHref}`;
  const childIsActive = pathname === `/${item.slug}`;

  // Use pre-computed active descendants
  const hasActiveDescendant = activeDescendants.has(item.slug);
  const defaultOpen = childIsActive || hasActiveDescendant;
  const [isOpen, setIsOpen] = React.useState(defaultOpen);

  React.useEffect(() => {
    if (childIsActive || hasActiveDescendant) {
      setIsOpen(true);
    }
  }, [childIsActive, hasActiveDescendant]);

  if (childHasChildren) {
    return (
      <Collapsible asChild open={isOpen} onOpenChange={setIsOpen}>
        <SidebarMenuSubItem className="group/menu-item">
          <SidebarMenuSubButton
            asChild
            isActive={childIsActive}
            className="peer/menu-button"
          >
            <Link href={childHref}>
              {item.icon && <item.icon className="mr-2 h-4 w-4" />}
              <span>{item.title}</span>
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
              <MemoizedNavChildren items={item.children!} />
            </SidebarMenuSub>
          </CollapsibleContent>
        </SidebarMenuSubItem>
      </Collapsible>
    );
  }

  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton asChild isActive={childIsActive}>
        <Link href={childHref}>
          {item.icon && <item.icon className="mr-2 h-4 w-4" />}
          <span>{item.title}</span>
        </Link>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
}

const MemoizedNestedNavItemComponent = React.memo(NestedNavItemComponent);

interface NavChildrenProps {
  items: NavItem[];
}

function NavChildren({ items }: NavChildrenProps) {
  const elements: React.ReactNode[] = [];
  let isFirstLabel = true;

  items.forEach((child, index) => {
    if (child.type === "label") {
      elements.push(
        <SidebarMenuSubLabel key={`label-${index}`} isFirst={isFirstLabel}>
          {child.title}
        </SidebarMenuSubLabel>,
      );
      isFirstLabel = false;
    } else if (child.type === "separator") {
      // Separators are handled via label spacing - skip rendering them
      return;
    } else if (child.type === "page") {
      elements.push(
        <MemoizedNestedNavItemComponent key={child.slug} item={child} />,
      );
    }
  });

  return <>{elements}</>;
}

const MemoizedNavChildren = React.memo(NavChildren);
