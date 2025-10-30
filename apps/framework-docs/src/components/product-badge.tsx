import { Badge } from "@/components/ui";

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
