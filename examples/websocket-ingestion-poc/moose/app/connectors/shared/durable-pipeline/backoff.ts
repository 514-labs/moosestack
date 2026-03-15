import { ReconnectPolicy } from "./types";

export const DEFAULT_RECONNECT_POLICY: ReconnectPolicy = {
  initialMs: 500,
  maxMs: 30_000,
  multiplier: 2,
  jitter: 0.2,
};

function applyJitter(baseMs: number, jitter: number): number {
  if (jitter <= 0) {
    return baseMs;
  }

  const spread = baseMs * jitter;
  const min = Math.max(0, baseMs - spread);
  const max = baseMs + spread;
  return Math.floor(min + Math.random() * (max - min));
}

export function getBackoffMs(policy: ReconnectPolicy, attempt: number): number {
  const base = Math.min(
    policy.maxMs,
    Math.floor(policy.initialMs * Math.pow(policy.multiplier, attempt)),
  );

  return applyJitter(base, policy.jitter);
}

export function waitMs(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
