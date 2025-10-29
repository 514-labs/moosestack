"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SearchBar } from "@/components/search/SearchBar";

export function TopNav() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const currentLanguage =
    pathname?.startsWith("/typescript") ? "typescript"
    : pathname?.startsWith("/python") ? "python"
    : "typescript";

  const navItems = [
    { label: "MooseStack", href: `/${currentLanguage}` },
    { label: "Hosting", href: "https://www.fiveonefour.com/boreal", external: true },
    { label: "AI", href: `/${currentLanguage}/ai` },
  ];

  return (
    <nav className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-6">
          <Link href={`/${currentLanguage}`} className="flex items-center space-x-2">
            <span className="text-xl font-bold">MooseStack</span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-6">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                target={item.external ? "_blank" : undefined}
                rel={item.external ? "noopener noreferrer" : undefined}
                className={cn(
                  "text-sm font-medium transition-colors hover:text-primary",
                  pathname === item.href ? "text-primary" : "text-muted-foreground",
                )}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>

        {/* Right side: Search + Language Switcher */}
        <div className="flex items-center gap-4">
          <div className="hidden md:block">
            <SearchBar />
          </div>
          
          <LanguageSwitcher currentLanguage={currentLanguage} />

          {/* Mobile Menu Button */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            <Menu className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t">
          <div className="container py-4 space-y-4">
            <SearchBar />
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                target={item.external ? "_blank" : undefined}
                rel={item.external ? "noopener noreferrer" : undefined}
                className="block py-2 text-sm font-medium"
                onClick={() => setMobileMenuOpen(false)}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}

function LanguageSwitcher({ currentLanguage }: { currentLanguage: string }) {
  const pathname = usePathname();

  const getOtherLanguageUrl = () => {
    if (!pathname) return "/python";
    
    if (currentLanguage === "typescript") {
      return pathname.replace("/typescript", "/python");
    } else {
      return pathname.replace("/python", "/typescript");
    }
  };

  return (
    <div className="flex items-center gap-1 rounded-md border p-1">
      <Link href={getOtherLanguageUrl().replace("/typescript", "/typescript")}>
        <Button
          variant={currentLanguage === "typescript" ? "secondary" : "ghost"}
          size="sm"
          className="text-xs"
        >
          TypeScript
        </Button>
      </Link>
      <Link href={getOtherLanguageUrl().replace("/python", "/python")}>
        <Button
          variant={currentLanguage === "python" ? "secondary" : "ghost"}
          size="sm"
          className="text-xs"
        >
          Python
        </Button>
      </Link>
    </div>
  );
}

