import { sql } from "@514labs/moose-lib";
import { Orders } from "./source-orders";

export interface OrderFulfillmentOlapTranslationInput {
  merchantId: string;
  startDate: string;
  endDate: string;
}

export interface OrderFulfillmentOlapTranslationRow {
  day: string;
  fulfilled: number;
  total: number;
}

export interface MooseClient {
  query<T>(statement: unknown): Promise<T[]>;
}

export async function runOrderFulfillmentHandlerOlapTranslation(
  params: OrderFulfillmentOlapTranslationInput,
  mooseClient: MooseClient,
): Promise<OrderFulfillmentOlapTranslationRow[]> {
  const statement = sql`
    SELECT
      toDate(order_ts) AS day,
      sumIf(1, status = 'fulfilled') AS fulfilled,
      count() AS total
    FROM ${Orders}
    WHERE merchant_id = ${params.merchantId}
      AND order_ts >= toDateTime(${params.startDate})
      AND order_ts < toDateTime(${params.endDate})
    GROUP BY day
    ORDER BY day ASC
  `;

  return mooseClient.query<OrderFulfillmentOlapTranslationRow>(statement);
}
