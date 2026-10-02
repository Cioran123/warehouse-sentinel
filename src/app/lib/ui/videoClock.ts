/**
 * Where each camera's video is right now, shared outside React so the floor views can read it
 * every animation frame without re-rendering.
 *
 * Camera tiles report on `timeupdate` (about 4 Hz); readers extrapolate between reports while
 * the video is playing, which keeps markers on the floor moving smoothly in step with the tile.
 */

interface Report {
  t: number;
  at: number;
  playing: boolean;
  duration: number;
}

/** A report older than this means the tile is gone or the tab was hidden. */
const STALE_MS = 1500;

const reports = new Map<string, Report>();

export function reportVideoTime(cameraId: string, t: number, playing: boolean, duration: number): void {
  reports.set(cameraId, { t, at: performance.now(), playing, duration: Number.isFinite(duration) ? duration : 0 });
}

export function forgetVideo(cameraId: string): void {
  reports.delete(cameraId);
}

/** The camera's current video time, or null when no tile for it is playing on screen. */
export function liveVideoTime(cameraId: string, now = performance.now()): number | null {
  const r = reports.get(cameraId);
  if (!r || now - r.at > STALE_MS) return null;
  const t = r.playing ? r.t + (now - r.at) / 1000 : r.t;
  return r.duration > 0 ? t % r.duration : t;
}

/**
 * The time to show a camera's tracks at: its live video when a tile is playing it, otherwise
 * the shared site clock looped over that camera's own footage length.
 */
export function cameraTime(cameraId: string, siteT: number, durationSec: number): number {
  const live = liveVideoTime(cameraId);
  if (live !== null) return live;
  return durationSec > 0 ? siteT % durationSec : siteT;
}
