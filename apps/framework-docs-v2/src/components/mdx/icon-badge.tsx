import { cn } from "@/lib/utils";
import type { IconProps } from "@tabler/icons-react";
import * as TablerIcons from "@tabler/icons-react";

interface IconBadgeProps {
  Icon?:
    | React.ComponentType<IconProps>
    | React.FC<React.SVGProps<SVGSVGElement>>
    | string;
  label: string;
  variant?: "moose" | "boreal" | "sloan" | "default";
  rounded?: "md" | "full";
  className?: string;
}

export function IconBadge({
  Icon,
  label,
  variant = "moose",
  rounded = "md",
  className,
}: IconBadgeProps) {
  // If Icon is a string, look it up in Tabler icons
  const IconComponent =
    typeof Icon === "string" ? (TablerIcons as any)[`Icon${Icon}`] : Icon;

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 w-fit border text-xs font-medium",
        "bg-neutral-800 border-neutral-700 text-neutral-100",
        "px-2.5 py-1.5",
        rounded === "full" ? "rounded-full" : "rounded-md",
        className,
      )}
    >
      {IconComponent && <IconComponent className="w-3.5 h-3.5" />}
      <span>{label}</span>
    </div>
  );
}
