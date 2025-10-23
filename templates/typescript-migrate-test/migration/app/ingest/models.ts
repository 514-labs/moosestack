import { Key, OlapTable, DeadLetterModel, DateTime } from "@514labs/moose-lib";

export interface Foo {
  primaryKey: Key<string>;
  timestamp: number;
  optionalText?: string;
}

export interface Bar {
  primaryKey: Key<string>;
  utcTimestamp: DateTime;
  hasText: boolean;
  textLength: number;
}

export const deadLetterTable = new OlapTable<DeadLetterModel>("FooDeadLetter", {
  orderByFields: ["failedAt"],
});

export const FooTable = new OlapTable<Foo>("Foo");

export const BarTable = new OlapTable<Bar>("Bar");
