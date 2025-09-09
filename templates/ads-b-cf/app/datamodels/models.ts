import { Key, IngestPipeline, DeadLetterQueue } from "@514labs/moose-lib";

// =============================================================================
// DATA MODEL DEFINITIONS
// =============================================================================

export interface AircraftTrackingData {
  // Aircraft identifiers
  hex: string; // using hex as the key since it appears to be a unique aircraft identifier
  transponder_type: string;
  flight: string;
  r: string;
  aircraft_type?: string;
  dbFlags: number;

  // Data source identifier
  source: "Mil" | "LADD";

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

// LADD (Limiting Aircraft Data Displayed) interface with additional fields
export interface LADDAircraftData extends AircraftTrackingData {
  // Additional navigation and performance fields from LADD API
  true_heading?: number;
  indicated_airspeed?: number;
  mach_number?: number;
  magnetic_heading?: number;
  outside_air_temp?: number;
  roll_angle?: number;
  true_airspeed?: number;
  total_air_temp?: number;
  track_rate?: number;
  wind_direction?: number;
  wind_speed?: number;
  gps_ok_before?: number;
  gps_ok_lat?: number;
  gps_ok_lon?: number;
  last_position_lat?: number;
  last_position_lon?: number;
  last_position_nic?: number;
  receiver_lat?: number;
  receiver_lon?: number;
  calculated_track?: number;
  nav_altitude_fms?: number;
}

// =============================================================================
// PIPELINE DEFINITIONS
// =============================================================================

export const AircraftTrackingDataPipeline =
  new IngestPipeline<AircraftTrackingData>("AircraftTrackingData", {
    table: false,
    stream: true,
    ingestApi: true,
    deadLetterQueue: true,
    metadata: {
      description:
        "Raw aircraft tracking data from ADS-B APIs including military and civilian aircraft",
    },
  });

export const AircraftTrackingProcessedPipeline =
  new IngestPipeline<AircraftTrackingProcessed>("AircraftTrackingProcessed", {
    table: true,
    stream: true,
    ingestApi: false,
    deadLetterQueue: true,
    metadata: {
      description:
        "Processed aircraft data with geospatial coordinates and parsed navigation modes",
    },
  });

export const LADDAircraftDataPipeline = new IngestPipeline<LADDAircraftData>(
  "LADDAircraftData",
  {
    table: false,
    stream: true,
    ingestApi: true,
    deadLetterQueue: true,
    metadata: {
      description:
        "Enhanced aircraft data from LADD API with additional performance and navigation fields",
    },
  },
);
