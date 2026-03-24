/** Validate that a `runs` parameter is a positive integer. */
export function validateRuns(runs: number): void {
  if (!Number.isInteger(runs) || runs < 1) {
    throw new Error(`runs must be a positive integer, got ${runs}`);
  }
}
