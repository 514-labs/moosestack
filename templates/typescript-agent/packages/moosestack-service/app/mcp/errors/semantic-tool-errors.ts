const SAFE_SEMANTIC_ERROR_PATTERNS = [
  /^Unknown filter '/i,
  /^Operator '.*' not allowed for filter '/i,
  /^Field '.*' is not sortable$/i,
  /^Field '.*' is not a valid dimension$/i,
  /^Invalid sort direction '/i,
  /^Cannot specify both 'offset' and 'page'/i,
] as const;

const TEMPORARY_BACKEND_ERROR_PATTERNS = [
  /fetch failed/i,
  /socket hang up/i,
  /ECONNREFUSED/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /timed out/i,
  /network error/i,
  /connection refused/i,
] as const;

const TIMESTAMP_FILTER_ERROR_PATTERNS = [
  /Cannot parse .*DateTime/i,
  /Cannot parse datetime/i,
  /value is too short for DateTime/i,
] as const;

const SCHEMA_DRIFT_ERROR_PATTERNS = [
  /Unknown table/i,
  /doesn't exist/i,
  /Unknown expression identifier/i,
  /Missing columns/i,
  /NOT_FOUND_COLUMN_IN_BLOCK/i,
] as const;

export function formatSemanticToolError(error: unknown, toolTitle: string): string {
  const errorMessage = error instanceof Error ? error.message : String(error);

  if (
    SAFE_SEMANTIC_ERROR_PATTERNS.some((pattern) => {
      return pattern.test(errorMessage);
    })
  ) {
    return errorMessage;
  }

  if (
    TIMESTAMP_FILTER_ERROR_PATTERNS.some((pattern) => {
      return pattern.test(errorMessage);
    })
  ) {
    return "One of the timestamp filters is invalid. Use ISO-8601 date/time strings and try again.";
  }

  if (
    SCHEMA_DRIFT_ERROR_PATTERNS.some((pattern) => {
      return pattern.test(errorMessage);
    })
  ) {
    return `${toolTitle} is out of sync with the backing schema. Check the Moose service build/deployment or use get_data_catalog to inspect the exposed data surface.`;
  }

  if (
    TEMPORARY_BACKEND_ERROR_PATTERNS.some((pattern) => {
      return pattern.test(errorMessage);
    })
  ) {
    return `${toolTitle} is temporarily unavailable because the Moose service or ClickHouse backend is unreachable. Try again in a moment.`;
  }

  return `Unable to execute ${toolTitle} right now. Try again, or inspect the Moose service logs for details.`;
}
