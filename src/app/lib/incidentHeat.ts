/**
 * Incident heat on the floor plan: where safety incidents happen, not just how many each zone has.
 *
 * Every incident spreads its weight over the floor positions of the people and vehicles it is
 * about, for the samples inside its window, so a near miss heats the strip of floor where the
 * forklift and the worker actually were. Weight follows priority and the verifier's verdict.
 *
 * `simulateHistory` adds a seeded, clearly labelled stand-in for a longer history: jittered copies
 * of the real incidents plus events along the known risk features (the dock-side forklift lane
 * and the robot lane). It exists to show the view at a realistic volume during a demo.
 */

import type { FloorTracks } from "@/app/lib/floorTracks";
import { BUILDING, LANE, PLAN_H, PLAN_W, ZONES } from "@/app/lib/floorPlan";

/** Plan units per heat cell. */
const CELL = 5;
export const HEAT_W = Math.ceil(PLAN_W / CELL);
export const HEAT_H = Math.ceil(PLAN_H / CELL);

const PRIORITY_W = { high: 3, medium: 2, low: 1 } as const;
const STATUS_W = { kept: 1.5, candidate: 1, rejected: 0.25 } as const;
/** Gaussian spread around each position, in plan units (~2.5 m). */
const SIGMA = 22;

export interface HeatSpot {
  x: number;
  y: number;
  weight: number;
  zoneId: string;
  simulated: boolean;
}

export interface HeatMap {
  grid: Float32Array;
  max: number;
  /** Zones ranked by accumulated incident weight. */
  zones: { zoneId: string; weight: number; share: number }[];
  realIncidents: number;
  simulatedIncidents: number;
}

/** Mulberry32: a tiny seeded PRNG so the simulated history is the same on every load. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(r: () => number): number {
  const u = Math.max(1e-9, r());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

function zoneAt(x: number, y: number): string {
  for (const [id, z] of Object.entries(ZONES)) {
    if (x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h) return id;
  }
  return "";
}

const inside = (x: number, y: number) =>
  x >= BUILDING.x && x <= BUILDING.x + BUILDING.w && y >= BUILDING.y && y <= BUILDING.y + BUILDING.h;

/** Positions each real incident occupied: its agents' samples inside the incident window. */
export function incidentSpots(data: FloorTracks): { spots: HeatSpot[]; perIncident: Map<string, HeatSpot[]> } {
  const byKey = new Map(data.agents.map((a) => [a.key, a]));
  const spots: HeatSpot[] = [];
  const perIncident = new Map<string, HeatSpot[]>();
  for (const inc of data.incidents) {
    const w = PRIORITY_W[inc.priority] * STATUS_W[inc.verificationStatus];
    const s0 = Math.floor(inc.startSec / data.sampleStep);
    const s1 = Math.ceil(inc.endSec / data.sampleStep);
    const pts: { x: number; y: number }[] = [];
    for (const key of inc.agentKeys) {
      const a = byKey.get(key);
      if (!a) continue;
      for (let s = Math.max(s0, a.from); s <= Math.min(s1, a.from + a.x.length - 1); s++) {
        pts.push({ x: a.x[s - a.from], y: a.y[s - a.from] });
      }
    }
    const own = pts.map((p) => ({ ...p, weight: w / pts.length, zoneId: inc.zoneId, simulated: false }));
    perIncident.set(inc.id, own);
    spots.push(...own);
  }
  return { spots, perIncident };
}

/** A seeded stand-in for a longer shift history, for demos. Never mixed in unless asked for. */
export function simulateHistory(data: FloorTracks, perIncident: Map<string, HeatSpot[]>, copies = 14): HeatSpot[] {
  const r = rng(20261002);
  const out: HeatSpot[] = [];
  const push = (x: number, y: number, weight: number) => {
    if (inside(x, y)) out.push({ x, y, weight, zoneId: zoneAt(x, y), simulated: true });
  };
  // Repeat offenders: the same kinds of events near where the real ones happened.
  for (const inc of data.incidents) {
    const pts = perIncident.get(inc.id) ?? [];
    if (!pts.length) continue;
    const w = PRIORITY_W[inc.priority];
    for (let k = 0; k < copies; k++) {
      const c = pts[Math.floor(r() * pts.length)];
      const cx = c.x + gauss(r) * 26;
      const cy = c.y + gauss(r) * 18;
      for (let j = 0; j < 4; j++) push(cx + gauss(r) * 6, cy + gauss(r) * 6, (w * (0.5 + r())) / 4);
    }
  }
  // Known risk features: crossings at the dock-side forklift lane and the robot lane.
  const lane = ZONES.forklift_lane;
  for (let k = 0; k < 18; k++) {
    push(lane.x + 40 + r() * (lane.w - 80), lane.y + lane.h * (0.35 + r() * 0.5), 1.2 * (0.6 + r()));
  }
  for (let k = 0; k < 12; k++) {
    push(LANE.left + r() * (LANE.right - LANE.left), LANE.top + r() * (LANE.bottom - LANE.top), 1.0 * (0.6 + r()));
  }
  // Rack faces on the staging floor: occasional bare heads under the racking.
  for (let k = 0; k < 10; k++) push(190 + r() * 120, 230 + r() * 300, 0.7 * (0.6 + r()));
  return out;
}

/** Splats spots onto the heat grid with a Gaussian kernel. */
export function buildHeat(spots: HeatSpot[], realIncidents: number, simulatedIncidents: number): HeatMap {
  const grid = new Float32Array(HEAT_W * HEAT_H);
  const radius = Math.ceil((SIGMA * 3) / CELL);
  const inv = 1 / (2 * (SIGMA / CELL) ** 2);
  const zoneW = new Map<string, number>();
  for (const p of spots) {
    const gx = p.x / CELL;
    const gy = p.y / CELL;
    for (let y = Math.max(0, Math.floor(gy - radius)); y <= Math.min(HEAT_H - 1, Math.ceil(gy + radius)); y++) {
      for (let x = Math.max(0, Math.floor(gx - radius)); x <= Math.min(HEAT_W - 1, Math.ceil(gx + radius)); x++) {
        const d2 = (x - gx) ** 2 + (y - gy) ** 2;
        grid[y * HEAT_W + x] += p.weight * Math.exp(-d2 * inv);
      }
    }
    if (p.zoneId) zoneW.set(p.zoneId, (zoneW.get(p.zoneId) ?? 0) + p.weight);
  }
  let max = 0;
  for (const v of grid) max = Math.max(max, v);
  const total = [...zoneW.values()].reduce((a, b) => a + b, 0) || 1;
  const zones = Object.keys(ZONES)
    .map((zoneId) => ({ zoneId, weight: zoneW.get(zoneId) ?? 0, share: (zoneW.get(zoneId) ?? 0) / total }))
    .sort((a, b) => b.weight - a.weight);
  return { grid, max, zones, realIncidents, simulatedIncidents };
}

/** Yellow → orange → red → deep red, with alpha rising from transparent. */
const STOPS: [number, [number, number, number]][] = [
  [0, [255, 237, 160]],
  [0.35, [254, 178, 76]],
  [0.65, [240, 59, 32]],
  [1, [128, 0, 38]],
];

export function heatColor(t: number): [number, number, number, number] {
  const v = Math.max(0, Math.min(1, t));
  let i = 0;
  while (i < STOPS.length - 2 && v > STOPS[i + 1][0]) i++;
  const [t0, c0] = STOPS[i];
  const [t1, c1] = STOPS[i + 1];
  const f = (v - t0) / (t1 - t0);
  const alpha = v < 0.02 ? 0 : Math.min(1, 0.25 + v * 1.1) * 0.85;
  return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f, alpha];
}

/** Paints the grid onto a canvas, one pixel per cell; the GPU smooths it when scaled up. */
export function paintHeat(heat: HeatMap, canvas: HTMLCanvasElement): void {
  canvas.width = HEAT_W;
  canvas.height = HEAT_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const img = ctx.createImageData(HEAT_W, HEAT_H);
  const norm = heat.max > 0 ? 1 / heat.max : 0;
  for (let i = 0; i < heat.grid.length; i++) {
    // sqrt lifts the low end so single incidents stay visible next to hotspots
    const [r, g, b, a] = heatColor(Math.sqrt(heat.grid[i] * norm));
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = a * 255;
  }
  ctx.putImageData(img, 0, 0);
}
