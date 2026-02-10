import { DateTime } from "@514labs/moose-lib";

export type CoinbaseResourceName = "matches";

export interface CoinbaseMarketTrade {
  trade_id: string;
  product_id: string;
  price: string;
  size: string;
  side: "BUY" | "SELL";
  time: string;
}

export interface CoinbaseMarketTradesChannelEvent {
  trades: CoinbaseMarketTrade[];
}

export interface CoinbaseMarketTradesUpdate {
  channel: "market_trades";
  sequence_num: number;
  timestamp: string;
  events: CoinbaseMarketTradesChannelEvent[];
}

export interface CoinbaseMatchPayload extends Record<string, unknown> {
  sequence_num: number;
  timestamp: string;
  trade: CoinbaseMarketTrade;
}

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
  event_time: DateTime;
  received_at: DateTime;
  payload_json: string;
  cdc_operation: "INSERT";
  cdc_timestamp: DateTime;
  is_deleted: false;
}
