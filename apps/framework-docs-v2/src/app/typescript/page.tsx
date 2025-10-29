import { redirect } from "next/navigation";
import { getAllSlugs } from "@/lib/content";

export default function TypeScriptIndexPage() {
  // Redirect to first available page
  const slugs = getAllSlugs("typescript");
  if (slugs.length > 0) {
    redirect(`/typescript/${slugs[0]}`);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-4xl font-bold mb-4">TypeScript Documentation</h1>
      <p className="text-lg text-muted-foreground">
        Welcome to the MooseStack TypeScript documentation.
      </p>
    </div>
  );
}

