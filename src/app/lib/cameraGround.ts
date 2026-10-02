/**
 * Turns per-camera detections into positions on the shared floor plan.
 *
 * Each camera is calibrated by naming the ground quad it frames: four points in normalised
 * image space and the four floor points they land on. From that pair we solve a homography and
 * push every detection's foot point (the bottom centre of its box) through it, which is how a
 * single fixed camera recovers floor position from a 2D box.
 */

import { BUILDING, type Vec2 } from "@/app/lib/floorPlan";

export interface GroundCalibration {
  /** Normalised image quad: bottom-left, bottom-right, top-right, top-left. */
  image: readonly [Vec2, Vec2, Vec2, Vec2];
  /** The floor quad it covers, in plan units: near-left, near-right, far-right, far-left. */
  plan: readonly [Vec2, Vec2, Vec2, Vec2];
}

/**
 * The band of each frame that contains floor. Feet in this footage land between y 0.65 and 0.86,
 * so a 0.50-0.96 band brackets the data without extrapolating past the horizon.
 */
const FLOOR_BAND: GroundCalibration["image"] = [
  { x: 0, y: 0.96 },
  { x: 1, y: 0.96 },
  { x: 1, y: 0.5 },
  { x: 0, y: 0.5 },
];

/**
 * Hand-authored calibration, one entry per fixed camera. "Near" is the edge closest to the
 * mount, and near edges are narrower than far edges because that is what perspective does.
 */
export const GROUND: Record<string, GroundCalibration> = {
  // Mounted on the walkway looking north across the dock face, so image x runs the dock's length.
  WH_CAM_01: {
    image: FLOOR_BAND,
    plan: [
      { x: 150, y: 146 },
      { x: 470, y: 146 },
      { x: 556, y: 72 },
      { x: 70, y: 72 },
    ],
  },
  // South end of Aisle A looking up the lane: image x runs across the lane, so stepping into it
  // reads as lateral motion.
  WH_CAM_02: {
    image: FLOOR_BAND,
    plan: [
      { x: 440, y: 536 },
      { x: 504, y: 536 },
      { x: 532, y: 216 },
      { x: 412, y: 216 },
    ],
  },
  // Over the pick-zone cross aisle looking south at the rack faces.
  WH_CAM_03: {
    image: FLOOR_BAND,
    plan: [
      { x: 330, y: 230 },
      { x: 140, y: 230 },
      { x: 72, y: 268 },
      { x: 396, y: 268 },
    ],
  },
  // East wall looking west along the charger apron.
  WH_CAM_04: {
    image: FLOOR_BAND,
    plan: [
      { x: 872, y: 476 },
      { x: 872, y: 404 },
      { x: 616, y: 396 },
      { x: 616, y: 486 },
    ],
  },
};

/** Row-major 3x3 homography with h22 fixed at 1. */
export type Homography = readonly number[];

/** Solves `a x = b` in place by Gaussian elimination with partial pivoting. */
function gaussian(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    [b[col], b[pivot]] = [b[pivot], b[col]];
    for (let row = col + 1; row < n; row++) {
      const f = a[row][col] / a[col][col];
      if (f === 0) continue;
      for (let k = col; k < n; k++) a[row][k] -= f * a[col][k];
      b[row] -= f * b[col];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = b[row];
    for (let k = row + 1; k < n; k++) sum -= a[row][k] * x[k];
    x[row] = sum / a[row][row];
  }
  return x;
}

/** Four-point DLT: the homography mapping `src` onto `dst`, corner for corner. */
export function solveHomography(
  src: GroundCalibration["image"],
  dst: GroundCalibration["plan"],
): Homography | null {
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = gaussian(a, b);
  return h ? [...h, 1] : null;
}

/** Projects a normalised image point onto the floor plan. */
export function project(h: Homography, x: number, y: number): Vec2 {
  const w = h[6] * x + h[7] * y + h[8];
  if (Math.abs(w) < 1e-9) return { x: NaN, y: NaN };
  return {
    x: (h[0] * x + h[1] * y + h[2]) / w,
    y: (h[3] * x + h[4] * y + h[5]) / w,
  };
}

/** Keeps a projected point inside the shell; detections near a frame edge can land just outside. */
export function clampToFloor(p: Vec2, margin = 18): Vec2 {
  const lo = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
  return {
    x: lo(p.x, BUILDING.x + margin, BUILDING.x + BUILDING.w - margin),
    y: lo(p.y, BUILDING.y + margin, BUILDING.y + BUILDING.h - margin),
  };
}

/** The homography for a camera, or null if it has no calibration. */
export function homographyFor(cameraId: string): Homography | null {
  const cal = GROUND[cameraId];
  return cal ? solveHomography(cal.image, cal.plan) : null;
}
