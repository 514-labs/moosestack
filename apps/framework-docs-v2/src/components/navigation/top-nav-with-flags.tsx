import { Suspense } from "react";
import { TopNav } from "@/components/navigation/top-nav";
import { getGitHubStars } from "@/lib/github-stars";
import { getNavVariant } from "@/lib/nav-variant";

async function TopNavWithFlagsContent() {
  // Get variant at build time
  const variant = getNavVariant();

  const showAi = variant !== "base";

  // Fetch stars
  const stars = await getGitHubStars();

  return <TopNav stars={stars} showAi={showAi} />;
}

export function TopNavWithFlags() {
  return (
    <Suspense fallback={<div className="h-14" />}>
      <TopNavWithFlagsContent />
    </Suspense>
  );
}
