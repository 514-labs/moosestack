/**
 * Server-side wrapper for SideNav
 *
 * Pre-computes feature flags at build time and passes pre-filtered
 * navigation to the client SideNav component.
 */

import { SideNav } from "./side-nav";
import { getNavVariant } from "@/lib/nav-variant";
import type { NavFilterFlags } from "@/config/navigation";

// Map variant names to flag configurations
function getFilterFlagsForVariant(
  variant: "base" | "draft" | "beta" | "full",
): NavFilterFlags {
  switch (variant) {
    case "base":
      return {
        showDataSourcesPage: false,
        showDraftGuides: false,
        showBetaGuides: false,
      };
    case "draft":
      return {
        showDataSourcesPage: true,
        showDraftGuides: true,
        showBetaGuides: false,
      };
    case "beta":
      return {
        showDataSourcesPage: true,
        showDraftGuides: false,
        showBetaGuides: true,
      };
    case "full":
      return {
        showDataSourcesPage: true,
        showDraftGuides: true,
        showBetaGuides: true,
      };
  }
}

/**
 * Server component that determines build-time navigation variant
 * and passes appropriate flags to client SideNav
 */
export function SideNavServer() {
  const variant = getNavVariant();
  const flags = getFilterFlagsForVariant(variant);

  return <SideNav flags={flags} />;
}
