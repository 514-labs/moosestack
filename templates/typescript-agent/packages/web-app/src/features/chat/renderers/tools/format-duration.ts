const MILLISECONDS_THRESHOLD = 5000;

export function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    return "0ms";
  }

  if (milliseconds < MILLISECONDS_THRESHOLD) {
    return `${Math.round(milliseconds)}ms`;
  }

  const seconds = milliseconds / 1000;
  return `${seconds.toFixed(2)}s`;
}
