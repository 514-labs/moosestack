import { MaterializedView, OlapTable, sql } from "@514-labs/moose-lib";
import { Orders } from "./source-orders";

interface OrderFulfillmentDailyModel {
  merchant_id: string;
  day: Date;
  fulfilled: number;
  total: number;
}
export const OrderFulfillmentDaily = OlapTable<OrderFulfillmentDailyModel>(
  "OrderFulfillmentDaily",
  {
    orderByFields: ["merchant_id", "day"],
  },
);
export const OrderFulfillmentDailyMV =
  MaterializedView<OrderFulfillmentDailyModel>({
    targetTable: OrderFulfillmentDaily,
    materializedViewName: "OrderFulfillmentDailyMV",
    selectTables: [Orders],
    selectStatement: sql`
    SELECT
      merchant_id,
      toDate(order_ts) AS day,
      sumIf(1, status = 'fulfilled') AS fulfilled,
      count() AS total
    FROM ${Orders}
    GROUP BY merchant_id, day
  `,
  });
