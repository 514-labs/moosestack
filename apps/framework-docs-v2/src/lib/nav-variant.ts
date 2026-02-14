/**
 * Navigation variant selection
 *
 * Determines which pre-computed navigation variant to use based on
 * environment configuration at build time.
 */

export type NavVariant = "base" | "draft" | "beta" | "full";

/**
 * Get the navigation variant to use for this build
 *
 * Variants:
 * - base: Public content only (production default)
 * - draft: Include draft guides (internal team)
 * - beta: Include beta guides (select external users)
 * - full: All content (development)
 *
 * Configured via NEXT_PUBLIC_NAV_VARIANT environment variable
 */
export function getNavVariant(): NavVariant {
  const variant = process.env.NEXT_PUBLIC_NAV_VARIANT as NavVariant | undefined;

  // Validate variant
  if (variant && ["base", "draft", "beta", "full"].includes(variant)) {
    return variant;
  }

  // Default to base for both production and development
  // Use NEXT_PUBLIC_NAV_VARIANT=full to see all content in dev
  return "base";
}
