import { NextResponse } from "next/server";
import { chat, type ChatTurn } from "@/app/lib/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TURNS = 12;
const MAX_CHARS = 500;

function parseTurns(raw: unknown): ChatTurn[] | null {
  if (!Array.isArray(raw)) return null;
  const turns = raw
    .filter(
      (t): t is ChatTurn =>
        !!t &&
        typeof t === "object" &&
        (t.role === "user" || t.role === "assistant") &&
        typeof t.content === "string" &&
        t.content.trim().length > 0,
    )
    .slice(-MAX_TURNS)
    .map((t) => ({ role: t.role, content: t.content.trim().slice(0, MAX_CHARS * 2) }));
  return turns.length ? turns : null;
}

export async function POST(req: Request) {
  let body: { messages?: unknown; context?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    // fall through to validation
  }
  const messages = parseTurns(body.messages);
  const last = messages?.[messages.length - 1];
  if (!messages || !last || last.role !== "user") {
    return NextResponse.json({ error: "messages must end with a user question" }, { status: 400 });
  }
  if (last.content.length > MAX_CHARS) return NextResponse.json({ error: "question too long" }, { status: 400 });

  try {
    return NextResponse.json(await chat({ messages, context: body.context as never }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/chat]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
