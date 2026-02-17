"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import { IconMenu, IconSearch } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
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
  showHosting: boolean;
  showAi: boolean;
}

export function TopNav({ stars, showHosting, showAi }: TopNavProps) {
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
    ...(showHosting ?
      [
        {
          label: "Hosting",
          href: "/hosting",
          section: "hosting" as DocumentationSection,
        },
      ]
    : []),
    ...(showAi ?
      [
        {
          label: "AI",
          href: "/ai/overview",
          section: "ai" as DocumentationSection,
        },
      ]
    : []),
    {
      label: "Templates",
      href: "/templates",
      section: "templates",
      isActive: (pathname: string) => pathname.startsWith("/templates"),
    },
    {
      label: "Guides",
      href: "/guides",
      section: "guides",
    },
  ];

  return (
    <>
      <nav className="sticky top-0 z-50 w-full bg-background">
        <div className="flex h-[--header-height] items-center px-4">
          <div className="mr-4 flex items-center gap-2">
            <Link
              href="https://www.fiveonefour.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center px-2"
            >
              <Image
                src="/logo-light.png"
                alt="Fiveonefour"
                width={32}
                height={32}
                className="h-4 w-4 object-cover hidden dark:block"
                priority
              />
              <Image
                src="/logo-dark.png"
                alt="Fiveonefour"
                width={32}
                height={32}
                className="h-4 w-4 object-cover block dark:hidden"
                priority
              />
            </Link>
            <Separator orientation="vertical" className="h-4" />
            <Link href="/" className="flex items-center ml-2">
              <span className="text-sm">
                Fiveonefour<span className="text-muted-foreground"> Docs</span>
              </span>
            </Link>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden xl:flex xl:flex-1 xl:items-center xl:justify-between">
            <nav className="flex items-center gap-2 overflow-hidden">
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
                    className="shrink-0 min-w-fit"
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
                className="relative h-9 w-full justify-start text-sm text-muted-foreground sm:pr-14 xl:w-64"
                onClick={() => setSearchOpen(true)}
              >
                <IconSearch className="mr-2 h-4 w-4" />
                <span className="inline-flex">Search documentation</span>
                <kbd className="pointer-events-none hidden h-5 select-none items-center gap-1 ml-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
                  <span className="text-xs">⌘</span>K
                </kbd>
              </Button>
              <Button variant="ghost" asChild>
                <Link href={buildUrl("/moosestack/release-notes")}>
                  Release Notes
                </Link>
              </Button>
              <GitHubButtonGroup stars={stars} />
              <ThemeToggle />
              <SidebarTrigger />
            </div>
          </div>

          {/* Mobile Menu Button */}
          <div className="flex flex-1 items-center justify-end xl:hidden">
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
        <div className="xl:hidden border-t">
          <div className="px-4 py-4 space-y-2">
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => {
                setSearchOpen(true);
                setMobileMenuOpen(false);
              }}
            >
              <IconSearch className="mr-2 h-4 w-4" />
              Search documentation
            </Button>
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
            <Button variant="ghost" asChild className="w-full justify-start">
              <Link
                href={buildUrl("/moosestack/release-notes")}
                onClick={() => setMobileMenuOpen(false)}
              >
                Release Notes
              </Link>
            </Button>
            <div className="flex items-center justify-between pt-2 border-t">
              <div className="flex items-center space-x-2">
                <ThemeToggle />
                <SidebarTrigger />
              </div>
              <GitHubButtonGroup stars={stars} />
            </div>
          </div>
        </div>
      )}

      <CommandSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}
