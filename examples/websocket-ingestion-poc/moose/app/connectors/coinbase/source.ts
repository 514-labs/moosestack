import { WebsocketClient, WsDataEvent } from "coinbase-api";
import { defineWebSocketSource } from "../shared/durable-pipeline/source-definition";
import { CoinbaseCheckpoint, CoinbaseMatchPayload } from "./types";
import { matchesResource } from "./resources/matches";

export interface CoinbaseConnectorEnv {
  coinbaseWsUrl?: string;
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
    coinbaseWsUrl: process.env.COINBASE_WS_URL,
    coinbaseProducts: parseProducts(process.env.COINBASE_PRODUCTS),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toErrorMessage(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }

  if (typeof value === "string") {
    return value;
  }

  if (isRecord(value) && typeof value.message === "string") {
    return value.message;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return "Unknown Coinbase websocket error";
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(toErrorMessage(value));
}

export const coinbaseSource = defineWebSocketSource<
  "matches",
  unknown,
  CoinbaseMatchPayload,
  CoinbaseCheckpoint
>({
  name: "coinbase",
  resources: [matchesResource],
  start: async ({ fromCheckpoint, onDisconnect, emitRaw, signal }) => {
    const { coinbaseProducts, coinbaseWsUrl } = getCoinbaseConnectorEnv();

    if (fromCheckpoint) {
      console.log(
        `Loaded Coinbase checkpoint ${JSON.stringify(fromCheckpoint)} (provider replay is not supported).`,
      );
    }

    const websocket = new WebsocketClient({
      ...(coinbaseWsUrl ? { wsUrl: coinbaseWsUrl } : {}),
    });

    let didDisconnect = false;
    const disconnect = (error?: unknown) => {
      if (didDisconnect) {
        return;
      }

      didDisconnect = true;
      onDisconnect(error);
    };

    const handleUpdate = async (event: WsDataEvent<unknown>) => {
      try {
        await emitRaw(event.data);
      } catch (error) {
        disconnect(error);
      }
    };

    const updateListener = (event: WsDataEvent<unknown>) => {
      void handleUpdate(event);
    };

    const errorListener = (error: unknown) => {
      disconnect(toError(error));
    };

    const responseListener = (response: unknown) => {
      if (isRecord(response) && response.type === "error") {
        disconnect(
          new Error(`Coinbase subscription error: ${toErrorMessage(response)}`),
        );
      }
    };

    const closeListener = () => {
      disconnect(new Error("Coinbase websocket closed."));
    };

    websocket.on("update", updateListener);
    websocket.on("error", errorListener);
    websocket.on("exception", errorListener);
    websocket.on("response", responseListener);
    websocket.on("close", closeListener);

    websocket.subscribe(
      {
        topic: "market_trades",
        payload: {
          product_ids: coinbaseProducts,
        },
      },
      "advTradeMarketData",
    );

    const abortListener = () => {
      disconnect();
    };

    signal.addEventListener("abort", abortListener, { once: true });

    return {
      stop: async () => {
        signal.removeEventListener("abort", abortListener);
        websocket.removeAllListeners();
        websocket.closeAll(true);
      },
    };
  },
});
