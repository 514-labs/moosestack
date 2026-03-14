import Link from "next/link";
import { ReportBuilder } from "@/components/report-builder/report-builder";

export default function BuilderPage() {
  return (
    <div className="mx-auto max-w-7xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Query Builder</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Select metrics, dimensions, and filters to explore Amazon review
            data
          </p>
        </div>
        <Link
          href="/"
          className="text-sm font-medium text-primary hover:underline"
        >
          &larr; Dashboard
        </Link>
      </div>
      <ReportBuilder />
    </div>
  );
}
