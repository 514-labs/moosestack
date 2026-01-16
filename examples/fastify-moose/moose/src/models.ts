import { OlapTable } from "@514labs/moose-lib";

export interface EventModel {
  event_id: string;
  event_time: Date;
  user_id: string;
  amount: number;
  status: "completed" | "active" | "inactive";
}

export const Events = new OlapTable<EventModel>("events", {
  database: "local",
  orderByFields: ["event_time"],
});
