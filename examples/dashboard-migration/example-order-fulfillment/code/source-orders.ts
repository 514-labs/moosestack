import { LifeCycle, OlapTable } from "@514-labs/moose-lib";

export interface OrdersModel {
  merchant_id: string;
  order_ts: Date;
  status: string;
}

export const Orders = OlapTable<OrdersModel>("Orders", {
  orderByFields: ["merchant_id", "order_ts"],
  lifeCycle: LifeCycle.EXTERNALLY_MANAGED,
});
