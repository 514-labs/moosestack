import typia from "typia";
import { CoinbaseMarketTradesUpdate, CoinbaseMatchPayload } from "./types";

const validateCoinbaseMarketTradesUpdate =
  typia.createValidate<CoinbaseMarketTradesUpdate>();

function toCoinbaseMatchPayloads(
  event: CoinbaseMarketTradesUpdate,
): CoinbaseMatchPayload[] {
  const payloads: CoinbaseMatchPayload[] = [];

  for (const update of event.events) {
    for (const trade of update.trades) {
      payloads.push({
        sequence_num: event.sequence_num,
        timestamp: event.timestamp,
        trade,
      });
    }
  }

  return payloads;
}

export function parseCoinbaseMatchPayloads(
  value: unknown,
): CoinbaseMatchPayload[] {
  const validation = validateCoinbaseMarketTradesUpdate(value);
  if (!validation.success) {
    return [];
  }

  return toCoinbaseMatchPayloads(validation.data);
}
