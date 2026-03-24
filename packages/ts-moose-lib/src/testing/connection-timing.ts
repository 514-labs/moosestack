/**
 * HTTP connection timing diagnostics.
 * Measures DNS, TCP, TLS, and time-to-first-byte for ClickHouse HTTP requests.
 * Used to diagnose latency spikes in the network/proxy layer.
 */

import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { validateRuns } from "./shared";

const DEFAULT_TIMEOUT_MS = 30_000;

export type SpikePhase =
  | "DNS"
  | "TCP"
  | "TLS"
  | "Server processing (TTFB)"
  | "Response transfer";

export interface ConnectionTiming {
  readonly dnsMs: number;
  readonly tcpMs: number;
  readonly tlsMs: number;
  readonly firstByteMs: number;
  readonly totalMs: number;
  readonly statusCode: number;
  readonly bodyLength: number;
}

export interface ConnectionTimingOptions {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
  readonly query: string;
  readonly ssl: boolean;
  /** Request timeout in milliseconds. Defaults to 30 000. */
  readonly timeoutMs?: number;
}

/**
 * Execute a ClickHouse query via raw HTTP and capture connection-level timing.
 * Bypasses the ClickHouse client to measure DNS, TCP, TLS, and TTFB independently.
 */
export function timedHttpQuery(
  opts: ConnectionTimingOptions,
): Promise<ConnectionTiming> {
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const start = performance.now();
    let dnsTime = 0;
    let tcpTime = 0;
    let tlsTime = 0;
    let firstByteTime = 0;
    let settled = false;

    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        fn();
      }
    };

    const reqFn = opts.ssl ? httpsRequest : httpRequest;

    const req = reqFn(
      {
        hostname: opts.host,
        port: opts.port,
        path: `/?database=${encodeURIComponent(opts.database)}&default_format=JSONEachRow`,
        method: "POST",
        agent: false,
        timeout,
        headers: {
          "Content-Type": "text/plain",
          Authorization:
            "Basic " +
            Buffer.from(`${opts.user}:${opts.password}`).toString("base64"),
        },
      },
      (res) => {
        firstByteTime = performance.now() - start;

        let bodyLength = 0;
        res.on("data", (chunk: Uint8Array) => {
          bodyLength += chunk.length;
        });
        res.on("error", (err) =>
          settle(() =>
            reject(
              new Error(`Response stream error: ${err.message}`, {
                cause: err,
              }),
            ),
          ),
        );
        res.on("end", () => {
          const totalTime = performance.now() - start;
          settle(() =>
            resolve({
              dnsMs: dnsTime,
              tcpMs: tcpTime,
              tlsMs: tlsTime,
              firstByteMs: firstByteTime,
              totalMs: totalTime,
              statusCode: res.statusCode ?? 0,
              bodyLength,
            }),
          );
        });
      },
    );

    req.on("socket", (socket) => {
      socket.on("lookup", () => {
        dnsTime = performance.now() - start;
      });
      socket.on("connect", () => {
        tcpTime = performance.now() - start;
      });
      socket.on("secureConnect", () => {
        tlsTime = performance.now() - start;
      });
    });

    req.on("timeout", () => {
      req.destroy();
      settle(() => reject(new Error(`Request timed out after ${timeout}ms`)));
    });

    req.on("error", (err) => settle(() => reject(err)));

    req.write(opts.query);
    req.end();
  });
}

export interface ConnectionSpikeResult {
  readonly timings: readonly ConnectionTiming[];
  readonly fastest: ConnectionTiming;
  readonly slowest: ConnectionTiming;
  readonly spikeDetected: boolean;
  readonly spikePhase: SpikePhase | null;
}

/**
 * Run multiple timed HTTP queries and identify which phase caused any spike.
 * A spike is detected when the slowest request is >10x slower than the fastest,
 * and the fastest took at least 1ms (to avoid false positives on sub-millisecond
 * localhost responses).
 */
export async function diagnoseConnectionSpike(
  opts: ConnectionTimingOptions,
  runs: number = 6,
): Promise<ConnectionSpikeResult> {
  validateRuns(runs);

  const timings: ConnectionTiming[] = [];
  for (let i = 0; i < runs; i++) {
    timings.push(await timedHttpQuery(opts));
  }

  const sorted = [...timings].sort((a, b) => a.totalMs - b.totalMs);
  const fastest = sorted[0];
  const slowest = sorted[sorted.length - 1];

  // Require fastest > 1ms to avoid division-by-near-zero false positives
  const spikeDetected =
    fastest.totalMs > 1 && slowest.totalMs > fastest.totalMs * 10;

  let spikePhase: SpikePhase | null = null;
  if (spikeDetected) {
    // For non-TLS connections, tlsMs stays 0. Use tcpMs as the TLS/TCP boundary
    // so that phase durations don't go negative.
    const fastTlsEnd = fastest.tlsMs || fastest.tcpMs;
    const slowTlsEnd = slowest.tlsMs || slowest.tcpMs;

    const phases: { name: SpikePhase; fast: number; slow: number }[] = [
      { name: "DNS", fast: fastest.dnsMs, slow: slowest.dnsMs },
      {
        name: "TCP",
        fast: fastest.tcpMs - fastest.dnsMs,
        slow: slowest.tcpMs - slowest.dnsMs,
      },
      ...(fastest.tlsMs > 0 ?
        [
          {
            name: "TLS" as const,
            fast: fastest.tlsMs - fastest.tcpMs,
            slow: slowest.tlsMs - slowest.tcpMs,
          },
        ]
      : []),
      {
        name: "Server processing (TTFB)",
        fast: fastest.firstByteMs - fastTlsEnd,
        slow: slowest.firstByteMs - slowTlsEnd,
      },
      {
        name: "Response transfer",
        fast: fastest.totalMs - fastest.firstByteMs,
        slow: slowest.totalMs - slowest.firstByteMs,
      },
    ];

    let maxDelta = 0;
    for (const phase of phases) {
      const delta = phase.slow - phase.fast;
      if (delta > maxDelta) {
        maxDelta = delta;
        spikePhase = phase.name;
      }
    }
  }

  return { timings, fastest, slowest, spikeDetected, spikePhase };
}
