import { defineQueryModel } from "./query-layer";
import { OrderFulfillmentDaily } from "./order-fulfillment-daily-mv";
import { sql } from "@514labs/moose-lib";

export const OrderFulfillmentQM = defineQueryModel({
  table: OrderFulfillmentDaily,
  dimensions: {
    merchantId: { column: "merchant_id" },
    day: { column: "day" },
  },
  metrics: {
    fulfilled: { agg: sql`sum(fulfilled)` },
    total: { agg: sql`sum(total)` },
  },
  filters: {
    merchantId: { column: "merchant_id", operators: ["eq"] as const },
    day: { column: "day", operators: ["gte", "lte"] as const },
  },
  sortable: ["day"] as const,
});
