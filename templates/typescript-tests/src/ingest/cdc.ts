import {
  CdcSource,
  CdcTable,
  DateTime,
  Stream,
  mooseRuntimeEnv,
} from "@514labs/moose-lib";

export interface OrderRow {
  id: string;
  customerId: string;
  totalCents: number;
  status: string;
  createdAt: DateTime;
}

export const ordersCdcSource = new CdcSource("orders_cdc", {
  kind: "postgresql",
  connection: mooseRuntimeEnv.get("TEST_CDC_CONNECTION"),
  metadata: {
    description: "CDC source for orders (template test)",
  },
});

export const ordersCdcTable = new CdcTable<OrderRow>(
  "orders",
  ordersCdcSource,
  {
    sourceTable: "public.orders",
    primaryKey: ["id"],
    snapshot: "initial",
    stream: true,
    table: true,
  },
);

export interface OrdersIngestRow {
  orderId: string;
  customerId: string;
  totalUsd: number;
  status: string;
  updatedAt: DateTime;
  op: string;
}

export const ordersIngestStream = new Stream<OrdersIngestRow>("orders_ingest");

ordersCdcTable.changes?.addTransform(
  ordersIngestStream,
  (event) => {
    const row = event.after ?? event.before;
    if (!row) {
      return null;
    }
    return {
      orderId: row.id,
      customerId: row.customerId,
      totalUsd: row.totalCents / 100,
      status: row.status,
      updatedAt: row.createdAt,
      op: event.op,
    };
  },
  { version: "v1" },
);
