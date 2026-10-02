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

/**
 * Camera-covered zones, laid out from what the four VAST SDG cameras show: roll-up dock doors on
 * the north wall (forklift lane, shipping dock), pallet racking down the west wall with the
 * staging floor in front of it, and an open cross aisle to the east with a marked robot lane.
 */
export const ZONES: Record<string, Rect> = {
  forklift_lane: { x: 64, y: 64, w: 500, h: 88 },
  shipping_dock: { x: 596, y: 64, w: 340, h: 88 },
  staging_floor: { x: 180, y: 196, w: 384, h: 380 },
  cross_aisle: { x: 596, y: 196, w: 340, h: 228 },
};

/** Where to hang each zone's name, picked to sit clear of its camera and its incidents. */
export const ZONE_LABEL_AT: Record<string, Vec2> = {
  forklift_lane: { x: 330, y: 112 },
  shipping_dock: { x: 766, y: 112 },
  staging_floor: { x: 372, y: 300 },
  cross_aisle: { x: 700, y: 240 },
};

/**
 * Where each zone's camera is mounted and which way it looks (degrees, 0 = east, 90 = south).
 * Each mount is chosen so the camera actually frames the floor its tracks are projected onto —
 * see `GROUND_QUADS` in `cameraGround.ts`.
 */
export const CAMERA_PINS: Record<string, { x: number; y: number; dir: number }> = {
  // west end of the dock wall, looking east along the doors (the wall is on the image's left)
  forklift_lane: { x: 78, y: 140, dir: 352 },
  // west end of the shipping dock, looking east along the wall's steel columns
  shipping_dock: { x: 610, y: 144, dir: 345 },
  // south-east corner of the staging floor, looking north-west at the racking
  staging_floor: { x: 554, y: 566, dir: 222 },
  // south wall of the cross aisle, looking north; the robot lane runs up from its left corner
  cross_aisle: { x: 774, y: 418, dir: 270 },
};

/** View cone drawn for every camera, shared by the 2D plan and the 3D frustums. */
export const CONE_LEN = 96;
export const CONE_HALF_DEG = 26;

/** Pallet racking down the west wall; the staging floor (WH_CAM_02) looks at its faces. */
export const RACK_XS = [76, 128];
export const RACK_W = 34;
export const RACK_TOP = 208;
export const RACK_BOTTOM = 560;

export const DOCK_DOORS = [104, 184, 264, 344, 424, 504, 656, 736, 816, 896];

/** No charging bays at this site. */
export const CHARGER_BAYS: number[] = [];
export const CHARGER_BAY = { y: 474, w: 48, h: 90 };

/** Pedestrian walkway running the width of the building, south of the docks. */
export const WALKWAY: Rect = { x: 64, y: 164, w: 872, h: 20 };

/**
 * Robot / pallet-staging lane in the cross aisle, closed to foot traffic. It is
 * where WH_CAM_03's restricted polygon lands on the floor (see `GROUND` in cameraGround.ts).
 */
export const LANE = { left: 672, right: 726, top: 296, bottom: 420 };

/** Uncovered areas. Both docks have cameras here, so the shipping-dock outline is empty. */
export const SHIPPING_DOCK: Rect = { x: 0, y: 0, w: 0, h: 0 };
export const OFFICE: Rect = { x: 596, y: 440, w: 340, h: 136 };
/** Interior wall splitting `OFFICE` into office and breakroom. */
export const OFFICE_SPLIT_X = 766;

/** Personnel door on the east wall, into the cross aisle. */
export const EAST_DOOR = { x: 955, y: 300, h: 28 };

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
