import { NextResponse } from "next/server";

export async function GET() {
  try {
    const res = await fetch(
      "http://localhost:4000/aircraft/metrics?metrics=totalAircraft,planesInAir,planesOnGround,avgGroundSpeed,avgAltitude,emergencyCount",
    );
    if (!res.ok) throw new Error(`Upstream error: ${res.status}`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 502 },
    );
  }
}
