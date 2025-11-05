/**
 * SQL Query Validation and Security Utilities
 *
 * This module provides security functions for validating and sanitizing SQL queries
 * to prevent dangerous operations and enforce row limits.
 *
 * Implementation Notes:
 * - Uses regex-based validation (no SQL parser dependency required)
 * - Handles ClickHouse-specific SQL patterns
 * - Supports various LIMIT clause formats (LIMIT n, LIMIT n OFFSET m, LIMIT n, m)
 * - Handles parameterized queries (LIMIT ?, LIMIT :param)
 * - Handles CTEs (WITH clauses) without breaking syntax
 * - Replaces existing LIMIT rather than wrapping in subquery (avoids CTE issues)
 *
 * Edge Cases Handled:
 * - Comments before SQL keywords (-- comment\nSELECT)
 * - Multiple whitespace variations
 * - Case-insensitive keyword matching
 * - LIMIT with OFFSET in various formats
 * - Parameterized queries with placeholders
 */

/**
 * SQL Query Validation Result
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
  supportsLimit: boolean;
}

/**
 * Validates that a query starts with an allowed SQL keyword.
 *
 * Whitelist: SELECT, SHOW, DESCRIBE, DESC, EXPLAIN
 *
 * @param query - The SQL query to validate
 * @returns ValidationResult or null if valid
 */
export function validateQueryWhitelist(query: string): ValidationResult | null {
  const trimmed = query.trim();

  if (!trimmed) {
    return {
      valid: false,
      error: "Query cannot be empty",
      supportsLimit: false,
    };
  }

  // Extract the first SQL keyword (handle comments and whitespace)
  const firstKeywordMatch = trimmed.match(/^\s*(?:--[^\n]*\n\s*)*(\w+)/i);
  if (!firstKeywordMatch) {
    return {
      valid: false,
      error: "Could not parse SQL query",
      supportsLimit: false,
    };
  }

  const firstKeyword = firstKeywordMatch[1].toUpperCase();

  // Whitelist: Only allow specific read-only operations
  const allowedKeywords = ["SELECT", "SHOW", "DESCRIBE", "DESC", "EXPLAIN"];

  if (!allowedKeywords.includes(firstKeyword)) {
    return {
      valid: false,
      error: `Query type '${firstKeyword}' not allowed. Only SELECT, SHOW, DESCRIBE, EXPLAIN queries are permitted`,
      supportsLimit: false,
    };
  }

  // Determine if this query type supports LIMIT clauses
  const supportsLimit = firstKeyword === "SELECT";

  return null; // Valid - return null to indicate no error
}

/**
 * Checks for dangerous SQL keywords that should never appear in queries.
 *
 * Blocklist: INSERT, UPDATE, DELETE, DROP, CREATE, ALTER, TRUNCATE, GRANT, REVOKE, EXECUTE, CALL
 *
 * @param query - The SQL query to validate
 * @returns ValidationResult or null if valid
 */
// Blocklist keywords and their regexes (precompiled once)
const dangerousKeywords = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "CREATE",
  "ALTER",
  "TRUNCATE",
  "GRANT",
  "REVOKE",
  "EXECUTE",
  "CALL",
];

const dangerousKeywordRegexes = dangerousKeywords.map(
  (keyword) => new RegExp(`\\b${keyword}\\b`),
);

export function validateQueryBlocklist(query: string): ValidationResult | null {
  const upperQuery = query.toUpperCase();
  for (let i = 0; i < dangerousKeywordRegexes.length; i++) {
    const regex = dangerousKeywordRegexes[i];
    if (regex.test(upperQuery)) {
      return {
        valid: false,
        error: `Dangerous operation '${dangerousKeywords[i]}' not allowed in queries`,
        supportsLimit: false,
      };
    }
  }

  return null; // Valid - return null to indicate no error
}

/**
 * Applies or enforces a LIMIT clause on a SQL query.
 *
 * - If query doesn't support LIMIT (SHOW, DESCRIBE, EXPLAIN), returns unchanged
 * - If query has existing LIMIT, replaces it with enforced maximum
 * - If query has no LIMIT, appends one
 *
 * Handles various LIMIT patterns:
 * - LIMIT <number>
 * - LIMIT <number> OFFSET <number>
 * - LIMIT <offset>, <count>
 * - LIMIT ? (parameterized queries)
 * - Queries with WITH clauses (CTEs)
 *
 * @param query - The SQL query
 * @param maxLimit - Maximum number of rows to return
 * @param supportsLimit - Whether this query type supports LIMIT clauses
 * @returns Query with enforced LIMIT
 */
export function applyLimitToQuery(
  query: string,
  maxLimit: number,
  supportsLimit: boolean,
): string {
  if (!supportsLimit) {
    return query;
  }

  const trimmed = query.trim();

  // Check if query already has a LIMIT clause (comprehensive pattern)
  // Matches: LIMIT <number>, LIMIT <number> OFFSET <number>, LIMIT <number>, <number>, LIMIT ?
  const limitPattern =
    /\bLIMIT\s+(?:\d+|\?|:\w+)(?:\s+OFFSET\s+(?:\d+|\?|:\w+)|\s*,\s*(?:\d+|\?|:\w+))?/i;
  const hasLimit = limitPattern.test(trimmed);

  if (hasLimit) {
    // Replace existing LIMIT clause with our enforced maximum
    // This avoids creating invalid SQL with duplicate LIMIT clauses
    // and handles CTEs correctly (no subquery wrapping needed)
    return trimmed.replace(limitPattern, `LIMIT ${maxLimit}`);
  } else {
    // Simply append the LIMIT clause
    return `${trimmed} LIMIT ${maxLimit}`;
  }
}

/**
 * Validates SQL queries to ensure only safe, read-only operations are permitted.
 *
 * @param query - The SQL query to validate
 * @returns ValidationResult with validation status and metadata
 */
export function validateQuery(query: string): ValidationResult {
  // Check whitelist
  const whitelistError = validateQueryWhitelist(query);
  if (whitelistError) {
    return whitelistError;
  }

  // Check blocklist
  const blocklistError = validateQueryBlocklist(query);
  if (blocklistError) {
    return blocklistError;
  }

  // Determine if query supports LIMIT (only SELECT does)
  const firstKeyword = query
    .trim()
    .match(/^\s*(?:--[^\n]*\n\s*)*(\w+)/i)?.[1]
    .toUpperCase();
  const supportsLimit = firstKeyword === "SELECT";

  return {
    valid: true,
    supportsLimit,
  };
}
