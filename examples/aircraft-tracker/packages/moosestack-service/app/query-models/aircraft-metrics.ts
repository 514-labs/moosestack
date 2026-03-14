/**
 * Aircraft Metrics — semantic query model for aircraft aggregate queries.
 *
 * Uses the MooseStack query layer (defineQueryModel) so that the same metrics
 * definition is shared across the REST API, MCP tools, and AI SDK consumers.
 *
 * @see https://docs.fiveonefour.com/moosestack/apis/semantic-layer
 */

import {
  defineQueryModel,
  sql,
  count,
  countDistinct,
} from "@514labs/moose-lib";
import { AircraftTrackingProcessedTable } from "../ingest/aircraft";

export const aircraftMetrics = defineQueryModel({
  name: "query_aircraft_metrics",
  description:
    "Military aircraft tracking metrics: total tracked, planes in the air, " +
    "planes on the ground, average speed/altitude, emergency count. " +
    "Data comes from ADS-B transponder messages polled every 30 seconds. " +
    "Filterable by category (size class): " +
    "A0=unspecified, A1=light, A2=small, A3=large, A4=high-vortex (B757), " +
    "A5=heavy, A6=high-performance, A7=rotorcraft, B=gliders/UAVs, " +
    "C=surface vehicles, D=reserved. " +
    "Also filterable by ICAO aircraft_type code (most military leave this empty): " +
    "B744=Boeing 747, C130/C30J=C-130, C17=C-17, K35R=KC-135, " +
    "B52H=B-52, F16=F-16, F15=F-15, H60=Black Hawk, V22=Osprey, P8=P-8, etc.",

  table: AircraftTrackingProcessedTable,

  dimensions: {
    /** Group by ICAO aircraft type designator (e.g. B738, A320). */
    aircraftType: { column: "aircraft_type" },
    /** Group by emitter category (A0–D7). */
    category: { column: "category" },
    /** Group by transponder message source type. */
    transponderType: { column: "transponder_type" },
    /** Group by emergency status. */
    emergency: { column: "emergency" },
    /** Group by minute. */
    minute: { expression: sql`toStartOfMinute(timestamp)`, as: "minute" },
    /** Group by day. */
    day: { expression: sql`toDate(timestamp)`, as: "day" },
    /** Group by hour. */
    hour: { expression: sql`toStartOfHour(timestamp)`, as: "hour" },
    /** Group by month. */
    month: { expression: sql`toStartOfMonth(timestamp)`, as: "month" },
  },

  metrics: {
    /** Count of distinct ICAO hex addresses in the time window. */
    totalAircraft: {
      agg: countDistinct(AircraftTrackingProcessedTable.columns.hex),
      as: "totalAircraft",
    },
    /** Aircraft that have ever reported as airborne. */
    planesInAir: {
      agg: sql`countDistinct(CASE WHEN alt_baro_is_ground = false THEN hex ELSE NULL END)`,
      as: "planesInAir",
    },
    /** Aircraft that have ever reported as on ground. */
    planesOnGround: {
      agg: sql`countDistinct(CASE WHEN alt_baro_is_ground = true THEN hex ELSE NULL END)`,
      as: "planesOnGround",
    },
    /** Average ground speed (knots) of airborne aircraft. */
    avgGroundSpeed: {
      agg: sql`avg(CASE WHEN alt_baro_is_ground = false THEN gs ELSE NULL END)`,
      as: "avgGroundSpeed",
    },
    /** Maximum barometric altitude (feet) in the window. */
    maxAltitude: {
      agg: sql`max(alt_baro)`,
      as: "maxAltitude",
    },
    /** Average barometric altitude (feet) of airborne aircraft. */
    avgAltitude: {
      agg: sql`avg(CASE WHEN alt_baro_is_ground = false THEN alt_baro ELSE NULL END)`,
      as: "avgAltitude",
    },
    /** Aircraft with an active emergency squawk or status. */
    emergencyCount: {
      agg: sql`countDistinct(CASE WHEN emergency != 'none' AND emergency != '' THEN hex ELSE NULL END)`,
      as: "emergencyCount",
    },
    /** Aircraft with autopilot engaged. */
    autopilotEngaged: {
      agg: sql`countDistinct(CASE WHEN autopilot = true THEN hex ELSE NULL END)`,
      as: "autopilotEngaged",
    },
    /** Total number of ADS-B datapoints (rows) ingested. */
    totalDatapoints: {
      agg: count(),
      as: "totalDatapoints",
    },
    /** Earliest timestamp in the dataset. */
    firstSeen: {
      agg: sql`min(timestamp)`,
      as: "firstSeen",
    },
    /** Latest timestamp in the dataset. */
    lastSeen: {
      agg: sql`max(timestamp)`,
      as: "lastSeen",
    },
    /** Number of distinct emitter categories observed. */
    distinctCategories: {
      agg: sql`uniqExact(category)`,
      as: "distinctCategories",
    },
    /** Number of distinct ICAO aircraft type codes observed. */
    distinctAircraftTypes: {
      agg: sql`uniqExact(aircraft_type)`,
      as: "distinctAircraftTypes",
    },
  },

  filters: {
    /**
     * Filter by ICAO aircraft type designator (DOC 8643).
     * Most military aircraft do not broadcast this field — it will often be empty.
     * Common codes: B741/B742/B743/B744/B748 = Boeing 747 variants,
     * B738/B739 = Boeing 737, A320/A321 = Airbus A320 family,
     * C130/C30J = C-130 Hercules, C17 = C-17 Globemaster, C5M = C-5 Galaxy,
     * K35R/K35E = KC-135 Stratotanker, KC10 = KC-10 Extender,
     * B52H = B-52 Stratofortress, B1B = B-1 Lancer, B2 = B-2 Spirit,
     * E3CF/E3TF = E-3 Sentry (AWACS), E6B = E-6B Mercury,
     * F16/F15/F18H/F22 = fighters, P8 = P-8 Poseidon,
     * H60/S70B = Black Hawk variants, V22 = V-22 Osprey,
     * C56X = Citation Excel, GLF5 = Gulfstream V, C560 = Citation V.
     */
    aircraftType: { column: "aircraft_type", operators: ["eq", "in"] as const },
    /**
     * Filter by ADS-B emitter category (aircraft/vehicle class).
     * A0 = unspecified, A1 = light (<15,500 lbs), A2 = small (15,500–75,000 lbs),
     * A3 = large (75,000–300,000 lbs), A4 = high-vortex large (e.g. B757),
     * A5 = heavy (>300,000 lbs), A6 = high-performance (>5g, >400 kts),
     * A7 = rotorcraft, B0–B7 = gliders/balloons/parachutists/UAVs,
     * C0–C7 = surface vehicles/obstacles, D0–D7 = reserved/unassigned.
     */
    category: { column: "category", operators: ["eq", "in"] as const },
    /** Filter by emergency status (none, general, lifeguard, minfuel, nordo, unlawful, downed). */
    emergency: { column: "emergency", operators: ["eq", "in"] as const },
    /** Filter by timestamp range. */
    timestamp: { column: "timestamp", operators: ["gte", "lte"] as const },
  },

  sortable: [
    "totalAircraft",
    "totalDatapoints",
    "planesInAir",
    "planesOnGround",
    "avgGroundSpeed",
    "minute",
    "day",
    "month",
  ] as const,

  defaults: {
    metrics: ["totalAircraft", "planesInAir", "planesOnGround"],
    dimensions: [],
    orderBy: [],
    limit: 100,
    maxLimit: 1000,
  },
});
