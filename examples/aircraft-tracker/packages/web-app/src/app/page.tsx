import Link from "next/link";
import { Dashboard } from "@/components/dashboard";

export default function Home() {
  return (
    <div className="min-h-screen p-6 lg:p-10 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">ADS-B Aircraft Tracker</h1>
        <Link
          href="/builder"
          className="text-sm font-medium text-primary hover:underline"
        >
          Report Builder →
        </Link>
      </div>
      <Dashboard />
    </div>
  );
}
