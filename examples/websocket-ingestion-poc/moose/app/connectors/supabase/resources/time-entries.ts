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

export const SupabaseTimeEntriesChangesTable =
  new OlapTable<SupabaseChangeRecord>("supabase_time_entries_changes", {
    engine: ClickHouseEngines.ReplacingMergeTree,
    orderByFields: ["row_id", "cdc_timestamp"],
    ver: "cdc_timestamp",
    isDeleted: "is_deleted",
  });

export const SupabaseTimeEntriesChangesStream =
  new Stream<SupabaseChangeRecord>("supabase_time_entries_changes_stream", {
    destination: SupabaseTimeEntriesChangesTable,
  });

export const timeEntriesResource = defineWebSocketResource<
  "time_entries",
  SupabaseChangePayload,
  SupabaseChangePayload,
  SupabaseCheckpoint
>({
  name: "time_entries",
  sink: SupabaseTimeEntriesChangesStream,
  parse: (payload) => parseResourcePayload(payload, "time_entries"),
  process: ({ payload, receivedAt }) => {
    const record = toSupabaseChangeRecord("time_entries", payload, receivedAt);

    return {
      records: [record],
      checkpoint: checkpointFromPayload("time_entries", payload),
    };
  },
});
