/**
 * Chart share utilities for generating shareable URLs and copying to clipboard.
 */

import type {
  ShareableState,
  ChartType,
  ChartDisplayOptions,
} from "./chart-types";

/**
 * Generate a shareable URL for a chart.
 */
export function generateShareableUrl(
  chartId: string,
  chartType: ChartType,
  data: unknown,
  options: ChartDisplayOptions,
): string {
  const state: ShareableState = {
    chartId,
    chartType,
    data,
    options,
  };

  const encoded = encodeURIComponent(JSON.stringify(state));
  const baseUrl = window.location.origin;
  return `${baseUrl}/dashboard/chart/${chartId}?state=${encoded}`;
}

/**
 * Copy shareable URL to clipboard.
 */
export async function copyShareableUrl(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
  } catch (err) {
    // Fallback for older browsers
    const textArea = document.createElement("textarea");
    textArea.value = url;
    textArea.style.position = "fixed";
    textArea.style.opacity = "0";
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand("copy");
    document.body.removeChild(textArea);
  }
}

/**
 * Get shareable state object.
 */
export function getShareableState(
  chartId: string,
  chartType: ChartType,
  data: unknown,
  options: ChartDisplayOptions,
): ShareableState {
  return {
    chartId,
    chartType,
    data,
    options,
  };
}

/**
 * Decode shareable state from URL.
 */
export function decodeShareableState(encoded: string): ShareableState | null {
  try {
    const decoded = decodeURIComponent(encoded);
    return JSON.parse(decoded) as ShareableState;
  } catch {
    return null;
  }
}
