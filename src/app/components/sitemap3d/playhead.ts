/**
 * The clock the 3D floor plays back on.
 *
 * It lives outside React state on purpose: the frame loop reads and advances it sixty times a
 * second, and re-rendering the scene at that rate would be pointless work.
 */
import { cameraTime } from "@/app/lib/ui/videoClock";

export class Playhead {
  t = 0;
  /** Footage length per camera; each camera's tracks loop over their own clip. */
  cameraDurations: Record<string, number> = {};
  playing = true;
  speed = 1;
  duration = 120;

  /** Advances by one frame, looping at the end of the clip. Long stalls are clamped. */
  advance(dt: number): void {
    if (!this.playing) return;
    this.t += Math.min(dt, 0.25) * this.speed;
    if (this.t > this.duration) this.t -= this.duration;
  }

  seek(t: number): void {
    this.t = Math.max(0, Math.min(this.duration, t));
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
  }

  setSpeed(speed: number): void {
    this.speed = speed;
  }

  /** Where a camera's tracks are now: its live tile if one is playing, else the site clock. */
  cameraT(cameraId: string): number {
    return cameraTime(cameraId, this.t, this.cameraDurations[cameraId] ?? this.duration);
  }

  setDuration(duration: number): void {
    this.duration = duration;
    this.t = Math.min(this.t, duration);
  }
}
