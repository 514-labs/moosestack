"use client";

import { ThemeToggle } from "@/components/theme-toggle";

export function ContentHeader() {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background">
      <div className="flex h-14 items-center justify-between px-4">
        <span className="text-sm font-semibold">Financial Analytics</span>
        <ThemeToggle />
      </div>
    </header>
  );
}
