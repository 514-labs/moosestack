"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { NavItem } from "@/lib/content";
import { useState } from "react";

interface SideNavProps {
  items: NavItem[];
  language: "typescript" | "python";
}

export function SideNav({ items, language }: SideNavProps) {
  return (
    <aside className="fixed top-14 z-30 hidden h-[calc(100vh-3.5rem)] w-64 shrink-0 overflow-y-auto border-r md:sticky md:block">
      <div className="py-6 px-4">
        <nav className="space-y-1">
          {items.map((item) => (
            <NavItemComponent key={item.slug} item={item} language={language} />
          ))}
        </nav>
      </div>
    </aside>
  );
}

function NavItemComponent({
  item,
  language,
  level = 0,
}: {
  item: NavItem;
  language: string;
  level?: number;
}) {
  const pathname = usePathname();
  const href = `/${language}/${item.slug}`;
  const isActive = pathname === href;
  const hasChildren = item.children && item.children.length > 0;
  const [isOpen, setIsOpen] = useState(
    isActive || (hasChildren && item.children?.some((child) => pathname.includes(child.slug))),
  );

  if (hasChildren) {
    return (
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger
          className={cn(
            "flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent",
            isActive && "bg-accent",
          )}
          style={{ paddingLeft: `${level * 12 + 12}px` }}
        >
          <span>{item.title}</span>
          <ChevronRight
            className={cn(
              "h-4 w-4 transition-transform",
              isOpen && "rotate-90",
            )}
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-1 space-y-1">
            {item.children?.map((child) => (
              <NavItemComponent
                key={child.slug}
                item={child}
                language={language}
                level={level + 1}
              />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <Link
      href={href}
      className={cn(
        "block rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent",
        isActive && "bg-accent text-accent-foreground",
      )}
      style={{ paddingLeft: `${level * 12 + 12}px` }}
    >
      {item.title}
    </Link>
  );
}

