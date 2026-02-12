import { ThemeToggle } from "@/components/theme-toggle";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { GitHubButtonGroup } from "@/components/github-button-group";

interface UtilityControlsProps {
  stars: number | null;
  variant?: "desktop" | "mobile";
}

/**
 * UtilityControls - Reusable component for ThemeToggle, SidebarTrigger, and GitHubButtonGroup
 * Used in both desktop and mobile navigation layouts
 */
export function UtilityControls({
  stars,
  variant = "desktop",
}: UtilityControlsProps): React.JSX.Element {
  if (variant === "mobile") {
    return (
      <div className="flex items-center justify-between pt-2 border-t">
        <div className="flex items-center space-x-2">
          <ThemeToggle />
          <SidebarTrigger />
        </div>
        <GitHubButtonGroup stars={stars} />
      </div>
    );
  }

  // Desktop variant - renders inline, parent handles spacing
  return (
    <>
      <GitHubButtonGroup stars={stars} />
      <ThemeToggle />
      <SidebarTrigger />
    </>
  );
}
