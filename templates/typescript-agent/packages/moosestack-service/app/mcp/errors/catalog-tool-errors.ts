const SAFE_CATALOG_ERROR_PATTERNS = [/^Invalid component_type:/i, /^Invalid format:/i] as const;

export function formatCatalogToolError(error: unknown): string {
  const errorMessage = error instanceof Error ? error.message : String(error);

  if (SAFE_CATALOG_ERROR_PATTERNS.some((pattern) => pattern.test(errorMessage))) {
    return errorMessage;
  }

  return "Unable to retrieve the data catalog right now. Try again in a moment.";
}
