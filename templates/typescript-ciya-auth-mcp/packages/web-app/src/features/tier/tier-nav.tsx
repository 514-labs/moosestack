"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tiers = [
  { href: "/tier1", label: "Tier 1" },
  { href: "/tier2", label: "Tier 2" },
  { href: "/tier3", label: "Tier 3" },
];

export function TierNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-12 items-center gap-4 px-4">
        <Link
          href="/"
          className="text-sm font-medium hover:text-foreground text-muted-foreground transition-colors"
        >
          &larr; Home
        </Link>
        <div className="h-4 w-px bg-border" />
        {tiers.map((tier) => {
          const isActive = pathname.startsWith(tier.href);
          return (
            <Link
              key={tier.href}
              href={tier.href}
              className={`text-sm font-medium transition-colors ${
                isActive ? "text-foreground" : (
                  "text-muted-foreground hover:text-foreground"
                )
              }`}
            >
              {tier.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
