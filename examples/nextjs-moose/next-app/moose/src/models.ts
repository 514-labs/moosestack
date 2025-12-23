import { OlapTable } from "@514labs/moose-lib";
import typia, { tags } from "typia";
import { executeQuery } from "./client";

export interface EventModel {
  id: string;
  amount: number;
  event_time: Date;
  status: "completed" | "active" | "inactive";
}

export const Events = new OlapTable<EventModel>("events", {
  orderByFields: ["event_time"],
});

// export async function seedEvents(count: number = 1000): Promise<void> {
//   const generator = typia.createRandom<EventModel>();
//   const events: EventModel[] = [];

//   for (let i = 0; i < count; i++) {
//     events.push(generator());
//   }

//   const result = await executeCommand(sql`INSERT INTO events VALUES ${events}`);
//   console.log(`Successfully inserted: ${result.successful} records`);
//   if (result.failed > 0) {
//     console.warn(`Failed to insert: ${result.failed} records`);
//   }
// }
