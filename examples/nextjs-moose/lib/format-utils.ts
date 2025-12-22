/**
 * Formats a number as a currency value in USD.
 * @param value - The numeric value to format
 * @returns Formatted currency string (e.g., "$1,234")
 */
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Formats a number with locale-specific formatting.
 * @param value - The numeric value to format
 * @returns Formatted number string (e.g., "1,234")
 */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
