import Image from "next/image";

export type PreviewVariant =
  | "chat"
  | "performance"
  | "dashboards"
  | "migrations"
  | "cdp"
  | "production";

export interface GuidePreviewProps {
  variant?: PreviewVariant;
  imagePath?: string;
  title: string;
}

export function GuidePreview({ variant, imagePath, title }: GuidePreviewProps) {
  // If image path provided, use it
  if (imagePath) {
    return (
      <div className="relative w-full h-[200px] md:w-48 md:h-[108px] shrink-0 overflow-hidden rounded-md border border-neutral-700">
        <Image src={imagePath} alt={title} fill className="object-cover" />
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
          <div className="w-full h-full flex gap-2.5 p-3">
            {/* Left section: 3 small boxes on top, 1 large box below */}
            <div className="flex-1 flex flex-col gap-2.5">
              <div className="flex gap-2.5 h-1/4">
                <div className="flex-1 border border-neutral-700 rounded mix-blend-luminosity"></div>
                <div className="flex-1 border border-neutral-700 rounded mix-blend-luminosity"></div>
                <div className="flex-1 border border-neutral-700 rounded mix-blend-luminosity"></div>
              </div>
              <div className="flex-1 border border-neutral-700 rounded mix-blend-luminosity"></div>
            </div>
            {/* Right section: tall box */}
            <div className="w-1/3 border border-neutral-500 rounded mix-blend-luminosity"></div>
          </div>
        );

      case "performance":
        return (
          <div className="flex gap-2.5 h-full items-center justify-center p-3">
            <div className="w-3/4 h-14 border border-neutral-500 rounded mix-blend-luminosity"></div>
          </div>
        );

      case "dashboards":
        return (
          <div className="w-full h-full flex flex-col gap-2.5 p-3">
            {/* Top row: 3 equal cards (lighter) - taller on mobile */}
            <div className="flex gap-2.5 h-[55%] md:h-8">
              <div className="flex-1 border border-neutral-500 rounded mix-blend-luminosity"></div>
              <div className="flex-1 border border-neutral-500 rounded mix-blend-luminosity"></div>
              <div className="flex-1 border border-neutral-500 rounded mix-blend-luminosity"></div>
            </div>
            {/* Bottom row: 2 equal cards */}
            <div className="flex gap-2.5 flex-1">
              <div className="flex-1 border border-neutral-700 rounded mix-blend-luminosity"></div>
              <div className="flex-1 border border-neutral-700 rounded mix-blend-luminosity"></div>
            </div>
          </div>
        );

      case "migrations":
        return (
          <div className="flex items-center gap-3 h-full p-3">
            <div className="flex-1 h-14 border border-neutral-500 rounded mix-blend-luminosity"></div>
            <div className="text-neutral-500 text-2xl">→</div>
            <div className="flex-1 h-14 border border-neutral-500 rounded mix-blend-luminosity"></div>
          </div>
        );

      case "cdp":
        return (
          <div className="relative w-full h-full p-3">
            {/* Center circle */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 border border-neutral-500 rounded-full mix-blend-luminosity"></div>
            {/* Surrounding circles */}
            <div className="absolute top-3 left-1/2 -translate-x-1/2 w-8 h-8 border border-neutral-500 rounded-full mix-blend-luminosity"></div>
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-8 h-8 border border-neutral-500 rounded-full mix-blend-luminosity"></div>
            <div className="absolute left-3 top-1/2 -translate-y-1/2 w-8 h-8 border border-neutral-500 rounded-full mix-blend-luminosity"></div>
            <div className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 border border-neutral-500 rounded-full mix-blend-luminosity"></div>
          </div>
        );

      case "production":
        return (
          <div className="flex items-center gap-2.5 h-full justify-center p-3">
            {/* Deployment pipeline: 3 stages with arrows */}
            <div className="flex-1 h-12 border border-neutral-500 rounded mix-blend-luminosity"></div>
            <div className="text-neutral-500 text-lg">→</div>
            <div className="flex-1 h-12 border border-neutral-500 rounded mix-blend-luminosity"></div>
            <div className="text-neutral-500 text-lg">→</div>
            <div className="flex-1 h-12 border border-neutral-500 rounded mix-blend-luminosity"></div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="relative w-full h-[200px] md:w-48 md:h-[108px] shrink-0 overflow-hidden rounded-md border border-neutral-700 bg-neutral-900">
      {renderSkeleton()}
    </div>
  );
}
