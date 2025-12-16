import { NextResponse } from "next/server";
import { getAllItems } from "@/lib/templates";

// export const dynamic = "force-static";

export async function GET() {
  try {
    const items = getAllItems();

    return NextResponse.json(items, {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch (error) {
    console.error("Failed to generate templates data:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
