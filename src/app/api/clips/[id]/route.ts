import path from "node:path";
import { NextResponse } from "next/server";
import { CLIPS_DIR } from "@/app/lib/storage";
import { clipKey, vastMediaUrl } from "@/app/lib/vast";
import { streamVideo } from "@/app/lib/videoStream";

export const runtime = "nodejs";

/** Evidence clips stream from VAST S3 when synced there, else from storage/clips. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[\w-]+$/.test(id)) return NextResponse.json({ error: "Bad clip id" }, { status: 400 });
  const fromVast = await vastMediaUrl(clipKey(id));
  if (fromVast) return NextResponse.redirect(fromVast, 307);
  return streamVideo(req, path.join(CLIPS_DIR, `${id}.mp4`));
}
