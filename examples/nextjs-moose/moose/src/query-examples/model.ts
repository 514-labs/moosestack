import { defineQueryModel } from "../query-layer";
import { Events } from "../models";
import { sql } from "@514labs/moose-lib";

export const eventsModel = defineQueryModel({
  table: Events,

  // Dimensions: columns for grouping and filtering
  // Key names are used as SQL aliases automatically (no `as` needed)
  dimensions: {
    status: {
      column: "status",
      description: "Event processing status",
    },
    hour: {
      expression: sql.fragment`toStartOfHour(${Events.columns.event_time})`,
      as: "time",
      description: "Event time truncated to the hour",
    },
    day: {
      expression: sql.fragment`toDate(${Events.columns.event_time})`,
      as: "time",
      description: "Event date (day granularity)",
    },
    month: {
      expression: sql.fragment`toStartOfMonth(${Events.columns.event_time})`,
      as: "time",
      description: "Event date truncated to the start of the month",
    },
  },

  // Metrics: aggregates computed over dimensions
  // Key names are used as SQL aliases automatically (no `as` needed)
  metrics: {
    totalEvents: {
      agg: sql.fragment`count(*)`,
      description: "Total number of events",
    },
    totalAmount: {
      agg: sql.fragment`sum(${Events.columns.amount})`,
      description: "Sum of event amounts",
    },
    avgAmount: {
      agg: sql.fragment`avg(${Events.columns.amount})`,
      description: "Average event amount",
    },
    minAmount: {
      agg: sql.fragment`min(${Events.columns.amount})`,
      description: "Minimum event amount",
    },
    maxAmount: {
      agg: sql.fragment`max(${Events.columns.amount})`,
      description: "Maximum event amount",
    },
    highValueRatio: {
      agg: sql.fragment`countIf(${Events.columns.amount} > 100) / count(*)`,
      description: "Ratio of events with amount greater than 100",
    },
  },

  filters: {
    timestamp: {
      column: "event_time",
      operators: ["gte", "lte"] as const,
      description: "Filter by event timestamp range",
    },
    status: {
      column: "status",
      operators: ["eq", "in"] as const,
      description: "Filter by event processing status",
    },
    amount: {
      column: "amount",
      operators: ["gte", "lte"] as const,
      description: "Filter by event amount range",
    },
    id: {
      column: "id",
      operators: ["eq"] as const,
      description: "Filter by exact event ID",
    },
  },

  // Sortable fields use the key names (camelCase)
  sortable: ["totalAmount", "totalEvents", "avgAmount"] as const,
  defaults: {},
});
