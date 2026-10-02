/**
 * The clock the 3D floor plays back on.
 *
 * It lives outside React state on purpose: the frame loop reads and advances it sixty times a
 * second, and re-rendering the scene at that rate would be pointless work.
 */
export class Playhead {
  t = 0;
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

  setDuration(duration: number): void {
    this.duration = duration;
    this.t = Math.min(this.t, duration);
  }
}
