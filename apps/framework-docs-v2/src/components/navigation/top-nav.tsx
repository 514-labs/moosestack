"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { GitHubButtonGroup } from "@/components/github-button-group";
import { useLanguage } from "@/hooks/use-language";
import {
  getSectionFromPathname,
  type DocumentationSection,
} from "@/config/navigation";

export function TopNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { language } = useLanguage();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
  }> = [
    {
      label: "MooseStack",
      href: "/moosestack/overview",
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
  ];

  return (
    <>
      <nav className="sticky top-0 z-50 w-full border-b bg-background">
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
            <nav className="flex items-center space-x-6 text-sm">
              {navItems.map((item) => {
                const isActive = activeSection === item.section;
                return (
                  <Link
                    key={item.section}
                    href={item.external ? item.href : buildUrl(item.href)}
                    target={item.external ? "_blank" : undefined}
                    rel={item.external ? "noopener noreferrer" : undefined}
                    className={cn(
                      "transition-colors hover:text-foreground/80",
                      isActive ?
                        "text-foreground font-medium"
                      : "text-foreground/60",
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <div className="flex items-center space-x-2">
              <GitHubButtonGroup />
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
              <Menu className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </nav>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t">
          <div className="px-4 py-4 space-y-4">
            {navItems.map((item) => {
              const isActive = activeSection === item.section;
              return (
                <Link
                  key={item.section}
                  href={item.external ? item.href : buildUrl(item.href)}
                  target={item.external ? "_blank" : undefined}
                  rel={item.external ? "noopener noreferrer" : undefined}
                  className={cn("block text-sm", isActive && "font-medium")}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {item.label}
                </Link>
              );
            })}
            <div className="flex items-center justify-center space-x-2 pt-2 border-t">
              <ThemeToggle />
              <SidebarTrigger />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
