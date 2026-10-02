import { NextResponse } from "next/server";
import { buildFloorTracks } from "@/app/lib/floorTracks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every camera's tracks, projected onto the floor plan and resampled onto one clock. */
export async function GET() {
  try {
    return NextResponse.json(await buildFloorTracks());
  } catch (err) {
    console.error("[floor-tracks] failed", err);
    return NextResponse.json(
      { error: "Could not project tracks onto the floor plan; run pipeline/detect.py" },
      { status: 500 },
    );
  }
}
