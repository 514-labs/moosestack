import { Suspense } from "react";
import { TopNav } from "@/components/navigation/top-nav";
import { showHostingSection, showGuidesSection, showAiSection } from "@/flags";
import { getGitHubStars } from "@/lib/github-stars";

async function TopNavWithFlagsContent() {
  // Fetch both stars and flags in parallel
  const [stars, showHosting, showGuides, showAi] = await Promise.all([
    getGitHubStars(),
    showHostingSection().catch(() => false),
    showGuidesSection().catch(() => false),
    showAiSection().catch(() => true),
  ]);

  return (
    <TopNav
      stars={stars}
      showHosting={showHosting}
      showGuides={showGuides}
      showAi={showAi}
    />
  );
}

export function TopNavWithFlags() {
  return (
    <Suspense fallback={<div className="h-14" />}>
      <TopNavWithFlagsContent />
    </Suspense>
  );
}
