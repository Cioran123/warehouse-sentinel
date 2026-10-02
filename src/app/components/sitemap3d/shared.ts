import * as THREE from "three";
import { metresOf, planToWorld, type Rect } from "@/app/lib/floorPlan";

/** Hex twins of the tokens in globals.css; three.js materials need plain colours, not oklch. */
export const C = {
  bg: "#f4f5f8",
  apron: "#edeff2",
  floor: "#e8eaee",
  grid: "#d5d9e0",
  gridMajor: "#c0c5cf",
  wall: "#e1e4e9",
  ink: "#2b3140",
  fixture: "#9aa0ab",
  rack: "#d6dae0",
  rackEdge: "#b6bcc6",
  shelf: "#c8ccd4",
  pallet: "#c9b08a",
  office: "#e6e8ed",
  lane: "#c99a12",
  accent: "#4a54c6",
  high: "#d03b2f",
  still: "#a8aeb8",
  moving: "#394052",
  forklift: "#d49a26",
  forkliftDark: "#474d59",
} as const;

export interface Box {
  /** Centre in world metres. */
  x: number;
  z: number;
  /** Extent in world metres. */
  w: number;
  d: number;
}

/** A plan rectangle as a centred world-space footprint. */
export function boxOf(r: Rect): Box {
  const [x, z] = planToWorld(r.x + r.w / 2, r.y + r.h / 2);
  return { x, z, w: metresOf(r.w), d: metresOf(r.h) };
}

/** Plan point to a world position on the floor. */
export function at(px: number, py: number, y = 0): [number, number, number] {
  const [x, z] = planToWorld(px, py);
  return [x, y, z];
}

export const m = metresOf;

/** Plan headings are degrees with 0 = east and 90 = south, which is also +x and +z here. */
export const radOf = (deg: number) => (deg * Math.PI) / 180;

/** The floor patch a camera can see, as a flat fan of triangles in the XZ plane. */
export function fovFootprint(radius: number, dirDeg: number, halfDeg: number, segs = 20) {
  const pts: number[] = [];
  const a0 = radOf(dirDeg - halfDeg);
  const a1 = radOf(dirDeg + halfDeg);
  for (let i = 0; i < segs; i++) {
    const t0 = a0 + ((a1 - a0) * i) / segs;
    const t1 = a0 + ((a1 - a0) * (i + 1)) / segs;
    pts.push(
      0, 0, 0,
      Math.cos(t0) * radius, 0, Math.sin(t0) * radius,
      Math.cos(t1) * radius, 0, Math.sin(t1) * radius,
    );
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

/** The view volume between a mount and its floor footprint, so the cone reads in 3D. */
export function fovVolume(
  radius: number,
  dirDeg: number,
  halfDeg: number,
  mountY: number,
  segs = 20,
) {
  const pts: number[] = [];
  const a0 = radOf(dirDeg - halfDeg);
  const a1 = radOf(dirDeg + halfDeg);
  const ring: [number, number][] = [];
  for (let i = 0; i <= segs; i++) {
    const t = a0 + ((a1 - a0) * i) / segs;
    ring.push([Math.cos(t) * radius, Math.sin(t) * radius]);
  }
  for (let i = 0; i < segs; i++) {
    const [x0, z0] = ring[i];
    const [x1, z1] = ring[i + 1];
    pts.push(0, mountY, 0, x0, 0, z0, x1, 0, z1);
  }
  // Close the two side walls back to the mount.
  pts.push(0, mountY, 0, ring[0][0], 0, ring[0][1], 0, 0, 0);
  pts.push(0, mountY, 0, 0, 0, 0, ring[segs][0], 0, ring[segs][1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

/** Deterministic noise, so the dressing in the racks is identical on every render. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
