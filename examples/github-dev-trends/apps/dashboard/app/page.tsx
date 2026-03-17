import { TrendingTopicsChart } from "@/components/trending-topics-chart";

export default function Home() {
  return (
    <main className="container mx-auto py-8 px-4">
      <h1 className="text-3xl font-bold mb-6 text-center">
        GitHub Trending Topics
      </h1>
      <p className="text-gray-600 mb-8 text-center max-w-2xl mx-auto">
        Discover which programming topics are trending on GitHub in real-time.
        Adjust the time interval and filters to see how trends evolve.
      </p>
      <div className="bg-white rounded-lg shadow-lg p-6">
        <TrendingTopicsChart />
      </div>
    </main>
  );
}
