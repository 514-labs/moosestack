/**
 * Chart export utilities for various formats.
 */

import type { ExportFormat, ExportData } from "./chart-types";

/**
 * Export chart as PNG using canvas-based approach.
 */
export async function exportChartAsPNG(
  chartElement: HTMLElement,
  filename: string,
): Promise<void> {
  const canvas = await htmlToCanvas(chartElement);
  const url = canvas.toDataURL("image/png");
  downloadFile(url, `${filename}.png`);
}

/**
 * Export chart as SVG.
 */
export function exportChartAsSVG(
  chartElement: HTMLElement,
  filename: string,
): void {
  const svgElement = chartElement.querySelector("svg");
  if (!svgElement) {
    throw new Error("No SVG element found in chart");
  }

  const svgData = new XMLSerializer().serializeToString(svgElement);
  const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  downloadFile(url, `${filename}.svg`);
  URL.revokeObjectURL(url);
}

/**
 * Export chart data as CSV.
 */
export function exportChartAsCSV(data: ExportData, filename: string): void {
  if (!data.csv) {
    throw new Error("CSV data not available for this chart");
  }

  const blob = new Blob([data.csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  downloadFile(url, `${filename}.csv`);
  URL.revokeObjectURL(url);
}

/**
 * Export chart data as JSON.
 */
export function exportChartAsJSON(data: ExportData, filename: string): void {
  if (!data.json) {
    throw new Error("JSON data not available for this chart");
  }

  const jsonString = JSON.stringify(data.json, null, 2);
  const blob = new Blob([jsonString], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  downloadFile(url, `${filename}.json`);
  URL.revokeObjectURL(url);
}

/**
 * Export chart as PDF (requires jsPDF library).
 */
export async function exportChartAsPDF(
  chartElement: HTMLElement,
  filename: string,
): Promise<void> {
  // Dynamic import to avoid bundling jsPDF if not used
  const { default: jsPDF } = await import("jspdf");
  const canvas = await htmlToCanvas(chartElement);
  const imgData = canvas.toDataURL("image/png");

  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "px",
    format: [canvas.width, canvas.height],
  });

  pdf.addImage(imgData, "PNG", 0, 0, canvas.width, canvas.height);
  pdf.save(`${filename}.pdf`);
}

/**
 * Convert HTML element to canvas.
 */
async function htmlToCanvas(element: HTMLElement): Promise<HTMLCanvasElement> {
  // Dynamic import to avoid bundling html2canvas if not used
  const html2canvas = (await import("html2canvas")).default;
  return await html2canvas(element, {
    backgroundColor: null,
    scale: 2,
    logging: false,
  });
}

/**
 * Download a file from a URL.
 */
function downloadFile(url: string, filename: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
