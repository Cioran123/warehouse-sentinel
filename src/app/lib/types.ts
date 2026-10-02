export type EventType =
  | "restricted_zone_entry"
  | "vehicle_pedestrian_proximity"
  | "ppe_missing_hard_hat"
  | "person_down_or_inactivity";

export type Priority = "low" | "medium" | "high";

export type VerificationStatus = "candidate" | "kept" | "rejected";

export type SourceType = "synthetic_sdg" | "organizer" | "team_recorded";

/** Normalized [x, y] in 0..1 of the frame. */
export type Point = [number, number];

export interface Incident {
  id: string;
  videoId: string;
  venueId: string;
  cameraId: string;
  zone: string;
  eventType: EventType;
  startSec: number;
  endSec: number;
  priority: Priority;
  /** Observable evidence from the verifier, or the candidate-check notes when unverified. */
  observations: string[];
  /** Notes from the YOLO candidate check that selected this window. */
  signalNotes?: string[];
  evidenceClipUrl?: string;
  sourceType: SourceType;
  verificationStatus: VerificationStatus;
  requiresHumanReview: boolean;
  cosmosExplanation?: string;
  /** Which verifier produced the keep/drop decision, e.g. "cosmos:nvidia/cosmos-reason2-8b". */
  verifier?: string;
  promptVersion?: string;
  /** Raw candidate-check signals (density z-score, coherence, dwell seconds, ...). */
  signals?: Record<string, number>;
  trackIds?: number[];
  createdAt: string;
}

export interface GroundTruth {
  eventType: EventType;
  startSec: number;
  endSec: number;
}

export interface Camera {
  id: string;
  zone: string;
  zoneId: string;
  videoFile: string;
  durationSec: number;
  sourceType: SourceType;
  scenario: string;
  restrictedPolygons?: Point[][];
  /** Hard hats required in view; enables the missing-hard-hat check. */
  ppeRequired?: boolean;
  /** Operational region; detections and optical flow are limited to it. */
  roi?: Point[];
  /** Absent for the live webcam, which has no labeled scenario. */
  groundTruth?: GroundTruth;
}

/** Camera id of incidents found live by pipeline/live_server.py (config: pipeline/config/live.json). */
export const LIVE_CAMERA_ID = "WEBCAM";

export type LiveEventStatus = "recording" | "verifying" | VerificationStatus | "error";

/** Progress of a live candidate, reported by the live server with every frame. */
export interface LiveEvent {
  id: string;
  eventType: EventType;
  priority: Priority;
  status: LiveEventStatus;
  startSec: number;
  endSec: number;
  explanation?: string;
}

export interface VenueConfig {
  venueId: string;
  venueName: string;
  cameras: Camera[];
  normalSegments: { cameraId: string; startSec: number; endSec: number }[];
}

export interface TrackBox {
  id: number;
  /** Normalized [x1, y1, x2, y2]. */
  box: [number, number, number, number];
  /** 17 COCO keypoints as normalized [x, y, conf]; display only, absent when no skeleton matched. */
  kp?: [number, number, number][];
  /** Head cue from pipeline/ppe.py: "hat", "none" (no hard hat), or "unknown". */
  ppe?: "hat" | "none" | "unknown";
}

/** Scene-level optical flow inside the camera ROI (see pipeline/detect.py). */
export interface FlowStats {
  /** Mean speed, frame-widths per second. */
  mag: number;
  /** 0..1, length of the mean unit flow vector over moving pixels. */
  align: number;
  /** Degrees in image coordinates (-90 = up the frame). */
  dir: number;
  movingFrac: number;
}

/** A tracked forklift, pallet jack, or other vehicle (see pipeline/detect.py). */
export interface VehicleBox {
  id: number;
  /** Normalized [x1, y1, x2, y2]. */
  box: [number, number, number, number];
  /** Detector class name, e.g. "forklift" or "truck". */
  cls: string;
}

export interface TrackFrame {
  t: number;
  boxes: TrackBox[];
  vehicles?: VehicleBox[];
  /** Humanoid robots and AMRs the person detector picked up, kept out of every person check. */
  robots?: { id: number; box: [number, number, number, number] }[];
  flow?: FlowStats | null;
}

export interface CameraTracks {
  cameraId: string;
  fps: number;
  /** Source frame size in pixels, needed to turn normalized boxes back into real aspect ratios. */
  width?: number;
  height?: number;
  durationSec?: number;
  roi?: Point[];
  synthetic?: boolean;
  frames: TrackFrame[];
}

export interface EvalSummary {
  createdAt: string;
  promptVersion: string;
  verifier: string;
  weaveUrl?: string;
  metrics: Record<string, number>;
  rows: {
    cameraId: string;
    expected: EventType | "normal";
    predicted: EventType | "none";
    iou: number;
    status: VerificationStatus | "none";
  }[];
}

export const EVENT_LABEL: Record<EventType, string> = {
  restricted_zone_entry: "Person in restricted area",
  vehicle_pedestrian_proximity: "Possible forklift–pedestrian near miss",
  ppe_missing_hard_hat: "Possible missing hard hat",
  person_down_or_inactivity: "Person down / prolonged inactivity",
};

/** Terse forms for map pins and other places with no room for the full sentence. */
export const EVENT_LABEL_SHORT: Record<EventType, string> = {
  restricted_zone_entry: "Restricted entry",
  vehicle_pedestrian_proximity: "Near miss",
  ppe_missing_hard_hat: "No hard hat",
  person_down_or_inactivity: "Person down",
};

export const EVENT_TYPES = Object.keys(EVENT_LABEL) as EventType[];

/** Hex twins of --color-high/medium/low in globals.css (inline styles append alpha suffixes). */
export const PRIORITY_COLOR: Record<Priority, string> = {
  low: "#3f8a4f",
  medium: "#b07a12",
  high: "#d03b2f",
};

/** Verified reads strongest; unverified and rejected step down in weight, not hue. */
export const STATUS_COLOR: Record<VerificationStatus, string> = {
  candidate: "#8a909c",
  kept: "#2b3140",
  rejected: "#c4c8cf",
};
