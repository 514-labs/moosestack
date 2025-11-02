"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { NavItem } from "@/lib/content";

interface SideNavProps {
  items: NavItem[];
  language: "typescript" | "python";
}

export function SideNav({ items, language }: SideNavProps) {
  return (
    <aside className="hidden lg:block w-64 border-r">
      <ScrollArea className="h-[calc(100vh-4rem)] py-6 px-4">
        <nav className="space-y-1">
          {items.map((item) => (
            <NavItemComponent key={item.slug.join("/")} item={item} language={language} />
          ))}
        </nav>
      </ScrollArea>
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
  const [isOpen, setIsOpen] = useState(true);

  const href = `/${language}/${item.slug.join("/")}`;
  const isActive = pathname === href;
  const hasChildren = item.children && item.children.length > 0;

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
          level > 0 && "ml-4",
          isActive
            ? "bg-secondary text-secondary-foreground font-medium"
            : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
        )}
      >
        {hasChildren && (
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="shrink-0"
            aria-label={isOpen ? "Collapse" : "Expand"}
          >
            {isOpen ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        )}
        {!hasChildren && <span className="w-4" />}
        <Link href={href} className="flex-1 truncate">
          {item.title}
        </Link>
      </div>

      {hasChildren && isOpen && (
        <div className="mt-1">
          {item.children?.map((child) => (
            <NavItemComponent
              key={child.slug.join("/")}
              item={child}
              language={language}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

