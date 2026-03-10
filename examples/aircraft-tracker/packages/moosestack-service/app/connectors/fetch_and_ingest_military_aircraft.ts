import { Task, Workflow } from "@514labs/moose-lib";
import { AircraftTrackingData } from "../datamodels/models";

interface ApiResponse {
  ac: AircraftTrackingData[];
  total?: number;
  ctime?: number;
  ptime?: number;
}

interface FetchTaskInput {
  apiUrl?: string;
}

interface FetchTaskOutput {
  processedCount: number;
  timestamp: string;
  success: boolean;
}

function mapToAircraftTrackingData(
  aircraft: AircraftTrackingData,
  timestamp: Date,
): AircraftTrackingData {
  let alt_baro = 0;
  let alt_baro_is_ground = false;

  if (
    typeof aircraft.alt_baro === "string" &&
    (aircraft.alt_baro as unknown) === "ground"
  ) {
    alt_baro = 0;
    alt_baro_is_ground = true;
  } else if (typeof aircraft.alt_baro === "number" && aircraft.alt_baro === 0) {
    alt_baro_is_ground = true;
  } else {
    alt_baro = aircraft.alt_baro || 0;
  }

  return {
    hex: aircraft.hex,
    transponder_type: aircraft.transponder_type || "",
    flight: aircraft.flight || "",
    r: aircraft.r || "",
    aircraft_type: aircraft.aircraft_type || "",
    dbFlags: aircraft.dbFlags || 0,
    lat: aircraft.lat || 0,
    lon: aircraft.lon || 0,
    alt_baro: alt_baro,
    alt_baro_is_ground: alt_baro_is_ground,
    alt_geom: aircraft.alt_geom || 0,
    gs: aircraft.gs || 0,
    track: aircraft.track || 0,
    baro_rate: aircraft.baro_rate || 0,
    geom_rate: aircraft.geom_rate || 0,
    squawk: aircraft.squawk || "",
    emergency: aircraft.emergency || "",
    category: aircraft.category || "",
    nav_qnh: aircraft.nav_qnh || 0,
    nav_altitude_mcp: aircraft.nav_altitude_mcp || 0,
    nav_heading: aircraft.nav_heading || 0,
    nav_modes: aircraft.nav_modes || [],
    nic: aircraft.nic || 0,
    rc: aircraft.rc || 0,
    seen_pos: aircraft.seen_pos || 0,
    version: aircraft.version || 0,
    nic_baro: aircraft.nic_baro || 0,
    nac_p: aircraft.nac_p || 0,
    nac_v: aircraft.nac_v || 0,
    sil: aircraft.sil || 0,
    sil_type: aircraft.sil_type || "",
    gva: aircraft.gva || 0,
    sda: aircraft.sda || 0,
    alert: aircraft.alert || 0,
    spi: aircraft.spi || 0,
    mlat: aircraft.mlat || [],
    tisb: aircraft.tisb || [],
    messages: aircraft.messages || 0,
    seen: aircraft.seen || 0,
    rssi: aircraft.rssi || 0,
    timestamp: timestamp,
  } as AircraftTrackingData;
}

export const fetchAndIngestMilitaryAircraft = new Task<
  FetchTaskInput,
  FetchTaskOutput
>("fetch_and_ingest_military_aircraft", {
  run: async (context: {
    state: any;
    input: FetchTaskInput;
  }): Promise<FetchTaskOutput> => {
    try {
      const { input } = context;
      const apiUrl = input.apiUrl || "https://api.adsb.lol/v2/mil";

      console.log(`Fetching military aircraft data from ${apiUrl}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(apiUrl, {
        method: "GET",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(
          `API request failed with status: ${response.status} ${response.statusText}`,
        );
      }

      const data: ApiResponse = await response.json();

      if (!data.ac || !Array.isArray(data.ac)) {
        console.log("No aircraft data found in API response");
        return {
          processedCount: 0,
          timestamp: new Date().toISOString(),
          success: true,
        };
      }

      console.log(`Fetched ${data.ac.length} military aircraft records`);

      const timestamp = new Date();
      let processedCount = 0;

      for (const aircraft of data.ac) {
        try {
          const mappedData = mapToAircraftTrackingData(aircraft, timestamp);

          const ingestResponse = await fetch(
            "http://localhost:4000/ingest/AircraftTrackingDataIngestApi",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(mappedData),
            },
          );

          if (ingestResponse.ok) {
            processedCount++;
          } else {
            console.warn(
              `Failed to ingest aircraft ${aircraft.hex}: ${ingestResponse.status} ${ingestResponse.statusText}`,
            );
          }
        } catch (error) {
          console.warn(`Error processing aircraft ${aircraft.hex}:`, error);
        }
      }

      console.log(
        `Successfully processed ${processedCount} out of ${data.ac.length} aircraft records`,
      );

      return {
        processedCount,
        timestamp: new Date().toISOString(),
        success: true,
      };
    } catch (error) {
      console.error("Error in fetch_and_ingest_military_aircraft task:", error);
      throw error;
    }
  },
  retries: 3,
  timeout: "5m",
});

export const militaryAircraftTrackingWorkflow = new Workflow(
  "military_aircraft_tracking",
  {
    startingTask: fetchAndIngestMilitaryAircraft,
    retries: 3,
    timeout: "1h",
    schedule: "@every 30s",
  },
);
