import { createLangfuseTraceCollector } from "agent-observability-langfuse";
import type { TraceCollector } from "agent-runtime";
import { getLangfuseConfig } from "@/env-vars";
import { createInMemoryTraceCollector } from "@/lib/in-memory-trace-collector";

export function createTraceCollector(): TraceCollector {
  const config = getLangfuseConfig();
  if (!config) {
    return createInMemoryTraceCollector();
  }

  return createLangfuseTraceCollector(config);
}
