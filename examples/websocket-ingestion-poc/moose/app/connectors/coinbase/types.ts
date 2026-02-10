import { DateTime } from "@514labs/moose-lib";
import { SourceEnvelope } from "../shared/durable-pipeline/types";

export type CoinbaseResourceName = "matches";

export interface CoinbaseSubscriptionsMessage {
  type: "subscriptions";
}

export interface CoinbaseHeartbeatMessage {
  type: "heartbeat";
  sequence: number;
  product_id: string;
  time: string;
}

export interface CoinbaseErrorMessage {
  type: "error";
  message: string;
  reason?: string;
}

export interface CoinbaseMatchMessage {
  type: "match";
  trade_id: number;
  sequence: number;
  maker_order_id: string;
  taker_order_id: string;
  time: string;
  product_id: string;
  size: string;
  price: string;
  side: "buy" | "sell";
}

export type CoinbaseInboundMessage =
  | CoinbaseSubscriptionsMessage
  | CoinbaseHeartbeatMessage
  | CoinbaseErrorMessage
  | CoinbaseMatchMessage
  | Record<string, unknown>;

export interface CoinbaseCheckpoint extends Record<string, unknown> {
  product_id: string;
  sequence: number;
  event_time: string;
}

export interface CoinbaseMatchRecord extends Record<string, unknown> {
  trade_id: string;
  sequence: number;
  product_id: string;
  side: "buy" | "sell";
  price: number;
  size: number;
  maker_order_id: string;
  taker_order_id: string;
  event_time: DateTime;
  received_at: DateTime;
  payload_json: string;
  cdc_operation: "INSERT";
  cdc_timestamp: DateTime;
  is_deleted: false;
}

export type CoinbaseSourceEnvelope = SourceEnvelope<
  CoinbaseResourceName,
  CoinbaseMatchRecord,
  CoinbaseCheckpoint
>;
