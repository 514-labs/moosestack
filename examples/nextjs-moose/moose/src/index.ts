export * from "./models";
export * from "./queries";
import { EventModel } from "./models";
import { OlapTable } from "@514labs/moose-lib";
export const Events2 = new OlapTable<EventModel>("events2", {
  orderByFields: ["event_time"],
});
