import { OlapTable } from "@514labs/moose-lib";

export interface EventModel {
  id: string;
  amount: number;
  event_time: Date;
  status: "completed" | "active" | "inactive";
}

export const Events = new OlapTable<EventModel>("events", {
  orderByFields: ["event_time"],
});
