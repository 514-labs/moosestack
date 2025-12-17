export function getDateRange(
  range: string | null,
): { start: Date; end: Date } | undefined {
  if (!range || range === "all") {
    return undefined;
  }

  const end = new Date();
  end.setHours(23, 59, 59, 999); // End of today

  const start = new Date();

  switch (range) {
    case "7d":
      start.setDate(start.getDate() - 7);
      break;
    case "30d":
      start.setDate(start.getDate() - 30);
      break;
    case "90d":
      start.setDate(start.getDate() - 90);
      break;
    default:
      return undefined;
  }

  start.setHours(0, 0, 0, 0); // Start of day

  return { start, end };
}
