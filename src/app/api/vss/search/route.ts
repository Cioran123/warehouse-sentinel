import { NextResponse } from "next/server";
import { searchArchive } from "@/app/lib/vss";
import { traced } from "@/app/lib/weave";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { query } -> similar moments from the VAST VSS archive. */
export async function POST(req: Request) {
  let query = "";
  try {
    const body = (await req.json()) as { query?: unknown };
    query = typeof body.query === "string" ? body.query.trim() : "";
  } catch {
    // fall through to validation
  }
  if (!query || query.length > 400) return NextResponse.json({ error: "query is required (max 400 chars)" }, { status: 400 });
  return NextResponse.json(await traced("sentinel.vss_archive_search", searchArchive, query, {}));
}
