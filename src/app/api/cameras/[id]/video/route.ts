import { NextResponse } from "next/server";
import { vastMediaUrl, videoKey } from "@/app/lib/vast";
import { cameraVideoPath, getCamera } from "@/app/lib/venue";
import { streamVideo } from "@/app/lib/videoStream";

export const runtime = "nodejs";

/** Streams from VAST S3 when the video has been synced there, else from storage/videos. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const camera = await getCamera(id);
  if (!camera) return NextResponse.json({ error: "Camera not found" }, { status: 404 });
  const fromVast = await vastMediaUrl(videoKey(camera.videoFile));
  if (fromVast) return NextResponse.redirect(fromVast, 307);
  return streamVideo(req, cameraVideoPath(camera));
}
