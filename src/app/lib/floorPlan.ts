/**
 * The site floor plan, in plan units on a 1000x640 canvas.
 *
 * Both the 2D SVG plan (`VenueMap`) and the 3D scene (`SiteMap3D`) read their geometry from
 * here, so the two views can never drift apart.
 */

export const PLAN_W = 1000;
export const PLAN_H = 640;

/** Plan units per metre, matching the 10 m scale bar drawn on the 2D plan. */
export const UNITS_PER_M = 9.2;

export type Rect = { x: number; y: number; w: number; h: number };
export type Vec2 = { x: number; y: number };

/** Outer shell. The interior is the walkable floor. */
export const BUILDING: Rect = { x: 40, y: 40, w: 920, h: 560 };

/** Camera-covered zones: docks on the north wall, racking below. */
export const ZONES: Record<string, Rect> = {
  receiving_dock: { x: 64, y: 64, w: 500, h: 88 },
  pick_zone: { x: 64, y: 196, w: 340, h: 380 },
  aisle_a: { x: 416, y: 196, w: 112, h: 380 },
  charging_station: { x: 596, y: 392, w: 340, h: 184 },
};

/** Where to hang each zone's name, picked to sit clear of its camera and its incidents. */
export const ZONE_LABEL_AT: Record<string, Vec2> = {
  receiving_dock: { x: 476, y: 112 },
  pick_zone: { x: 150, y: 430 },
  aisle_a: { x: 472, y: 226 },
  charging_station: { x: 766, y: 424 },
};

/**
 * Where each zone's camera is mounted and which way it looks (degrees, 0 = east, 90 = south).
 * Each mount is chosen so the camera actually frames the floor its tracks are projected onto —
 * see `GROUND_QUADS` in `cameraGround.ts`.
 */
export const CAMERA_PINS: Record<string, { x: number; y: number; dir: number }> = {
  receiving_dock: { x: 314, y: 188, dir: 270 },
  pick_zone: { x: 234, y: 206, dir: 90 },
  aisle_a: { x: 472, y: 562, dir: 270 },
  charging_station: { x: 920, y: 436, dir: 180 },
};

/** View cone drawn for every camera, shared by the 2D plan and the 3D frustums. */
export const CONE_LEN = 96;
export const CONE_HALF_DEG = 26;

export const RACK_XS = [84, 148, 212, 276, 340, 542];
export const RACK_W = 34;
export const RACK_TOP = 272;
export const RACK_BOTTOM = 556;

export const DOCK_DOORS = [104, 184, 264, 344, 424, 504, 656, 736, 816, 896];

export const CHARGER_BAYS = [616, 680, 744, 808, 872];
export const CHARGER_BAY = { y: 474, w: 48, h: 90 };

/** Pedestrian walkway running the width of the building, south of the docks. */
export const WALKWAY: Rect = { x: 64, y: 164, w: 872, h: 20 };

/** Forklift-only lane down Aisle A. Pedestrians in here are what Aisle A watches for. */
export const LANE = { left: 432, right: 512, top: 248, bottom: 548 };

/** Areas with no camera on them. */
export const SHIPPING_DOCK: Rect = { x: 596, y: 64, w: 340, h: 88 };
export const OFFICE: Rect = { x: 596, y: 196, w: 340, h: 168 };
/** Interior wall splitting `OFFICE` into office and breakroom. */
export const OFFICE_SPLIT_X = 766;

/** Personnel door on the east wall. */
export const EAST_DOOR = { x: 955, y: 160, h: 28 };

export const metresOf = (units: number): number => units / UNITS_PER_M;

/** Plan units to world metres: origin at the centre of the building, +x east, +z south. */
export function planToWorld(px: number, py: number): [number, number] {
  return [
    (px - (BUILDING.x + BUILDING.w / 2)) / UNITS_PER_M,
    (py - (BUILDING.y + BUILDING.h / 2)) / UNITS_PER_M,
  ];
}

/**
 * Heights in metres across a 100 m x 61 m shell. The structure is deliberately cut down from
 * real warehouse heights: this is a model of the floor, and a 9 m wall would hide the floor it
 * is there to explain.
 */
export const HEIGHT = {
  wall: 2.6,
  rack: 4.2,
  dockDoor: 2.2,
  office: 2.4,
  person: 1.72,
  forklift: 1.35,
  forkliftMast: 2.4,
  cameraMount: 4.6,
};
