import { Suspense } from "react";
import { TopNav } from "@/components/navigation/top-nav";
import { getGitHubStars } from "@/lib/github-stars";
import { getNavVariant } from "@/lib/nav-variant";

async function TopNavWithFlagsContent() {
  // Get variant at build time
  const variant = getNavVariant();

  // Determine section visibility based on variant
  // For now, show hosting/AI sections for all variants except 'base'
  // Adjust this logic based on your requirements
  const showHosting = variant !== "base";
  const showAi = variant !== "base";

  // Fetch stars
  const stars = await getGitHubStars();

  return <TopNav stars={stars} showHosting={showHosting} showAi={showAi} />;
}

export function TopNavWithFlags() {
  return (
    <Suspense fallback={<div className="h-14" />}>
      <TopNavWithFlagsContent />
    </Suspense>
  );
}
