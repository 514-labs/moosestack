import { MaterializedView, OlapTable, sql } from "@514labs/moose-lib";
import { Orders } from "./source-orders";

interface OrderFulfillmentDailyModel {
  merchant_id: string;
  day: Date;
  fulfilled: number;
  total: number;
}
export const OrderFulfillmentDaily = new OlapTable<OrderFulfillmentDailyModel>(
  "OrderFulfillmentDaily",
  {
    orderByFields: ["merchant_id", "day"],
  },
);
export const OrderFulfillmentDailyMV =
  new MaterializedView<OrderFulfillmentDailyModel>({
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
