"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

export function TemplatesCTA() {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border/50 bg-card p-6">
      <div className="flex flex-col gap-2">
        <h3 className="text-xl font-semibold text-foreground">
          Try Our Templates
        </h3>
        <p className="text-sm text-muted-foreground">1 Click Starter kits</p>
      </div>
      <Button variant="secondary" asChild className="w-fit">
        <Link href="/templates">Learn More</Link>
      </Button>
    </div>
  );
}
