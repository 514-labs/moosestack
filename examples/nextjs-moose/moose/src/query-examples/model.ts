import { defineQueryModel } from "../query-layer";
import { Events } from "../models";
import { sql } from "@514labs/moose-lib";

export const eventsModel = defineQueryModel({
  table: Events,

  // Dimensions: columns for grouping and filtering
  // Key names are used as SQL aliases automatically (no `as` needed)
  dimensions: {
    status: { column: "status" },
    hour: {
      expression: sql`toStartOfHour(${Events.columns.event_time})`,
      as: "time",
    },
    day: { expression: sql`toDate(${Events.columns.event_time})`, as: "time" },
    month: {
      expression: sql`toStartOfMonth(${Events.columns.event_time})`,
      as: "time",
    },
  },

  // Metrics: aggregates computed over dimensions
  // Key names are used as SQL aliases automatically (no `as` needed)
  metrics: {
    totalEvents: { agg: sql`count(*)` },
    totalAmount: { agg: sql`sum(${Events.columns.amount})` },
    avgAmount: { agg: sql`avg(${Events.columns.amount})` },
    minAmount: { agg: sql`min(${Events.columns.amount})` },
    maxAmount: { agg: sql`max(${Events.columns.amount})` },
    highValueRatio: {
      agg: sql`countIf(${Events.columns.amount} > 100) / count(*)`,
    },
  },

  filters: {
    timestamp: { column: "event_time", operators: ["gte", "lte"] as const },
    status: { column: "status", operators: ["eq", "in"] as const },
    amount: { column: "amount", operators: ["gte", "lte"] as const },
    id: { column: "id", operators: ["eq"] as const },
  },

  // Sortable fields use the key names (camelCase)
  sortable: ["totalAmount", "totalEvents", "avgAmount"] as const,
  defaults: {},
});
