import { OlapTable } from "@514labs/moose-lib";

export interface EventModel {
  transaction_id: string;
  event_type: string;
  product_id: number;
  customer_id: string;
  amount: number;
  quantity: number;
  event_time: Date;
  customer_email: string;
  customer_name: string;
  product_name: string;
  status: string; // e.g. 'completed', 'active', 'inactive'
}

export const Events = new OlapTable<EventModel>("events", {
  orderByFields: ["event_time"],
});

// Note: this file defines/exports Moose resources (OlapTable, etc.) as plain TS modules
// so it can be imported directly by a runtime server without an extra build step.
