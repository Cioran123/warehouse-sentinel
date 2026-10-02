import { promises as fs } from "node:fs";
import path from "node:path";
import { clampToFloor, homographyFor, project } from "@/app/lib/cameraGround";
import { metresOf } from "@/app/lib/floorPlan";
import { PIPELINE_DIR } from "@/app/lib/storage";
import type { CameraTracks, Incident, Priority } from "@/app/lib/types";
import { listIncidents, loadVenue } from "@/app/lib/venue";

/** Seconds between samples. The detectors run at 5 fps; the floor view interpolates between these. */
const SAMPLE_STEP = 0.5;

/**
 * A track whose path spans less than this is standing still. Measured as the extent of the path,
 * not its length, so per-frame detector jitter does not read as walking.
 */
const MOVING_M = 1.2;

/** Above this real-world box aspect the detector is looking at someone lying down, not standing. */
const PRONE_ASPECT = 1.2;

export type AgentKind = "person" | "vehicle";

export interface FloorAgent {
  key: string;
  cameraId: string;
  zoneId: string;
  zone: string;
  trackId: number;
  kind: AgentKind;
  /** Detector class for vehicles, e.g. "forklift". */
  cls?: string;
  /** Index of the first sample this track appears in. */
  from: number;
  /** Plan-unit positions, one per sample from `from` onwards. */
  x: number[];
  y: number[];
  /** Sample ranges where the box reads as prone, as [start, end] pairs. */
  prone: number[];
  /** How far the path spans, corner to corner, in metres. */
  spanM: number;
  moving: boolean;
  incidentIds: string[];
}

export interface FloorCamera {
  id: string;
  /** Length of this camera's footage; its tracks loop over it. */
  durationSec: number;
  zoneId: string;
  zone: string;
  calibrated: boolean;
  tracks: number;
  moving: number;
}

export interface FloorIncident {
  id: string;
  cameraId: string;
  zoneId: string;
  startSec: number;
  endSec: number;
  priority: Priority;
  eventType: string;
  /** Keys of the agents this incident is about. */
  agentKeys: string[];
}

export interface FloorTracks {
  durationSec: number;
  sampleStep: number;
  sampleCount: number;
  agents: FloorAgent[];
  cameras: FloorCamera[];
  incidents: FloorIncident[];
}

async function readTracks(cameraId: string): Promise<CameraTracks | null> {
  try {
    return JSON.parse(
      await fs.readFile(path.join(PIPELINE_DIR, `${cameraId}.tracks.json`), "utf8"),
    ) as CameraTracks;
  } catch {
    return null;
  }
}

/** The vehicle track an incident is about, if its signals name one. */
function vehicleTrackOf(incident: Incident): number | null {
  const v = incident.signals?.vehicleTrack;
  return typeof v === "number" ? v : null;
}

interface Sampled {
  /** Foot point on the floor plan, in plan units. */
  x: number;
  y: number;
  prone: boolean;
}

/** Collapses a boolean series into [start, end] sample ranges. */
function runs(flags: boolean[], offset: number): number[] {
  const out: number[] = [];
  let start = -1;
  flags.forEach((on, i) => {
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      out.push(start + offset, i - 1 + offset);
      start = -1;
    }
  });
  if (start >= 0) out.push(start + offset, flags.length - 1 + offset);
  return out;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Projects every camera's tracks onto the shared floor plan and resamples them onto one clock,
 * so the 3D view can play the whole site back as a single scene.
 */
export async function buildFloorTracks(): Promise<FloorTracks> {
  const [venue, incidents] = await Promise.all([loadVenue(), listIncidents()]);
  const loaded = await Promise.all(venue.cameras.map((c) => readTracks(c.id)));

  const lengthOf = (t: CameraTracks | null) =>
    t ? (t.durationSec ?? (t.frames.at(-1)?.t ?? 0) + 1 / Math.max(1, t.fps)) : 0;
  const durationSec = Math.max(1, ...loaded.map(lengthOf));
  const sampleCount = Math.floor(durationSec / SAMPLE_STEP) + 1;

  const agents: FloorAgent[] = [];
  const cameras: FloorCamera[] = [];

  venue.cameras.forEach((camera, i) => {
    const tracks = loaded[i];
    const h = homographyFor(camera.id);
    if (!tracks || !h) {
      cameras.push({
        id: camera.id,
        durationSec: lengthOf(tracks) || camera.durationSec,
        zoneId: camera.zoneId,
        zone: camera.zone,
        calibrated: !!h,
        tracks: 0,
        moving: 0,
      });
      return;
    }

    const frameAspect = (tracks.width ?? 16) / (tracks.height ?? 9);
    const sampleOf = new Map<string, Map<number, Sampled>>();
    const kindOf = new Map<string, { kind: AgentKind; trackId: number; cls?: string }>();

    for (const frame of tracks.frames) {
      const slot = Math.round(frame.t / SAMPLE_STEP);
      if (slot < 0 || slot >= sampleCount) continue;
      // Keep the detection closest to the sample instant.
      if (Math.abs(frame.t - slot * SAMPLE_STEP) > SAMPLE_STEP / 2) continue;

      const add = (key: string, box: [number, number, number, number], prone: boolean, vehicle = false) => {
        // A standing body meets the floor at the bottom of its box; a prone one lies across it.
        // A vehicle box's bottom edge is its forks or load reaching toward the camera, so its body
        // sits a third of the way up.
        const iy = prone ? (box[1] + box[3]) / 2 : vehicle ? box[3] - 0.3 * (box[3] - box[1]) : box[3];
        const foot = clampToFloor(project(h, (box[0] + box[2]) / 2, iy));
        if (!Number.isFinite(foot.x) || !Number.isFinite(foot.y)) return;
        let series = sampleOf.get(key);
        if (!series) sampleOf.set(key, (series = new Map()));
        series.set(slot, { x: foot.x, y: foot.y, prone });
      };

      for (const b of frame.boxes) {
        const key = `${camera.id}#p${b.id}`;
        kindOf.set(key, { kind: "person", trackId: b.id });
        const w = b.box[2] - b.box[0];
        const hh = b.box[3] - b.box[1];
        add(key, b.box, hh > 0 && (w / hh) * frameAspect > PRONE_ASPECT);
      }
      for (const v of frame.vehicles ?? []) {
        const key = `${camera.id}#v${v.id}`;
        kindOf.set(key, { kind: "vehicle", trackId: v.id, cls: v.cls });
        add(key, v.box, false, true);
      }
    }

    let movingCount = 0;
    for (const [key, series] of sampleOf) {
      const meta = kindOf.get(key);
      if (!meta || series.size === 0) continue;
      const slots = [...series.keys()].sort((a, b) => a - b);
      const from = slots[0];
      const last = slots.at(-1)!;

      const xs: number[] = [];
      const ys: number[] = [];
      const prone: boolean[] = [];
      let held: Sampled = series.get(from)!;
      for (let slot = from; slot <= last; slot++) {
        held = series.get(slot) ?? held;
        xs.push(round1(held.x));
        ys.push(round1(held.y));
        prone.push(held.prone);
      }

      const span = Math.hypot(
        Math.max(...xs) - Math.min(...xs),
        Math.max(...ys) - Math.min(...ys),
      );
      const spanM = Math.round(metresOf(span) * 10) / 10;
      const moving = spanM >= MOVING_M;
      if (moving) movingCount++;

      const matched = incidents.filter(
        (inc) =>
          inc.cameraId === camera.id &&
          (meta.kind === "vehicle"
            ? vehicleTrackOf(inc) === meta.trackId
            : (inc.trackIds ?? []).includes(meta.trackId)),
      );

      agents.push({
        key,
        cameraId: camera.id,
        zoneId: camera.zoneId,
        zone: camera.zone,
        trackId: meta.trackId,
        kind: meta.kind,
        cls: meta.cls,
        from,
        x: xs,
        y: ys,
        prone: runs(prone, from),
        spanM,
        moving,
        incidentIds: matched.map((inc) => inc.id),
      });
    }

    cameras.push({
      id: camera.id,
      durationSec: lengthOf(tracks),
      zoneId: camera.zoneId,
      zone: camera.zone,
      calibrated: true,
      tracks: sampleOf.size,
      moving: movingCount,
    });
  });

  // Movers last so they draw over the standing crowd.
  agents.sort((a, b) => Number(a.moving) - Number(b.moving) || a.key.localeCompare(b.key));

  const zoneOf = new Map(venue.cameras.map((c) => [c.id, c.zoneId]));
  const floorIncidents: FloorIncident[] = incidents
    .filter((inc) => zoneOf.has(inc.cameraId))
    .map((inc) => ({
      id: inc.id,
      cameraId: inc.cameraId,
      zoneId: zoneOf.get(inc.cameraId)!,
      startSec: inc.startSec,
      endSec: inc.endSec,
      priority: inc.priority,
      eventType: inc.eventType,
      agentKeys: agents.filter((a) => a.incidentIds.includes(inc.id)).map((a) => a.key),
    }));

  return {
    durationSec,
    sampleStep: SAMPLE_STEP,
    sampleCount,
    agents,
    cameras,
    incidents: floorIncidents,
  };
}
