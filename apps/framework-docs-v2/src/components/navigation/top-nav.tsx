"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { IconMenu, IconSearch } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { GitHubButtonGroup } from "@/components/github-button-group";
import { useLanguage } from "@/hooks/use-language";
import {
  getSectionFromPathname,
  type DocumentationSection,
} from "@/config/navigation";
import { CommandSearch } from "@/components/search/command-search";

interface TopNavProps {
  stars: number | null;
}

export function TopNav({ stars }: TopNavProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { language } = useLanguage();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // Handle keyboard shortcut for search
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSearchOpen((open) => !open);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  // Determine active section from pathname
  const activeSection = getSectionFromPathname(pathname);

  // Helper to build URLs with language param
  const buildUrl = (path: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("lang", language);
    return `${path}?${params.toString()}`;
  };

  const navItems: Array<{
    label: string;
    href: string;
    section: DocumentationSection;
    external?: boolean;
    isActive?: (pathname: string) => boolean;
  }> = [
    {
      label: "MooseStack",
      href: "/moosestack",
      section: "moosestack",
    },
    {
      label: "Hosting",
      href: "/hosting/overview",
      section: "hosting",
    },
    {
      label: "AI",
      href: "/ai/overview",
      section: "ai",
    },
    {
      label: "Templates",
      href: "/moosestack/templates-examples",
      section: "moosestack",
      isActive: (pathname) => pathname.includes("/templates-examples"),
    },
  ];

  return (
    <>
      <nav className="sticky top-0 z-50 w-full bg-background">
        <div className="flex h-[--header-height] items-center px-4">
          <div className="mr-4 flex">
            <Link href="/" className="mr-6 flex items-center space-x-2">
              <span>
                Fiveonefour<span className="text-muted-foreground"> Docs</span>
              </span>
            </Link>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden md:flex md:flex-1 md:items-center md:justify-between">
            <nav className="flex items-center gap-2">
              {navItems.map((item, index) => {
                const isActive =
                  item.isActive ?
                    item.isActive(pathname)
                  : activeSection !== null && activeSection === item.section;
                return (
                  <Button
                    key={`${item.section}-${index}`}
                    variant={isActive ? "secondary" : "ghost"}
                    asChild
                  >
                    <Link
                      href={item.external ? item.href : buildUrl(item.href)}
                      target={item.external ? "_blank" : undefined}
                      rel={item.external ? "noopener noreferrer" : undefined}
                    >
                      {item.label}
                    </Link>
                  </Button>
                );
              })}
            </nav>

            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                className="relative h-9 w-full justify-start text-sm text-muted-foreground sm:pr-12 md:w-40 lg:w-64"
                onClick={() => setSearchOpen(true)}
              >
                <IconSearch className="mr-2 h-4 w-4" />
                <span className="hidden lg:inline-flex">
                  Search documentation...
                </span>
                <span className="inline-flex lg:hidden">Search...</span>
                <kbd className="pointer-events-none absolute right-1.5 top-1.5 hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
                  <span className="text-xs">⌘</span>K
                </kbd>
              </Button>
              <Button variant="ghost" asChild>
                <Link href={buildUrl("/moosestack/changelog")}>Changelog</Link>
              </Button>
              <GitHubButtonGroup stars={stars} />
              <ThemeToggle />
              <SidebarTrigger />
            </div>
          </div>

          {/* Mobile Menu Button */}
          <div className="flex flex-1 items-center justify-end md:hidden">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              <IconMenu className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </nav>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t">
          <div className="px-4 py-4 space-y-2">
            {navItems.map((item, index) => {
              const isActive =
                item.isActive ?
                  item.isActive(pathname)
                : activeSection !== null && activeSection === item.section;
              return (
                <Button
                  key={`${item.section}-${index}`}
                  variant={isActive ? "secondary" : "ghost"}
                  asChild
                  className="w-full justify-start"
                >
                  <Link
                    href={item.external ? item.href : buildUrl(item.href)}
                    target={item.external ? "_blank" : undefined}
                    rel={item.external ? "noopener noreferrer" : undefined}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    {item.label}
                  </Link>
                </Button>
              );
            })}
            <div className="flex items-center justify-center space-x-2 pt-2 border-t">
              <ThemeToggle />
              <SidebarTrigger />
            </div>
          </div>
        </div>
      )}

      <CommandSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}
