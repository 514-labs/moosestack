import { Badge } from "@/components/ui";
import { cn } from "@/lib/utils";

interface CustomBadgeProps {
  variant?: "moose" | "boreal" | "sloan" | "default";
  children: React.ReactNode;
  className?: string;
}

export function ProductBadge({
  variant = "default",
  children,
  className = "",
}: CustomBadgeProps) {
  const variantClasses = {
    moose:
      "bg-moose-purple hover:bg-moose-purple-dark text-moose-purple-foreground",
    boreal:
      "bg-boreal-green hover:bg-boreal-green-dark text-boreal-green-foreground",
    sloan: "bg-sloan-teal text-black",
    default: "",
  };

  return (
    <Badge className={`${variantClasses[variant]} ${className}`}>
      {children}
    </Badge>
  );
}

const variantColors = {
  moose: {
    background: "bg-gray-950",
    foreground: "text-gray-100",
    stroke: "border-gray-800",
  },
  boreal: {
    background: "bg-gray-950",
    foreground: "text-gray-100",
    stroke: "border-gray-800",
  },
  sloan: {
    background: "bg-gray-950",
    foreground: "text-gray-100",
    stroke: "border-gray-800",
  },
  default: {
    background: "bg-gray-950",
    foreground: "text-gray-100",
    stroke: "border-gray-800",
  },
};

interface IconBadgeProps {
  Icon?: React.ElementType;
  label: string;
  variant?: "moose" | "boreal" | "sloan" | "default";
  rounded?: "md" | "full";
}

export function IconBadge({
  Icon,
  label,
  variant = "moose",
  rounded = "md",
}: IconBadgeProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 w-fit border text-xs font-medium",
        "bg-neutral-800 border-neutral-700 text-neutral-100",
        "px-2.5 py-1.5",
        rounded === "full" ? "rounded-full" : "rounded-md",
      )}
    >
      {Icon && <Icon className="w-3.5 h-3.5" />}
      <span>{label}</span>
    </div>
  );
}
