import WebSocket from "ws";
import { defineSource } from "../shared/durable-pipeline/source-definition";
import {
  CoinbaseCheckpoint,
  CoinbaseErrorMessage,
  CoinbaseInboundMessage,
  CoinbaseMatchMessage,
  CoinbaseMatchRecord,
  CoinbaseSourceEnvelope,
} from "./types";

export interface CoinbaseConnectorEnv {
  coinbaseWsUrl: string;
  coinbaseProducts: string[];
}

function parseProducts(value: string | undefined): string[] {
  if (!value) {
    return ["BTC-USD", "ETH-USD"];
  }

  return value
    .split(",")
    .map((product) => product.trim())
    .filter(Boolean);
}

export function getCoinbaseConnectorEnv(): CoinbaseConnectorEnv {
  return {
    coinbaseWsUrl:
      process.env.COINBASE_WS_URL ?? "wss://ws-feed.exchange.coinbase.com",
    coinbaseProducts: parseProducts(process.env.COINBASE_PRODUCTS),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parseCoinbaseInboundMessage(
  rawData: WebSocket.RawData,
): CoinbaseInboundMessage | null {
  try {
    const text =
      typeof rawData === "string" ? rawData : rawData.toString("utf8");
    const parsed = JSON.parse(text);
    return isRecord(parsed) ? (parsed as CoinbaseInboundMessage) : null;
  } catch {
    return null;
  }
}

export function isCoinbaseMatchMessage(
  value: unknown,
): value is CoinbaseMatchMessage {
  if (!isRecord(value) || value.type !== "match") {
    return false;
  }

  const requiredStringFields = [
    "maker_order_id",
    "taker_order_id",
    "time",
    "product_id",
    "size",
    "price",
  ] as const;

  for (const field of requiredStringFields) {
    if (typeof value[field] !== "string") {
      return false;
    }
  }

  return (
    typeof value.trade_id === "number" &&
    typeof value.sequence === "number" &&
    (value.side === "buy" || value.side === "sell")
  );
}

export function isCoinbaseErrorMessage(
  value: unknown,
): value is CoinbaseErrorMessage {
  return (
    isRecord(value) &&
    value.type === "error" &&
    typeof value.message === "string"
  );
}

function parseNumberOrThrow(fieldName: string, value: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid Coinbase ${fieldName}: ${value}`);
  }

  return parsed;
}

function toCoinbaseMatchRecord(
  message: CoinbaseMatchMessage,
  receivedAt: Date,
): CoinbaseMatchRecord {
  const eventTime = new Date(message.time);
  if (Number.isNaN(eventTime.getTime())) {
    throw new Error(`Invalid Coinbase match timestamp: ${message.time}`);
  }

  return {
    trade_id: String(message.trade_id),
    sequence: message.sequence,
    product_id: message.product_id,
    side: message.side,
    price: parseNumberOrThrow("price", message.price),
    size: parseNumberOrThrow("size", message.size),
    maker_order_id: message.maker_order_id,
    taker_order_id: message.taker_order_id,
    event_time: eventTime,
    received_at: receivedAt,
    payload_json: JSON.stringify(message),
    cdc_operation: "INSERT",
    cdc_timestamp: eventTime,
    is_deleted: false,
  };
}

function checkpointFromCoinbaseMessage(
  message: CoinbaseMatchMessage,
): CoinbaseCheckpoint {
  return {
    product_id: message.product_id,
    sequence: message.sequence,
    event_time: message.time,
  };
}

export const coinbaseSource = defineSource<
  CoinbaseSourceEnvelope,
  CoinbaseCheckpoint
>({
  start: async ({ fromCheckpoint, onDisconnect, onEvent, signal }) => {
    const { coinbaseProducts, coinbaseWsUrl } = getCoinbaseConnectorEnv();

    if (fromCheckpoint) {
      console.log(
        `Loaded Coinbase checkpoint ${JSON.stringify(fromCheckpoint)} (provider replay is not supported).`,
      );
    }

    const socket = new WebSocket(coinbaseWsUrl);

    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        socket.off("error", onErrorBeforeOpen);

        socket.send(
          JSON.stringify({
            type: "subscribe",
            product_ids: coinbaseProducts,
            channels: ["matches"],
          }),
        );

        resolve();
      };

      const onErrorBeforeOpen = (error: Error) => {
        socket.off("open", onOpen);
        reject(error);
      };

      socket.once("open", onOpen);
      socket.once("error", onErrorBeforeOpen);
    });

    socket.on("message", async (rawData: WebSocket.RawData) => {
      const message = parseCoinbaseInboundMessage(rawData);
      if (!message) {
        return;
      }

      if (isCoinbaseErrorMessage(message)) {
        onDisconnect(
          new Error(
            [
              "Coinbase websocket returned an error.",
              message.message,
              message.reason,
            ]
              .filter(Boolean)
              .join("\n"),
          ),
        );
        return;
      }

      if (!isCoinbaseMatchMessage(message)) {
        return;
      }

      try {
        const receivedAt = new Date();
        await onEvent({
          resource: "matches",
          payload: toCoinbaseMatchRecord(message, receivedAt),
          checkpoint: checkpointFromCoinbaseMessage(message),
        });
      } catch (error) {
        onDisconnect(error);
      }
    });

    socket.on("error", (error: Error) => {
      onDisconnect(error);
    });

    socket.on("close", () => {
      onDisconnect(new Error("Coinbase websocket closed."));
    });

    signal.addEventListener(
      "abort",
      () => {
        onDisconnect();
      },
      { once: true },
    );

    return {
      stop: async () => {
        socket.removeAllListeners();
        if (
          socket.readyState === WebSocket.CLOSED ||
          socket.readyState === WebSocket.CLOSING
        ) {
          return;
        }

        await new Promise<void>((resolve) => {
          socket.once("close", () => resolve());
          socket.close();
        });
      },
    };
  },
});
