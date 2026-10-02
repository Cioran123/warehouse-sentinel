import { NextResponse } from "next/server";
import { loadIncidentView } from "@/app/lib/incidentView";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[\w-]+$/.test(id)) return NextResponse.json({ error: "Bad incident id" }, { status: 400 });
  const view = await loadIncidentView(id);
  if (!view) return NextResponse.json({ error: "Incident not found" }, { status: 404 });
  return NextResponse.json(view);
}
