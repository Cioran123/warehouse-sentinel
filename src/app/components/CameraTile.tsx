"use client";

import { useEffect, useRef, useState } from "react";
import type { CameraStatus, IndexStatus } from "@/app/lib/cameraStatus";
import { formatSpan } from "@/app/lib/format";
import { EVENT_LABEL, PRIORITY_COLOR, type CameraTracks, type Incident } from "@/app/lib/types";
import { VerificationBadge } from "./Badges";
import IncidentLink from "./IncidentLink";
import { useFullscreen } from "@/app/lib/ui/useFullscreen";
import { forgetVideo, reportVideoTime } from "@/app/lib/ui/videoClock";
import FullscreenButton from "./FullscreenButton";
import TrackOverlay, { nearestFrame } from "./TrackOverlay";

/** Only states that need the supervisor's attention get a note; indexed cameras say nothing. */
const INDEX_NOTE: Partial<Record<IndexStatus, string>> = {
  missing_video: "Awaiting footage",
  not_indexed: "Not indexed yet",
};

interface Props {
  status: CameraStatus;
  showOverlay: boolean;
  /** Incidents whose span contains the current playback time. */
  active: Incident[];
  onTime: (cameraId: string, t: number) => void;
  /** The camera's zone is selected on the venue map. */
  selected?: boolean;
  /** The assistant's latest answer mentions this camera's zone. */
  highlighted?: boolean;
  onSelectZone?: () => void;
}

export default function CameraTile({ status, showOverlay, active, onTime, selected = false, highlighted = false, onSelectZone }: Props) {
  const { camera, indexStatus, latest, incidentCount } = status;
  const note = INDEX_NOTE[indexStatus];
  const [tracks, setTracks] = useState<CameraTracks | null>(null);
  const [time, setTime] = useState(0);
  const hasVideo = indexStatus !== "missing_video";

  useEffect(() => {
    if (!hasVideo) return;
    let cancelled = false;
    fetch(`/api/cameras/${camera.id}/tracks`)
      .then((r) => (r.ok ? (r.json() as Promise<CameraTracks>) : null))
      .then((t) => {
        if (!cancelled) setTracks(t);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [camera.id, hasVideo]);

  useEffect(() => () => forgetVideo(camera.id), [camera.id]);
  const frameRef = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreen(frameRef);

  const frame = tracks ? nearestFrame(tracks.frames, time) : null;
  const top = active[0];
  const pulseColor = top ? PRIORITY_COLOR[top.priority] : undefined;

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-xl border bg-surface transition-[border-color,box-shadow] duration-200 ${
        top ? "tile-alert" : selected ? "border-accent shadow-[0_0_0_3px_var(--color-accent-soft)]" : highlighted ? "border-accent-line" : "border-line hover:border-line-strong"
      }`}
      style={pulseColor ? ({ "--pulse": pulseColor } as React.CSSProperties) : undefined}
    >
      <div ref={frameRef} className="fs-frame">
      <div
        className={`fs-stage group relative aspect-video bg-footage ${onSelectZone && !fullscreen.active ? "cursor-pointer" : ""}`}
        onClick={fullscreen.active ? undefined : onSelectZone}
        title={onSelectZone && !fullscreen.active ? `${selected ? "Clear focus on" : "Focus"} ${camera.zone}` : undefined}
      >
        {!hasVideo ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
            <span className="text-[13px] font-medium text-white/80">Awaiting footage</span>
            <span className="text-[12px] text-white/50">Add shots to footage/{camera.id}/ and run pipeline/assemble.py</span>
          </div>
        ) : (
          <>
            <video
              src={`/api/cameras/${camera.id}/video`}
              className="h-full w-full object-cover"
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
              onTimeUpdate={(e) => {
                const v = e.currentTarget;
                setTime(v.currentTime);
                onTime(camera.id, v.currentTime);
                reportVideoTime(camera.id, v.currentTime, !v.paused, v.duration);
              }}
              onPause={(e) => reportVideoTime(camera.id, e.currentTarget.currentTime, false, e.currentTarget.duration)}
            />
            {showOverlay && frame && (
              <div className="pointer-events-none absolute inset-0">
                <TrackOverlay camera={camera} frame={frame} showIds />
              </div>
            )}
          </>
        )}
        {frame && (
          <div className="absolute bottom-2 right-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] tabular-nums text-white/90">
            {frame.boxes.length} {frame.boxes.length === 1 ? "person" : "people"}
            {frame.vehicles?.length ? ` · ${frame.vehicles.length} vehicle${frame.vehicles.length === 1 ? "" : "s"}` : ""}
          </div>
        )}
        {top && (
          <IncidentLink
            id={top.id}
            className="absolute left-2 top-2 flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-white shadow-sm transition-[filter] hover:brightness-110"
            style={{ background: pulseColor }}
            title="Open this incident"
          >
            {EVENT_LABEL[top.eventType]}
            <span className="text-white/75">Review →</span>
          </IncidentLink>
        )}
        <div className="absolute right-2 top-2 flex items-center gap-2">
          {fullscreen.active && (
            <span className="rounded-md bg-black/60 px-2 py-1 text-[12px] font-medium text-white/90">
              {camera.zone} <span className="font-mono text-white/60">{camera.id}</span>
            </span>
          )}
          {hasVideo && (
            <FullscreenButton
              active={fullscreen.active}
              onToggle={fullscreen.toggle}
              label={camera.zone}
              className={`bg-black/60 text-white/90 hover:bg-black/80 ${fullscreen.active ? "" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100"}`}
            />
          )}
        </div>
      </div>
      </div>
      <div className="flex flex-1 flex-col gap-2 px-3 pb-3 pt-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[13px] font-medium text-ink">{camera.zone}</span>
          <span className="flex-shrink-0 font-mono text-[11px] text-ink-3">
            {note ? `${note} · ` : ""}
            {camera.id}
          </span>
        </div>
        {latest ? (
          <IncidentLink
            id={latest.id}
            className="-mx-1.5 flex flex-col gap-1 rounded-lg px-1.5 py-1 transition-colors hover:bg-sunken"
          >
            <span className="flex items-baseline justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: PRIORITY_COLOR[latest.priority] }} />
                <span className="truncate text-[12px] text-ink-2">{EVENT_LABEL[latest.eventType]}</span>
              </span>
              <span className="flex-shrink-0 font-mono text-[11px] text-ink-3">{formatSpan(latest.startSec, latest.endSec)}</span>
            </span>
            <span className="flex items-center justify-between gap-2 pl-3">
              <VerificationBadge status={latest.verificationStatus} />
              {incidentCount > 1 && <span className="text-[11px] text-ink-3">+{incidentCount - 1} more</span>}
            </span>
          </IncidentLink>
        ) : (
          <p className="text-[12px] text-ink-3">{hasVideo ? "No incidents flagged" : camera.scenario}</p>
        )}
      </div>
    </div>
  );
}
