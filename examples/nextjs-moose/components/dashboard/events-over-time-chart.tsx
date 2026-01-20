"use client";

import * as React from "react";
import { LineChart, type TimeBucketOption } from "@/components/charts";
import { useTimeseries } from "./dashboard-hooks";
import type { BucketSize } from "@/app/actions";

export function EventsOverTimeChart() {
  const [bucket, setBucket] = React.useState<TimeBucketOption>("auto");

  // Convert TimeBucketOption to BucketSize for the hook (undefined when "auto")
  const hookBucket: BucketSize | undefined =
    bucket === "auto" ? undefined : bucket;
  const { data } = useTimeseries(hookBucket);

  return (
    <LineChart
      title="Events over time"
      description="COUNT(events) grouped by time bucket"
      data={data ?? []}
      className="lg:col-span-2"
      height={350}
      showTimeBucket
      timeBucket={bucket}
      onTimeBucketChange={setBucket}
    />
  );
}
