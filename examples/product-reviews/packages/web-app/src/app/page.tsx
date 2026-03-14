import Link from "next/link";
import { ReviewCharts } from "@/features/dashboard/review-charts";

export default function Home() {
  return (
    <div className="mx-auto max-w-6xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Amazon Reviews Dashboard</h1>
          <p className="text-muted-foreground text-sm">
            Insights from ~25 million Amazon customer reviews
          </p>
        </div>
        <Link
          href="/builder"
          className="text-sm font-medium text-primary hover:underline"
        >
          Query Builder &rarr;
        </Link>
      </div>
      <ReviewCharts />
    </div>
  );
}
