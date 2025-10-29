"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, BookOpen } from "lucide-react";
import type { NavItem } from "@/lib/content-types";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
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

interface SideNavProps {
  items: NavItem[];
  language: "typescript" | "python";
}

export function SideNav({ items, language }: SideNavProps) {
  const displayLanguage = language === "typescript" ? "TypeScript" : "Python";

  return (
    <Sidebar
      className="top-[--header-height] !h-[calc(100svh-var(--header-height))]"
      collapsible="icon"
      variant="sidebar"
    >
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href={`/${language}`}>
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <BookOpen className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Moose Docs</span>
                  <span className="truncate text-xs">{displayLanguage}</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Documentation</SidebarGroupLabel>
          <SidebarMenu>
            {items.map((item) => (
              <NavItemComponent
                key={item.slug}
                item={item}
                language={language}
              />
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

function NavItemComponent({
  item,
  language,
}: {
  item: NavItem;
  language: string;
}) {
  const pathname = usePathname();
  const href = `/${language}/${item.slug}`;
  const isActive = pathname === href;
  const hasChildren = item.children && item.children.length > 0;
  const hasActiveChild =
    hasChildren &&
    item.children?.some(
      (child: NavItem) => pathname === `/${language}/${child.slug}`,
    );
  const defaultOpen = isActive || hasActiveChild;

  if (hasChildren) {
    return (
      <Collapsible key={item.slug} asChild defaultOpen={defaultOpen}>
        <SidebarMenuItem>
          <SidebarMenuButton asChild tooltip={item.title}>
            <Link href={href}>
              <span>{item.title}</span>
            </Link>
          </SidebarMenuButton>
          {item.children?.length ?
            <>
              <CollapsibleTrigger asChild>
                <SidebarMenuAction className="data-[state=open]:rotate-90">
                  <ChevronRight />
                  <span className="sr-only">Toggle</span>
                </SidebarMenuAction>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SidebarMenuSub>
                  {item.children?.map((child: NavItem) => {
                    const childHref = `/${language}/${child.slug}`;
                    const childIsActive = pathname === childHref;
                    return (
                      <SidebarMenuSubItem key={child.slug}>
                        <SidebarMenuSubButton asChild isActive={childIsActive}>
                          <Link href={childHref}>
                            <span>{child.title}</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    );
                  })}
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
          <span>{item.title}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
