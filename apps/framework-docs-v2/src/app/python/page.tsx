import { redirect } from "next/navigation";
import { getAllSlugs } from "@/lib/content";

export default function PythonIndexPage() {
  // Redirect to first available page
  const slugs = getAllSlugs("python");
  if (slugs.length > 0) {
    redirect(`/python/${slugs[0]}`);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-4xl font-bold mb-4">Python Documentation</h1>
      <p className="text-lg text-muted-foreground">
        Welcome to the MooseStack Python documentation.
      </p>
    </div>
  );
}

