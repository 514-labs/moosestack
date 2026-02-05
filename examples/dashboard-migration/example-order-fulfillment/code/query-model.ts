import { defineQueryModel } from "@514-labs/moose-lib";
import { OrderFulfillmentDaily } from "./order-fulfillment-daily-mv";

export const OrderFulfillmentQM = defineQueryModel({
  table: OrderFulfillmentDaily,
  dimensions: { merchantId: "merchant_id", day: "day" },
  metrics: { fulfilled: "sum(fulfilled)", total: "sum(total)" },
  filters: { merchantId: "=", day: "between" },
  sortable: ["day"],
});
