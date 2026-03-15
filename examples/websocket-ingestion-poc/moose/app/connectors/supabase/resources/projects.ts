import { ClickHouseEngines, OlapTable, Stream } from "@514labs/moose-lib";
import { defineWebSocketResource } from "../../shared/durable-pipeline/resource-definition";
import {
  SupabaseChangePayload,
  SupabaseChangeRecord,
  SupabaseCheckpoint,
} from "../types";
import {
  checkpointFromPayload,
  parseResourcePayload,
  toSupabaseChangeRecord,
} from "./shared";

export const SupabaseProjectsChangesTable = new OlapTable<SupabaseChangeRecord>(
  "supabase_projects_changes",
  {
    engine: ClickHouseEngines.ReplacingMergeTree,
    orderByFields: ["row_id", "cdc_timestamp"],
    ver: "cdc_timestamp",
    isDeleted: "is_deleted",
  },
);

export const SupabaseProjectsChangesStream = new Stream<SupabaseChangeRecord>(
  "supabase_projects_changes_stream",
  {
    destination: SupabaseProjectsChangesTable,
  },
);

export const projectsResource = defineWebSocketResource<
  "projects",
  SupabaseChangePayload,
  SupabaseChangePayload,
  SupabaseCheckpoint
>({
  name: "projects",
  sink: SupabaseProjectsChangesStream,
  parse: (payload) => parseResourcePayload(payload, "projects"),
  process: ({ payload, receivedAt }) => {
    const record = toSupabaseChangeRecord("projects", payload, receivedAt);

    return {
      records: [record],
      checkpoint: checkpointFromPayload("projects", payload),
    };
  },
});
