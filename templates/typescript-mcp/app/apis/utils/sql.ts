/**
 * SQL Query Validation and Security Utilities
 *
 * This module provides security functions for validating and sanitizing SQL queries
 * to prevent dangerous operations and enforce row limits.
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
export function validateQueryBlocklist(query: string): ValidationResult | null {
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

  const upperQuery = query.toUpperCase();
  for (const keyword of dangerousKeywords) {
    // Match keyword as a whole word (with word boundaries)
    const regex = new RegExp(`\\b${keyword}\\b`, "i");
    if (regex.test(upperQuery)) {
      return {
        valid: false,
        error: `Dangerous operation '${keyword}' not allowed in queries`,
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
 * - If query has existing LIMIT, wraps in subquery to enforce maximum
 * - If query has no LIMIT, appends one
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

  // Check if query already has a LIMIT clause
  const hasLimit = /\bLIMIT\s+\d+/i.test(trimmed);

  if (hasLimit) {
    // Wrap the query in a subquery to enforce our maximum limit
    return `SELECT * FROM (${trimmed}) AS subquery LIMIT ${maxLimit}`;
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
