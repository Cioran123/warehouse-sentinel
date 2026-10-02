import { NextResponse } from "next/server";
import { getIncident } from "@/app/lib/venue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[\w-]+$/.test(id)) return NextResponse.json({ error: "Bad incident id" }, { status: 400 });
  const incident = await getIncident(id);
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(incident);
}
