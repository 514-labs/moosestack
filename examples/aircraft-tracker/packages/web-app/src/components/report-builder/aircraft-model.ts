import type { ReportModel } from "./types";

/**
 * Client-side metadata matching the aircraftMetrics query model
 * defined in packages/moosestack-service/app/query-models/aircraft-metrics.ts.
 */
export const aircraftReportModel: ReportModel = {
  dimensions: [
    { id: "minute", label: "Minute", description: "Group by minute" },
    { id: "day", label: "Day", description: "Group by calendar day" },
    { id: "hour", label: "Hour", description: "Group by hour" },
    { id: "month", label: "Month", description: "Group by month" },
    {
      id: "category",
      label: "Category",
      description: "Emitter category (A0–A7, B, C, D)",
    },
    {
      id: "aircraftType",
      label: "Aircraft Type",
      description: "ICAO type designator (B738, C130, F16, etc.)",
      dataKey: "aircraft_type",
    },
    {
      id: "transponderType",
      label: "Transponder",
      description: "Transponder message source type",
      dataKey: "transponder_type",
    },
    {
      id: "emergency",
      label: "Emergency",
      description: "Emergency status (none, general, lifeguard, etc.)",
    },
  ],
  metrics: [
    {
      id: "totalAircraft",
      label: "Total Aircraft",
      description: "Distinct ICAO hex addresses",
    },
    {
      id: "planesInAir",
      label: "In Air",
      description: "Aircraft currently airborne",
    },
    {
      id: "planesOnGround",
      label: "On Ground",
      description: "Aircraft reporting as on ground",
    },
    {
      id: "avgGroundSpeed",
      label: "Avg Speed",
      description: "Average ground speed (knots)",
    },
    {
      id: "maxAltitude",
      label: "Max Altitude",
      description: "Maximum barometric altitude (feet)",
    },
    {
      id: "avgAltitude",
      label: "Avg Altitude",
      description: "Average altitude of airborne aircraft (feet)",
    },
    {
      id: "emergencyCount",
      label: "Emergencies",
      description: "Aircraft with active emergency squawk",
    },
    {
      id: "autopilotEngaged",
      label: "Autopilot",
      description: "Aircraft with autopilot engaged",
    },
    {
      id: "totalDatapoints",
      label: "Datapoints",
      description: "Total ADS-B datapoints (rows) ingested",
    },
  ],
  filters: [
    {
      id: "category",
      label: "Category",
      description: "Filter by emitter category (aircraft size class)",
      operators: ["eq", "in"],
      values: [
        { value: "A0", label: "A0 — Unspecified" },
        { value: "A1", label: "A1 — Light (<15,500 lbs)" },
        { value: "A2", label: "A2 — Small (15,500–75,000 lbs)" },
        { value: "A3", label: "A3 — Large (75,000–300,000 lbs)" },
        { value: "A4", label: "A4 — High-vortex (B757)" },
        { value: "A5", label: "A5 — Heavy (>300,000 lbs)" },
        { value: "A6", label: "A6 — High-performance" },
        { value: "A7", label: "A7 — Rotorcraft" },
      ],
    },
    {
      id: "aircraftType",
      label: "Aircraft Type",
      description: "Filter by ICAO type designator (e.g. B738, C130, F16)",
      operators: ["eq", "in"],
    },
    {
      id: "emergency",
      label: "Emergency",
      description: "Filter by emergency status",
      operators: ["eq", "in"],
      values: [
        { value: "none", label: "None" },
        { value: "general", label: "General" },
        { value: "lifeguard", label: "Lifeguard" },
        { value: "minfuel", label: "Minimum fuel" },
        { value: "nordo", label: "No radio" },
        { value: "unlawful", label: "Unlawful interference" },
        { value: "downed", label: "Downed aircraft" },
      ],
    },
  ],
};
