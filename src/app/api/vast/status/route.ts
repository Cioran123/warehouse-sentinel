import { NextResponse } from "next/server";
import { vastStatus } from "@/app/lib/vast";
import { vssConfigured } from "@/app/lib/vss";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Which VAST services this deployment is using right now. */
export async function GET() {
  return NextResponse.json({ ...(await vastStatus()), archive: vssConfigured() });
}
