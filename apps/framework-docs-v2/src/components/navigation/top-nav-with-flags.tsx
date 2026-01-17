import { Suspense } from "react";
import { TopNav } from "@/components/navigation/top-nav";
import { showHostingSection, showAiSection } from "@/flags";
import { getGitHubStars } from "@/lib/github-stars";

async function TopNavWithFlagsContent() {
  // Fetch both stars and flags in parallel
  const [stars, showHosting, showAi] = await Promise.all([
    getGitHubStars(),
    showHostingSection().catch(() => false),
    showAiSection().catch(() => false),
  ]);

  return <TopNav stars={stars} showHosting={showHosting} showAi={showAi} />;
}

export function TopNavWithFlags() {
  return (
    <Suspense fallback={<div className="h-14" />}>
      <TopNavWithFlagsContent />
    </Suspense>
  );
}
