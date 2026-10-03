import { NextResponse } from "next/server";
import { streamArchiveSegment, vssConfigured } from "@/app/lib/vss";

export const runtime = "nodejs";

/** GET ?source=s3://... plays a VSS archive segment without exposing the VSS token. */
export async function GET(req: Request) {
  const source = new URL(req.url).searchParams.get("source") ?? "";
  if (!vssConfigured()) return NextResponse.json({ error: "VAST archive not configured" }, { status: 503 });
  if (!/^s3:\/\/[\w.-]+\/.+\.(mp4|mov|webm|mkv)$/i.test(source)) {
    return NextResponse.json({ error: "Bad source" }, { status: 400 });
  }
  try {
    return await streamArchiveSegment(source, req.headers.get("range"));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
