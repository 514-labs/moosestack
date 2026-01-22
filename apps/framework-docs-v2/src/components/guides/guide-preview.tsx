interface GuidePreviewProps {
  variant?:
    | "chat"
    | "performance"
    | "dashboards"
    | "migrations"
    | "cdp"
    | "production";
  imagePath?: string;
  title: string;
}

export function GuidePreview({ variant, imagePath, title }: GuidePreviewProps) {
  // If image path provided, use it
  if (imagePath) {
    return (
      <div className="relative w-48 h-32 shrink-0 overflow-hidden rounded-lg border border-border bg-gradient-to-b from-muted/50 to-background">
        <img
          src={imagePath}
          alt={title}
          className="w-full h-full object-cover"
        />
      </div>
    );
  }

  // If no variant and no imagePath, return null
  if (!variant) {
    return null;
  }

  // Otherwise render skeleton variant
  const renderSkeleton = () => {
    switch (variant) {
      case "chat":
        return (
          <div className="w-full h-full flex flex-col gap-2.5 justify-center p-3">
            {/* Chat bubbles */}
            <div className="flex justify-end">
              <div className="w-2/3 h-8 border-2 border-border/50 rounded-xl rounded-tr-sm"></div>
            </div>
            <div className="flex justify-start">
              <div className="w-3/4 h-8 border-2 border-muted-foreground/30 rounded-xl rounded-tl-sm"></div>
            </div>
            <div className="flex justify-end">
              <div className="w-1/2 h-8 border-2 border-border/50 rounded-xl rounded-tr-sm"></div>
            </div>
          </div>
        );

      case "performance":
        return (
          <div className="flex gap-2.5 h-full items-center justify-center p-3">
            <div className="w-3/4 h-14 border-2 border-muted-foreground/30 rounded-xl"></div>
          </div>
        );

      case "dashboards":
        return (
          <div className="w-full h-full flex gap-2.5 p-3">
            <div className="flex-1 flex flex-col gap-2.5">
              <div className="flex gap-2.5">
                <div className="flex-1 h-8 border-2 border-border/50 rounded-xl"></div>
                <div className="flex-1 h-8 border-2 border-border/50 rounded-xl"></div>
                <div className="flex-1 h-8 border-2 border-border/50 rounded-xl"></div>
              </div>
              <div className="flex-1 border-2 border-border/50 rounded-xl"></div>
            </div>
            <div className="w-1/3 border-2 border-muted-foreground/30 rounded-xl"></div>
          </div>
        );

      case "migrations":
        return (
          <div className="flex items-center gap-3 h-full p-3">
            <div className="flex-1 h-14 border-2 border-border/50 rounded-xl"></div>
            <div className="text-muted-foreground text-2xl">→</div>
            <div className="flex-1 h-14 border-2 border-muted-foreground/30 rounded-xl"></div>
          </div>
        );

      case "cdp":
        return (
          <div className="relative w-full h-full p-3">
            {/* Center circle - highlighted */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 border-2 border-muted-foreground/30 rounded-full"></div>
            {/* Surrounding circles */}
            <div className="absolute top-3 left-1/2 -translate-x-1/2 w-8 h-8 border-2 border-border/50 rounded-full"></div>
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-8 h-8 border-2 border-border/50 rounded-full"></div>
            <div className="absolute left-3 top-1/2 -translate-y-1/2 w-8 h-8 border-2 border-border/50 rounded-full"></div>
            <div className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 border-2 border-border/50 rounded-full"></div>
          </div>
        );

      case "production":
        return (
          <div className="flex items-center gap-2.5 h-full justify-center p-3">
            {/* Deployment pipeline: 3 stages with arrows */}
            <div className="flex-1 h-12 border-2 border-border/50 rounded-xl"></div>
            <div className="text-muted-foreground text-lg">→</div>
            <div className="flex-1 h-12 border-2 border-muted-foreground/30 rounded-xl"></div>
            <div className="text-muted-foreground text-lg">→</div>
            <div className="flex-1 h-12 border-2 border-border/50 rounded-xl"></div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="relative w-48 h-32 shrink-0 overflow-hidden rounded-lg border border-border bg-gradient-to-b from-muted/50 to-background">
      {/* Glow effect */}
      <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />

      {/* Subtle grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage: `
            linear-gradient(to right, currentColor 1px, transparent 1px),
            linear-gradient(to bottom, currentColor 1px, transparent 1px)
          `,
          backgroundSize: "16px 16px",
        }}
      />

      {/* Skeleton Content */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="bg-card/50 w-full h-full border border-border/30 rounded-lg overflow-hidden">
          {renderSkeleton()}
        </div>
      </div>
    </div>
  );
}
