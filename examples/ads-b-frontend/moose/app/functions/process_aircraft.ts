import {
  AircraftTrackingData,
  AircraftTrackingDataPipeline,
  AircraftTrackingProcessed,
  AircraftTrackingProcessedPipeline,
} from "../datamodels/models";

function calculateZOrder(lat: number, lon: number): number {
  // Normalize lat/lon to integers between 0 and 2^20
  const latInt = Math.floor(((lat + 90.0) * (1 << 20)) / 180.0);
  const lonInt = Math.floor(((lon + 180.0) * (1 << 20)) / 360.0);

  // Interleave bits
  let result = 0;
  for (let i = 0; i < 20; i++) {
    result |= ((latInt & (1 << i)) << i) | ((lonInt & (1 << i)) << (i + 1));
  }
  return result;
}

/**
 * Converts NavModes array to boolean flags
 * @param navModes Array of navigation modes
 * @returns Object containing boolean flags for each nav mode
 */
function parseNavModes(navModes?: string[]): {
  approach: boolean;
  autopilot: boolean;
  althold: boolean;
  lnav: boolean;
  tcas: boolean;
} {
  return {
    approach: navModes?.includes("approach") ?? false,
    autopilot: navModes?.includes("autopilot") ?? false,
    althold: navModes?.includes("althold") ?? false,
    lnav: navModes?.includes("lnav") ?? false,
    tcas: navModes?.includes("tcas") ?? false,
  };
}

function transformAircraft(
  record: AircraftTrackingData,
): AircraftTrackingProcessed {
  const zorderCoordinate = calculateZOrder(record.lat, record.lon);
  const { approach, autopilot, althold, lnav, tcas } = parseNavModes(
    record.nav_modes,
  );
  return {
    ...record,
    zorderCoordinate,
    approach,
    autopilot,
    althold,
    lnav,
    tcas,
    timestamp: new Date(record.timestamp),
  };
}

AircraftTrackingDataPipeline!.stream!.addTransform(
  AircraftTrackingProcessedPipeline!.stream!,
  transformAircraft,
);
