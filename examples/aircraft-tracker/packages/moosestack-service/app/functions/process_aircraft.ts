import {
  AircraftTrackingData,
  AircraftTrackingProcessed,
} from "../datamodels/models";

function calculateZOrder(lat: number, lon: number): number {
  const latInt = Math.floor(((lat + 90.0) * (1 << 20)) / 180.0);
  const lonInt = Math.floor(((lon + 180.0) * (1 << 20)) / 360.0);

  let result = 0;
  for (let i = 0; i < 20; i++) {
    result |= ((latInt & (1 << i)) << i) | ((lonInt & (1 << i)) << (i + 1));
  }
  return result;
}

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

export function transformAircraft(
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
