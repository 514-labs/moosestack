"use client";

import { useState } from "react";
import type { ToolTimingPayload } from "../types/message-parts";

interface UseToolTimingsResult {
  toolTimings: Record<string, ToolTimingPayload>;
  handleToolTimingData: (data: ToolTimingPayload) => void;
  resetToolTimings: () => void;
}

export function useToolTimings(): UseToolTimingsResult {
  const [toolTimings, setToolTimings] = useState<
    Record<string, ToolTimingPayload>
  >({});

  const handleToolTimingData = ({
    toolCallId,
    duration,
    stepNumber,
    toolName,
  }: ToolTimingPayload) => {
    if (!Number.isFinite(duration) || duration < 0) {
      return;
    }

    setToolTimings((previousTimings) => ({
      ...previousTimings,
      [toolCallId]: {
        toolCallId,
        duration,
        stepNumber,
        toolName,
      },
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
