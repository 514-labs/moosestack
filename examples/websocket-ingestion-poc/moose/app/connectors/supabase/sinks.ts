import { ClickHouseEngines, OlapTable, Stream } from "@514labs/moose-lib";
import { ResourceDefinitions } from "../shared/durable-pipeline/types";
import {
  SupabaseChangeRecord,
  SupabaseCheckpoint,
  SupabaseResourceName,
} from "./types";

export type SupabaseSinkKey = SupabaseResourceName;

// Destination resources (Moose sinks)
export const SupabaseProjectsChangesTable = new OlapTable<SupabaseChangeRecord>(
  "supabase_projects_changes",
  {
    engine: ClickHouseEngines.ReplacingMergeTree,
    orderByFields: ["row_id", "cdc_timestamp"],
    ver: "cdc_timestamp",
    isDeleted: "is_deleted",
  },
);

export const SupabaseTimeEntriesChangesTable =
  new OlapTable<SupabaseChangeRecord>("supabase_time_entries_changes", {
    engine: ClickHouseEngines.ReplacingMergeTree,
    orderByFields: ["row_id", "cdc_timestamp"],
    ver: "cdc_timestamp",
    isDeleted: "is_deleted",
  });

export const SupabaseProjectsChangesStream = new Stream<SupabaseChangeRecord>(
  "supabase_projects_changes_stream",
  {
    destination: SupabaseProjectsChangesTable,
  },
);

export const SupabaseTimeEntriesChangesStream =
  new Stream<SupabaseChangeRecord>("supabase_time_entries_changes_stream", {
    destination: SupabaseTimeEntriesChangesTable,
  });

// Source table -> destination object map (single source of truth for where data lands)
export const SUPABASE_RESOURCES = {
  projects: {
    destination: SupabaseProjectsChangesStream,
  },
  time_entries: {
    destination: SupabaseTimeEntriesChangesStream,
  },
} satisfies ResourceDefinitions<
  SupabaseResourceName,
  SupabaseChangeRecord,
  SupabaseCheckpoint
>;

export function getMappedSupabaseTables(): SupabaseResourceName[] {
  return Object.keys(SUPABASE_RESOURCES) as SupabaseResourceName[];
}
