"use client";

import { useEffect, useRef, useState } from "react";
import {
  EVENT_LABEL,
  LIVE_CAMERA_ID,
  type Camera,
  type LiveEvent,
  type LiveEventStatus,
  type Point,
  type TrackBox,
  type TrackFrame,
} from "@/app/lib/types";
import IncidentLink from "./IncidentLink";
import TrackOverlay from "./TrackOverlay";

const LIVE_URL = process.env.NEXT_PUBLIC_LIVE_URL ?? "http://localhost:8775";
// Frames are downscaled before upload; the server runs at imgsz 640 anyway.
const SEND_WIDTH = 960;
const JPEG_QUALITY = 0.7;
// Posture must hold this long before the tile flags it, so a quick bend does not.
const DOWN_HOLD_MS = 2000;

type Posture = "upright" | "tilted" | "down";
type LiveBox = TrackBox & { posture?: Posture };
type LiveFrame = { t: number; boxes: LiveBox[]; flow?: TrackFrame["flow"]; ms: number; events?: LiveEvent[] };
type Status = "idle" | "starting" | "live" | "no-server" | "no-camera";
type Health = { verifier?: string; camera?: { zone?: string; restrictedPolygons?: Point[][] } };

const WEBCAM: Camera = {
  id: LIVE_CAMERA_ID,
  zone: "Local webcam",
  zoneId: "webcam",
  videoFile: "",
  durationSec: 0,
  sourceType: "team_recorded",
  scenario: "Live webcam test feed",
};

const PENDING: LiveEventStatus[] = ["recording", "verifying"];
const DONE: LiveEventStatus[] = ["kept", "rejected", "candidate"];
const VERIFIER_NAME: Record<string, string> = { cosmos: "Cosmos", claude: "Claude", none: "No verifier" };
const STATUS_STYLE: Record<LiveEventStatus, { color: string; text: (verifier: string) => string }> = {
  recording: { color: "#b07a12", text: () => "Recording aftermath" },
  verifying: { color: "#b07a12", text: (v) => `${v} checking…` },
  kept: { color: "#2b3140", text: (v) => `${v}: verified` },
  rejected: { color: "#8a909c", text: (v) => `${v}: rejected` },
  candidate: { color: "#8a909c", text: () => "Unverified" },
  error: { color: "#d03b2f", text: () => "Failed" },
};

interface Props {
  showOverlay: boolean;
  /** Called once per live incident when the verifier has written it to the ledger. */
  onLiveIncident?: (id: string) => void;
}

/** Browser webcam, labeled live by pipeline/live_server.py (YOLO-pose + ByteTrack), which also
 * runs the four candidate checks and sends each new candidate's clip to the verifier. */
export default function WebcamTile({ showOverlay, onLiveIncident }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const runningRef = useRef(false);
  const downSince = useRef(new Map<number, number>());
  const [status, setStatus] = useState<Status>("idle");
  const [frame, setFrame] = useState<LiveFrame | null>(null);
  const [aspect, setAspect] = useState(16 / 9);
  const [fps, setFps] = useState(0);
  const [down, setDown] = useState<number[]>([]);
  const [mirrored, setMirrored] = useState(true);
  const [health, setHealth] = useState<Health>({});
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const notified = useRef(new Set<string>());
  const onIncidentRef = useRef(onLiveIncident);
  useEffect(() => {
    onIncidentRef.current = onLiveIncident;
  }, [onLiveIncident]);

  const takeEvents = (next: LiveEvent[] | undefined) => {
    if (!next) return;
    setEvents(next);
    for (const e of next) {
      if (DONE.includes(e.status) && !notified.current.has(e.id)) {
        notified.current.add(e.id);
        onIncidentRef.current?.(e.id);
      }
    }
  };

  const stop = () => {
    const wasRunning = runningRef.current;
    runningRef.current = false;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    downSince.current.clear();
    setFrame(null);
    setDown([]);
    setFps(0);
    setStatus("idle");
    // Candidates still recording their aftermath are verified with the frames sent so far.
    if (wasRunning) {
      fetch(`${LIVE_URL}/stop`, { method: "POST" })
        .then((r) => r.json())
        .then((d: { events?: LiveEvent[] }) => takeEvents(d.events))
        .catch(() => {});
    }
  };

  useEffect(() => () => {
    if (runningRef.current) fetch(`${LIVE_URL}/stop`, { method: "POST" }).catch(() => {});
    runningRef.current = false;
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  // After Stop no frame responses arrive, so poll until pending verifications finish.
  const hasPending = events.some((e) => PENDING.includes(e.status));
  useEffect(() => {
    if (status === "live" || !hasPending) return;
    const id = setInterval(() => {
      fetch(`${LIVE_URL}/events`)
        .then((r) => r.json())
        .then((d: { events?: LiveEvent[] }) => takeEvents(d.events))
        .catch(() => {});
    }, 2000);
    return () => clearInterval(id);
  }, [status, hasPending]);

  const loop = async () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = (canvasRef.current ??= document.createElement("canvas"));
    const scale = Math.min(1, SEND_WIDTH / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let reset = true;
    let last = performance.now();
    while (runningRef.current) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", JPEG_QUALITY));
      if (!blob) continue;
      try {
        const res = await fetch(`${LIVE_URL}/frame${reset ? "?reset=1" : ""}`, { method: "POST", body: blob });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as LiveFrame;
        if (!runningRef.current) break;
        reset = false;
        const now = performance.now();
        setFps((f) => f * 0.8 + (1000 / Math.max(1, now - last)) * 0.2);
        last = now;
        setFrame(data);
        takeEvents(data.events);
        const ids = new Set(data.boxes.map((b) => b.id));
        for (const b of data.boxes) {
          if (b.posture === "down") {
            if (!downSince.current.has(b.id)) downSince.current.set(b.id, now);
          } else downSince.current.delete(b.id);
        }
        for (const id of downSince.current.keys()) if (!ids.has(id)) downSince.current.delete(id);
        setDown([...downSince.current].filter(([, since]) => now - since >= DOWN_HOLD_MS).map(([id]) => id));
        setStatus("live");
      } catch {
        if (!runningRef.current) break;
        setStatus("no-server");
        setFrame(null);
        await new Promise((r) => setTimeout(r, 1500));
        reset = true;
      }
    }
  };

  const start = async () => {
    setStatus("starting");
    fetch(`${LIVE_URL}/health`)
      .then((r) => r.json())
      .then((h: Health) => setHealth(h))
      .catch(() => {});
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      setAspect(video.videoWidth / video.videoHeight || 16 / 9);
      runningRef.current = true;
      void loop();
    } catch {
      setStatus("no-camera");
    }
  };

  const active = status === "live" || status === "no-server" || status === "starting";
  const people = frame?.boxes.length ?? 0;
  // The server labels the unmirrored frame; flip coordinates instead of the SVG so ID text stays readable.
  const overlayFrame: TrackFrame | null = frame
    ? {
        t: frame.t,
        boxes: mirrored
          ? frame.boxes.map((b) => ({
              ...b,
              box: [1 - b.box[2], b.box[1], 1 - b.box[0], b.box[3]],
              kp: b.kp?.map(([x, y, c]) => [1 - x, y, c] as [number, number, number]),
            }))
          : frame.boxes,
        flow: frame.flow && mirrored ? { ...frame.flow, dir: 180 - frame.flow.dir } : frame.flow,
      }
    : null;
  const polygons = health.camera?.restrictedPolygons ?? [];
  const camera: Camera = {
    ...WEBCAM,
    zone: health.camera?.zone ?? WEBCAM.zone,
    restrictedPolygons: mirrored ? polygons.map((p) => p.map(([x, y]) => [1 - x, y] as Point)) : polygons,
  };
  const verifier = VERIFIER_NAME[health.verifier ?? ""] ?? health.verifier ?? "Verifier";
  const recent = [...events].reverse().slice(0, 3);

  return (
    <div className={`flex flex-col overflow-hidden rounded-xl border bg-surface ${down.length ? "tile-alert" : "border-line"}`}
      style={down.length ? ({ "--pulse": "#d03b2f" } as React.CSSProperties) : undefined}>
      <div className="relative bg-footage" style={{ aspectRatio: String(aspect) }}>
        <video ref={videoRef} className={`h-full w-full object-fill ${active ? "" : "hidden"}`}
          style={mirrored ? { transform: "scaleX(-1)" } : undefined} muted playsInline />
        {!active && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <span className="text-[13px] font-medium text-white/85">Live webcam</span>
            <span className="text-[12px] text-white/55">{status === "no-camera" ? "Camera permission was denied, or no camera was found." : "Run the same checks on your own camera, live."}</span>
            <button type="button" onClick={start}
              className="mt-1.5 rounded-md bg-white px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-white/90">
              Start webcam
            </button>
          </div>
        )}
        {showOverlay && overlayFrame && (
          <div className="pointer-events-none absolute inset-0">
            <TrackOverlay camera={camera} frame={overlayFrame} highlight={new Set(down)} showIds />
          </div>
        )}
        {active && (
          <div className="absolute bottom-2 right-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] tabular-nums text-white/90">
            {people} {people === 1 ? "person" : "people"}
            {status === "live" ? ` · ${fps.toFixed(1)} fps` : ""}
          </div>
        )}
        {active && (
          <div className="absolute right-2 top-2 flex items-center gap-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#ff5a4e]" /> Live
          </div>
        )}
        {down.length > 0 && (
          <div className="absolute left-2 top-2 rounded-md bg-[#d03b2f] px-2 py-1 text-[12px] font-medium text-white shadow-sm">
            Possible person down · {down.map((id) => `#${id}`).join(", ")}
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 px-3 pb-3 pt-2.5 text-[12px]">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[13px] font-medium text-ink">{health.camera?.zone ?? "Webcam"}</span>
          <span className="flex items-center gap-3 text-ink-3">
            <span className={status === "no-server" ? "text-[#b07a12]" : ""}>
              {status === "live" ? "Labeling" : status === "no-server" ? "Server unreachable" : status === "starting" ? "Starting…" : "Off"}
            </span>
            <button type="button" onClick={() => setMirrored((m) => !m)} className="transition-colors hover:text-ink">
              {mirrored ? "Mirrored" : "Unmirrored"}
            </button>
            {active && (
              <button type="button" onClick={stop} className="font-medium text-ink-2 transition-colors hover:text-ink">Stop</button>
            )}
          </span>
        </div>
        {recent.length > 0 && (
          <ul className="flex flex-col gap-1">
            {recent.map((e) => {
              const style = STATUS_STYLE[e.status];
              const label = `${EVENT_LABEL[e.eventType]} · ${e.startSec.toFixed(0)}s`;
              return (
                <li key={e.id} className="flex items-center justify-between gap-2" title={e.explanation}>
                  {DONE.includes(e.status)
                    ? <IncidentLink id={e.id} className="truncate text-ink-2 hover:text-ink hover:underline">{label}</IncidentLink>
                    : <span className="truncate text-ink-2">{label}</span>}
                  <span className="flex-shrink-0 font-medium" style={{ color: style.color }}>{style.text(verifier)}</span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="leading-relaxed text-ink-3">
          {status === "no-server"
            ? <>Start it with <code className="rounded bg-sunken px-1 font-mono text-ink-2">npm run live</code> ({LIVE_URL}).</>
            : <>Flags restricted-zone entry and people down, then sends each clip
              {verifier === "No verifier" || verifier === "Verifier" ? " for review" : ` to ${verifier}`}.</>}
        </p>
      </div>
    </div>
  );
}
