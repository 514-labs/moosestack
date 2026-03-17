import { Key, IngestPipeline } from "@514labs/moose-lib";

export interface AircraftTrackingData {
  // Aircraft identifiers
  hex: string; // using hex as the key since it appears to be a unique aircraft identifier
  transponder_type: string;
  flight: string;
  r: string;
  aircraft_type?: string;
  dbFlags: number;

  // Position data
  lat: number;
  lon: number;
  alt_baro: number;
  alt_baro_is_ground: boolean;
  alt_geom: number;
  gs: number;
  track: number;
  baro_rate: number;
  geom_rate?: number;
  squawk: string;

  // Status information
  emergency: string;
  category: string;
  nav_qnh?: number;
  nav_altitude_mcp?: number;
  nav_heading?: number;
  nav_modes?: string[];

  // Technical parameters
  nic: number;
  rc: number;
  seen_pos: number;
  version: number;
  nic_baro: number;
  nac_p: number;
  nac_v: number;
  sil: number;
  sil_type: string;
  gva: number;
  sda: number;

  // Status flags
  alert: number;
  spi: number;

  // Arrays
  mlat: string[];
  tisb: string[];

  // Additional metrics
  messages: number;
  seen: number;
  rssi: number;

  // Timestamp
  timestamp: Date;
}

export interface AircraftTrackingProcessed extends AircraftTrackingData {
  zorderCoordinate: Key<number>;
  approach: boolean;
  autopilot: boolean;
  althold: boolean;
  lnav: boolean;
  tcas: boolean;
}

export const AircraftTrackingDataPipeline =
  new IngestPipeline<AircraftTrackingData>("AircraftTrackingData", {
    table: false,
    stream: true,
    ingestApi: true,
  });

export const AircraftTrackingProcessedPipeline =
  new IngestPipeline<AircraftTrackingProcessed>("AircraftTrackingProcessed", {
    table: true,
    stream: true,
    ingestApi: false,
  });
