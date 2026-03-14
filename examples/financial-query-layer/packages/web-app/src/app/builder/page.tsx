import Link from "next/link";
import { ReportBuilder } from "@/components/report-builder/report-builder";

export default function BuilderPage() {
  return (
    <div className="min-h-screen p-6 lg:p-10 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Report Builder</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Select metrics and dimensions to build a custom transaction query
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
