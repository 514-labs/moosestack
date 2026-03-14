import {
  LowCardinality,
  ClickHouseDefault,
  UInt8,
  UInt16,
  UInt32,
  UInt64,
  Int32,
  Float64,
} from "@514labs/moose-lib";

/**
 * Raw aircraft tracking data from the ADS-B Exchange API (adsb.lol).
 *
 * Each record represents a single snapshot of an aircraft's state as reported
 * by ADS-B, Mode S, MLAT, or TIS-B transponder messages. Data is polled from
 * the `/v2/mil` endpoint every 30 seconds by the ingestion workflow.
 *
 * Field names and semantics follow the adsb.lol OpenAPI schema:
 * @see https://api.adsb.lol/docs
 */
export interface AircraftTrackingData {
  /**
   * ICAO 24-bit transponder address, rendered as 6 lowercase hex characters.
   * This is the primary identifier for a physical aircraft. Values prefixed
   * with `~` denote non-ICAO addresses (e.g. TIS-B track files).
   * @example "a1b2c3"
   */
  hex: string;

  /**
   * Best source of the current data for this aircraft. Indicates the type of
   * underlying messages being decoded.
   * @example "adsb_icao" | "adsr_icao" | "tisb_icao" | "mlat" | "mode_s" | "adsb_other" | "adsr_other" | "tisb_other" | "tisb_trackfile"
   */
  transponder_type: string & LowCardinality & ClickHouseDefault<"''">;

  /**
   * Callsign or flight number, padded to 8 characters. This is the identifier
   * shown on ATC screens (e.g. "UAL123  "). May be empty if the aircraft has
   * not transmitted an identification message.
   * @example "AME3508 "
   */
  flight: string & ClickHouseDefault<"''">;

  /**
   * Aircraft registration / tail number pulled from a local database lookup
   * keyed on the ICAO hex address. Empty if not found in the database.
   * @example "N12345"
   */
  r: string & ClickHouseDefault<"''">;

  /**
   * ICAO aircraft type designator per DOC 8643 (e.g. "B738", "A320", "C172").
   * Pulled from a local database lookup. Empty if not found.
   * Maps to the `t` field in the raw adsb.lol API response.
   * @example "B738"
   */
  aircraft_type: string & LowCardinality & ClickHouseDefault<"''">;

  /**
   * Database flag bitfield from the adsb.lol aircraft database.
   * - Bit 0 (1): military
   * - Bit 1 (2): interesting
   * - Bit 2 (4): PIA (Privacy ICAO Address)
   * - Bit 3 (8): LADD (Limiting Aircraft Data Displayed)
   */
  dbFlags: UInt8 & ClickHouseDefault<"0">;

  /**
   * Aircraft latitude in decimal degrees, WGS-84. Range: -90 to +90.
   * Zero when position is unknown or not yet received.
   */
  lat: Float64 & ClickHouseDefault<"0">;

  /**
   * Aircraft longitude in decimal degrees, WGS-84. Range: -180 to +180.
   * Zero when position is unknown or not yet received.
   */
  lon: Float64 & ClickHouseDefault<"0">;

  /**
   * Barometric altitude in feet relative to the standard pressure setting
   * (1013.25 hPa). Set to 0 when `alt_baro_is_ground` is true.
   * In the raw API this field can be the string "ground" or a number.
   */
  alt_baro: Int32 & ClickHouseDefault<"0">;

  /**
   * Whether the aircraft is reporting as on the ground. When true,
   * `alt_baro` is set to 0. Derived from the raw API where `alt_baro`
   * may be the literal string "ground".
   */
  alt_baro_is_ground: boolean;

  /**
   * Geometric (GNSS / INS) altitude in feet referenced to the WGS-84
   * ellipsoid. This differs from barometric altitude and is generally
   * more accurate but less commonly available.
   */
  alt_geom: Int32 & ClickHouseDefault<"0">;

  /**
   * Ground speed in knots, as reported by the transponder.
   */
  gs: Float64 & ClickHouseDefault<"0">;

  /**
   * True track over ground in degrees (0–359.9). This is the direction
   * the aircraft is actually moving, which may differ from heading in
   * crosswind conditions.
   */
  track: Float64 & ClickHouseDefault<"0">;

  /**
   * Barometric altitude rate of change in feet per minute.
   * Positive = climbing, negative = descending.
   */
  baro_rate: Int32 & ClickHouseDefault<"0">;

  /**
   * Geometric (GNSS / INS) altitude rate of change in feet per minute.
   * Positive = climbing, negative = descending.
   */
  geom_rate: Int32 & ClickHouseDefault<"0">;

  /**
   * Mode A transponder code (squawk), encoded as 4 octal digits.
   * Special codes: 7500 = hijack, 7600 = radio failure, 7700 = emergency.
   * @example "1200" | "7700"
   */
  squawk: string & ClickHouseDefault<"''">;

  /**
   * ADS-B emergency/priority status. Superset of the 7x00 squawk codes.
   * @example "none" | "general" | "lifeguard" | "minfuel" | "nordo" | "unlawful" | "downed" | "reserved"
   */
  emergency: string & LowCardinality & ClickHouseDefault<"'none'">;

  /**
   * ADS-B emitter category identifying the aircraft or vehicle class.
   * Categories range from A0–A7 (fixed-wing) through D0–D7 (other).
   * @see https://www.adsbexchange.com/emitter-category-ads-b-do-260b-2-2-3-2-5-2/
   * @example "A3" (large aircraft, 75,000–300,000 lbs)
   */
  category: string & LowCardinality & ClickHouseDefault<"''">;

  /**
   * Altimeter setting (QNH) in hectopascals as selected on the aircraft.
   * Standard pressure is 1013.25 hPa. Zero if not available.
   */
  nav_qnh: Float64 & ClickHouseDefault<"0">;

  /**
   * Selected altitude from the Mode Control Panel (MCP) or Flight Control
   * Unit (FCU), in feet. This is the altitude the pilot has dialed into
   * the autopilot. Zero if not available.
   */
  nav_altitude_mcp: Int32 & ClickHouseDefault<"0">;

  /**
   * Selected heading from the aircraft's flight management system.
   * Whether this is true or magnetic heading is not defined in DO-260B;
   * in practice it is usually magnetic. Zero if not available.
   */
  nav_heading: Float64 & ClickHouseDefault<"0">;

  /**
   * Set of currently engaged automation modes, as an array of strings.
   * Possible values: "autopilot", "vnav", "althold", "approach", "lnav", "tcas".
   * Empty array if no modes are engaged or data is unavailable.
   */
  nav_modes: string[];

  /**
   * Navigation Integrity Category (NIC). Indicates the radius of
   * containment for the reported position. Higher = more accurate.
   * Range: 0–11. See DO-260B Table 2-74.
   */
  nic: UInt8 & ClickHouseDefault<"0">;

  /**
   * Radius of Containment (Rc) in metres. Derived from NIC and any
   * supplementary bits. Represents the 95% containment radius of the
   * reported position.
   */
  rc: UInt32 & ClickHouseDefault<"0">;

  /**
   * How many seconds ago (before "now" at the receiver) the position
   * was last updated. Lower values = more recent position fixes.
   */
  seen_pos: Float64 & ClickHouseDefault<"0">;

  /**
   * ADS-B version number as defined in DO-260 (0), DO-260A (1),
   * or DO-260B (2). Versions 3–7 are reserved.
   */
  version: UInt8 & ClickHouseDefault<"0">;

  /**
   * Navigation Integrity Category for Barometric Altitude (NICbaro).
   * Indicates whether barometric altitude has been cross-checked.
   * 0 = not cross-checked, 1 = cross-checked.
   */
  nic_baro: UInt8 & ClickHouseDefault<"0">;

  /**
   * Navigation Accuracy Category for Position (NACp).
   * Indicates the 95% accuracy of the reported position.
   * Range: 0–11, higher = better. See DO-260B Table 2-73.
   */
  nac_p: UInt8 & ClickHouseDefault<"0">;

  /**
   * Navigation Accuracy Category for Velocity (NACv).
   * Indicates the 95% accuracy of the reported velocity.
   * Range: 0–4, higher = better.
   */
  nac_v: UInt8 & ClickHouseDefault<"0">;

  /**
   * Source Integrity Level (SIL). Probability of exceeding the NIC
   * containment radius without an alert.
   * Range: 0–3, higher = more integrity.
   */
  sil: UInt8 & ClickHouseDefault<"0">;

  /**
   * How the SIL value is interpreted.
   * - "unknown": SIL supplement not available
   * - "perhour": probability is per hour of flight
   * - "persample": probability is per sample
   */
  sil_type: string & LowCardinality & ClickHouseDefault<"'unknown'">;

  /**
   * Geometric Vertical Accuracy (GVA). Indicates the accuracy of
   * geometric altitude data. Range: 0–2.
   */
  gva: UInt8 & ClickHouseDefault<"0">;

  /**
   * System Design Assurance (SDA). Indicates the probability of an
   * undetected fault causing incorrect data. Range: 0–3.
   */
  sda: UInt8 & ClickHouseDefault<"0">;

  /**
   * Flight status alert bit. 1 = alert condition (squawk has changed),
   * 0 = no alert.
   */
  alert: UInt8 & ClickHouseDefault<"0">;

  /**
   * Special Position Identification bit. 1 = IDENT button has been
   * activated by the pilot, 0 = not active.
   */
  spi: UInt8 & ClickHouseDefault<"0">;

  /**
   * List of field names whose values were derived from multilateration
   * (MLAT) rather than direct ADS-B reception. Empty if all fields are
   * from direct reception.
   */
  mlat: string[];

  /**
   * List of field names whose values were derived from TIS-B (Traffic
   * Information Service — Broadcast) data. Empty if no TIS-B data
   * was used.
   */
  tisb: string[];

  /**
   * Total number of Mode S messages received from this aircraft since
   * the receiver started tracking it.
   */
  messages: UInt32 & ClickHouseDefault<"0">;

  /**
   * How many seconds ago (before "now" at the receiver) any message
   * was last received from this aircraft. Lower values = more recently seen.
   */
  seen: Float64 & ClickHouseDefault<"0">;

  /**
   * Recent average Received Signal Strength Indicator in dBFS
   * (decibels relative to full scale). Always negative; closer to 0 =
   * stronger signal. Typical range: -50 to 0.
   * @example -20.5
   */
  rssi: Float64 & ClickHouseDefault<"0">;

  /**
   * Timestamp when this data snapshot was captured by the ingestion
   * workflow. All aircraft from the same API poll share the same timestamp.
   */
  timestamp: Date;
}

/**
 * Processed aircraft tracking data with derived fields for spatial indexing
 * and decoded navigation modes.
 *
 * Extends {@link AircraftTrackingData} with:
 * - A Z-order curve coordinate for efficient 2D spatial range queries in ClickHouse
 * - Boolean flags decoded from the `nav_modes` string array for easier filtering
 *
 * Produced by the `transformAircraft` streaming function wired to
 * `AircraftTrackingDataStream → AircraftTrackingProcessedStream`.
 */
export interface AircraftTrackingProcessed extends AircraftTrackingData {
  /**
   * Z-order (Morton) curve coordinate encoding lat/lon into a single integer
   * for efficient spatial range queries. Computed by interleaving the bits of
   * normalised latitude and longitude values (20 bits each, yielding a 40-bit key).
   * Adjacent values in Z-order correspond to geographically nearby positions.
   */
  zorderCoordinate: UInt64;

  /** Whether the "approach" automation mode is currently engaged. */
  approach: boolean;

  /** Whether the autopilot is currently engaged. */
  autopilot: boolean;

  /** Whether altitude hold mode is currently engaged. */
  althold: boolean;

  /** Whether lateral navigation (LNAV) mode is currently engaged. */
  lnav: boolean;

  /** Whether the Traffic Collision Avoidance System (TCAS) is currently active. */
  tcas: boolean;
}
