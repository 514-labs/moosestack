import { boolean, pgTable, text } from "drizzle-orm/pg-core";
import { ClickHouseEngines, OlapTable } from "@514labs/moose-lib";

export const KafkaCredentials = pgTable("kafka_credentials", {
  id: text("id").notNull(),
  yes: boolean("yes").notNull(),
});

type NonDeclaredType = typeof KafkaCredentials.$inferSelect;

export const NonDeclaredType = new OlapTable<NonDeclaredType>(
  "NonDeclaredType",
  {
    orderByFields: ["id"],
    engine: ClickHouseEngines.MergeTree,
  },
);
