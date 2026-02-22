"use client";

import { useState, useEffect } from "react";
import { CartesianGrid, XAxis, YAxis, BarChart, Bar } from "recharts";
import {
  Loader2,
  Rewind,
  Play,
  Pause,
  FastForward,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { TrendingTopicsControls } from "./trending-topics-controls";
import { Button } from "@/components/ui/button";

interface TopicStats {
  topic: string;
  eventCount: number;
  uniqueRepos: number;
  uniqueUsers: number;
}

interface ResponseBody {
  time: string;
  topicStats: TopicStats[];
}

export function TrendingTopicsChart() {
  const [currentTimeIndex, setCurrentTimeIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [interval, setInterval] = useState("hour");
  const [limit, setLimit] = useState(10);
  const [exclude, setExclude] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["topicTimeseries", interval, limit, exclude],
    queryFn: async (): Promise<ResponseBody[]> => {
      const baseUrl =
        process.env.NEXT_PUBLIC_MOOSE_URL || "http://localhost:4000";
      const params = new URLSearchParams();
      params.set("interval", interval);
      params.set("limit", String(limit));
      if (exclude) params.set("exclude", exclude);
      const res = await fetch(
        `${baseUrl}/api/topicTimeseries?${params.toString()}`,
      );
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      return res.json();
    },
  });

  // Updated animation logic
  useEffect(() => {
    if (!data || !isPlaying) return;

    const intervalId = window.setInterval(() => {
      setCurrentTimeIndex((prev) => (prev + 1) % data.length);
    }, 2000);

    return () => window.clearInterval(intervalId);
  }, [data, isPlaying]);

  if (isLoading && !data) {
    return (
      <div className="flex justify-center items-center h-80">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2">Loading trending topics...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex justify-center items-center h-80 text-red-500">
        <p>
          Error loading data:{" "}
          {error instanceof Error ? error.message : "An unknown error occurred"}
        </p>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="flex justify-center items-center h-80 text-muted-foreground">
        <p>Waiting for data... Events will appear once ingested.</p>
      </div>
    );
  }

  const chartConfig = Array.from(
    new Set(data.flatMap((d) => d.topicStats.map((t) => t.topic))),
  ).reduce(
    (acc, topic, index) => ({
      ...acc,
      [topic]: {
        label: topic,
        color: `var(--chart-${(index % 20) + 1})`,
      },
    }),
    {},
  );

  const chartData = data[currentTimeIndex].topicStats.map((stat) => ({
    eventCount: stat.eventCount,
    topic: stat.topic,
    fill: `var(--color-${stat.topic})`,
  }));

  return (
    <div>
      <TrendingTopicsControls
        interval={interval}
        limit={limit}
        exclude={exclude}
        onIntervalChange={(value) => {
          setInterval(value);
          setCurrentTimeIndex(0); // Reset animation index
        }}
        onLimitChange={(value) => {
          setLimit(value);
          setCurrentTimeIndex(0);
        }}
        onExcludeChange={(value) => {
          setExclude(value);
          setCurrentTimeIndex(0);
        }}
      />

      <div className="mt-8">
        <ChartContainer config={chartConfig} className="h-[500px] w-full">
          <BarChart
            accessibilityLayer
            layout="vertical"
            data={chartData}
            margin={{ top: 20, right: 40, left: 40, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="eventCount" type="number" domain={[0, "dataMax"]} />
            <YAxis
              type="category"
              dataKey="topic"
              width={100}
              tick={{ fontSize: 12 }}
              interval={0}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar
              dataKey="eventCount"
              radius={[0, 4, 4, 0]}
              animationDuration={800}
            />
          </BarChart>
        </ChartContainer>

        <div className="mt-6">
          <div className="flex items-center gap-4 mb-4 justify-center">
            <Button onClick={() => setCurrentTimeIndex(0)} variant="outline">
              <Rewind className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setIsPlaying(false);
                setCurrentTimeIndex(
                  currentTimeIndex === 0 ?
                    data.length - 1
                  : currentTimeIndex - 1,
                );
              }}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button onClick={() => setIsPlaying(!isPlaying)} variant="outline">
              {isPlaying ?
                <Pause className="w-4 h-4" />
              : <Play className="w-4 h-4" />}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setIsPlaying(false);
                setCurrentTimeIndex(
                  currentTimeIndex === data.length - 1 ?
                    0
                  : currentTimeIndex + 1,
                );
              }}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
            <Button
              onClick={() => setCurrentTimeIndex(data.length - 1)}
              variant="outline"
            >
              <FastForward className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-2">
            {data.map((timeData, index) => (
              <Button
                key={timeData.time}
                onClick={() => {
                  setCurrentTimeIndex(index);
                  setIsPlaying(false);
                }}
                className={`px-3 py-1 rounded text-sm whitespace-nowrap cursor-pointer hover:bg-secondary/80 hover:text-secondary-foreground transition-colors ${
                  index === currentTimeIndex ?
                    "bg-secondary text-secondary-foreground font-medium"
                  : "bg-muted text-muted-foreground"
                }`}
              >
                {interval === "day" ?
                  new Date(timeData.time).toLocaleDateString()
                : new Date(timeData.time).toLocaleTimeString()}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
