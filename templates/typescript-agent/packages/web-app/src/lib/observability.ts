import { createLangfuseTraceCollector } from "agent-observability-langfuse";
import {
  createInMemoryTraceCollector,
  type TraceCollector,
} from "agent-runtime";
import { getLangfuseConfig } from "@/env-vars";

export function createTraceCollector(): TraceCollector {
  const config = getLangfuseConfig();
  if (!config) {
    return createInMemoryTraceCollector();
  }

  return createLangfuseTraceCollector(config);
}
