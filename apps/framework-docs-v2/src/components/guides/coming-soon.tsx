import { IconBook, IconSparkles } from "@tabler/icons-react";

export function GuidesComingSoon() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] text-center px-4">
      <div className="relative mb-6">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/20 to-primary/5 blur-3xl rounded-full" />
        <div className="relative bg-gradient-to-br from-muted to-muted/50 rounded-2xl p-6 border border-border/50">
          <IconBook className="h-12 w-12 text-primary" strokeWidth={1.5} />
        </div>
      </div>

      <h1 className="text-3xl font-bold tracking-tight mb-3">
        Guides Coming Soon
      </h1>

      <p className="text-muted-foreground max-w-md mb-6 text-lg">
        We&apos;re crafting comprehensive guides to help you build powerful
        data-intensive applications with MooseStack.
      </p>

      <div className="flex flex-col sm:flex-row gap-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <IconSparkles className="h-4 w-4 text-primary" />
          <span>Application patterns</span>
        </div>
        <div className="flex items-center gap-2">
          <IconSparkles className="h-4 w-4 text-primary" />
          <span>Data management</span>
        </div>
        <div className="flex items-center gap-2">
          <IconSparkles className="h-4 w-4 text-primary" />
          <span>Best practices</span>
        </div>
      </div>

      <p className="text-sm text-muted-foreground/70 mt-8">
        Check back soon or explore our{" "}
        <a
          href="/moosestack"
          className="text-primary hover:underline underline-offset-4"
        >
          documentation
        </a>{" "}
        in the meantime.
      </p>
    </div>
  );
}
