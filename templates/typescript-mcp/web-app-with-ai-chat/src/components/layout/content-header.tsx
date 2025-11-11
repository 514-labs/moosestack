"use client";

import { ThemeToggle } from "@/components/theme-toggle";

export function ContentHeader() {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center justify-end px-4">
        <ThemeToggle />
      </div>
    </header>
  );
}
