"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useState } from "react";
import { SearchBar } from "@/components/search/search-bar";

interface TopNavProps {
  language: "typescript" | "python";
}

export function TopNav({ language }: TopNavProps) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems = [
    { label: "MooseStack", href: `/${language}` },
    { label: "Hosting", href: "https://www.fiveonefour.com/boreal", external: true },
    { label: "AI", href: `/${language}/ai` },
  ];

  return (
    <>
      <SearchBar />
      <nav className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center">
        <div className="mr-4 flex">
          <Link href="/" className="mr-6 flex items-center space-x-2">
            <span className="font-bold">MooseStack</span>
          </Link>
        </div>

        {/* Desktop Navigation */}
        <div className="hidden md:flex md:flex-1 md:items-center md:justify-between">
          <nav className="flex items-center space-x-6 text-sm font-medium">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                target={item.external ? "_blank" : undefined}
                rel={item.external ? "noopener noreferrer" : undefined}
                className={cn(
                  "transition-colors hover:text-foreground/80",
                  pathname === item.href ? "text-foreground" : "text-foreground/60",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center space-x-4">
            {/* Language Switcher */}
            <div className="flex items-center space-x-2 text-sm">
              <Link
                href={pathname.replace(/\/(typescript|python)/, "/typescript")}
                className={cn(
                  "px-3 py-1 rounded-md transition-colors",
                  language === "typescript"
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent",
                )}
              >
                TypeScript
              </Link>
              <Link
                href={pathname.replace(/\/(typescript|python)/, "/python")}
                className={cn(
                  "px-3 py-1 rounded-md transition-colors",
                  language === "python"
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent",
                )}
              >
                Python
              </Link>
            </div>

            {/* Search Button */}
            <Button variant="outline" size="sm">
              <Search className="h-4 w-4 mr-2" />
              Search
              <kbd className="ml-2 pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
                <span className="text-xs">⌘</span>K
              </kbd>
            </Button>
          </div>
        </div>

        {/* Mobile Menu Button */}
        <div className="flex flex-1 items-center justify-end md:hidden">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            <Menu className="h-5 w-5" />
          </Button>
        </div>
      </nav>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t">
          <div className="container py-4 space-y-4">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                target={item.external ? "_blank" : undefined}
                rel={item.external ? "noopener noreferrer" : undefined}
                className="block text-sm font-medium"
                onClick={() => setMobileMenuOpen(false)}
              >
                {item.label}
              </Link>
            ))}
            <div className="flex space-x-2 pt-2">
              <Link
                href={pathname.replace(/\/(typescript|python)/, "/typescript")}
                className={cn(
                  "flex-1 px-3 py-2 text-center rounded-md text-sm transition-colors",
                  language === "typescript"
                    ? "bg-primary text-primary-foreground"
                    : "bg-accent",
                )}
              >
                TypeScript
              </Link>
              <Link
                href={pathname.replace(/\/(typescript|python)/, "/python")}
                className={cn(
                  "flex-1 px-3 py-2 text-center rounded-md text-sm transition-colors",
                  language === "python"
                    ? "bg-primary text-primary-foreground"
                    : "bg-accent",
                )}
              >
                Python
              </Link>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

