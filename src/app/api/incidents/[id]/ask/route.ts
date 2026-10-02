import { NextResponse } from "next/server";
import { askAboutClip, type ClipTurn } from "@/app/lib/clipChat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CHARS = 500;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[\w-]+$/.test(id)) return NextResponse.json({ error: "Bad incident id" }, { status: 400 });

  let body: { question?: unknown; history?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    // fall through to validation
  }
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) return NextResponse.json({ error: "question is required" }, { status: 400 });
  if (question.length > MAX_CHARS) return NextResponse.json({ error: "question too long" }, { status: 400 });
  const history: ClipTurn[] = Array.isArray(body.history)
    ? body.history
        .filter(
          (t): t is ClipTurn =>
            !!t && typeof t === "object" && (t.role === "user" || t.role === "assistant") && typeof t.content === "string",
        )
        .slice(-6)
        .map((t) => ({ role: t.role, content: t.content.slice(0, MAX_CHARS * 2) }))
    : [];

  try {
    const answer = await askAboutClip(id, question, history);
    if (!answer) return NextResponse.json({ error: "Incident not found" }, { status: 404 });
    return NextResponse.json(answer);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/incidents/ask]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
