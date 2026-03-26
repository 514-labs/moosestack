"use client";

import { useState } from "react";

interface ToolTimingData {
  toolCallId: string;
  duration: number;
}

export function useToolTimings() {
  const [toolTimings, setToolTimings] = useState<Record<string, number>>({});

  const handleToolTimingData = ({ toolCallId, duration }: ToolTimingData) => {
    setToolTimings((previousTimings) => ({
      ...previousTimings,
      [toolCallId]: duration,
    }));
  };

  const resetToolTimings = () => {
    setToolTimings({});
  };

  return {
    toolTimings,
    handleToolTimingData,
    resetToolTimings,
  };
}
